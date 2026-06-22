# Chrome Web Store listing copy

Copy/paste these into the Web Store Developer Dashboard fields. Replace the
bracketed placeholders before submitting.

---

## Name
Gmail Label Tabs

## Summary (short description — max 132 characters)
Pinned label tabs for Gmail, plus Hold: snooze emails out of your inbox and have
them return on a timer.

## Category
Productivity / Workflow & Planning

## Detailed description
Gmail Label Tabs adds a clean tab bar to the top of Gmail so you can jump between
your labels in one click — and a built‑in Hold (snooze) feature so emails leave
your inbox now and come back exactly when you want.

LABEL TABS
• A sticky tab bar across the top of Gmail. Inbox is always first.
• Pick which labels show as tabs and drag to reorder them (gear → settings).
• Your choices sync across devices via your Google account.

HOLD (boomerang / snooze)
• Hold any email and choose when it returns: 3 days, 1 week, a custom duration
  (hours/days/weeks), or a specific date & time.
• Custom durations you enter are remembered as one‑click options.
• Held emails leave your inbox and are tagged with a "Hold" label (you can rename
  it). When the timer fires they return to your inbox, marked unread.
• Hold from an open email, straight from a list row on hover, or in bulk by
  selecting multiple rows.
• A "Hold" tab shows everything you've got on hold; return any of them early with
  one click — individually or in bulk.
• If someone replies before the timer is up, the hold clears automatically.

PRIVACY
• Runs entirely in your browser and your own Google account.
• No analytics, no tracking, nothing sent to the developer, nothing sold.
• Only reads label data and the limited thread info needed to hold/return the
  emails you choose. Full privacy policy: [your-privacy-policy-URL]

## Single purpose (required)
The single purpose of this extension is to help users navigate Gmail labels and
temporarily remove (hold/snooze) selected emails from the inbox so they return at
a chosen time.

## Permission justifications (required)

**identity** — Used to obtain an OAuth token (via `chrome.identity`) so the
extension can call the Gmail API on the signed‑in user's behalf. No identity data
is stored or transmitted anywhere except Google's own API.

**storage** — Stores the user's settings (which labels are pinned, the custom
Hold label name, saved Hold durations) and the list of currently held threads so
they can be returned on schedule. Stored only in `chrome.storage` (local/sync).

**alarms** — Runs a periodic background check (once per minute) that returns held
emails to the inbox when their timer expires and detects replies that should end
a hold early.

**Host permission `https://mail.google.com/*`** — The extension's UI (tab bar,
Hold buttons) is injected into the Gmail web app, so it must run on Gmail pages.

**Host permission `https://www.googleapis.com/*`** — Required to call the Gmail
REST API to read labels and add/remove labels on the threads the user holds.

**`gmail.labels` scope** — Read the user's label list to render tabs, and
create/rename the "Hold" label.

**`gmail.modify` scope** — Add/remove labels on the specific threads the user
holds (archive out of the inbox, apply the Hold label, then re‑add INBOX/UNREAD
on return). Also reads limited metadata of held threads (subject, snippet,
message count) to display them and to detect replies. The extension never reads
full message bodies, sends mail, or deletes mail.

## Remote code
No. The extension contains no remote code; all logic ships in the package.

## Data usage disclosures (Privacy practices tab)
- Collects: "Personal communications" — limited Gmail label and held‑thread
  metadata, used only on‑device to provide the feature.
- Does **not** sell or transfer user data to third parties.
- Does **not** use data for purposes unrelated to the single purpose.
- Does **not** use data for creditworthiness/lending.
- Complies with the Google API Services User Data Policy (Limited Use).

## Privacy policy URL
[your-privacy-policy-URL]  (e.g. the raw/Pages URL of PRIVACY.md in this repo)
