package sshutil

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"

	"golang.org/x/crypto/ssh"
)

type HealthResult struct {
	Status      string
	CPUUsage    float64
	MemoryUsage float64
	DiskUsage   float64
}

func Check(ctx context.Context, host string, port int32, user string, signer ssh.Signer) (HealthResult, error) {
	client := NewClient(host, port, user, signer)
	return CheckWithClient(ctx, client)
}

func CheckWithClient(ctx context.Context, client Client) (HealthResult, error) {
	output, err := client.Run(ctx, healthMetricsCommand)
	if err != nil {
		return HealthResult{Status: "unreachable"}, err
	}

	result, err := parseHealthMetrics(output)
	if err != nil {
		return HealthResult{Status: "degraded"}, err
	}
	result.Status = healthStatus(result)
	return result, nil
}

const healthMetricsCommand = `read cpu user nice system idle iowait irq softirq steal guest guest_nice < /proc/stat
idle1=$((idle+iowait))
total1=$((user+nice+system+idle+iowait+irq+softirq+steal))
sleep 1
read cpu user nice system idle iowait irq softirq steal guest guest_nice < /proc/stat
idle2=$((idle+iowait))
total2=$((user+nice+system+idle+iowait+irq+softirq+steal))
awk -v idle1="$idle1" -v idle2="$idle2" -v total1="$total1" -v total2="$total2" 'BEGIN { total=total2-total1; idle=idle2-idle1; if (total > 0) printf "CPU %.2f\n", (1 - idle / total) * 100; else print "CPU 0.00" }'
free | awk '/Mem:/ { printf "MEMORY %.2f\n", ($3 * 100) / $2 }'
df -P / | awk 'NR==2 { gsub("%", "", $5); printf "DISK %.2f\n", $5 }'`

func parseHealthMetrics(output string) (HealthResult, error) {
	result := HealthResult{}
	seen := map[string]bool{}
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		value, err := strconv.ParseFloat(fields[1], 64)
		if err != nil {
			return result, fmt.Errorf("parse %s metric: %w", fields[0], err)
		}
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return result, fmt.Errorf("parse %s metric: value must be finite", fields[0])
		}
		value = clampPercent(value)
		switch fields[0] {
		case "CPU":
			result.CPUUsage = value
			seen["CPU"] = true
		case "MEMORY":
			result.MemoryUsage = value
			seen["MEMORY"] = true
		case "DISK":
			result.DiskUsage = value
			seen["DISK"] = true
		}
	}
	for _, metric := range []string{"CPU", "MEMORY", "DISK"} {
		if !seen[metric] {
			return result, fmt.Errorf("missing %s metric", metric)
		}
	}
	return result, nil
}

func healthStatus(result HealthResult) string {
	if result.CPUUsage >= 95 || result.MemoryUsage >= 90 || result.DiskUsage >= 90 {
		return "degraded"
	}
	return "healthy"
}

func clampPercent(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}
