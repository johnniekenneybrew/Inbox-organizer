'use strict';

// Service worker — two jobs:
//   1. Bridge chrome.identity (only available here) to the content script.
//   2. Run the "Hold" engine: archive threads on request and re-deliver them
//      to the inbox when their timer expires, via a periodic chrome.alarm.

// ─── Constants ──────────────────────────────────────────────────────────────

const API            = 'https://www.googleapis.com/gmail/v1/users/me';
const DEFAULT_HOLD_NAME = 'Snooze';             // user-customizable via storage.sync
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
    const err = new Error('Authentication expired. Open the settings gear in Gmail to re-authorize.');
    err.status = 401;
    throw err;
  }
  if (!r.ok) {
    const err = new Error(`Gmail API error ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.status === 204 ? null : r.json();
}

// Run fn(token). On 401 the stale cached token has already been dropped by api(),
// so mint a fresh one and retry the whole operation exactly once — the standard
// chrome.identity pattern. Operations passed here must be safe to re-run.
async function withToken(interactive, fn) {
  let token = await getToken(interactive);
  try {
    return await fn(token);
  } catch (err) {
    if (err?.status !== 401) throw err;
    token = await getToken(interactive);
    return fn(token);
  }
}

// Serialize every mutation of heldThreads (holdThread / cancelHold / processHolds)
// through one promise chain so their read-modify-write cycles can't interleave —
// e.g. a re-snooze landing while the alarm loop is mid-flight.
let holdChain = Promise.resolve();
function serialized(fn) {
  const run = holdChain.then(fn, fn);
  holdChain = run.catch(() => {}); // keep the chain alive past failures
  return run;
}

function modifyThread(token, threadId, addLabelIds, removeLabelIds) {
  return api(token, `/threads/${threadId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  });
}

// The user-customizable Snooze label name (defaults to "Snooze").
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
  return withToken(true, async (token) => {
    const labelId = await ensureHeldLabel(token);
    await reapplyHoldLabel(token, labelId);
    return { ok: true };
  });
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
    msgCount: countIncoming(thread),
  };
}

// "A reply arrived" must mean a message from the other side: the user's own
// drafts and sent replies also appear in thread.messages, and counting them
// would silently cancel the snooze the moment the user starts typing a draft.
function countIncoming(thread) {
  return (thread.messages || []).filter((m) => {
    const l = m.labelIds || [];
    return !l.includes('DRAFT') && !l.includes('SENT');
  }).length;
}

// Current number of incoming messages in a thread (used to detect a new reply).
async function threadMessageCount(token, threadId) {
  const thread = await api(token, `/threads/${threadId}?format=minimal`);
  return countIncoming(thread);
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
  return withToken(true, async (token) => {
    const meta = await resolveThreadMeta(token, { threadId, messageId });
    // Resolve the label first; if this throws, the hold fails and is surfaced to
    // the user instead of silently archiving the email with no label applied.
    const heldLabelId = await ensureHeldLabel(token);

    // Persist the intent BEFORE touching the server: if the worker dies between
    // the two, the record survives and the timer still fires. The reverse order
    // leaves a thread archived with no record — invisible forever. The benign
    // failure mode of this order (record without archive) is self-correcting:
    // the timer just re-adds INBOX to a thread already there.
    const record = {
      threadId: meta.threadId,
      subject: meta.subject,
      snippet: meta.snippet,
      returnAt,
      heldAt: Date.now(),
      msgCount: meta.msgCount, // baseline for reply detection
      countsIncoming: true,    // baseline excludes DRAFT/SENT (see countIncoming)
    };
    const holds = await loadHolds();
    // Replace any existing hold for the same thread — but keep what we displaced:
    // if this is a re-snooze and the archive call fails, the original record must
    // be restored, or the (still-archived) thread would be left with no timer.
    const displaced = holds.find((h) => h.threadId === meta.threadId) || null;
    await saveHolds([...holds.filter((h) => h.threadId !== meta.threadId), record]);
    await ensureAlarm();

    try {
      await modifyThread(token, meta.threadId, [heldLabelId], ['INBOX']);
    } catch (err) {
      // Archive failed — take the new record back out (so a failed first snooze
      // doesn't later yank an email still sitting in the inbox) and put back the
      // one it replaced.
      const cur = await loadHolds();
      const rest = cur.filter((h) => !(h.threadId === record.threadId && h.heldAt === record.heldAt));
      await saveHolds(displaced ? [...rest, displaced] : rest);
      throw err;
    }
    return { ok: true, returnAt, subject: meta.subject };
  });
}

