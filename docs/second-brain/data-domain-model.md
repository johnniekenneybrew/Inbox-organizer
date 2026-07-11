# Data & Domain Model

There is **no backend and no database**. All state lives in Chrome extension storage plus one piece of server-side state in the user's own Gmail (the Snooze label). There is **no billing/plan model** — the extension is free.

## `chrome.storage.sync` (roams with the Google account, quota-bound)

| Key | Shape | Notes |
|---|---|---|
| `tabs` | `[{ id, type: 'label'\|'query', name, labelId, labelName, sublabels: bool, query, description, fg, bg }]` | One item for all tabs — subject to the 8KB per-item sync quota; `saveTabs` surfaces quota failures. `id` = `genId()` (`'t' + random base36`). Legacy `pinnedLabels` migrates to this on load |
| `note:<threadId>` | string | One key per noted thread (`NOTE_PREFIX = 'note:'`, `content.js:103`). Empty text deletes the key |
| `holdLabelName` | string | User's name for the Snooze tab & Gmail label. Default `'Snooze'` (`DEFAULT_HOLD_NAME` in both `content.js` and `background.js`) |

## `chrome.storage.local` (this machine only)

| Key | Shape | Notes |
|---|---|---|
| `heldThreads` | `[{ threadId, subject, snippet, returnAt, heldAt, msgCount, countsIncoming }]` | The snooze records. `returnAt`/`heldAt` are epoch ms. `msgCount` is the reply-detection baseline counting **incoming** messages only (DRAFT/SENT excluded); `countsIncoming: true` marks the post-2026-07 counting scheme — legacy records are rebased on their first check. All mutations serialized through one promise chain in the worker |
| `heldLabelId` | string | Cached Gmail label id; self-heals via `ensureHeldLabel` (verifies, renames on drift, recreates if deleted) |
| `customDurations` | `[{ label, amount, unit: 'hours'\|'days'\|'weeks' }]` | Each custom duration the user ever entered becomes a reusable quick-pick |

## Server-side state (user's Gmail)

- **The Snooze label** — created/renamed by the extension via the Labels API. A snoozed thread = archived (`INBOX` removed) + Snooze label applied. This means the *user's mailbox* is the recovery source if local records are lost (see Backlog: reinstall reconciliation is not yet implemented).
- Returns re-add `INBOX` + `UNREAD` and remove the label.

## Known divergence risks

- `heldThreads` (local) vs the label (server): clearing extension storage strands labeled-but-untracked threads — open backlog item.
- One extension storage per Chrome profile, but Gmail can show multiple accounts (`/u/1`): snooze state belongs only to the Chrome-profile account — open backlog item.
