# WMGJ Clinical Readiness API

Read-only FastAPI contract surface for synthetic readiness evidence. It is not a
clinical service and cannot activate deploy, migration, patient communication,
diagnosis, prognosis, prescription, or treatment decisions.

## Quick Start

### Start the development server

```bash
uv run fastapi dev
```

Visit `http://localhost:8000/docs` and inspect `GET /v1/readiness`.

### Tests

```bash
uv run pytest
```

### FastAPI Cloud status

Deployment is deliberately not linked or authenticated. The repository-level
manual workflow defaults to dry-run and requires protected approvals plus both
production enablement variables before it can deploy.

```bash
uv run fastapi cloud deploy --help
```

## Project Structure

- `main.py` — typed, synthetic, read-only API
- `tests/` — fail-closed contract checks
- `pyproject.toml` — locked application dependencies

## Learn More

- [FastAPI Documentation](https://fastapi.tiangolo.com)
- [FastAPI Cloud](https://fastapicloud.com)
