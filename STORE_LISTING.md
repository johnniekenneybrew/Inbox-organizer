# Chrome Web Store listing copy

Copy/paste these into the Web Store Developer Dashboard fields. Replace the
bracketed placeholders before submitting.

---

## Publisher
Lazo Labs — contact: info@lazolabs.app

## Name
Inbox Genie - Tabs & Notes for Gmail

## Summary (short description — max 132 characters)
Turn Gmail labels & searches into tabs, add private notes to emails, and snooze (Hold) emails back to your inbox on a timer.

## Category
Productivity / Workflow & Planning

## Detailed description
Inbox Genie makes Gmail faster in two ways: it turns your labels into one‑click
tabs, and it lets you put emails on hold so they leave your inbox now and come back
exactly when you can deal with them.

If you live in Gmail, two things slow you down every day — hunting through the
label sidebar, and emails you can't act on yet sitting in your inbox nagging you.
Inbox Genie fixes both.

GET TO ANY LABEL IN ONE CLICK
Pin your most‑used labels as tabs across the top of Gmail (Inbox is always first),
so you stop digging through the sidebar. Choose which labels appear and drag them
into the order you want — and your setup follows you to every device you use Gmail
on.

CLEAR YOUR INBOX WITHOUT LOSING TRACK ("Hold")
Not ready to deal with an email? Hold it. It leaves your inbox immediately and
returns — marked unread — exactly when you choose: in 3 days, a week, a custom
amount of time, or on a specific date.
• Hold an open email, a single message on hover, or a whole batch at once.
• Everything you've held lives under a "Hold" tab, so nothing slips through the
  cracks — bring any of it back early with a single click.
• If someone replies before your timer is up, the hold clears automatically, so a
  live conversation never gets stuck in limbo.

WHY YOU'LL WANT IT
• A calmer inbox that shows only what needs you right now.
• Your labels, always one click away.
• Peace of mind that held email always comes back on schedule.

PRIVATE BY DESIGN
Inbox Genie runs entirely in your browser and your own Google account. No
analytics, no tracking, nothing sent to us, nothing sold. It only reads your label
list and the limited thread details needed to hold and return the emails you
choose — it never reads your email content and never sends mail.
Full privacy policy: https://johnniekenneybrew.github.io/Inbox-organizer/PRIVACY.html

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
https://johnniekenneybrew.github.io/Inbox-organizer/PRIVACY.html  (GitHub Pages — enable in repo Settings → Pages. Later you can move it to https://lazolabs.app/privacy and update this URL.)  (e.g. the raw/Pages URL of PRIVACY.md in this repo)
