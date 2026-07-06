package proxy

import (
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
	"unicode"

	"deploy-manager/internal/stringutil"
)

type Target struct {
	Domain     string
	Upstream   string
	TLSEnabled bool
	ProxyType  string
}

func BuildCommand(target Target) (string, error) {
	if err := ValidateTarget(target); err != nil {
		return "", err
	}

	target.Domain = strings.TrimSpace(target.Domain)
	target.Upstream = strings.TrimSpace(target.Upstream)
	slug, err := routeSlug(target.Domain)
	if err != nil {
		return "", err
	}

	switch target.ProxyType {
	case "caddy":
		return caddyCommand(target, slug), nil
	case "traefik":
		config := traefikConfig(target, slug)
		path := "/etc/traefik/dynamic/deploy-manager-" + slug + ".yml"
		return strings.Join([]string{
			"sudo mkdir -p /etc/traefik/dynamic",
			"printf %s " + shellQuote(config) + " | sudo tee " + shellQuote(path) + " >/dev/null",
		}, " && "), nil
	default:
		return "", fmt.Errorf("unsupported proxy type %q", target.ProxyType)
	}
}

func ValidateTarget(target Target) error {
	if containsUnsafeProxyRune(target.Upstream) {
		return fmt.Errorf("upstream_url contains unsupported characters")
	}
	target.Domain = strings.TrimSpace(target.Domain)
	target.Upstream = strings.TrimSpace(target.Upstream)
	if target.Domain == "" {
		return fmt.Errorf("domain is required")
	}
	if target.Upstream == "" {
		return fmt.Errorf("upstream_url is required")
	}
	if err := validateUpstreamURL(target.Upstream); err != nil {
		return err
	}
	switch target.ProxyType {
	case "caddy", "traefik":
		_, err := routeSlug(target.Domain)
		return err
	case "none":
		return fmt.Errorf("server proxy type is none")
	default:
		return fmt.Errorf("unsupported proxy type %q", target.ProxyType)
	}
}

func validateUpstreamURL(value string) error {
	if stringutil.HasControlCharacter(value) {
		return fmt.Errorf("upstream_url cannot contain control characters")
	}
	if containsUnsafeProxyRune(value) {
		return fmt.Errorf("upstream_url contains unsupported characters")
	}

	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" {
		return fmt.Errorf("upstream_url must be an absolute HTTP URL")
	}
	if parsed.User != nil {
		return fmt.Errorf("upstream_url cannot include credentials")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return fmt.Errorf("upstream_url must be an origin URL without path, query, or fragment")
	}
	if err := validateUpstreamHost(parsed.Hostname()); err != nil {
		return err
	}
	switch parsed.Scheme {
	case "http", "https":
		return nil
	default:
		return fmt.Errorf("upstream_url must use http or https")
	}
}

func containsUnsafeProxyRune(value string) bool {
	for _, char := range value {
		if char == '\'' || char == '"' || char == '`' {
			return true
		}
		if unicode.IsSpace(char) && char != ' ' {
			return true
		}
	}
	return false
}

func validateUpstreamHost(host string) error {
	host = strings.ToLower(strings.Trim(host, "[]"))
	if host == "metadata.google.internal" {
		return fmt.Errorf("upstream_url cannot target cloud metadata services")
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		if addr == netip.MustParseAddr("169.254.169.254") || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() {
			return fmt.Errorf("upstream_url cannot target link-local addresses")
		}
		return nil
	}
	ips, err := net.LookupIP(host)
	if err != nil {
		return nil
	}
	for _, ip := range ips {
		addr, ok := netip.AddrFromSlice(ip)
		if !ok {
			continue
		}
		if addr == netip.MustParseAddr("169.254.169.254") || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() {
			return fmt.Errorf("upstream_url cannot target link-local addresses")
		}
	}
	return nil
}

func caddyConfig(target Target) string {
	address := target.Domain
	if !target.TLSEnabled {
		address = "http://" + target.Domain
	}
	return fmt.Sprintf("%s {\n\treverse_proxy %s\n}\n", address, target.Upstream)
}

