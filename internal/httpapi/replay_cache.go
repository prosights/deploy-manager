package httpapi

import (
	"strings"
	"sync"
)

type replayCache struct {
	mu    sync.Mutex
	limit int
	seen  map[string]struct{}
	order []string
}

func newReplayCache(limit int) *replayCache {
	if limit < 1 {
		limit = 1
	}
	return &replayCache{limit: limit, seen: map[string]struct{}{}}
}

func (c *replayCache) Seen(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.seen[value]; ok {
		return true
	}
	c.seen[value] = struct{}{}
	c.order = append(c.order, value)
	if len(c.order) > c.limit {
		oldest := c.order[0]
		c.order = c.order[1:]
		delete(c.seen, oldest)
	}
	return false
}
