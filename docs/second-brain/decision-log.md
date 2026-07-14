# Decision Log

Dated major product/technical decisions, newest first. Reconstructed from git history and session records; commit hashes cite the evidence. Keep entries short and factual; append at the top.

**2026-07-14 — First-run label loading fixed** (found via live smoke test). The settings panel's label fetch timed out at 8s while the user was still reading the OAuth consent screen, then silently reported "(no labels found)" — a guaranteed dead-end on every fresh install. Now: 90s timeout, three honest dropdown states (loading / failed / genuinely none), in-place refresh when labels arrive, and an automatic re-fetch when the form opens with nothing cached.

**2026-07-11 — Adversarial bug-hunt hardening shipped** (`c6950d7`). A 6-lens parallel review + 3-skeptic verification found 20 confirmed bugs; the 15 pure-correctness fixes shipped: snooze engine made intent-first (record before archive; API before record-delete), per-hold commits, 404 pruning, label self-healing in the loop, 401 retry-once, single-queue serialization, drafts/sent excluded from reply detection (with legacy-baseline migration), note-save race fixes with per-note write sequencing, popover cleanup on navigation, safe hash decoding, honest quota errors. Five design-decision items deferred to the backlog.

**2026-07-11 — "Hold" renamed to "Snooze"** (`4e5d207`). Decision: user-facing discoverability beats avoiding overlap with Gmail's native Snoozed view — "Snooze" is the word users already know. Internal code names (`holdThread`, `heldThreads`…) deliberately kept to avoid churn. Context: Gmail's API cannot read or write native snooze, so the extension's own label+timer implementation is the only option.

**2026-06-26 — Settings panel must never hang on auth** (`26cf51a`). Network/auth stalls previously left the gear panel on "Loading…" forever; now it fails visibly.

**2026-06-25 — Notes get a visible affordance on rows** (`4a0da92`). The sticky-note marker became bigger, yellow, and clickable for inline view/edit — notes are usable without opening the email.

**2026-06-25 — Self-healing label resolution** (`ec06d2b`). The Snooze label id is verified/renamed/recreated on use instead of trusted blindly; renames re-label all held threads.

**2026-06-24 — Final name: "Inbox Genie - Tabs & Notes for Gmail"** (`cc74474`, after `438845c` "Gmail Genie" and `9df271f` "Inbox Organizer" the same week). Naming churn settled; short name **Inbox Genie**, publisher **Lazo Labs**.

**2026-06-24 — Tabs v2 + email notes shipped** (`60fb296`). Tabs went from pinned labels to full objects (label / label+sublabels / arbitrary query, custom colors, names, descriptions); private per-thread notes added on `storage.sync`. Legacy `pinnedLabels` auto-migrates.

**2026-06-24 — Privacy page hosted on GitHub Pages** (`5e3fe17`, after `68a3f8c` targeted lazolabs.app). Interim decision until lazolabs.app is live; the store listing URL points at GitHub Pages.

**2026-06-22 — Store-ready: icons, listing, privacy policy, v1.2** (`2798c70`). Chrome Web Store submission path prepared: listing copy, permission justifications, data disclosures.

**2026-06-09 — Snooze UX rework** (`478699f`…`b87186e`). Right-side tab with count, Return now, cached custom durations, custom label name, specific date/time option, bulk over checkboxes, unread-on-return for manual returns too, immediate removal from inbox on hold.

**2026-06-09 — Extension ID pinned** (`62a5923`). `key` field added to the manifest so the ID (and users' storage) survives repacking.

**2026-06-08 — The Hold feature exists** (`3bb1a0e`). Core bet: snooze-style boomerang implemented with a Gmail label + `chrome.alarms`, no backend.

**2026-06-05 — Initial commit: "Gmail Label Tabs"** (`d737d81`). Origin: label tabs only; notes and snooze came later.
