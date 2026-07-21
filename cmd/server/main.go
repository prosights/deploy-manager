package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"deploy-manager/internal/config"
	"deploy-manager/internal/connectors"
	"deploy-manager/internal/db"
	"deploy-manager/internal/deployments"
	"deploy-manager/internal/doppler"
	"deploy-manager/internal/githubconnector"
	"deploy-manager/internal/httpapi"
	"deploy-manager/internal/migrations"
	"deploy-manager/internal/notificationconnector"
	"deploy-manager/internal/notifications"
	"deploy-manager/internal/objectstorage"
	"deploy-manager/internal/proxy"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func main() {
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	app, err := newApplication(ctx, cfg)
	if err != nil {
		slog.Error("initialize application", "error", err)
		os.Exit(1)
	}
	defer app.close()

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           app.handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      0,
		IdleTimeout:       120 * time.Second,
	}

	var workerDone <-chan struct{}
	if cfg.DeploymentWorkerEnabled {
		workerDone = app.queue.StartWorker(ctx)
	} else {
		slog.Info("deployment queue worker disabled")
	}
	serve(ctx, stop, server, cfg.Addr)
	shutdown(server, cfg.Shutdown)
	waitForWorker(workerDone, cfg.Shutdown)
}

type application struct {
	pool    *pgxpool.Pool
	redis   *redis.Client
	queue   deployments.Queue
	handler http.Handler
}

func newApplication(ctx context.Context, cfg config.Config) (*application, error) {
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect database: %w", err)
	}
	if err := migrations.Run(ctx, pool); err != nil {
		pool.Close()
		return nil, fmt.Errorf("run migrations: %w", err)
	}

	redisClient, err := newRedisClient(ctx, cfg.RedisURL)
	if err != nil {
		pool.Close()
		return nil, err
	}

	queries := db.New(pool)
	logBus := deployments.NewLogBus(redisClient)
	notifier := newNotifier(cfg)
	runtime := doppler.NewWithCommand(cfg.DopplerProject, cfg.DopplerConfig, cfg.DopplerToken, cfg.DopplerCLIPath)
	// Contract: runtime secret values are sourced exclusively from Doppler.
	// This guards against a future wiring change silently swapping in another
	// provider. See AGENTS.md: Deploy Manager is not a secrets manager.
	if err := requireDopplerRuntimeSource(runtime); err != nil {
		pool.Close()
		_ = redisClient.Close()
		return nil, err
	}
	github := githubconnector.New()
	githubApp, err := newGitHubAppClient(cfg)
	if err != nil {
		pool.Close()
		_ = redisClient.Close()
		return nil, err
	}
	slack := notificationconnector.New("slack")
	resend := notificationconnector.New("resend")
	s3 := objectstorage.NewConnector("s3")
	gcs := objectstorage.NewConnector("gcs")
	var sourceAuthenticator deployments.SourceAuthenticator
	if githubApp != nil {
		sourceAuthenticator = githubconnector.NewSourceAuthenticator(queries, githubApp)
	}
	runner := deployments.NewRunner(queries, logBus, notifier, runtime, sourceAuthenticator)
	queue := deployments.NewQueue(redisClient, queries, runner)
	if cfg.DeploymentWorkerEnabled {
		if recovered, err := queue.RecoverInterrupted(ctx); err != nil {
			_ = redisClient.Close()
			pool.Close()
			return nil, fmt.Errorf("recover interrupted deployments: %w", err)
		} else if recovered > 0 {
			slog.Info("recovered interrupted deployments", "count", recovered)
		}
		if recovered, err := queue.RecoverQueued(ctx, 0); err != nil {
			_ = redisClient.Close()
			pool.Close()
			return nil, fmt.Errorf("recover queued deployments: %w", err)
		} else if recovered > 0 {
			slog.Info("recovered queued deployments", "count", recovered)
		}
	}
	proxyManager := proxy.NewManager(queries)
	readiness := []httpapi.ReadinessCheck{{
		Name:  "database",
		Check: pool.Ping,
	}, {
		Name: "redis",
		Check: func(ctx context.Context) error {
			return redisClient.Ping(ctx).Err()
		},
	}}
	if cfg.DopplerConfigured() {
		readiness = append(readiness, httpapi.ReadinessCheck{
			Name: "doppler",
			Check: func(context.Context) error {
				return runtime.Check()
			},
		})
	}

	githubWebhook := httpapi.GitHubWebhookConfig{Secret: cfg.GitHubWebhookSecret, AppSlug: cfg.GitHubAppSlug}
	if githubApp != nil {
		githubWebhook.App = githubApp
	}

	handler := httpapi.New(queries, pool, queue, logBus, proxyManager, githubWebhook, map[string]connectors.Connector{
		github.Provider():  github,
		runtime.Provider(): runtime,
		slack.Provider():   slack,
		resend.Provider():  resend,
		s3.Provider():      s3,
		gcs.Provider():     gcs,
	}, cfg.StaticDir, httpapi.AuthConfig{Token: cfg.APIToken, Disabled: cfg.AuthDisabled}, readiness...)

	if cfg.AuthDisabled {
		slog.Warn("AUTH_DISABLED=true; protected API routes are unauthenticated")
	}

	return &application{
		pool:    pool,
		redis:   redisClient,
		queue:   queue,
		handler: handler,
	}, nil
}

