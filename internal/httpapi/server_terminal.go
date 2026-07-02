package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"deploy-manager/internal/sshutil"
	"deploy-manager/internal/stringutil"

	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/ssh"
)

const terminalConnectTimeout = 10 * time.Second

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
	if initialDirectory != "" {
		if err := session.Start(fmt.Sprintf("cd %s && exec ${SHELL:-/bin/bash} -i", stringutil.ShellQuote(initialDirectory))); err != nil {
			writeTerminalError(conn, err)
			return
		}
	} else if err := session.Shell(); err != nil {
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

func (s Server) terminalInitialDirectory(r *http.Request, serverID pgtype.UUID) (string, error) {
	value := strings.TrimSpace(r.URL.Query().Get("application_id"))
	if value == "" {
		return "", nil
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
	return application.RemoteDirectory, nil
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
