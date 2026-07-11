# Pipelines & Integrations

## The one integration: Gmail REST API v1

Base: `https://www.googleapis.com/gmail/v1/users/me` (constant `API`, `background.js:10`). All calls go through `api()` which attaches the OAuth bearer token, attaches HTTP status to thrown errors, and drops the cached token on 401 (callers retry once via `withToken`).

**Endpoints used:**
- `GET /threads/{id}` (`format=metadata` for subject/snippet baseline, `format=minimal` for reply checks)
- `POST /threads/{id}/modify` — the workhorse: add/remove `INBOX`, `UNREAD`, and the Snooze label
- `GET /messages/{id}?format=minimal` — resolve a scraped message id to its thread
- `GET /labels`, `GET/PATCH /labels/{id}`, `POST /labels` — list, verify/rename, create the Snooze label

**Auth:** `chrome.identity.getAuthToken` (Chrome's built-in OAuth; no client secret in the codebase). OAuth client id lives in `manifest.json` → `oauth2.client_id` (a different client id on the `dev` branch than on `main`). Scopes — exactly two:
- `https://www.googleapis.com/auth/gmail.labels`
- `https://www.googleapis.com/auth/gmail.modify`

**Privacy commitments already published** (PRIVACY.md / store listing): never reads full message bodies, never sends mail, only touches threads the user explicitly snoozes, no analytics, no tracking, no data leaves the user's browser/Google account.

## Scheduled work

`chrome.alarms` — one alarm (`glt-check-holds`), period 1 minute (MV3 minimum). Drives `processHolds`: timer returns, reply detection, label self-healing, dead-thread pruning.

## Deliberately absent (don't "fix" these)

- **No AI providers, no third-party APIs, no webhooks, no analytics/telemetry** — the privacy story is a core selling point and a store-review asset.
- **No env vars, no secrets, no build step** — plain JS files shipped as-is; nothing to configure per environment except the manifest differences between `dev` and `main`.
- **No remote code** — declared in the store listing; everything ships in the package.
