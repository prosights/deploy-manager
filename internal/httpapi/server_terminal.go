package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path"
	"strings"
	"sync"
	"time"

	"deploy-manager/internal/db"
	"deploy-manager/internal/sshutil"
	"deploy-manager/internal/stringutil"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/ssh"
)

const terminalConnectTimeout = 10 * time.Second
const defaultServerTerminalDirectory = "/srv/deploy-manager"

type terminalClientMessage struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
}

func (s Server) serverTerminal(w http.ResponseWriter, r *http.Request) {
	serverID, err := parseUUIDParam(r, "serverID")
	if err != nil {
		writeError(w, err)
		return
	}
	server, err := s.queries.GetServer(r.Context(), serverID)
	if err != nil {
		writeError(w, serverLookupError(err))
		return
	}
	initialDirectory, err := s.terminalInitialDirectory(r, serverID)
	if err != nil {
		writeError(w, err)
		return
	}

	upgrader := websocketUpgrader()
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithTimeout(r.Context(), terminalConnectTimeout)
	defer cancel()

	if server.ConnectionMode == sshutil.ConnectionModeTailscaleSSH {
		if sshutil.IsLocalTailscaleHost(ctx, server.Hostname) {
			s.runLocalTerminal(r.Context(), conn, r, server, initialDirectory)
			return
		}
		s.runTailscaleTerminal(r.Context(), conn, r, server, initialDirectory)
		return
	}

	sshClient, err := sshutil.ServerClient(ctx, server, sshutil.FileSigner{})
	if err != nil {
		writeTerminalError(conn, err)
		return
	}
	client, err := sshClient.Connect(ctx)
	if err != nil {
		writeTerminalError(conn, err)
		return
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		writeTerminalError(conn, err)
		return
	}
	defer session.Close()

	stdin, err := session.StdinPipe()
	if err != nil {
		writeTerminalError(conn, err)
		return
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		writeTerminalError(conn, err)
		return
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		writeTerminalError(conn, err)
		return
	}

	if err := session.RequestPty("xterm-256color", 32, 120, ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}); err != nil {
		writeTerminalError(conn, err)
		return
	}
	if err := session.Start(terminalShellCommand(initialDirectory, "/bin/bash", false)); err != nil {
		writeTerminalError(conn, err)
		return
	}

	s.audit(r, "server.terminal.open", "server", uuidString(server.ID), server.Name, map[string]any{"connection_mode": server.ConnectionMode, "application_directory": initialDirectory != ""})
	writer := terminalWriter{conn: conn}
	done := make(chan struct{}, 2)
	go copyTerminalOutput(&writer, stdout, done)
	go copyTerminalOutput(&writer, stderr, done)

	for {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var message terminalClientMessage
		if err := json.Unmarshal(payload, &message); err != nil {
			continue
		}
		switch message.Type {
		case "input":
			_, _ = io.WriteString(stdin, message.Data)
		case "resize":
			if message.Rows > 0 && message.Cols > 0 {
				_ = session.WindowChange(message.Rows, message.Cols)
			}
		}
	}
	_ = session.Signal(ssh.SIGHUP)
	_ = session.Close()
	<-done
	<-done
}

func (s Server) runLocalTerminal(ctx context.Context, conn *websocket.Conn, r *http.Request, server db.Server, initialDirectory string) {
	commandText := terminalShellCommand(initialDirectory, "/bin/sh", true)
	command := exec.CommandContext(ctx, "sh", "-lc", commandText)
	terminal, err := pty.StartWithSize(command, &pty.Winsize{Rows: 32, Cols: 120})
	if err != nil {
		writeTerminalError(conn, err)
		return
	}
	defer terminal.Close()

	s.audit(r, "server.terminal.open", "server", uuidString(server.ID), server.Name, map[string]any{"connection_mode": "local", "application_directory": initialDirectory != ""})
	bridgeTerminal(conn, terminal, command)
}

func (s Server) runTailscaleTerminal(ctx context.Context, conn *websocket.Conn, r *http.Request, server db.Server, initialDirectory string) {
	if err := sshutil.ValidateTailscaleHost(server.Hostname); err != nil {
		writeTerminalError(conn, err)
		return
	}
	if strings.TrimSpace(server.SshUser) == "" {
		writeTerminalError(conn, validationError("server ssh_user is required for Tailscale SSH"))
		return
	}

	args := []string{"ssh", strings.TrimSpace(server.SshUser) + "@" + strings.TrimSpace(server.Hostname)}
	args = append(args, terminalShellCommand(initialDirectory, "/bin/bash", false))
	command := exec.CommandContext(ctx, "tailscale", args...)
	terminal, err := pty.StartWithSize(command, &pty.Winsize{Rows: 32, Cols: 120})
	if err != nil {
		writeTerminalError(conn, err)
		return
	}
	defer terminal.Close()

	s.audit(r, "server.terminal.open", "server", uuidString(server.ID), server.Name, map[string]any{"connection_mode": server.ConnectionMode, "application_directory": initialDirectory != ""})
	bridgeTerminal(conn, terminal, command)
}

