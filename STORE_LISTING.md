# Chrome Web Store listing copy

Copy/paste these into the Web Store Developer Dashboard fields. Replace the
bracketed placeholders before submitting.

---

## Publisher
Lazo Labs — contact: info@lazolabs.app

## Name
Inbox Genie - Tabs & Notes for Gmail

## Summary (short description — max 132 characters)
Turn Gmail labels & searches into tabs, add private notes to emails, and Snooze emails back to your inbox on a timer.

## Category
Productivity / Workflow & Planning

## Detailed description
Whether you strive for inbox zero or just want to organize your inbox to make your day-to-day run smoother, Inbox Genie makes staying on top of your inbox a breeze.

Inbox Genie adds the three things Gmail is missing: one-click tabs for your labels and searches, private notes on any email, and a Snooze button that clears emails out of your inbox and brings them back exactly when you need them — all without ever leaving Gmail.

CUSTOM TABS — get anywhere in one click
✅ Turn any Gmail label into a tab
✅ Add a tab for a label and all of its sublabels
✅ Turn any search into a tab — like receipts with attachments, or emails from your boss or customers
✅ Color-code tabs with your own font and background colors
✅ Rename tabs, edit their query, and add descriptions
✅ Drag to reorder — and your tabs sync across all your devices

PRIVATE NOTES — remember what matters
✅ Add a private note to any email, right at the top of the conversation
✅ Notes auto-save and sync across your devices
✅ Only you can see them — notes are never added to the email or shared with anyone
✅ A marker shows you at a glance which emails have notes

SNOOZE — a clear inbox, nothing forgotten
✅ Snooze an email to clear it from your inbox now and have it come back later
✅ Choose 3 days, 1 week, a custom duration, or a specific date & time
✅ Snooze one email, or a whole batch at once
✅ See everything you've snoozed under one tab and return any of it early with a click
✅ Snoozed emails return marked unread, so they never slip past you
✅ If someone replies before the timer is up, the snooze cancels automatically

WHY YOU'LL LOVE IT
• A calmer inbox that shows only what needs you right now
• Your labels and searches, always one click away
• Context where you need it, with private notes on any email
• Peace of mind that snoozed email always comes back on schedule

PRIVATE BY DESIGN
Inbox Genie runs entirely in your browser and your own Google account. No analytics, no tracking, nothing sent to us, nothing sold. It only reads your label list and the limited thread details needed to power tabs, notes, and Snooze — it never reads your email content and never sends mail.
Full privacy policy: https://johnniekenneybrew.github.io/Inbox-organizer/PRIVACY.html

## Single purpose (required)
The single purpose of this extension is to help users navigate Gmail labels and
temporarily snooze selected emails out of the inbox so they return at a chosen
time.

## Permission justifications (required)

**identity** — Used to obtain an OAuth token (via `chrome.identity`) so the
extension can call the Gmail API on the signed‑in user's behalf. No identity data
is stored or transmitted anywhere except Google's own API.

**storage** — Stores the user's settings (which labels are pinned, the custom
Snooze label name, saved Snooze durations) and the list of currently snoozed
threads so they can be returned on schedule. Stored only in `chrome.storage`
(local/sync).

**alarms** — Runs a periodic background check (once per minute) that returns
snoozed emails to the inbox when their timer expires and detects replies that
should end a snooze early.

**Host permission `https://mail.google.com/*`** — The extension's UI (tab bar,
Snooze buttons) is injected into the Gmail web app, so it must run on Gmail pages.

**Host permission `https://www.googleapis.com/*`** — Required to call the Gmail
REST API to read labels and add/remove labels on the threads the user snoozes.

**`gmail.labels` scope** — Read the user's label list to render tabs, and
create/rename the "Snooze" label.

**`gmail.modify` scope** — Add/remove labels on the specific threads the user
snoozes (archive out of the inbox, apply the Snooze label, then re‑add INBOX/UNREAD
on return). Also reads limited metadata of snoozed threads (subject, snippet,
message count) to display them and to detect replies. The extension never reads
full message bodies, sends mail, or deletes mail.

## Remote code
No. The extension contains no remote code; all logic ships in the package.

## Data usage disclosures (Privacy practices tab)
- Collects: "Personal communications" — limited Gmail label and snoozed‑thread
  metadata, used only on‑device to provide the feature.
- Does **not** sell or transfer user data to third parties.
- Does **not** use data for purposes unrelated to the single purpose.
- Does **not** use data for creditworthiness/lending.
- Complies with the Google API Services User Data Policy (Limited Use).

## Privacy policy URL
https://johnniekenneybrew.github.io/Inbox-organizer/PRIVACY.html  (GitHub Pages — enable in repo Settings → Pages. Later you can move it to https://lazolabs.app/privacy and update this URL.)  (e.g. the raw/Pages URL of PRIVACY.md in this repo)
