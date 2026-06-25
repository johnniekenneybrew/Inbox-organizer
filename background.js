'use strict';

// Service worker — two jobs:
//   1. Bridge chrome.identity (only available here) to the content script.
//   2. Run the "Hold" engine: archive threads on request and re-deliver them
//      to the inbox when their timer expires, via a periodic chrome.alarm.

// ─── Constants ──────────────────────────────────────────────────────────────

const API            = 'https://www.googleapis.com/gmail/v1/users/me';
const DEFAULT_HOLD_NAME = 'Hold';               // user-customizable via storage.sync
const HOLDS_KEY      = 'heldThreads';           // chrome.storage.local
const HELD_LABEL_KEY = 'heldLabelId';           // cached label id
const HOLD_NAME_KEY  = 'holdLabelName';         // chrome.storage.sync
const ALARM_NAME     = 'glt-check-holds';
const CHECK_PERIOD_MIN = 1;                      // MV3 minimum granularity

// ─── Token helpers ────────────────────────────────────────────────────────────

function getToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        return reject(new Error(chrome.runtime.lastError?.message || 'No auth token'));
      }
      resolve(token);
    });
  });
}

function removeToken(token) {
  return new Promise((resolve) =>
    chrome.identity.removeCachedAuthToken({ token }, () => resolve())
  );
}

// ─── Gmail API ──────────────────────────────────────────────────────────────

