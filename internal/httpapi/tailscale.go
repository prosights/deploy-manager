package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os/exec"
	"sort"
	"strings"
	"time"
)

type tailscaleDevice struct {
	Name     string   `json:"name"`
	Host     string   `json:"host"`
	DNSName  string   `json:"dns_name"`
	OS       string   `json:"os"`
	Online   bool     `json:"online"`
	Tags     []string `json:"tags"`
	LastSeen string   `json:"last_seen,omitempty"`
}

type tailscaleDevicesResponse struct {
	Available bool              `json:"available"`
	Error     string            `json:"error,omitempty"`
	Devices   []tailscaleDevice `json:"devices"`
}

type tailscaleStatus struct {
	Peer map[string]tailscalePeer `json:"Peer"`
}

type tailscalePeer struct {
	HostName     string    `json:"HostName"`
	DNSName      string    `json:"DNSName"`
	TailscaleIPs []string  `json:"TailscaleIPs"`
	Online       bool      `json:"Online"`
	OS           string    `json:"OS"`
	Tags         []string  `json:"Tags"`
	LastSeen     time.Time `json:"LastSeen"`
}

func (s Server) listTailscaleDevices(w http.ResponseWriter, r *http.Request) {
	devices, err := tailscaleDevices(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, tailscaleDevicesResponse{
			Available: false,
			Error:     err.Error(),
			Devices:   []tailscaleDevice{},
		})
		return
	}
	writeJSON(w, http.StatusOK, tailscaleDevicesResponse{
		Available: true,
		Devices:   devices,
	})
}

func tailscaleDevices(ctx context.Context) ([]tailscaleDevice, error) {
	path, err := exec.LookPath("tailscale")
	if err != nil {
		return nil, errors.New("tailscale CLI is not installed or not on PATH")
	}
	command := exec.CommandContext(ctx, path, "status", "--json")
	output, err := command.Output()
	if err != nil {
		return nil, errors.New("tailscale status failed")
	}
	var status tailscaleStatus
	if err := json.Unmarshal(output, &status); err != nil {
		return nil, errors.New("tailscale status returned invalid JSON")
	}
	devices := make([]tailscaleDevice, 0, len(status.Peer))
	for _, peer := range status.Peer {
		host := firstTailscaleIP(peer.TailscaleIPs)
		if host == "" {
			continue
		}
		devices = append(devices, tailscaleDevice{
			Name:     peer.HostName,
			Host:     host,
			DNSName:  strings.TrimSuffix(peer.DNSName, "."),
			OS:       peer.OS,
			Online:   peer.Online,
			Tags:     peer.Tags,
			LastSeen: formatTailscaleTime(peer.LastSeen),
		})
	}
	sort.Slice(devices, func(i, j int) bool {
		if devices[i].Online != devices[j].Online {
			return devices[i].Online
		}
		return devices[i].Name < devices[j].Name
	})
	return devices, nil
}

func firstTailscaleIP(ips []string) string {
	for _, ip := range ips {
		if strings.Contains(ip, ".") {
			return ip
		}
	}
	if len(ips) > 0 {
		return ips[0]
	}
	return ""
}

func formatTailscaleTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.Format(time.RFC3339)
}
