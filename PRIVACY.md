# Privacy Policy — Inbox Genie

_Last updated: 2026-06-22_

Inbox Genie ("the extension"), published by **Lazo Labs**, is a browser
extension that adds a label tab bar and a "Hold" (snooze) feature inside Gmail.
This policy explains exactly what data the extension accesses, how it is used,
and where it is stored.

**Summary: the extension runs entirely in your browser and your own Google
account. It does not send your data to the developer or to any third‑party
server. There are no analytics, no tracking, and nothing is ever sold.**

## Who operates this extension

This extension is published by **Lazo Labs**. For privacy questions, contact:
**info@lazolabs.app**.

## What the extension accesses

The extension uses the Gmail API with the following OAuth scopes:

- **`https://www.googleapis.com/auth/gmail.labels`** — to read the list of your
  Gmail labels (names and IDs) so it can show them as tabs, and to create/rename
  the "Hold" label.
- **`https://www.googleapis.com/auth/gmail.modify`** — to put an email on Hold
  and bring it back. Specifically, it adds/removes labels on threads you
  explicitly act on (removing `INBOX` to archive, adding the `Hold` label, and
  later re‑adding `INBOX`/`UNREAD`). To support Hold it also reads limited thread
  metadata for threads you hold — the subject line, a short snippet, and the
  number of messages in the thread (used to detect whether a reply arrived).

The extension does **not** read the full content of your emails, does **not**
send email, and does **not** access threads other than the ones you choose to
hold.

## What the extension stores, and where

All data is stored using Chrome's built‑in `chrome.storage`, which lives in your
browser / your Google account sync — **never on a server controlled by the
developer**:

| Data | Where | Purpose |
|---|---|---|
| Pinned label list (id + name) | `chrome.storage.sync` | Which labels appear as tabs |
| Hold label name | `chrome.storage.sync` | Your custom name for the Hold tab/label |
| Held threads (thread ID, subject, snippet, return time, baseline message count) | `chrome.storage.local` | To return held emails on time and detect replies |
| Saved custom durations | `chrome.storage.local` | Your reusable "Hold for…" presets |
| Cached Hold label ID | `chrome.storage.local` | Performance |
| OAuth token | Managed by Chrome (`chrome.identity`) | Authenticating Gmail API calls |

## How the data is used

Data is used **only** to provide the extension's features (label tabs and Hold)
on your own device. The extension's use of information received from Google APIs
adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the **Limited Use** requirements. In particular:

- We do **not** transfer or sell this data to third parties.
- We do **not** use this data for advertising.
- We do **not** allow humans to read this data, except as needed for security,
  to comply with law, or with your explicit consent.
- We use and transfer this data only to provide and improve the extension's
  user‑facing features.

## Data sharing

None. No data leaves your browser/Google account except the direct API calls
your browser makes to Google's Gmail API on your behalf.

## Data retention and deletion

- Extension settings and hold records live in `chrome.storage`. **Uninstalling
  the extension removes its local data.**
- You can clear pending holds at any time using the extension's "Return now" /
  cancel controls.
- Any labels created in Gmail (e.g. the `Hold` label) remain in your Gmail
  account until you delete them in Gmail, and are under your control.
- You can revoke the extension's access at any time at
  [Google Account → Security → Third‑party access](https://myaccount.google.com/connections).

## Children

This extension is not directed to children under 13.

## Changes to this policy

If this policy changes, the updated version will be posted at this URL with a new
"Last updated" date.
