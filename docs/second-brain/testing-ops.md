# Testing & Ops

## Branches

| Branch | Purpose |
|---|---|
| `main` | Production — store-facing manifest (name "Inbox Genie - Tabs & Notes for Gmail", prod OAuth client id) |
| `dev` | Dev build — manifest name carries "(DEV)" and a separate OAuth client id so both can be installed side-by-side |
| feature branches | Work lands here first, then merges to `dev` for testing |

Merging feature → `dev`: the manifest differences (name, `default_title`, client id) live only on `dev`; merges auto-resolve as long as feature branches don't touch those lines.

## Test (all manual today — no automated tests, no CI)

1. **Syntax gate:** `node --check content.js && node --check background.js` — the only automated check that exists. Run it before every commit.
2. **Build the dev zip:** from the repo root on `dev`:
   ```
   zip -rq inbox-genie-DEV.zip manifest.json background.js content.js styles.css popup.html icons
   ```
   (Exactly these files — `mockup.html`, `preview/`, `store-assets/`, docs are never shipped.)
3. **Load it:** `chrome://extensions` → Developer mode → Load unpacked (or drag the zip) → open Gmail → authorize via the settings gear.
4. **Manual smoke checklist:** snooze a row + an open email; bulk snooze; "Return now"; add/edit a note from row and panel; add/reorder/recolor a tab; rename the Snooze label in settings; check the Snooze tab count.

## Ship to production

1. Merge `dev` → `main` (keep `main`'s manifest name/client id — reverse of the usual direction, review the manifest diff by hand).
2. Bump `"version"` in `manifest.json` (currently 1.3).
3. Cut the zip from `main` with the same zip command.
4. Upload in the Chrome Web Store Developer Dashboard; listing copy lives in `STORE_LISTING.md` (summary, description, permission justifications, data disclosures — copy/paste ready).
5. Privacy policy must stay hosted at the URL in the listing: `https://johnniekenneybrew.github.io/Inbox-organizer/PRIVACY.html` (GitHub Pages serving `PRIVACY.html`).

## Operational gotchas

- **MV3 worker death is normal.** The snooze engine is written intent-first (record saved before archive; record deleted only after successful return) so a kill mid-operation degrades benignly. Keep that ordering — it was a hard-won fix (see Decision Log 2026-07).
- **Gmail's DOM is obfuscated and shifts.** Selectors like `tr.zA`, `.bog`, `[data-legacy-thread-id]` are load-bearing; a Gmail redesign can silently break row detection. The MutationObserver + retry timers are the safety net.
- **`chrome.storage.sync` quotas are real:** 8KB per item (the single `tabs` item can hit this), ~120 writes/min (typing notes hits this — saves are debounced 600ms, retried once, and failures surfaced honestly).
- **One Gmail account per Chrome profile.** `chrome.identity` tokens belong to the profile account; secondary `/u/1` accounts see the UI but can't be served correctly (open backlog item).
- **The extension ID is pinned** via `manifest.json`'s `key` field — don't remove it or the ID (and everyone's storage) changes.