func terminalColorEnv() string {
	return "export TERM=xterm-256color CLICOLOR=1 CLICOLOR_FORCE=1 COLORTERM=truecolor FORCE_COLOR=1"
}

func terminalPromptEnv() string {
	return `ESC="$(printf '\033')"; export PS1="${ESC}[1;32m\\u@\\h${ESC}[0m:${ESC}[1;34m\\w${ESC}[0m $ "`
}

func terminalShellCommand(initialDirectory string, fallbackShell string, includePrompt bool) string {
	parts := []string{terminalColorEnv()}
	if includePrompt {
		parts = append(parts, terminalPromptEnv())
	}
	if initialDirectory != "" {
		quoted := stringutil.ShellQuote(initialDirectory)
		parts = append(parts, "if [ -d "+quoted+" ]; then cd "+quoted+"; fi")
	}
	parts = append(parts, "exec ${SHELL:-"+fallbackShell+"} -i")
	return strings.Join(parts, "; ")
}

func bridgeTerminal(conn *websocket.Conn, terminal *os.File, command *exec.Cmd) {
	writer := terminalWriter{conn: conn}
	done := make(chan struct{}, 1)
	go copyTerminalOutput(&writer, terminal, done)

	for {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var message terminalClientMessage
		if err := json.Unmarshal(payload, &message); err != nil {
			continue
		}
		switch message.Type {
		case "input":
			_, _ = io.WriteString(terminal, message.Data)
		case "resize":
			if message.Rows > 0 && message.Cols > 0 {
				_ = pty.Setsize(terminal, &pty.Winsize{Rows: uint16(message.Rows), Cols: uint16(message.Cols)})
			}
		}
	}
	_ = command.Process.Kill()
	_ = command.Wait()
	<-done
}

func (s Server) terminalInitialDirectory(r *http.Request, serverID pgtype.UUID) (string, error) {
	value := strings.TrimSpace(r.URL.Query().Get("application_id"))
	if value == "" {
		return defaultServerTerminalDirectory, nil
	}
	applicationID, err := stringutil.PgUUID(value)
	if err != nil {
		return "", validationError("invalid application_id")
	}
	application, err := s.queries.GetApplication(r.Context(), applicationID)
	if err != nil {
		return "", applicationLookupError(err, "application not found")
	}
	if application.ServerID != serverID {
		return "", validationError("application does not belong to this server")
	}
	return applicationTerminalDirectory(application), nil
}

func applicationTerminalDirectory(application db.Application) string {
	composeDirectory := path.Dir(application.ComposePath)
	if composeDirectory == "." {
		return application.RemoteDirectory
	}
	return path.Join(application.RemoteDirectory, composeDirectory)
}

func websocketUpgrader() websocket.Upgrader {
	return websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			origin := strings.TrimSpace(r.Header.Get("Origin"))
			if origin == "" {
				return true
			}
			return sameHostOrigin(origin, r.Host)
		},
	}
}

func sameHostOrigin(origin string, host string) bool {
	origin = strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(origin, "http://"), "https://"))
	return strings.EqualFold(origin, host)
}

type terminalWriter struct {
	mu   sync.Mutex
	conn *websocket.Conn
}

func (w *terminalWriter) Write(payload []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.conn.WriteMessage(websocket.TextMessage, payload)
}

func copyTerminalOutput(writer *terminalWriter, reader io.Reader, done chan<- struct{}) {
	defer func() { done <- struct{}{} }()
	buffer := make([]byte, 4096)
	for {
		n, err := reader.Read(buffer)
		if n > 0 {
			if writeErr := writer.Write(buffer[:n]); writeErr != nil {
				return
			}
		}
		if err != nil {
			return
		}
	}
}

func writeTerminalError(conn *websocket.Conn, err error) {
	if err == nil || errors.Is(err, context.Canceled) {
		return
	}
	_ = conn.WriteMessage(websocket.TextMessage, []byte("\r\nterminal error: "+err.Error()+"\r\n"))
}
