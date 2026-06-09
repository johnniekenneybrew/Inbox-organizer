# Gmail Label Tabs

A Chrome extension (Manifest V3) that adds a sticky tab bar inside Gmail for instant label navigation, plus a **Hold** feature that snoozes emails out of the inbox and brings them back on a timer.

## What it does

### Label tabs
- Renders a tab bar at the top of the Gmail inbox — **Inbox** is always pinned first
- Clicking a tab runs a `label:[label-name]` search in Gmail
- Active tab shows a blue underline indicator
- Settings panel (gear icon) lets you pick which labels to show and drag to reorder
- Saved to `chrome.storage.sync` — persists across sessions and syncs across devices

### Hold (boomerang)
- **From the inbox list:** hover any row and click the inline **Hold** button — no need to open the email
- **From an open conversation:** click **Hold** in the tab bar
- Pick when it should come back: **3 days**, **1 week**, a **Custom** duration (a number of hours/days/weeks), or a **specific date & time**
- Custom durations are remembered — each one you enter is cached locally (`chrome.storage.local`) and appears as its own quick-pick button next time (removable with the ✕)
- The email is archived out of the inbox and tagged with the **Hold** label
- The **Hold** tab on the right of the bar opens the Hold label so you can see and open the held emails in Gmail; it shows a count badge. Hovering a held row shows **when it will return** plus a **Return now** button
- **Return now** is available both on a held email's row (hover) and inside the opened email; the automatic timer return and Return now both bring the email back **unread**
- **A reply ends the hold early:** if a new message arrives in a held thread before the timer, the background check removes the **Hold** label automatically (the reply has already pulled the thread back into your inbox)
- The Hold tab/label name is **customizable** in the settings (gear) panel — defaults to "Hold"
- Holds are tracked in `chrome.storage.local`; the return + reply-check job runs in the service worker via `chrome.alarms` (once a minute)

---

## Setup (follow this order)

### 1. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the repo folder
4. The **Extension ID** is pinned by the `key` field in `manifest.json`, so it is always:
   ```
   alppbmfhhihpefnnkokcmmalblhdnnad
   ```
   (Loading unpacked on any machine produces this same ID, which is what the OAuth client below is registered against.)

### 2. Create an OAuth 2.0 client in Google Cloud

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and open (or create) a project
2. Navigate to **APIs & Services → Credentials**
3. Click **Create Credentials → OAuth client ID**
4. Choose application type: **Chrome Extension**
5. Paste the pinned Extension ID (`alppbmfhhihpefnnkokcmmalblhdnnad`) into the **Application ID** field
6. Click **Create** and copy the **Client ID**

> The project must have the **Gmail API** enabled:
> APIs & Services → Library → search "Gmail API" → Enable

### 3. Paste the Client ID into manifest.json

Open `manifest.json` and replace `YOUR_CLIENT_ID` with your actual Client ID:

```json
"oauth2": {
  "client_id": "1234567890-abc.apps.googleusercontent.com",
  ...
}
```

Then reload the extension in `chrome://extensions` (click the refresh icon).

### 4. Add test users in Google Cloud

Because the app stays in **Testing** mode you must explicitly allow each Gmail account that will use it:

1. APIs & Services → **OAuth consent screen**
2. Scroll to **Test users** → **Add users**
3. Enter each teammate's Gmail address and save

---

## Usage

1. Open [Gmail](https://mail.google.com)
2. The tab bar appears at the top of the inbox — **Inbox** is shown by default
3. Click the **gear icon** (right side of the bar) to open the settings panel
4. Check labels to pin them as tabs; drag rows to reorder
5. Click **Save** — the bar updates immediately

---

## File overview

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest — permissions, OAuth scopes, content script declaration |
| `background.js` | Service worker — brokers `chrome.identity.getAuthToken()` calls, runs the Hold/return engine via `chrome.alarms` |
| `content.js` | Injected into Gmail — renders tab bar, Hold button + manager, settings panel, MutationObserver, hash-change handler |
| `styles.css` | Injected CSS — tab bar, Hold UI, and settings panel styles, all prefixed `glt-` |
| `popup.html` | Extension toolbar popup — quick link to open Gmail |

---

## OAuth scopes

| Scope | Why |
|---|---|
| `https://www.googleapis.com/auth/gmail.labels` | Read your label list for the tab bar; create the **⏳ Held** label |
| `https://www.googleapis.com/auth/gmail.modify` | Archive a held thread out of the inbox and add it back when its timer fires |

`gmail.modify` does **not** grant permanent deletion or send access. The extension only changes which labels (including `INBOX`/`UNREAD`) are applied to threads you explicitly hold.
