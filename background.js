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

// Find (or create) the Hold label and cache its id.
async function ensureHeldLabel(token) {
  const cached = (await chrome.storage.local.get(HELD_LABEL_KEY))[HELD_LABEL_KEY];
  if (cached) return cached;

  const name = await getHoldName();
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

// Persist a new Hold label name and rename the Gmail label to match.
async function setHoldLabelName(name) {
  await chrome.storage.sync.set({ [HOLD_NAME_KEY]: name });
  const token = await getToken(true);
  const id = (await chrome.storage.local.get(HELD_LABEL_KEY))[HELD_LABEL_KEY];
  if (id) {
    await api(token, `/labels/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
  } else {
    await ensureHeldLabel(token); // not created yet — create with the new name
  }
  return { ok: true };
}

// Resolve a usable threadId + display metadata from whatever the content script
// could scrape (a legacy thread id, or just a legacy message id).
async function resolveThreadMeta(token, { threadId, messageId }) {
  const headerOf = (msg, name) =>
    (msg?.payload?.headers || []).find((h) => h.name.toLowerCase() === name)?.value;

  if (!threadId && messageId) {
    const msg = await api(
      token,
      `/messages/${messageId}?format=metadata&metadataHeaders=Subject`
    );
    return {
      threadId: msg.threadId,
      subject: headerOf(msg, 'subject') || '(no subject)',
      snippet: msg.snippet || '',
    };
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
  };
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
  const heldLabelId = await ensureHeldLabel(token).catch(() => null);

  const add = heldLabelId ? [heldLabelId] : [];
  await modifyThread(token, meta.threadId, add, ['INBOX']);

  const holds = await loadHolds();
  // Replace any existing hold for the same thread.
  const next = holds.filter((h) => h.threadId !== meta.threadId);
  next.push({
    threadId: meta.threadId,
    subject: meta.subject,
    snippet: meta.snippet,
    returnAt,
    heldAt: Date.now(),
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

// Re-deliver every hold whose timer has expired. Runs on the alarm tick.
async function returnDueThreads() {
  const holds = await loadHolds();
  const now = Date.now();
  const due = holds.filter((h) => h.returnAt <= now);
  if (due.length === 0) return;

  let token;
  try {
    token = await getToken(false); // non-interactive — never pops UI in background
  } catch {
    return; // user must re-auth; leave holds in place and retry next tick
  }

  const heldLabelId = (await chrome.storage.local.get(HELD_LABEL_KEY))[HELD_LABEL_KEY];
  const remove = heldLabelId ? [heldLabelId] : [];
  const delivered = new Set();

  for (const hold of due) {
    try {
      // Bring it back to the inbox and mark unread so it stands out.
      await modifyThread(token, hold.threadId, ['INBOX', 'UNREAD'], remove);
      delivered.add(hold.threadId);
    } catch {
      // Leave undelivered holds for the next tick.
    }
  }

  if (delivered.size) {
    const remaining = (await loadHolds()).filter((h) => !delivered.has(h.threadId));
    await saveHolds(remaining);
  }
}

// ─── Wiring ───────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) returnDueThreads();
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
