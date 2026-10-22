package compose

import "testing"

func TestParseReadsServicesPortsAndDependencies(t *testing.T) {
	services, err := Parse([]byte(`
services:
  web:
    build:
      context: ./web
      dockerfile: Dockerfile.prod
    ports:
      - "${WEB_PORT:-8080}:3000"
      - "3000"
    depends_on: [api]
  api:
    image: api:latest
    expose: ["9000/tcp"]
`))
	if err != nil {
		t.Fatal(err)
	}
	if len(services) != 2 || services[0].Name != "api" || services[1].Name != "web" {
		t.Fatalf("expected api and web sorted by name, got %+v", services)
	}
	api, web := services[0], services[1]
	if api.Image != "api:latest" || len(api.Ports) != 1 || api.Ports[0].ContainerPort != 9000 || api.Ports[0].Protocol != "tcp" {
		t.Fatalf("unexpected api service %+v", api)
	}
	if web.BuildContext != "./web" || web.Dockerfile != "Dockerfile.prod" || len(web.DependsOn) != 1 || web.DependsOn[0] != "api" {
		t.Fatalf("unexpected web service %+v", web)
	}
	if len(web.Ports) != 1 || web.Ports[0].ContainerPort != 3000 || web.Ports[0].PublishedPort != 8080 || web.Ports[0].Variable != "WEB_PORT" {
		t.Fatalf("expected one deduplicated web port published via WEB_PORT, got %+v", web.Ports)
	}
}

func TestParseRejectsInvalidYAML(t *testing.T) {
	if _, err := Parse([]byte("services: [")); err == nil {
		t.Fatal("expected invalid yaml to fail")
	}
}
