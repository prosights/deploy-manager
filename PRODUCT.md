# Product

## Register

product

## Users

Internal infrastructure and product engineers who need to register remote Linux servers, deploy containerized applications, and inspect deployment health.

## Product Purpose

Paddock is a single internal control plane for Docker Compose deployments on our own servers, in the spirit of Coolify and Railway. It validates SSH connectivity, monitors server health, deploys services with blue/green rollback, manages reverse proxy routing, and streams deployment logs. It does not manage secrets directly; Doppler remains the source of truth.

## Brand Personality

Precise, operational, calm. The interface should feel like a serious internal tool: dense enough for repeated use, clear under pressure, and explicit about risky infrastructure state.

## Anti-references

Avoid a generic PaaS marketing dashboard, a secret-manager clone, decorative SaaS gradients, and large card-only layouts that hide operational detail. The app should not imply that Paddock owns or stores private secret values.

## Design Principles

- Make deployment state obvious before asking users to act.
- Keep provider-specific behavior behind connector boundaries.
- Prefer tables, timelines, and logs over decorative summaries.
- Make risky actions explicit and auditable.

## Accessibility & Inclusion

Target WCAG 2.1 AA contrast for app UI, support keyboard navigation for primary workflows, and respect reduced-motion preferences. Status should not rely on color alone.
