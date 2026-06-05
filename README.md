# Gmail Label Tabs

A Chrome extension (Manifest V3) that adds a sticky tab bar inside Gmail for instant label navigation.

## What it does

- Renders a tab bar at the top of the Gmail inbox — **Inbox** is always pinned first
- Clicking a tab runs a `label:[label-name]` search in Gmail
- Active tab shows a blue underline indicator
- Settings panel (gear icon) lets you pick which labels to show and drag to reorder
- Saved to `chrome.storage.sync` — persists across sessions and syncs across devices

---

## Setup (follow this order)

### 1. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `gmail-label-tabs` folder
4. Note the **Extension ID** that appears (e.g. `abcdefghijklmnopqrstuvwxyzabcdef`)

### 2. Create an OAuth 2.0 client in Google Cloud

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and open (or create) a project
2. Navigate to **APIs & Services → Credentials**
3. Click **Create Credentials → OAuth client ID**
4. Choose application type: **Chrome Extension**
5. Paste the Extension ID from step 1 into the **Application ID** field
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
| `background.js` | Service worker — brokers `chrome.identity.getAuthToken()` calls from the content script |
| `content.js` | Injected into Gmail — renders tab bar, settings panel, MutationObserver, hash-change handler |
| `styles.css` | Injected CSS — tab bar and settings panel styles, all prefixed `glt-` |
| `popup.html` | Extension toolbar popup — quick link to open Gmail |

---

## OAuth scope

Only `https://www.googleapis.com/auth/gmail.labels` is requested — read-only access to label metadata. No email content is ever read.
