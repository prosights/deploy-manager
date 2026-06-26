# Product

## Register

product

## Users

Internal infrastructure and product engineers who need to register remote Linux servers, deploy containerized applications, inspect deployment health, and understand which infrastructure credentials have access to which systems.

## Product Purpose

Deploy Manager is a single internal control plane for remote server operations and Docker Compose deployments. It validates SSH connectivity, monitors server health, deploys application stacks, manages reverse proxy routing, streams deployment logs, and centralizes credential permission inventory. It does not manage secrets directly; secret systems such as Doppler remain the source of truth and are integrated through connectors.

## Brand Personality

Precise, operational, calm. The interface should feel like a serious internal tool: dense enough for repeated use, clear under pressure, and explicit about risky infrastructure state.

## Anti-references

Avoid a generic PaaS marketing dashboard, a secret-manager clone, decorative SaaS gradients, and large card-only layouts that hide operational detail. The app should not imply that Deploy Manager owns or stores private secret values.

## Design Principles

- Make deployment state obvious before asking users to act.
- Treat credential permissions and usage as a first-class operational view.
- Keep provider-specific behavior behind connector boundaries.
- Prefer tables, timelines, and logs over decorative summaries.
- Make risky actions explicit and auditable.

## Accessibility & Inclusion

Target WCAG 2.1 AA contrast for app UI, support keyboard navigation for primary workflows, and respect reduced-motion preferences. Status should not rely on color alone.