async function cancelHold({ threadId, messageId, returnToInbox }) {
  return withToken(true, async (token) => {
    // The Hold view / row may only give us a message id — resolve to a thread.
    if (!threadId && messageId) {
      threadId = (await resolveThreadMeta(token, { messageId })).threadId;
    }

    if (returnToInbox) {
      const heldLabelId = (await chrome.storage.local.get(HELD_LABEL_KEY))[HELD_LABEL_KEY];
      try {
        // Mark unread on the way back so it stands out — same as the timer return.
        await modifyThread(token, threadId, ['INBOX', 'UNREAD'], heldLabelId ? [heldLabelId] : []);
      } catch (err) {
        if (err?.status === 404) {
          // Thread permanently deleted — nothing to return; fall through and
          // retire the record.
        } else if (err?.status === 400 && heldLabelId) {
          // Stale cached label id (label deleted in Gmail). Re-resolve, then
          // return the thread with the fresh id.
          const fresh = await ensureHeldLabel(token).catch(() => null);
          await modifyThread(token, threadId, ['INBOX', 'UNREAD'], fresh ? [fresh] : []);
        } else {
          throw err; // return failed — keep the record so the timer/retry still works
        }
      }
    }

    // Only drop the timer once the server call succeeded (or the thread is gone).
    // Deleting it first would strand a still-archived email with no way back.
    const holds = await loadHolds();
    await saveHolds(holds.filter((h) => h.threadId !== threadId));
    return { ok: true };
  });
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

  // Resolve (and self-heal) the label id up front. Using the raw cached id would
  // make every modify call 400 forever if the user deleted the label in Gmail.
  // If we can't resolve it, skip this tick rather than returning threads while
  // leaving the label stuck on them — the next tick retries.
  let heldLabelId;
  try {
    heldLabelId = await ensureHeldLabel(token);
  } catch (err) {
    if (err?.status !== 401) return;
    try {
      token = await getToken(false); // stale cached token; mint a fresh one
      heldLabelId = await ensureHeldLabel(token);
    } catch {
      return;
    }
  }
  let removeLabel = [heldLabelId];
  const now = Date.now();

  // Retire a hold from storage the moment its server action succeeds (or the
  // thread turns out to be gone). Matching on heldAt keeps a re-snooze written
  // after this loop's snapshot from being deleted by mistake.
  const retire = async (hold) => {
    const cur = await loadHolds();
    await saveHolds(cur.filter((h) => !(h.threadId === hold.threadId && h.heldAt === hold.heldAt)));
  };

  for (const hold of holds) {
    try {
      if (hold.returnAt <= now) {
        // Timer expired — bring it back to the inbox and mark unread.
        await modifyThread(token, hold.threadId, ['INBOX', 'UNREAD'], removeLabel);
        // Commit per-hold (not batched after the loop): if the worker dies
        // mid-loop, already-returned threads must not be replayed next tick,
        // re-marking mail the user has since read as unread.
        await retire(hold);
        continue;
      }
      // Not due yet — if a reply landed, clear the hold early.
      if (hold.msgCount != null) {
        const count = await threadMessageCount(token, hold.threadId);
        if (hold.countsIncoming !== true) {
          // Legacy record from before drafts/sent were excluded: its baseline
          // was computed under the old counting and can't be compared to the
          // new count (it reads inflated, which would mute reply detection).
          // Rebase it to the current incoming count and check from next tick.
          const cur = await loadHolds();
          await saveHolds(cur.map((h) =>
            (h.threadId === hold.threadId && h.heldAt === hold.heldAt)
              ? { ...h, msgCount: count, countsIncoming: true }
              : h));
        } else if (count > hold.msgCount) {
          // Just drop the label; the reply already returned it to the inbox.
          await modifyThread(token, hold.threadId, ['INBOX'], removeLabel);
          await retire(hold);
        }
      }
    } catch (err) {
      if (err?.status === 404) {
        // Thread permanently deleted by the user — retire the hold instead of
        // retrying a dead API call every minute forever.
        await retire(hold).catch(() => {});
      } else if (err?.status === 401) {
        // Token died mid-run; api() dropped it. Mint a fresh one, re-resolve
        // the label with it, and keep going — this hold retries next tick.
        try {
          token = await getToken(false);
          heldLabelId = await ensureHeldLabel(token);
          removeLabel = [heldLabelId];
        } catch {
          return;
        }
      }
      // Anything else is transient — leave the hold for the next tick.
    }
  }
}

// ─── Wiring ───────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) serialized(processHolds);
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
      serialized(() => holdThread(message))
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case 'LIST_HOLDS':
      loadHolds().then((holds) => sendResponse({ holds }));
      return true;

    case 'CANCEL_HOLD':
      serialized(() => cancelHold(message))
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case 'SET_HOLD_LABEL_NAME':
      serialized(() => setHoldLabelName(message.name))
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true;
  }
});
