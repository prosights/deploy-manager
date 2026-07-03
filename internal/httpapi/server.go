package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

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
	replays *replayCache
	sources map[string]connectors.Connector
	static  string

	sshHealth      sshHealthChecker
	dockerEngine   dockerEngineChecker
	remoteCommands remoteCommandRunner
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

type AuthConfig struct {
	Token    string
	Disabled bool
}

type ReadinessCheck struct {
	Name  string
	Check func(context.Context) error
}

func New(queries *db.Queries, tx transactionStarter, queue DeploymentQueue, logs *deployments.LogBus, proxyApplier ProxyApplier, github GitHubWebhookConfig, sources map[string]connectors.Connector, staticDir string, auth AuthConfig, readiness ...ReadinessCheck) http.Handler {
	server := Server{queries: queries, tx: tx, ready: readiness, queue: queue, logs: logs, proxy: proxyApplier, github: github, replays: newReplayCache(1024), sources: sources, static: staticDir}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Compress(5))
	r.Use(securityHeaders)

	r.Route("/api", func(r chi.Router) {
		r.Use(rateLimit(600, 1*time.Minute))
		// Unauthenticated endpoints: liveness/readiness probes and the GitHub
		// webhook, which authenticates itself with an HMAC signature.
		r.Get("/healthz", server.health)
		r.Get("/readyz", server.readyz)
		r.Post("/webhooks/github", server.githubWebhook)

		r.Group(func(r chi.Router) {
			if !auth.Disabled {
				r.Use(requireAuth(auth.Token))
			}
			r.Get("/settings", server.settings)
			r.Patch("/settings", server.updateSettings)
			r.Get("/audit-events", server.listAuditEvents)
			r.Get("/projects", server.listProjects)
			r.Post("/projects", server.createProject)
			r.Patch("/projects/{projectID}", server.updateProject)
			r.Delete("/projects/{projectID}", server.deleteProject)
			r.Patch("/projects/{projectID}/registry", server.updateProjectRegistry)
			r.Get("/environments", server.listEnvironments)
			r.Post("/environments", server.createEnvironment)
			r.Delete("/environments/{environmentID}", server.deleteEnvironment)
			r.Get("/servers", server.listServers)
			r.Post("/servers", server.createServer)
			r.Get("/tailscale/devices", server.listTailscaleDevices)
			r.Post("/servers/{serverID}/check", server.checkServer)
			r.Post("/servers/{serverID}/commands", server.runServerCommand)
			r.Get("/servers/{serverID}/terminal", server.serverTerminal)
			r.Get("/applications", server.listApplications)
			r.Post("/applications", server.createApplication)
			r.Delete("/applications/{applicationID}", server.deleteApplication)
			r.Post("/applications/{applicationID}/rollback", server.rollbackApplication)
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
			r.Get("/github/repositories", server.listGitHubRepositories)
			r.Get("/container-registries", server.listContainerRegistries)
			r.Post("/container-registries", server.upsertContainerRegistry)
			r.Get("/proxy-routes", server.listProxyRoutes)
			r.Post("/proxy-routes", server.createProxyRoute)
			r.Delete("/proxy-routes/{routeID}", server.deleteProxyRoute)
			r.Post("/proxy-routes/{routeID}/apply", server.applyProxyRoute)
		})
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
