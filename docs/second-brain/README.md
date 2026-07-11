# 🧞 Inbox Genie — Second Brain

**Updated:** 2026-07-11

Inbox Genie is a Chrome extension (Manifest V3) that lives inside the Gmail web app and adds three things Gmail is missing: a sticky **tab bar** that turns labels and saved searches into one-click colored tabs, private **notes** on any email (synced via the user's own Chrome storage, never written into the email), and a **Snooze** engine that archives an email out of the inbox under a user-named Gmail label and returns it — marked unread — when a timer expires, when the other side replies, or on demand. It has no backend: a content script (`content.js`) renders all UI inside Gmail, and an MV3 service worker (`background.js`) brokers OAuth tokens and runs the snooze timer loop against the Gmail REST API. Published by **Lazo Labs**.

> **Source of truth:** the code is the real source of truth (`johnniekenneybrew/Inbox-organizer`); this brain is the mirror — update it when big things ship, not on every commit.

## Sections

| Page | What's in it |
|---|---|
| [Brand / Design System](brand-design-system.md) | Palette hex values, typography, logo assets, rules that must not be broken |
| [Product Map](product-map.md) | Every surface → owning file/function, core user flows in plain language |
| [Data & Domain Model](data-domain-model.md) | Entities and every storage key, exact shapes, server-side state |
| [Pipelines & Integrations](pipelines-integrations.md) | Gmail API usage, OAuth scopes, what's deliberately absent |
| [Testing & Ops](testing-ops.md) | Run/test/ship steps, release gate, operational gotchas |
| [Decision Log](decision-log.md) | Dated major decisions reconstructed from history, newest first |
| [Backlog & Open Threads](backlog-open-threads.md) | Known-open work, prioritized |