func caddyCommand(target Target, slug string) string {
	config := caddyConfig(target)
	hostPath := "/etc/caddy/conf.d/deploy-manager-" + slug + ".caddy"
	script := fmt.Sprintf(`set -e
if command -v caddy >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files caddy.service >/dev/null 2>&1; then
  sudo mkdir -p /etc/caddy/conf.d
  printf %%s %s | sudo tee %s >/dev/null
  sudo caddy validate --config /etc/caddy/Caddyfile
  sudo systemctl reload caddy
elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -Fxq caddy && test -f /opt/infrastructure/Caddyfile; then
  DM_CADDY_ADDRESS=%s DM_CADDY_CONFIG=%s python3 - <<'PY'
import os
import pathlib
import re
import shutil
import time

path = pathlib.Path("/opt/infrastructure/Caddyfile")
address = os.environ["DM_CADDY_ADDRESS"].strip()
config = os.environ["DM_CADDY_CONFIG"].rstrip() + "\n"
content = path.read_text()
start = f"# deploy-manager route {address}\n"
end = f"# deploy-manager route end {address}\n"
managed = start + config + end

content = re.sub(
    r"(?ms)^" + re.escape(start) + r".*?^" + re.escape(end) + r"\n?",
    "",
    content,
)

lines = content.splitlines(keepends=True)
cleaned = []
i = 0
while i < len(lines):
    if lines[i].strip() == f"{address} {{":
        depth = lines[i].count("{") - lines[i].count("}")
        i += 1
        while i < len(lines) and depth > 0:
            depth += lines[i].count("{") - lines[i].count("}")
            i += 1
        continue
    cleaned.append(lines[i])
    i += 1

content = "".join(cleaned).rstrip() + "\n\n" + managed
backup = path.with_name(path.name + ".deploy-manager-backup." + time.strftime("%%Y%%m%%d%%H%%M%%S"))
shutil.copy2(path, backup)
path.write_text(content)
PY
  docker exec caddy caddy validate --config /etc/caddy/Caddyfile
  docker exec caddy caddy reload --config /etc/caddy/Caddyfile
else
  echo "no supported caddy runtime found" >&2
  exit 1
fi`, shellQuote(config), shellQuote(hostPath), shellQuote(target.Domain), shellQuote(config))
	return "bash -lc " + shellQuote(script)
}

func traefikConfig(target Target, slug string) string {
	entryPoint := "websecure"
	tls := "    tls: {}\n"
	if !target.TLSEnabled {
		entryPoint = "web"
		tls = ""
	}

	return fmt.Sprintf(`http:
  routers:
    %s:
      rule: "Host(%s)"
      service: %s
      entryPoints:
        - %s
%s  services:
    %s:
      loadBalancer:
        servers:
          - url: "%s"
`, slug, "`"+target.Domain+"`", slug, entryPoint, tls, slug, target.Upstream)
}

var routeSlugPattern = regexp.MustCompile(`[^a-z0-9-]+`)

func routeSlug(domain string) (string, error) {
	domain = strings.ToLower(strings.TrimSpace(domain))
	if err := ValidateDomain(domain); err != nil {
		return "", err
	}

	slug := strings.Trim(routeSlugPattern.ReplaceAllString(strings.ReplaceAll(domain, ".", "-"), "-"), "-")
	if slug == "" {
		return "", fmt.Errorf("domain is required")
	}
	return slug, nil
}

func ValidateDomain(domain string) error {
	domain = strings.ToLower(strings.TrimSpace(domain))
	for _, char := range domain {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '.' || char == '-' {
			continue
		}
		return fmt.Errorf("domain contains unsupported characters")
	}
	if err := validateDomainLabels(domain); err != nil {
		return err
	}
	return nil
}

func validateDomainLabels(domain string) error {
	if domain == "" {
		return fmt.Errorf("domain is required")
	}
	if len(domain) > 253 {
		return fmt.Errorf("domain is too long")
	}
	labels := strings.Split(domain, ".")
	for _, label := range labels {
		if label == "" {
			return fmt.Errorf("domain labels cannot be empty")
		}
		if len(label) > 63 {
			return fmt.Errorf("domain label is too long")
		}
		if strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return fmt.Errorf("domain labels cannot start or end with hyphen")
		}
	}
	return nil
}

func shellQuote(value string) string {
	return stringutil.ShellQuote(value)
}
