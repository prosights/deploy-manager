package deployments

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"deploy-manager/internal/db"

	"github.com/redis/go-redis/v9"
)

const deploymentQueueKey = "deployments:queue"
const defaultRecoveryLimit int32 = 100
const interruptedDeploymentLogMessage = "Deployment was interrupted by server restart; marked failed"

type Queue struct {
	redis   *redis.Client
	queries *db.Queries
	runner  Runner
}

type queuePayload struct {
	DeploymentID string `json:"deployment_id"`
}

func NewQueue(redisClient *redis.Client, queries *db.Queries, runner Runner) Queue {
	return Queue{redis: redisClient, queries: queries, runner: runner}
}

func (q Queue) Enqueue(ctx context.Context, deployment db.Deployment) error {
	payload, err := encodeDeployment(deployment)
	if err != nil {
		return err
	}
	return q.redis.RPush(ctx, deploymentQueueKey, payload).Err()
}

func (q Queue) RecoverQueued(ctx context.Context, limit int32) (int, error) {
	if limit <= 0 {
		limit = defaultRecoveryLimit
	}
	return recoverQueued(ctx, limit, q.queries.ListQueuedDeploymentsForRecovery, q.Enqueue)
}

func (q Queue) RecoverInterrupted(ctx context.Context) (int, error) {
	return recoverInterrupted(ctx, q.queries.FailRunningDeploymentsForRecovery, q.queries.AppendDeploymentLog)
}

func recoverQueued(
	ctx context.Context,
	limit int32,
	list func(context.Context, int32) ([]db.Deployment, error),
	enqueue func(context.Context, db.Deployment) error,
) (int, error) {
	if limit <= 0 {
		limit = defaultRecoveryLimit
	}
	deployments, err := list(ctx, limit)
	if err != nil {
		return 0, err
	}
	for index, deployment := range deployments {
		if err := enqueue(ctx, deployment); err != nil {
			return index, err
		}
	}
	return len(deployments), nil
}

func recoverInterrupted(
	ctx context.Context,
	failRunning func(context.Context) ([]db.FailRunningDeploymentsForRecoveryRow, error),
	appendLog func(context.Context, db.AppendDeploymentLogParams) (db.DeploymentLog, error),
) (int, error) {
	deployments, err := failRunning(ctx)
	if err != nil {
		return 0, err
	}
	for _, deployment := range deployments {
		_, err := appendLog(ctx, db.AppendDeploymentLogParams{
			DeploymentID: deployment.ID,
			Stream:       "system",
			Message:      interruptedDeploymentLogMessage,
		})
		if err != nil {
			return len(deployments), err
		}
	}
	return len(deployments), nil
}

func (q Queue) StartWorker(ctx context.Context) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		q.work(ctx)
		close(done)
	}()
	return done
}

func (q Queue) work(ctx context.Context) {
	for {
		item, err := q.redis.BLPop(ctx, 5*time.Second, deploymentQueueKey).Result()
		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, redis.Nil) {
				if errors.Is(err, context.Canceled) {
					return
				}
				continue
			}
			slog.Error("deployment queue pop failed", "error", err)
			continue
		}
		if len(item) != 2 {
			continue
		}
		if err := q.handle(ctx, item[1]); err != nil {
			slog.Error("deployment queue item failed", "error", err)
		}
	}
}

func (q Queue) handle(ctx context.Context, encoded string) error {
	payload, err := decodePayload(encoded)
	if err != nil {
		return err
	}
	deploymentID, err := pgUUID(payload.DeploymentID)
	if err != nil {
		return err
	}
	deployment, err := q.queries.GetDeployment(ctx, deploymentID)
	if err != nil {
		return err
	}
	if !shouldRunDeployment(deployment.Status) {
		return nil
	}
	q.runner.Run(ctx, deployment)
	return nil
}

func shouldRunDeployment(status string) bool {
	return status == "queued"
}

func encodeDeployment(deployment db.Deployment) (string, error) {
	id := uuidString(deployment.ID)
	if id == "" {
		return "", fmt.Errorf("deployment id is required")
	}
	data, err := json.Marshal(queuePayload{DeploymentID: id})
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func decodePayload(encoded string) (queuePayload, error) {
	var payload queuePayload
	decoder := json.NewDecoder(bytes.NewBufferString(encoded))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return payload, err
	}
	if err := decoder.Decode(&struct{}{}); err == nil {
		return payload, fmt.Errorf("queue payload must contain one JSON object")
	} else if !errors.Is(err, io.EOF) {
		return payload, err
	}
	payload.DeploymentID = strings.TrimSpace(payload.DeploymentID)
	if payload.DeploymentID == "" {
		return payload, fmt.Errorf("deployment_id is required")
	}
	return payload, nil
}
