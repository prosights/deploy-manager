package httpapi

import (
	"context"
	"net/http"
	"strings"

	"deploy-manager/internal/connectors"
	"deploy-manager/internal/db"
	"deploy-manager/internal/deployments"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Server struct {
	queries *db.Queries
	tx      transactionStarter
	ready   []ReadinessCheck
	queue   DeploymentQueue
	logs    *deployments.LogBus
	proxy   ProxyApplier
	github  GitHubWebhookConfig
	sources map[string]connectors.Connector
	static  string

	sshHealth    sshHealthChecker
	dockerEngine dockerEngineChecker
}

type transactionStarter interface {
	Begin(context.Context) (pgx.Tx, error)
}

type DeploymentQueue interface {
	Enqueue(context.Context, db.Deployment) error
}

type ProxyApplier interface {
	Apply(context.Context, pgtype.UUID) (db.ProxyRoute, error)
}

type GitHubWebhookConfig struct {
	Secret string
}

type ReadinessCheck struct {
	Name  string
	Check func(context.Context) error
}

func New(queries *db.Queries, tx transactionStarter, queue DeploymentQueue, logs *deployments.LogBus, proxyApplier ProxyApplier, github GitHubWebhookConfig, sources map[string]connectors.Connector, staticDir string, readiness ...ReadinessCheck) http.Handler {
	server := Server{queries: queries, tx: tx, ready: readiness, queue: queue, logs: logs, proxy: proxyApplier, github: github, sources: sources, static: staticDir}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Compress(5))

	r.Route("/api", func(r chi.Router) {
		r.Get("/healthz", server.health)
		r.Get("/readyz", server.readyz)
		r.Get("/settings", server.settings)
		r.Patch("/settings", server.updateSettings)
		r.Get("/audit-events", server.listAuditEvents)
		r.Get("/projects", server.listProjects)
		r.Post("/projects", server.createProject)
		r.Get("/environments", server.listEnvironments)
		r.Post("/environments", server.createEnvironment)
		r.Get("/servers", server.listServers)
		r.Post("/servers", server.createServer)
		r.Post("/servers/{serverID}/check", server.checkServer)
		r.Get("/applications", server.listApplications)
		r.Post("/applications", server.createApplication)
		r.Get("/deployments", server.listDeployments)
		r.Post("/deployments", server.createDeployment)
		r.Post("/deployments/{deploymentID}/cancel", server.cancelDeployment)
		r.Post("/deployments/{deploymentID}/retry", server.retryDeployment)
		r.Get("/deployments/{deploymentID}/logs", server.listDeploymentLogs)
		r.Get("/deployments/{deploymentID}/events", server.streamDeploymentLogs)
		r.Get("/credentials", server.listCredentials)
		r.Post("/credentials/inventory", server.upsertCredentialInventory)
		r.Post("/object-storage/inventory", server.upsertObjectStorageInventory)
		r.Get("/credentials/{credentialID}", server.credentialDetail)
		r.Get("/connectors", server.listConnectors)
		r.Post("/connectors", server.upsertConnector)
		r.Post("/connectors/{connectorID}/sync", server.syncConnector)
		r.Get("/proxy-routes", server.listProxyRoutes)
		r.Post("/proxy-routes", server.createProxyRoute)
		r.Post("/proxy-routes/{routeID}/apply", server.applyProxyRoute)
		r.Post("/webhooks/github", server.githubWebhook)
	})

	r.NotFound(server.notFound)
	r.Get("/*", server.spa)

	return r
}

func (s Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s Server) readyz(w http.ResponseWriter, r *http.Request) {
	checks := map[string]string{}
	ready := true
	for _, check := range s.ready {
		name := strings.TrimSpace(check.Name)
		if name == "" || check.Check == nil {
			continue
		}
		if err := check.Check(r.Context()); err != nil {
			checks[name] = "failed"
			ready = false
			continue
		}
		checks[name] = "ok"
	}

	if !ready {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"status": "unready",
			"checks": checks,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ready",
		"checks": checks,
	})
}

func (s Server) notFound(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api" {
		writeError(w, notFoundError("api endpoint not found"))
		return
	}
	s.spa(w, r)
}