async function api(token, path, options = {}) {
  const r = await fetch(API + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  if (r.status === 401) {
    await removeToken(token);
    throw new Error('Authentication expired. Open the settings gear in Gmail to re-authorize.');
  }
  if (!r.ok) throw new Error(`Gmail API error ${r.status}`);
  return r.status === 204 ? null : r.json();
}

function modifyThread(token, threadId, addLabelIds, removeLabelIds) {
  return api(token, `/threads/${threadId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  });
}

// The user-customizable Hold label name (defaults to "Hold").
async function getHoldName() {
  const v = (await chrome.storage.sync.get(HOLD_NAME_KEY))[HOLD_NAME_KEY];
  return v || DEFAULT_HOLD_NAME;
}

// Resolve the Hold label id, self-healing along the way:
//  • verify the cached id still exists; rename it if the label name drifted
//  • otherwise find an existing label by name, or create one
// Always returns a valid id so a hold can never archive an email unlabeled.
async function ensureHeldLabel(token) {
  const name = await getHoldName();
  const cached = (await chrome.storage.local.get(HELD_LABEL_KEY))[HELD_LABEL_KEY];

  if (cached) {
    try {
      const lbl = await api(token, `/labels/${cached}`);
      if (lbl && lbl.id) {
        if (lbl.name !== name) {
          await api(token, `/labels/${cached}`, {
            method: 'PATCH',
            body: JSON.stringify({ name }),
          });
        }
        return cached;
      }
    } catch {
      // Cached id is stale (label deleted/recreated) — fall through to re-resolve.
    }
  }

  const { labels = [] } = await api(token, '/labels');
  let label = labels.find((l) => l.name === name);
  if (!label) {
    label = await api(token, '/labels', {
      method: 'POST',
      body: JSON.stringify({
        name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      }),
    });
  }
  await chrome.storage.local.set({ [HELD_LABEL_KEY]: label.id });
  return label.id;
}

// Re-apply the Hold label to every currently-held thread (recovers any thread
// that was archived without the label, or whose label drifted).
async function reapplyHoldLabel(token, labelId) {
  const holds = await loadHolds();
  for (const h of holds) {
    try {
      await modifyThread(token, h.threadId, [labelId], []);
    } catch {
      // Best-effort; a single failure shouldn't block the rest.
    }
  }
}

// Persist a new Hold label name; ensureHeldLabel renames/creates the Gmail label
// to match, then re-label existing holds so none are left orphaned.
async function setHoldLabelName(name) {
  await chrome.storage.sync.set({ [HOLD_NAME_KEY]: name });
  const token = await getToken(true);
  const labelId = await ensureHeldLabel(token);
  await reapplyHoldLabel(token, labelId);
  return { ok: true };
}

// Resolve a usable threadId + display metadata (and the current message count,
// used later to detect a reply) from whatever the content script could scrape.
async function resolveThreadMeta(token, { threadId, messageId }) {
  const headerOf = (msg, name) =>
    (msg?.payload?.headers || []).find((h) => h.name.toLowerCase() === name)?.value;

  if (!threadId && messageId) {
    const msg = await api(token, `/messages/${messageId}?format=minimal`);
    threadId = msg.threadId;
  }

  const thread = await api(
    token,
    `/threads/${threadId}?format=metadata&metadataHeaders=Subject`
  );
  const msgs = thread.messages || [];
  return {
    threadId,
    subject: headerOf(msgs[0], 'subject') || '(no subject)',
    snippet: msgs[msgs.length - 1]?.snippet || '',
    msgCount: msgs.length,
  };
}

// Current number of messages in a thread (used to detect a new reply).
async function threadMessageCount(token, threadId) {
  const thread = await api(token, `/threads/${threadId}?format=minimal`);
  return (thread.messages || []).length;
}

// ─── Hold storage ─────────────────────────────────────────────────────────────

async function loadHolds() {
  return (await chrome.storage.local.get(HOLDS_KEY))[HOLDS_KEY] || [];
}

function saveHolds(holds) {
  return chrome.storage.local.set({ [HOLDS_KEY]: holds });
}

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_PERIOD_MIN });
  }
}

// ─── Core actions ─────────────────────────────────────────────────────────────

async function holdThread({ threadId, messageId, returnAt }) {
  const token = await getToken(true);
  const meta = await resolveThreadMeta(token, { threadId, messageId });
  // Resolve the label first; if this throws, the hold fails and is surfaced to the
  // user instead of silently archiving the email with no Hold label applied.
  const heldLabelId = await ensureHeldLabel(token);

  await modifyThread(token, meta.threadId, [heldLabelId], ['INBOX']);

  const holds = await loadHolds();
  // Replace any existing hold for the same thread.
  const next = holds.filter((h) => h.threadId !== meta.threadId);
  next.push({
    threadId: meta.threadId,
    subject: meta.subject,
    snippet: meta.snippet,
    returnAt,
    heldAt: Date.now(),
    msgCount: meta.msgCount, // baseline for reply detection
  });
  await saveHolds(next);
  await ensureAlarm();
  return { ok: true, returnAt, subject: meta.subject };
}

async function cancelHold({ threadId, messageId, returnToInbox }) {
  const token = await getToken(true);

  // The Hold view / row may only give us a message id — resolve to a thread.
  if (!threadId && messageId) {
    threadId = (await resolveThreadMeta(token, { messageId })).threadId;
  }

  const holds = await loadHolds();
  await saveHolds(holds.filter((h) => h.threadId !== threadId));

  if (returnToInbox) {
    const heldLabelId = (await chrome.storage.local.get(HELD_LABEL_KEY))[HELD_LABEL_KEY];
    // Mark unread on the way back so it stands out — same as the timer return.
    await modifyThread(token, threadId, ['INBOX', 'UNREAD'], heldLabelId ? [heldLabelId] : []);
  }
  return { ok: true };
}

// Runs on every alarm tick. Two responsibilities per hold:
//   • timer expired  → return it to the inbox, marked unread.
//   • reply arrived  → drop the Hold label early (a new message already pulled
//                      the thread back into the inbox).
async function processHolds() {
  const holds = await loadHolds();
  if (holds.length === 0) return;

  let token;
  try {
    token = await getToken(false); // non-interactive — never pops UI in background
  } catch {
    return; // user must re-auth; leave holds in place and retry next tick
  }

  const heldLabelId = (await chrome.storage.local.get(HELD_LABEL_KEY))[HELD_LABEL_KEY];
  const removeLabel = heldLabelId ? [heldLabelId] : [];
  const now = Date.now();
  const done = new Set();

  for (const hold of holds) {
    try {
      if (hold.returnAt <= now) {
        // Timer expired — bring it back to the inbox and mark unread.
        await modifyThread(token, hold.threadId, ['INBOX', 'UNREAD'], removeLabel);
        done.add(hold.threadId);
        continue;
      }
      // Not due yet — if a reply landed, clear the hold early.
      if (hold.msgCount != null) {
        const count = await threadMessageCount(token, hold.threadId);
        if (count > hold.msgCount) {
          // Just drop the Hold label; the reply already returned it to the inbox.
          await modifyThread(token, hold.threadId, ['INBOX'], removeLabel);
          done.add(hold.threadId);
        }
      }
    } catch {
      // Leave this hold for the next tick.
    }
  }

  if (done.size) {
    const remaining = (await loadHolds()).filter((h) => !done.has(h.threadId));
    await saveHolds(remaining);
  }
}

// ─── Wiring ───────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) processHolds();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'GET_TOKEN':
      getToken(true)
        .then((token) => sendResponse({ token }))
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case 'REMOVE_TOKEN':
      removeToken(message.token).then(() => sendResponse({ ok: true }));
      return true;

    case 'HOLD_THREAD':
      holdThread(message)
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case 'LIST_HOLDS':
      loadHolds().then((holds) => sendResponse({ holds }));
      return true;

    case 'CANCEL_HOLD':
      cancelHold(message)
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case 'SET_HOLD_LABEL_NAME':
      setHoldLabelName(message.name)
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true;
  }
});
