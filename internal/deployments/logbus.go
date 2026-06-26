package deployments

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/redis/go-redis/v9"
)

type LogEvent struct {
	ID           int64              `json:"id,omitempty"`
	DeploymentID string             `json:"deployment_id"`
	Stream       string             `json:"stream"`
	Message      string             `json:"message"`
	CreatedAt    pgtype.Timestamptz `json:"created_at,omitempty"`
}

type LogBus struct {
	mu          sync.RWMutex
	subscribers map[string]map[chan LogEvent]struct{}
	redis       *redis.Client
}

func NewLogBus(redisClient ...*redis.Client) *LogBus {
	bus := &LogBus{subscribers: map[string]map[chan LogEvent]struct{}{}}
	if len(redisClient) > 0 {
		bus.redis = redisClient[0]
	}
	return bus
}

func (b *LogBus) Publish(ctx context.Context, event LogEvent) {
	if b.redis != nil {
		data, err := json.Marshal(event)
		if err == nil {
			_ = b.redis.Publish(ctx, logChannel(event.DeploymentID), data).Err()
		}
		return
	}

	b.mu.RLock()
	defer b.mu.RUnlock()

	for ch := range b.subscribers[event.DeploymentID] {
		select {
		case ch <- event:
		default:
		}
	}
}

func (b *LogBus) Subscribe(ctx context.Context, deploymentID string) <-chan LogEvent {
	if b.redis != nil {
		return b.subscribeRedis(ctx, deploymentID)
	}
	return b.subscribeLocal(ctx, deploymentID)
}

func (b *LogBus) subscribeLocal(ctx context.Context, deploymentID string) <-chan LogEvent {
	ch := make(chan LogEvent, 32)

	b.mu.Lock()
	if b.subscribers[deploymentID] == nil {
		b.subscribers[deploymentID] = map[chan LogEvent]struct{}{}
	}
	b.subscribers[deploymentID][ch] = struct{}{}
	b.mu.Unlock()

	go func() {
		<-ctx.Done()
		b.mu.Lock()
		delete(b.subscribers[deploymentID], ch)
		if len(b.subscribers[deploymentID]) == 0 {
			delete(b.subscribers, deploymentID)
		}
		close(ch)
		b.mu.Unlock()
	}()

	return ch
}

func (b *LogBus) subscribeRedis(ctx context.Context, deploymentID string) <-chan LogEvent {
	ch := make(chan LogEvent, 32)
	subscription := b.redis.Subscribe(ctx, logChannel(deploymentID))

	go func() {
		defer close(ch)
		defer subscription.Close()

		for {
			message, err := subscription.ReceiveMessage(ctx)
			if err != nil {
				return
			}

			var event LogEvent
			if err := json.Unmarshal([]byte(message.Payload), &event); err != nil {
				continue
			}
			if !shouldDeliverLogEvent(deploymentID, event) {
				continue
			}

			select {
			case ch <- event:
			case <-ctx.Done():
				return
			}
		}
	}()

	return ch
}

func logChannel(deploymentID string) string {
	return fmt.Sprintf("deployments:%s:logs", deploymentID)
}

func shouldDeliverLogEvent(deploymentID string, event LogEvent) bool {
	return event.DeploymentID == deploymentID
}
