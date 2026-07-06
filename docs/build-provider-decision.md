# Build Provider Decision

Deploy Manager should treat Docker image builds as a provider boundary:

1. GitHub push arrives.
2. Deploy Manager dispatches a build provider.
3. The provider builds and pushes an image.
4. The provider calls `POST /api/builds/{buildID}/complete`.
5. Deploy Manager deploys the returned `image_ref` with blue/green.

## Default Path

Use GitHub Actions larger runners first.

Why:

- Repositories already live in GitHub.
- `workflow_dispatch` is already wired through the GitHub App.
- Runners are ephemeral by default.
- No long-lived build VM needs to be managed by Deploy Manager.
- The current workflow template supports larger runner labels through the `runner` input.

Recommended initial runner:

```json
{
  "runner": "linux_32_core"
}
```

GitHub publishes Linux larger runner rates at $0.082/min for `linux_32_core`, $0.162/min for `linux_64_core`, and $0.252/min for `linux_96_core`.

## GAR-First Path

Use Google Cloud Build high-CPU if Artifact Registry locality and Google IAM are more important than keeping everything inside GitHub Actions.

Why:

- Cloud Build can push to Artifact Registry with Google IAM.
- No GitHub runner entitlement is needed.
- Pricing for `e2-highcpu-32` is commonly lower than GitHub `linux_32_core`, though it varies by region.

Google's Cloud Build pricing update lists `e2-highcpu-32` around $0.064/min before regional adjustments, with higher region-specific rates in some locations.

## Current Recommendation

For the first two repositories, use GitHub Actions with `linux_32_core`.

If a 1.5 GB Docker image does not build and push in the target time, try in order:

1. Add BuildKit cache in the workflow. This is already present in the templates.
2. Move to `linux_64_core`.
3. Use GCP Cloud Build `e2-highcpu-32` when GAR push latency or GitHub runner limits become the bottleneck.

Do not add permanent build servers yet. They add lifecycle, isolation, cleanup, and credential-scope work before we have evidence that GitHub or Cloud Build is insufficient.
