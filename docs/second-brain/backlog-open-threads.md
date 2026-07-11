# Backlog & Open Threads

Prioritized. Sources: the 2026-07-11 bug-hunt (confirmed findings deferred as design decisions), session discussions, and repo TODOs. The code itself contains no `TODO`/`FIXME` comments — everything open lives here.

## P1 — data-integrity design decisions (from the bug-hunt "Wave 3")

1. **Reinstall/new-machine reconciliation.** `heldThreads` is local-only; reinstalling strands snoozed emails under the label with no timers. Decide: on install, list threads carrying the Snooze label and either return them to the inbox or adopt them with a default timer. (`background.js`, finding confirmed 3/3.)
2. **Multi-account guard.** The UI renders on every `mail.google.com/u/N` account but tokens/state belong to the Chrome-profile account only. Decide: detect the mismatch (Gmail `getProfile` vs the page's account) and disable/annotate the snooze UI on non-matching accounts. (Confirmed 3/3.)

## P2 — correctness edges

3. **Split view / reading pane:** an open conversation is never detected when list + conversation share `[role="main"]`, so no note panel and no contextual Snooze there. Fix `getOpenConversation` to scope to the conversation sub-pane. (`content.js:~380`.)
4. **Label names containing quotes** break `buildLabelQuery` (`label:"Reports "Q3""`). Escape or hyphen-normalize in the three interpolation sites (`content.js:85, ~908, ~1294`).
5. **Renaming the Snooze label to an existing label's name**: Gmail returns 409, the catch swallows it, and the cached id silently switches to the other label. Decide: reject with a clear error, or adopt the existing label and migrate held threads. (`background.js` `ensureHeldLabel` PATCH path.)

## P3 — product/monetization

6. **Tip jar** (discussed 2026-07-11, awaiting a decision): link-out only (Chrome Web Store forbids in-extension payment for digital goods). Recommended: Ko-fi or Buy Me a Coffee link in the settings-panel footer, optionally also the popup. **Blocked on: the payment-page URL.**
7. **Production release v1.4.** The rename + hardening work is on `dev` only; `main` is still pre-rename. Ship path: merge, bump version, new zip, updated store listing copy (already rewritten for "Snooze"), refresh screenshots that show the old "Hold" wording.

## P4 — housekeeping

8. **Store listing placeholders** — `STORE_LISTING.md` still says "Replace the bracketed placeholders before submitting"; verify none remain before the next store submission (the privacy-URL note about moving to `lazolabs.app/privacy` is still open).
9. **lazolabs.app** — privacy URL is on GitHub Pages "until lazolabs.app is live" (decision 2026-06-24); revisit when the domain is up.
10. **No automated tests / CI.** The only gate is `node --check` + manual smoke. Worth adding at least a headless smoke test against `mockup.html` if the project grows.
