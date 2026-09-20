# PRIYO CODEX HOST PRO — corrected build

This build keeps the original architecture but fixes the deployment and file-manager problems found during testing.

## Fixed

- ZIP uploads with one top-level folder are flattened automatically.
- File Manager now renders real folders and files instead of one flat path list.
- API errors now return useful JSON messages and the frontend displays the actual error.
- Project upload/deploy errors are shown inside the project card instead of a generic `Request failed` popup.
- Deployment Dockerfile generation now writes real newlines.
- HTML deployments use container port 80; Node/Python use port 3000.
- Deployment is marked `Running` only after the container starts successfully.
- Production deployments fail early with a clear message when `DOCKER_HOST` is not configured.
- Node/Python image builds can access the Docker build network when the dedicated executor permits it.
- GitHub Actions ZIP extraction workflow is included at `.github/workflows/extract.yml` and has `contents: write` permission.

## Render

The web panel can be hosted as a Docker web service on Render. Render web services do not provide a Docker daemon for launching arbitrary user containers inside the service. For Node/Python/HTML container deployments, configure `DOCKER_HOST` to a dedicated isolated Docker executor. Without it, the panel now reports the exact configuration error instead of returning a misleading generic failure.

Required environment variables include `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `PUBLIC_BASE_URL`. `DOCKER_HOST` is required for the container deployment engine.
