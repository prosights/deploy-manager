// Package compose reads the services, ports, and dependencies out of a
// docker-compose file so they can be shown and configured before deploying.
package compose

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"paddock/internal/runtimevars"

	"gopkg.in/yaml.v3"
)

type Service struct {
	Name          string   `json:"name"`
	Image         string   `json:"image,omitempty"`
	BuildContext  string   `json:"build_context,omitempty"`
	Dockerfile    string   `json:"dockerfile,omitempty"`
	Ports         []Port   `json:"ports"`
	DependsOn     []string `json:"depends_on"`
	ExecutionMode string   `json:"execution_mode,omitempty"`
}

type Port struct {
	ContainerPort int    `json:"container_port"`
	PublishedPort int    `json:"published_port,omitempty"`
	Protocol      string `json:"protocol,omitempty"`
	Variable      string `json:"variable,omitempty"`
}

type document struct {
	Services map[string]rawService `yaml:"services"`
}

type rawService struct {
	Image     string      `yaml:"image"`
	Build     yaml.Node   `yaml:"build"`
	Ports     []yaml.Node `yaml:"ports"`
	Expose    []yaml.Node `yaml:"expose"`
	DependsOn yaml.Node   `yaml:"depends_on"`
}

// Parse returns the services declared in a compose file, sorted by name.
func Parse(contents []byte) ([]Service, error) {
	var doc document
	if err := yaml.Unmarshal(contents, &doc); err != nil {
		return nil, err
	}
	services := make([]Service, 0, len(doc.Services))
	for name, service := range doc.Services {
		buildContext, dockerfile := buildSource(service.Build)
		ports := make([]Port, 0, len(service.Ports)+len(service.Expose))
		seenPorts := make(map[string]bool)
		for _, port := range append(service.Ports, service.Expose...) {
			if value, ok := parsePort(port); ok {
				key := fmt.Sprintf("%d/%s", value.ContainerPort, value.Protocol)
				if seenPorts[key] {
					continue
				}
				seenPorts[key] = true
				ports = append(ports, value)
			}
		}
		dependsOn := dependencies(service.DependsOn)
		sort.Strings(dependsOn)
		services = append(services, Service{
			Name:         name,
			Image:        service.Image,
			BuildContext: buildContext,
			Dockerfile:   dockerfile,
			Ports:        ports,
			DependsOn:    dependsOn,
		})
	}
	sort.Slice(services, func(i, j int) bool { return services[i].Name < services[j].Name })
	return services, nil
}

func buildSource(node yaml.Node) (string, string) {
	if node.Kind == yaml.ScalarNode {
		return node.Value, ""
	}
	if node.Kind == yaml.MappingNode {
		return yamlMapValue(node, "context"), yamlMapValue(node, "dockerfile")
	}
	return "", ""
}

func parsePort(node yaml.Node) (Port, bool) {
	if node.Kind == yaml.ScalarNode {
		value := node.Value
		protocol := ""
		if slash := strings.LastIndex(value, "/"); slash >= 0 {
			protocol = value[slash+1:]
			value = value[:slash]
		}
		containerValue, publishedValue, hasPublished := splitPort(value)
		containerPort, err := strconv.Atoi(containerValue)
		if err != nil || containerPort < 1 || containerPort > 65535 {
			return Port{}, false
		}
		port := Port{ContainerPort: containerPort, Protocol: protocol}
		if hasPublished {
			publishedPort, variable, ok := parsePublishedPort(publishedValue)
			if !ok {
				return Port{}, false
			}
			port.PublishedPort = publishedPort
			port.Variable = variable
		}
		return port, true
	}
	if node.Kind != yaml.MappingNode {
		return Port{}, false
	}
	target, err := strconv.Atoi(yamlMapValue(node, "target"))
	if err != nil || target < 1 || target > 65535 {
		return Port{}, false
	}
	port := Port{ContainerPort: target, Protocol: yamlMapValue(node, "protocol")}
	if published := yamlMapValue(node, "published"); published != "" {
		value, variable, ok := parsePublishedPort(published)
		if !ok {
			return Port{}, false
		}
		port.PublishedPort = value
		port.Variable = variable
	}
	return port, true
}

func splitPort(value string) (container string, published string, hasPublished bool) {
	separator := lastPortSeparator(value)
	if separator < 0 {
		return value, "", false
	}
	container = value[separator+1:]
	prefix := value[:separator]
	if separator = lastPortSeparator(prefix); separator >= 0 {
		prefix = prefix[separator+1:]
	}
	return container, prefix, true
}

func lastPortSeparator(value string) int {
	curly, square := 0, 0
	for index := len(value) - 1; index >= 0; index-- {
		switch value[index] {
		case '}':
			curly++
		case '{':
			curly--
		case ']':
			square++
		case '[':
			square--
		case ':':
			if curly == 0 && square == 0 {
				return index
			}
		}
	}
	return -1
}

func parsePublishedPort(value string) (int, string, bool) {
	value = strings.TrimSpace(value)
	variable := ""
	fallback := ""
	if strings.HasPrefix(value, "${") && strings.HasSuffix(value, "}") {
		contents := strings.TrimSuffix(strings.TrimPrefix(value, "${"), "}")
		variable, fallback, _ = strings.Cut(contents, ":-")
	} else if strings.HasPrefix(value, "$") {
		variable = strings.TrimPrefix(value, "$")
	} else {
		fallback = value
	}
	if variable != "" && !runtimevars.ValidKey(variable) {
		return 0, "", false
	}
	if fallback == "" {
		return 0, variable, variable != ""
	}
	port, err := strconv.Atoi(fallback)
	if err != nil || port < 1 || port > 65535 {
		return 0, "", false
	}
	return port, variable, true
}

func dependencies(node yaml.Node) []string {
	values := make([]string, 0)
	switch node.Kind {
	case yaml.SequenceNode:
		for _, child := range node.Content {
			if child.Value != "" {
				values = append(values, child.Value)
			}
		}
	case yaml.MappingNode:
		for index := 0; index+1 < len(node.Content); index += 2 {
			if node.Content[index].Value != "" {
				values = append(values, node.Content[index].Value)
			}
		}
	}
	return values
}

func yamlMapValue(node yaml.Node, key string) string {
	for index := 0; index+1 < len(node.Content); index += 2 {
		if node.Content[index].Value == key {
			return node.Content[index+1].Value
		}
	}
	return ""
}
