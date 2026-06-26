package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"deploy-manager/internal/db"
	proxypkg "deploy-manager/internal/proxy"

	"github.com/jackc/pgx/v5"
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
	if input.ApplicationID.Valid {
		application, err := s.queries.GetApplication(r.Context(), input.ApplicationID)
		if err != nil {
			writeError(w, proxyLookupError(err, "application not found"))
			return
		}
		input = normalizeCreateProxyRoute(input, &application)
	}
	input = normalizeCreateProxyRoute(input, nil)
	if !input.ServerID.Valid || input.Domain == "" || input.UpstreamUrl == "" {
		writeError(w, validationError("server_id, domain, and upstream_url are required"))
		return
	}
	server, err := s.queries.GetServer(r.Context(), input.ServerID)
	if err != nil {
		writeError(w, proxyLookupError(err, "server not found"))
		return
	}
	if err := proxypkg.ValidateTarget(proxypkg.Target{
		Domain:     input.Domain,
		Upstream:   input.UpstreamUrl,
		TLSEnabled: input.TlsEnabled,
		ProxyType:  server.ProxyType,
	}); err != nil {
		writeError(w, validationError(err.Error()))
		return
	}

	route, err := s.queries.CreateProxyRoute(r.Context(), input)
	if err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "proxy_route.upsert", "proxy_route", uuidString(route.ID), route.Domain, map[string]any{"server_id": uuidString(route.ServerID), "tls_enabled": route.TlsEnabled})
	writeJSON(w, http.StatusCreated, route)
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
	return input
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

	route, err := s.proxy.Apply(r.Context(), routeID)
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
