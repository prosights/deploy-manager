package proxy

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"

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
		config := caddyConfig(target)
		path := "/etc/caddy/conf.d/deploy-manager-" + slug + ".caddy"
		return strings.Join([]string{
			"sudo mkdir -p /etc/caddy/conf.d",
			"printf %s " + shellQuote(config) + " | sudo tee " + shellQuote(path) + " >/dev/null",
			"sudo caddy validate --config /etc/caddy/Caddyfile",
			"sudo systemctl reload caddy",
		}, " && "), nil
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
	switch parsed.Scheme {
	case "http", "https":
		return nil
	default:
		return fmt.Errorf("upstream_url must use http or https")
	}
}

func caddyConfig(target Target) string {
	address := target.Domain
	if !target.TLSEnabled {
		address = "http://" + target.Domain
	}
	return fmt.Sprintf("%s {\n\treverse_proxy %s\n}\n", address, target.Upstream)
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