func newGitHubAppClient(cfg config.Config) (*githubconnector.AppClient, error) {
	if !hasGitHubAppConfig(cfg) {
		return nil, nil
	}
	privateKey := cfg.GitHubAppPrivateKey
	if privateKey == "" {
		contents, err := os.ReadFile(cfg.GitHubAppPrivateKeyPath)
		if err != nil {
			return nil, fmt.Errorf("read GITHUB_APP_PRIVATE_KEY_PATH: %w", err)
		}
		privateKey = string(contents)
	}
	client, err := githubconnector.NewAppClient(cfg.GitHubAppID, privateKey, nil)
	if err != nil {
		return nil, fmt.Errorf("configure github app client: %w", err)
	}
	return client, nil
}

func hasGitHubAppConfig(cfg config.Config) bool {
	return cfg.GitHubAppID != "" || cfg.GitHubAppPrivateKey != "" || cfg.GitHubAppPrivateKeyPath != ""
}

func newRedisClient(ctx context.Context, redisURL string) (*redis.Client, error) {
	redisOptions, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	redisClient := redis.NewClient(redisOptions)
	if err := redisClient.Ping(ctx).Err(); err != nil {
		_ = redisClient.Close()
		return nil, fmt.Errorf("connect redis: %w", err)
	}
	return redisClient, nil
}

func newNotifier(cfg config.Config) notifications.Notifier {
	return notifications.Multi{
		notifications.Slack{WebhookURL: cfg.SlackWebhookURL},
		notifications.Resend{
			APIKey: cfg.ResendAPIKey,
			From:   cfg.ResendFromEmail,
			To:     cfg.ResendToEmail,
		},
	}
}

// requireDopplerRuntimeSource enforces the contract that runtime secret values
// are sourced exclusively from Doppler. Deploy Manager stores references and
// metadata, never secret values, and delegates secret material to Doppler.
func requireDopplerRuntimeSource(runtime any) error {
	provider, ok := runtime.(interface{ Provider() string })
	if !ok {
		return fmt.Errorf("runtime variable source must expose a Provider()")
	}
	if got := provider.Provider(); got != "doppler" {
		return fmt.Errorf("runtime variable source must be doppler, got %q", got)
	}
	return nil
}

func serve(ctx context.Context, stop context.CancelFunc, server *http.Server, addr string) {
	go func() {
		slog.Info("server listening", "addr", addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("http server failed", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
}

func shutdown(server *http.Server, timeout time.Duration) {
	shutdownCtx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown failed", "error", err)
		os.Exit(1)
	}
}

func waitForWorker(done <-chan struct{}, timeout time.Duration) {
	if done == nil {
		return
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
		slog.Warn("deployment queue worker did not stop before shutdown timeout")
	}
}

func (app *application) close() {
	_ = app.redis.Close()
	app.pool.Close()
}
