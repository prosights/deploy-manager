package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"deploy-manager/internal/db"
	proxypkg "deploy-manager/internal/proxy"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s Server) listProxyRoutes(w http.ResponseWriter, r *http.Request) {
	routes, err := s.queries.ListProxyRoutes(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, routes)
}

func (s Server) createProxyRoute(w http.ResponseWriter, r *http.Request) {
	var input db.CreateProxyRouteParams
	if err := readJSON(w, r, &input); err != nil {
		writeError(w, err)
		return
	}
	input.Domain = strings.TrimSpace(input.Domain)
	input.UpstreamUrl = strings.TrimSpace(input.UpstreamUrl)
	input.BlueUpstreamUrl.String = strings.TrimSpace(input.BlueUpstreamUrl.String)
	input.GreenUpstreamUrl.String = strings.TrimSpace(input.GreenUpstreamUrl.String)
	input.ComposeService.String = strings.TrimSpace(input.ComposeService.String)
	input.PortVariable.String = strings.TrimSpace(input.PortVariable.String)
	var application *db.Application
	if input.ApplicationID.Valid {
		loaded, err := s.queries.GetApplication(r.Context(), input.ApplicationID)
		if err != nil {
			writeError(w, proxyLookupError(err, "application not found"))
			return
		}
		application = &loaded
		input = normalizeCreateProxyRoute(input, application)
	}
	input = normalizeCreateProxyRoute(input, nil)
	if !input.ServerID.Valid {
		writeError(w, validationError("server_id is required"))
		return
	}
	server, err := s.queries.GetServer(r.Context(), input.ServerID)
	if err != nil {
		writeError(w, proxyLookupError(err, "server not found"))
		return
	}
	var route db.ProxyRoute
	if input.UpstreamUrl == "" {
		if application == nil {
			writeError(w, validationError("upstream_url is required for routes not linked to a service"))
			return
		}
		route, err = s.createDerivedProxyRoute(r.Context(), input, *application, server)
		if err != nil {
			writeError(w, err)
			return
		}
	} else {
		if err := validateProxyRouteInput(input, server.ProxyType); err != nil {
			writeError(w, err)
			return
		}
		route, err = s.queries.CreateProxyRoute(r.Context(), input)
		if err != nil {
			writeError(w, err)
			return
		}
	}
	s.audit(r, "proxy_route.upsert", "proxy_route", uuidString(route.ID), route.Domain, map[string]any{"server_id": uuidString(route.ServerID), "tls_enabled": route.TlsEnabled, "compose_service": route.ComposeService.String, "container_port": route.ContainerPort.Int32})
	writeJSON(w, http.StatusCreated, route)
}

func (s Server) deleteProxyRoute(w http.ResponseWriter, r *http.Request) {
	routeID, err := parseUUIDParam(r, "routeID")
	if err != nil {
		writeError(w, err)
		return
	}
	route, err := s.queries.GetProxyRouteTarget(r.Context(), routeID)
	if err != nil {
		writeError(w, proxyLookupError(err, "proxy route not found"))
		return
	}
	if route.Status != "pending" {
		server, err := s.queries.GetServer(r.Context(), route.ServerID)
		if err != nil {
			writeError(w, err)
			return
		}
		command, err := proxypkg.BuildRemoveCommand(route.Domain, route.ProxyType)
		if err != nil {
			writeError(w, validationError(err.Error()))
			return
		}
		removeCtx, cancel := context.WithTimeout(r.Context(), serverCheckTimeout)
		defer cancel()
		if _, err := s.remoteCommandRunner().Run(removeCtx, server, command); err != nil {
			writeError(w, err)
			return
		}
	}
	if err := s.queries.DeleteProxyRoute(r.Context(), routeID); err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "proxy_route.delete", "proxy_route", uuidString(route.ID), route.Domain, map[string]any{"server_id": uuidString(route.ServerID)})
	w.WriteHeader(http.StatusNoContent)
}

func normalizeCreateProxyRoute(input db.CreateProxyRouteParams, application *db.Application) db.CreateProxyRouteParams {
	if application != nil {
		input.ServerID = application.ServerID
		if strings.TrimSpace(input.Domain) == "" && application.Domain.Valid {
			input.Domain = application.Domain.String
		}
	}
	input.Domain = strings.ToLower(strings.TrimSpace(input.Domain))
	input.UpstreamUrl = strings.TrimSpace(input.UpstreamUrl)
	input.BlueUpstreamUrl = blankTextAsNull(input.BlueUpstreamUrl)
	input.GreenUpstreamUrl = blankTextAsNull(input.GreenUpstreamUrl)
	input.ComposeService = blankTextAsNull(input.ComposeService)
	input.PortVariable = blankTextAsNull(input.PortVariable)
	return input
}

var (
	composeServiceNamePattern  = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,128}$`)
	managedPortVariablePattern = regexp.MustCompile(`^[A-Z_][A-Z0-9_]{0,127}$`)
)

const (
	managedPortRangeStart = 20000
	managedPortRangeEnd   = 39999
)

func (s Server) createDerivedProxyRoute(ctx context.Context, input db.CreateProxyRouteParams, application db.Application, server db.Server) (db.ProxyRoute, error) {
	if s.tx == nil {
		return db.ProxyRoute{}, fmt.Errorf("database transactions are not configured")
	}
	tx, err := s.tx.Begin(ctx)
	if err != nil {
		return db.ProxyRoute{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	queries := s.queries.WithTx(tx)
	server, err = queries.GetServerForUpdate(ctx, server.ID)
	if err != nil {
		return db.ProxyRoute{}, err
	}
	routes, err := queries.ListProxyRoutesForServer(ctx, server.ID)
	if err != nil {
		return db.ProxyRoute{}, err
	}
	input, err = deriveProxyRouteInput(input, application, server, routes)
	if err != nil {
		return db.ProxyRoute{}, err
	}
	if err := validateProxyRouteInput(input, server.ProxyType); err != nil {
		return db.ProxyRoute{}, err
	}
	route, err := queries.CreateProxyRoute(ctx, input)
	if err != nil {
		return db.ProxyRoute{}, err
	}
	if err := queries.BumpApplicationConfigurationRevision(ctx, application.ID); err != nil {
		return db.ProxyRoute{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.ProxyRoute{}, err
	}
	return route, nil
}

func deriveProxyRouteInput(input db.CreateProxyRouteParams, application db.Application, server db.Server, routes []db.ProxyRoute) (db.CreateProxyRouteParams, error) {
	if input.ApplicationID != application.ID || application.ServerID != server.ID {
		return input, validationError("service and server do not match")
	}
	serviceName := strings.TrimSpace(input.ComposeService.String)
	if !input.ComposeService.Valid || !composeServiceNamePattern.MatchString(serviceName) || !input.ContainerPort.Valid || input.ContainerPort.Int32 < 1 || input.ContainerPort.Int32 > 65535 {
		return input, validationError("compose_service and container_port are required")
	}

	var stack []githubComposeService
	if len(application.ComposeServices) > 0 && json.Unmarshal(application.ComposeServices, &stack) != nil {
		return input, validationError("service compose metadata is invalid; scan the repository again")
	}
	port := githubComposePort{ContainerPort: int(input.ContainerPort.Int32)}
	if len(stack) > 0 {
		service, ok := findComposeService(stack, serviceName)
		if !ok {
			return input, validationError("selected compose service was not found")
		}
		if detected, ok := findComposePort([]githubComposeService{service}, serviceName, int(input.ContainerPort.Int32)); ok {
			port = detected
		}
	}
	if protocol := strings.ToLower(strings.TrimSpace(port.Protocol)); protocol != "" && protocol != "tcp" {
		return input, validationError("domains can only target TCP compose ports")
	}
	portVariable := ""
	if managedPortVariablePattern.MatchString(port.Variable) {
		portVariable = port.Variable
	}

	input = normalizeCreateProxyRoute(input, &application)
	if input.Domain == "" {
		return input, validationError("domain is required")
	}
	for _, route := range routes {
		if route.Domain == input.Domain && route.ApplicationID != application.ID {
			return input, validationError("domain is already assigned to another service")
		}
		if portVariable != "" && route.ApplicationID == application.ID && route.PortVariable.Valid && route.PortVariable.String == portVariable && !sameComposeEndpoint(route, application.ID, serviceName, input.ContainerPort.Int32) {
			return input, validationError("each routed compose endpoint needs its own port variable")
		}
		if sameComposeEndpoint(route, application.ID, serviceName, input.ContainerPort.Int32) {
			bluePort, blueOK := proxyURLPort(route.BlueUpstreamUrl.String)
			greenPort, greenOK := proxyURLPort(route.GreenUpstreamUrl.String)
			if !route.BlueUpstreamUrl.Valid || !route.GreenUpstreamUrl.Valid || !blueOK || !greenOK {
				return input, validationError("existing endpoint route has invalid blue-green upstreams")
			}
			host := deploymentRouteHost(server.Hostname)
			input.UpstreamUrl = route.UpstreamUrl
			input.BlueUpstreamUrl = pgtype.Text{String: proxyOrigin(host, bluePort), Valid: true}
			input.GreenUpstreamUrl = pgtype.Text{String: proxyOrigin(host, greenPort), Valid: true}
			input.PortVariable = route.PortVariable
			if strings.TrimSpace(server.Hostname) == "playground" {
				input.TlsEnabled = false
			}
			return input, nil
		}
	}

	used := make(map[int]bool)
	for _, route := range routes {
		for _, value := range []string{route.UpstreamUrl, route.BlueUpstreamUrl.String, route.GreenUpstreamUrl.String} {
			if port, ok := proxyURLPort(value); ok {
				used[port] = true
			}
		}
	}
	bluePort, greenPort, ok := allocateManagedPortPair(port.PublishedPort, used)
	if !ok {
		return input, validationError("server has no available managed deployment ports")
	}
	host := deploymentRouteHost(server.Hostname)
	input.UpstreamUrl = proxyOrigin(host, bluePort)
	input.BlueUpstreamUrl = pgtype.Text{String: proxyOrigin(host, bluePort), Valid: true}
	input.GreenUpstreamUrl = pgtype.Text{String: proxyOrigin(host, greenPort), Valid: true}
	input.PortVariable = blankTextAsNull(pgtype.Text{String: portVariable, Valid: portVariable != ""})
	if strings.TrimSpace(server.Hostname) == "playground" {
		input.TlsEnabled = false
	}
	return input, nil
}

func findComposeService(stack []githubComposeService, serviceName string) (githubComposeService, bool) {
	for _, service := range stack {
		if service.Name == serviceName {
			return service, true
		}
	}
	return githubComposeService{}, false
}

func findComposePort(stack []githubComposeService, serviceName string, containerPort int) (githubComposePort, bool) {
	for _, service := range stack {
		if service.Name != serviceName {
			continue
		}
		for _, port := range service.Ports {
			if port.ContainerPort == containerPort {
				return port, true
			}
		}
	}
	return githubComposePort{}, false
}

func sameComposeEndpoint(route db.ProxyRoute, applicationID pgtype.UUID, serviceName string, containerPort int32) bool {
	return route.ApplicationID == applicationID && route.ComposeService.Valid && route.ContainerPort.Valid &&
		route.ComposeService.String == serviceName && route.ContainerPort.Int32 == containerPort
}

func allocateManagedPortPair(preferred int, used map[int]bool) (int, int, bool) {
	blue := preferred
	if blue < 1 || blue > 65534 || used[blue] {
		blue = firstFreePort(managedPortRangeStart, managedPortRangeEnd, used)
	}
	if blue == 0 {
		return 0, 0, false
	}
	used[blue] = true
	green := blue + 1
	if green > 65535 || used[green] {
		green = firstFreePort(managedPortRangeStart, managedPortRangeEnd, used)
	}
	return blue, green, green != 0
}

func firstFreePort(start int, end int, used map[int]bool) int {
	for port := start; port <= end; port++ {
		if !used[port] {
			return port
		}
	}
	return 0
}

func proxyURLPort(value string) (int, bool) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Port() == "" {
		return 0, false
	}
	port, err := strconv.Atoi(parsed.Port())
	return port, err == nil && port >= 1 && port <= 65535
}

func deploymentRouteHost(hostname string) string {
	if strings.TrimSpace(hostname) == "playground" {
		return "host.docker.internal"
	}
	return "127.0.0.1"
}

func proxyOrigin(host string, port int) string {
	return "http://" + host + ":" + strconv.Itoa(port)
}

func validateProxyRouteInput(input db.CreateProxyRouteParams, proxyType string) error {
	if err := proxypkg.ValidateTarget(proxypkg.Target{Domain: input.Domain, Upstream: input.UpstreamUrl, TLSEnabled: input.TlsEnabled, ProxyType: proxyType}); err != nil {
		return validationError(err.Error())
	}
	if err := validateOptionalProxyUpstream(input.BlueUpstreamUrl, proxyType); err != nil {
		return validationError(err.Error())
	}
	if err := validateOptionalProxyUpstream(input.GreenUpstreamUrl, proxyType); err != nil {
		return validationError(err.Error())
	}
	return nil
}

func validateOptionalProxyUpstream(value pgtype.Text, proxyType string) error {
	if !value.Valid {
		return nil
	}
	return proxypkg.ValidateTarget(proxypkg.Target{
		Domain:     "upstream-check.example",
		Upstream:   value.String,
		TLSEnabled: false,
		ProxyType:  proxyType,
	})
}

func proxyLookupError(err error, message string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return notFoundError(message)
	}
	return err
}

func (s Server) applyProxyRoute(w http.ResponseWriter, r *http.Request) {
	routeID, err := parseUUIDParam(r, "routeID")
	if err != nil {
		writeError(w, err)
		return
	}
	if s.proxy == nil {
		writeError(w, validationError("proxy applier is not configured"))
		return
	}

	applyCtx, cancel := context.WithTimeout(r.Context(), serverCheckTimeout)
	defer cancel()
	route, err := s.proxy.Apply(applyCtx, routeID)
	if err != nil {
		s.audit(r, "proxy_route.apply_failed", "proxy_route", uuidString(routeID), uuidString(routeID), proxyApplyFailureMetadata(err))
		writeError(w, err)
		return
	}
	s.audit(r, "proxy_route.apply", "proxy_route", uuidString(route.ID), route.Domain, map[string]any{"status": route.Status})
	writeJSON(w, http.StatusOK, route)
}

func proxyApplyFailureMetadata(cause error) map[string]any {
	return map[string]any{
		"status": "failed",
		"error":  errorString(cause),
	}
}
