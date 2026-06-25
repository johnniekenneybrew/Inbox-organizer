'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const BAR_ID     = 'glt-bar';
const PANEL_ID   = 'glt-panel';
const OVERLAY_ID = 'glt-overlay';
const POPOVER_ID = 'glt-hold-pop';

const DEFAULT_HOLD_NAME = 'Hold';
const UNIT_MS = { hours: 3600e3, days: 864e5, weeks: 6048e5 };

// Fixed quick-pick durations. Custom durations the user adds are cached and
// rendered alongside these.
const DEFAULT_PRESETS = [
  { label: '3 days', ms: () => 3 * UNIT_MS.days },
  { label: '1 week', ms: () => 1 * UNIT_MS.weeks },
];

// ─── State ────────────────────────────────────────────────────────────────────

let cachedPinned     = [];               // tab objects: { id, type, name, query, … }
let cachedHolds      = [];               // [{ threadId, subject, returnAt }, …]
let customDurations  = [];               // [{ label, amount, unit }, …] (local cache)
let holdLabelName    = DEFAULT_HOLD_NAME; // user-customizable Hold label/tab name
let notesIndex       = new Set();         // thread IDs that have a saved note
let settingsOpen     = false;
let pickerOpen       = false;

function genId() { return 't' + Math.random().toString(36).slice(2, 9); }

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getToken() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_TOKEN' }, (resp) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (resp?.error) return reject(new Error(resp.error));
      resolve(resp.token);
    });
  });
}

async function fetchWithAuth(url) {
  const token = await getToken();
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) {
    chrome.runtime.sendMessage({ type: 'REMOVE_TOKEN', token });
    throw new Error('Authentication expired. Please click the settings gear to try again.');
  }
  if (!r.ok) throw new Error(`Gmail API error ${r.status}`);
  return r.json();
}

// ─── Gmail API ────────────────────────────────────────────────────────────────

async function fetchUserLabels() {
  const data = await fetchWithAuth('https://www.googleapis.com/gmail/v1/users/me/labels');
  return (data.labels || [])
    .filter((l) => l.type === 'user')
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Storage ──────────────────────────────────────────────────────────────────

function loadTabs() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['tabs', 'pinnedLabels'], (d) => {
      if (Array.isArray(d.tabs)) return resolve(d.tabs);
      // Migrate legacy pinned-label tabs into the new model.
      const migrated = (d.pinnedLabels || []).map((l) => ({
        id: genId(), type: 'label', name: l.name, labelId: l.id,
        labelName: l.name, sublabels: false, query: `label:"${l.name}"`,
      }));
      if (migrated.length) chrome.storage.sync.set({ tabs: migrated });
      resolve(migrated);
    });
  });
}

function saveTabs(tabs) {
  return new Promise((resolve) => chrome.storage.sync.set({ tabs }, resolve));
}

// ── Email notes (synced, one sync key per thread) ──
const NOTE_PREFIX = 'note:';
function noteKey(id) { return NOTE_PREFIX + id; }

function loadNotesIndex() {
  return new Promise((resolve) =>
    chrome.storage.sync.get(null, (all) => {
      notesIndex = new Set(
        Object.keys(all || {})
          .filter((k) => k.startsWith(NOTE_PREFIX))
          .map((k) => k.slice(NOTE_PREFIX.length))
      );
      resolve();
    })
  );
}

function getNote(id) {
  return new Promise((resolve) =>
    chrome.storage.sync.get(noteKey(id), (d) => resolve(d[noteKey(id)] || ''))
  );
}

function saveNote(id, text) {
  return new Promise((resolve, reject) => {
    if (!text.trim()) {
      chrome.storage.sync.remove(noteKey(id), () => { notesIndex.delete(id); resolve(); });
    } else {
      chrome.storage.sync.set({ [noteKey(id)]: text }, () => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        notesIndex.add(id); resolve();
      });
    }
  });
}

function loadHoldLabelName() {
  return new Promise((resolve) =>
    chrome.storage.sync.get('holdLabelName', (d) => resolve(d.holdLabelName || DEFAULT_HOLD_NAME))
  );
}

function saveHoldLabelName(name) {
  return new Promise((resolve) => chrome.storage.sync.set({ holdLabelName: name }, resolve));
}

function loadCustomDurations() {
  return new Promise((resolve) =>
    chrome.storage.local.get('customDurations', (d) => resolve(d.customDurations || []))
  );
}

// Newest first, deduped by label, capped at 6.
function saveCustomDuration(c) {
  customDurations = [c, ...customDurations.filter((x) => x.label !== c.label)].slice(0, 6);
  return new Promise((resolve) => chrome.storage.local.set({ customDurations }, resolve));
}

function removeCustomDuration(index) {
  customDurations = customDurations.filter((_, i) => i !== index);
  return new Promise((resolve) => chrome.storage.local.set({ customDurations }, resolve));
}

// ─── Navigation ───────────────────────────────────────────────────────────────

/**
 * Returns the name of the currently-active label (or 'INBOX' for the inbox).
 * Reads from the URL hash because Gmail is a hash-router SPA.
 */
function activeTabName() {
  const hash = location.hash;
  if (!hash || hash === '#' || hash.startsWith('#inbox')) return 'INBOX';

  const native = hash.match(/^#label\/(.+?)(?:[/?].*)?$/);
  if (native) return decodeURIComponent(native[1].replace(/\+/g, '%20'));

  const decoded = decodeURIComponent(hash);
  const quoted = decoded.match(/label:["']([^"']+)["']/i);
  if (quoted) return quoted[1];
  const plain = decoded.match(/label:([^"'\s&/]+)/i);
  return plain ? plain[1] : null;
}

function goToLabel(name) {
  if (name === 'INBOX') {
    location.hash = '#inbox';
  } else {
    location.hash = '#label/' + encodeURIComponent(name).replace(/%20/g, '+');
  }
}

// Navigate to a tab: a plain label uses Gmail's native label view; a query tab
// (or a label-with-sublabels) runs a Gmail search.
function goToTab(tab) {
  if (tab.type === 'label' && !tab.sublabels && (tab.labelName || tab.name)) {
    goToLabel(tab.labelName || tab.name);
  } else {
    location.hash = '#search/' + encodeURIComponent(tab.query || '');
  }
}

// The decoded query when a search view is open, else null.
function currentSearchQuery() {
  const m = location.hash.match(/^#search\/(.+)$/);
  if (!m) return null;
  return decodeURIComponent(m[1].replace(/\+/g, ' '));
}

function normQuery(q) {
  return (q || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function tabIsActive(tab) {
  const sq = currentSearchQuery();
  if (tab.type === 'label' && !tab.sublabels) {
    return !sq && activeTabName()?.toLowerCase() === (tab.labelName || tab.name).toLowerCase();
  }
  return sq != null && normQuery(sq) === normQuery(tab.query);
}

// Are we currently looking at the Hold label view?
function isCurrentViewHold() {
  const a = activeTabName();
  return !!a && a.toLowerCase() === holdLabelName.toLowerCase();
}

function threadIsHeld(threadId) {
  return !!threadId && cachedHolds.some((h) => h.threadId === threadId);
}

// ─── Tab Bar ──────────────────────────────────────────────────────────────────

function buildBar(tabs) {
  const bar = document.createElement('div');
  bar.id = BAR_ID;
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Gmail tabs');

  // Inbox — always first, built-in.
  const inboxBtn = document.createElement('button');
  inboxBtn.className = 'glt-tab';
  inboxBtn.setAttribute('role', 'tab');
  inboxBtn.textContent = 'Inbox';
  inboxBtn.dataset.builtin = 'inbox';
  inboxBtn.addEventListener('click', () => { goToLabel('INBOX'); setActiveTab(inboxBtn); });
  bar.appendChild(inboxBtn);

  (tabs || []).forEach((tab, i) => {
    const btn = document.createElement('button');
    btn.className = 'glt-tab';
    btn.setAttribute('role', 'tab');
    btn.textContent = tab.name;
    btn.dataset.tabIndex = String(i);
    if (tab.description) btn.title = tab.description;
    if (tab.fg) btn.style.color = tab.fg;
    if (tab.bg) { btn.style.background = tab.bg; btn.classList.add('glt-tab--colored'); }
    btn.addEventListener('click', () => { goToTab(tab); setActiveTab(btn); });
    bar.appendChild(btn);
  });

  // ── Right-aligned control group ──
  const right = document.createElement('div');
  right.className = 'glt-right';

  // Contextual action for an open conversation: "Hold" or "Return now".
  const action = document.createElement('button');
  action.className = 'glt-hold';
  action.innerHTML = `${clockIcon()}<span class="glt-hold-label">Hold</span>`;
  action.addEventListener('click', onBarActionClick);
  right.appendChild(action);

  // "Hold" navigation tab — opens the Hold label view in Gmail.
  const holdTab = document.createElement('button');
  holdTab.className = 'glt-hold-tab';
  holdTab.setAttribute('role', 'tab');
  holdTab.innerHTML =
    `<span class="glt-hold-tab-label"></span><span class="glt-hold-tab-count"></span>`;
  holdTab.addEventListener('click', () => goToLabel(holdLabelName));
  right.appendChild(holdTab);

  // Settings gear
  const gear = document.createElement('button');
  gear.className = 'glt-gear';
  gear.title = 'Settings';
  gear.setAttribute('aria-label', 'Settings');
  gear.innerHTML = gearIcon();
  gear.addEventListener('click', openSettings);
  right.appendChild(gear);

  bar.appendChild(right);
  return bar;
}

function setActiveTab(activeBtn) {
  document.querySelectorAll(`#${BAR_ID} .glt-tab`).forEach((btn) => {
    const on = btn === activeBtn;
    btn.classList.toggle('glt-tab--active', on);
    btn.setAttribute('aria-selected', String(on));
  });
}

function updateActiveTab() {
  const sq = currentSearchQuery();
  document.querySelectorAll(`#${BAR_ID} .glt-tab`).forEach((btn) => {
    let active;
    if (btn.dataset.builtin === 'inbox') {
      active = activeTabName() === 'INBOX' && !sq;
    } else {
      const t = cachedPinned[Number(btn.dataset.tabIndex)];
      active = !!t && tabIsActive(t);
    }
    btn.classList.toggle('glt-tab--active', active);
    btn.setAttribute('aria-selected', String(!!active));
  });
  updateHoldTab();
}

function gearIcon() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0
      00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96a7.28 7.28 0
      00-1.62-.94l-.36-2.54A.48.48 0 0014 3h-3.84c-.24
      0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0
      00-.59.22L2.74 9.47a.48.48 0 00.12.61l2.03 1.58a7.44 7.44 0
      000 1.88l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38
      1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24
      0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47
      0 .59-.22l1.92-3.32a.49.49 0 00-.12-.61l-2.01-1.58zM12 15.6c-1.98
      0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
  </svg>`;
}

function clockIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9"></circle>
    <path d="M12 7v5l3 2"></path>
  </svg>`;
}

// ─── Inject / remove bar ──────────────────────────────────────────────────────

function findVisibleMain() {
  const mains = document.querySelectorAll('[role="main"]');
  for (const m of mains) {
    if (m.offsetParent !== null && m.getBoundingClientRect().width > 0) return m;
  }
  return null;
}

function isBarVisible() {
  const bar = document.getElementById(BAR_ID);
  return !!(bar && bar.offsetParent !== null);
}

function injectBar(tabs) {
  document.getElementById(BAR_ID)?.remove();
  const main = findVisibleMain();
  if (!main) return false;
  main.prepend(buildBar(tabs));
  updateActiveTab();
  updateHoldUI();
  ensureNotePanel();
  return true;
}

function tryInjectWithRetry(attempts = 0) {
  if (isBarVisible()) {
    updateActiveTab();
    updateHoldUI();
    return;
  }
  if (injectBar(cachedPinned)) return;
  if (attempts < 20) setTimeout(() => tryInjectWithRetry(attempts + 1), 100);
}

// ─── Open-conversation detection ───────────────────────────────────────────────

/**
 * If a single conversation is open in the visible main, returns the identifiers
 * needed to act on it (and a subject). Returns null in list views.
 */
function getOpenConversation() {
  const main = findVisibleMain();
  if (!main) return null;
  if (main.querySelector('tr.zA')) return null; // a thread-list view, not a conversation

  const subject = main.querySelector('h2.hP')?.textContent?.trim() || '';

  const threadEl = main.querySelector('[data-legacy-thread-id]');
  if (threadEl) return { threadId: threadEl.getAttribute('data-legacy-thread-id'), subject };

  const msgEls = main.querySelectorAll('[data-legacy-message-id]');
  if (msgEls.length) {
    return { messageId: msgEls[msgEls.length - 1].getAttribute('data-legacy-message-id'), subject };
  }
  return null;
}

/**
 * Thread descriptors for the rows the user has checkbox-selected in the visible
 * list. Gmail marks a selected row with the `x7` class and an aria-checked
 * checkbox; we accept either signal.
 */
function getSelectedRows() {
  const main = findVisibleMain();
  if (!main) return [];
  const rows = [...main.querySelectorAll('tr.zA')].filter(
    (r) => r.classList.contains('x7') || r.querySelector('[role="checkbox"][aria-checked="true"]')
  );
  return rows.map(getRowThread).filter(Boolean);
}

// ─── Bar action + Hold tab state ────────────────────────────────────────────────

function updateHoldUI() {
  const action = document.querySelector(`#${BAR_ID} .glt-hold`);
  if (action) {
    const label = action.querySelector('.glt-hold-label');
    const convo = getOpenConversation();
    const selected = convo ? [] : getSelectedRows();

    if (convo) {
      // A single open conversation.
      action.style.display = '';
      const held = threadIsHeld(convo.threadId);
      action.dataset.scope = 'one';
      action.dataset.mode = held ? 'return' : 'hold';
      label.textContent = held ? 'Return now' : 'Hold';
      action.title = held
        ? 'Return this email to the inbox now (marked unread)'
        : 'Hold this email — return it to the inbox after a timer';
    } else if (selected.length) {
      // One or more checkbox-selected rows — act on all of them.
      action.style.display = '';
      const ret = isCurrentViewHold();
      action.dataset.scope = 'bulk';
      action.dataset.mode = ret ? 'return' : 'hold';
      label.textContent = `${ret ? 'Return now' : 'Hold'} (${selected.length})`;
      action.title = ret
        ? `Return ${selected.length} selected email(s) to the inbox`
        : `Hold ${selected.length} selected email(s)`;
    } else {
      action.style.display = 'none';
    }
  }
  updateHoldTab();
}

function updateHoldTab() {
  const tab = document.querySelector(`#${BAR_ID} .glt-hold-tab`);
  if (!tab) return;
  tab.querySelector('.glt-hold-tab-label').textContent = holdLabelName;
  const countEl = tab.querySelector('.glt-hold-tab-count');
  const n = cachedHolds.length;
  countEl.textContent = n ? String(n) : '';
  countEl.style.display = n ? '' : 'none';
  tab.classList.toggle('glt-hold-tab--active', isCurrentViewHold());
  tab.title = `Held emails${n ? ` (${n})` : ''} — open the “${holdLabelName}” view`;
}

// Bar action button: hold / return the open email, or all selected rows.
function onBarActionClick() {
  const anchor = document.querySelector(`#${BAR_ID} .glt-hold`);

  if (anchor.dataset.scope === 'bulk') {
    const targets = getSelectedRows();
    if (!targets.length) return;
    if (anchor.dataset.mode === 'return') {
      bulkReturn(targets);
    } else {
      openHoldPicker(anchor, targets, () => {});
    }
    return;
  }

  const convo = getOpenConversation();
  if (!convo) return;
  if (anchor.dataset.mode === 'return') {
    returnThread(convo, (ok) => { if (ok && getOpenConversation()) history.back(); });
  } else {
    openHoldPicker(anchor, convo, (held) => { if (held && getOpenConversation()) history.back(); });
  }
}

// Return every given held thread to the inbox now.
async function bulkReturn(targets) {
  let ok = 0;
  let fail = 0;
  for (const t of targets) {
    try {
      await sendBg({ type: 'CANCEL_HOLD', threadId: t.threadId, messageId: t.messageId, returnToInbox: true });
      if (t.rowEl) t.rowEl.style.display = 'none';
      ok++;
    } catch {
      fail++;
    }
  }
  await refreshHolds();
  if (ok && !fail) toast(`Returned ${ok} email${ok === 1 ? '' : 's'} to inbox`);
  else if (ok) toast(`Returned ${ok}; ${fail} failed`, true);
  else toast(`Couldn't return ${fail} email${fail === 1 ? '' : 's'}`, true);
}

// ─── Messaging helpers ──────────────────────────────────────────────────────────

function sendBg(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (resp) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (resp?.error) return reject(new Error(resp.error));
      resolve(resp);
    });
  });
}

async function refreshHolds() {
  try {
    const { holds } = await sendBg({ type: 'LIST_HOLDS' });
    cachedHolds = holds || [];
  } catch {
    cachedHolds = [];
  }
  updateHoldUI();
}

// ─── Duration picker ────────────────────────────────────────────────────────────

/**
 * Opens the duration popover anchored to `anchorEl` and holds `target`
 * (a { threadId | messageId } descriptor) for the chosen time.
 */
function openHoldPicker(anchorEl, target, onAfter) {
  document.getElementById(POPOVER_ID)?.remove();

  const pop = document.createElement('div');
  pop.id = POPOVER_ID;
  pop.className = 'glt-pop';
  pop.innerHTML = `
    <p class="glt-pop-title">Return to inbox in…</p>
    ${DEFAULT_PRESETS.map(
      (p, i) => `<button class="glt-pop-opt" data-def="${i}">${escHtml(p.label)}</button>`
    ).join('')}
    ${customDurations.map(
      (c, i) => `<button class="glt-pop-opt glt-pop-opt--custom" data-cust="${i}">
        <span>${escHtml(c.label)}</span>
        <span class="glt-pop-rm" data-rm="${i}" title="Remove this option">&#x2715;</span>
      </button>`
    ).join('')}
    <div class="glt-pop-custom">
      <input type="number" min="1" class="glt-pop-amt" placeholder="#">
      <select class="glt-pop-unit">
        <option value="hours">hours</option>
        <option value="days" selected>days</option>
        <option value="weeks">weeks</option>
      </select>
      <button class="glt-pop-cgo">Hold</button>
    </div>
    <p class="glt-pop-sub">Or on a specific date</p>
    <div class="glt-pop-date">
      <input type="datetime-local" class="glt-pop-dt" aria-label="Return on a specific date and time">
      <button class="glt-pop-cgo glt-pop-dgo">Set</button>
    </div>
  `;

  document.body.appendChild(pop);
  positionPopover(pop, anchorEl);
  pickerOpen = true;

  pop.querySelectorAll('.glt-pop-opt').forEach((opt) => {
    opt.addEventListener('click', (e) => {
      if (e.target.closest('.glt-pop-rm')) return; // handled below
      let ms;
      if (opt.dataset.def != null) {
        ms = DEFAULT_PRESETS[Number(opt.dataset.def)].ms();
      } else {
        const c = customDurations[Number(opt.dataset.cust)];
        ms = c.amount * UNIT_MS[c.unit];
      }
      commitHold(target, Date.now() + ms, onAfter);
    });
  });

  pop.querySelectorAll('.glt-pop-rm').forEach((rm) => {
    rm.addEventListener('click', async (e) => {
      e.stopPropagation();
      await removeCustomDuration(Number(rm.dataset.rm));
      closePopover();
      openHoldPicker(anchorEl, target, onAfter); // re-render with the option gone
    });
  });

  pop.querySelector('.glt-pop-cgo').addEventListener('click', () => {
    const amount = parseInt(pop.querySelector('.glt-pop-amt').value, 10);
    const unit = pop.querySelector('.glt-pop-unit').value;
    if (!amount || amount < 1) {
      flashError(pop, 'Enter a number of hours, days, or weeks.');
      return;
    }
    const singular = unit.replace(/s$/, '');
    const label = `${amount} ${amount === 1 ? singular : unit}`;
    saveCustomDuration({ label, amount, unit });
    commitHold(target, Date.now() + amount * UNIT_MS[unit], onAfter);
  });

  // Specific calendar date/time — held until that exact moment (not cached).
  pop.querySelector('.glt-pop-dgo').addEventListener('click', () => {
    const val = pop.querySelector('.glt-pop-dt').value;
    if (!val) {
      flashError(pop, 'Pick a date and time.');
      return;
    }
    const when = new Date(val).getTime();
    if (!when || when <= Date.now()) {
      flashError(pop, 'Pick a date/time in the future.');
      return;
    }
    commitHold(target, when, onAfter);
  });

  setTimeout(() => {
    const onAway = (e) => {
      if (!pop.contains(e.target) && e.target !== anchorEl) closePopover();
    };
    const onEsc = (e) => { if (e.key === 'Escape') closePopover(); };
    pop._cleanup = () => {
      document.removeEventListener('mousedown', onAway);
      document.removeEventListener('keydown', onEsc);
    };
    document.addEventListener('mousedown', onAway);
    document.addEventListener('keydown', onEsc);
  }, 0);
}

function positionPopover(pop, anchor) {
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${r.bottom + 6}px`;
  const left = Math.max(8, Math.min(r.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8));
  pop.style.left = `${left}px`;
}

function closePopover() {
  const pop = document.getElementById(POPOVER_ID);
  pop?._cleanup?.();
  pop?.remove();
  pickerOpen = false;
}

// `target` may be a single { threadId | messageId, rowEl } or an array of them.
async function commitHold(target, returnAt, onAfter) {
  closePopover();
  const targets = Array.isArray(target) ? target : [target];
  let ok = 0;
  let fail = 0;
  for (const t of targets) {
    try {
      await sendBg({ type: 'HOLD_THREAD', threadId: t.threadId, messageId: t.messageId, returnAt });
      // It's archived (INBOX removed) on the server — hide the row so it
      // visibly leaves the inbox right away.
      if (t.rowEl) t.rowEl.style.display = 'none';
      ok++;
    } catch {
      fail++;
    }
  }
  await refreshHolds();
  const when = formatWhen(returnAt);
  if (ok && !fail) {
    toast(targets.length > 1 ? `Held ${ok} emails — return ${when}` : `Held — returns ${when}`);
  } else if (ok) {
    toast(`Held ${ok}; ${fail} failed`, true);
  } else {
    toast(`Couldn't hold ${fail === 1 ? 'this email' : `${fail} emails`}`, true);
  }
  onAfter?.(ok > 0);
}

// Return a held thread to the inbox now (marked unread), removing its hold.
async function returnThread(target, onAfter) {
  try {
    await sendBg({
      type: 'CANCEL_HOLD',
      threadId: target.threadId,
      messageId: target.messageId,
      returnToInbox: true,
    });
    await refreshHolds();
    toast('Returned to inbox — marked unread');
    onAfter?.(true);
  } catch (err) {
    toast(`Couldn't return this email: ${err.message}`, true);
    onAfter?.(false);
  }
}

// ─── Inline button on list rows (Hold, or Return now in the Hold view) ──────────

/**
 * Pulls the API thread identifier out of a list row. Gmail tags rows with
 * `data-legacy-thread-id` (the hex id the API wants); falls back to a legacy
 * message id, then to parsing `data-thread-id`. Returns null if none are found.
 */
function getRowThread(row) {
  const t = row.matches('[data-legacy-thread-id]')
    ? row
    : row.querySelector('[data-legacy-thread-id]');
  if (t) return { threadId: t.getAttribute('data-legacy-thread-id'), rowEl: row };

  const m = row.querySelector('[data-legacy-last-message-id], [data-legacy-message-id]');
  if (m) {
    return {
      messageId:
        m.getAttribute('data-legacy-last-message-id') ||
        m.getAttribute('data-legacy-message-id'),
      rowEl: row,
    };
  }

  const dt = row.querySelector('[data-thread-id]');
  if (dt) {
    const id = dt.getAttribute('data-thread-id').replace(/^#thread-[fas]:/, '');
    if (id) return { threadId: id, rowEl: row };
  }
  return null;
}

let rowHoldHideTimer;

/**
 * A single floating button that follows the hovered list row. In the inbox it
 * holds the conversation without opening it; in the Hold view it returns the
 * conversation to the inbox. Uses event delegation so it survives re-renders.
 */
function setupRowHoldHover() {
  const btn = document.createElement('button');
  btn.id = 'glt-row-hold';
  btn.className = 'glt-row-hold';
  btn.innerHTML = `${clockIcon()}<span class="glt-row-hold-label">Hold</span>`;
  btn.style.display = 'none';
  document.body.appendChild(btn);

  // Non-interactive chip showing when a held email will return (Hold view only).
  const whenChip = document.createElement('div');
  whenChip.id = 'glt-row-when';
  whenChip.className = 'glt-row-when';
  whenChip.style.display = 'none';
  document.body.appendChild(whenChip);

  let target = null;

  const hideSoon = () => {
    clearTimeout(rowHoldHideTimer);
    rowHoldHideTimer = setTimeout(() => {
      if (!pickerOpen) {
        btn.style.display = 'none';
        whenChip.style.display = 'none';
      }
    }, 250);
  };

  const showFor = (row) => {
    const t = getRowThread(row);
    if (!t) return;
    target = t;
    const returnMode = isCurrentViewHold();
    btn.dataset.mode = returnMode ? 'return' : 'hold';
    btn.querySelector('.glt-row-hold-label').textContent = returnMode ? 'Return now' : 'Hold';
    btn.title = returnMode ? 'Return this email to the inbox now' : 'Hold this email';
    const r = row.getBoundingClientRect();
    btn.style.display = 'inline-flex';
    btn.style.top = `${r.top + r.height / 2 - btn.offsetHeight / 2}px`;
    btn.style.left = `${r.right - btn.offsetWidth - 16}px`;

    // In the Hold view, show when this thread is due back, beside the button.
    const hold = returnMode ? cachedHolds.find((h) => h.threadId === t.threadId) : null;
    if (hold) {
      whenChip.textContent = `Returns ${formatWhen(hold.returnAt)}`;
      whenChip.style.display = 'block';
      whenChip.style.top = `${r.top + r.height / 2 - whenChip.offsetHeight / 2}px`;
      whenChip.style.left = `${r.right - btn.offsetWidth - 16 - whenChip.offsetWidth - 8}px`;
    } else {
      whenChip.style.display = 'none';
    }
  };

  document.addEventListener('mouseover', (e) => {
    const row = e.target.closest?.('tr.zA');
    if (row && findVisibleMain()?.contains(row)) {
      clearTimeout(rowHoldHideTimer);
      showFor(row);
    }
  });

  document.addEventListener('mouseout', (e) => {
    const to = e.relatedTarget;
    const stillOnButton = to && (to === btn || btn.contains(to));
    const stillOnRow = to?.closest?.('tr.zA');
    if (!stillOnButton && !stillOnRow) hideSoon();
  });

  btn.addEventListener('mouseenter', () => clearTimeout(rowHoldHideTimer));
  btn.addEventListener('mouseleave', hideSoon);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!target) return;
    const drop = (ok) => {
      if (ok && target?.rowEl) target.rowEl.style.display = 'none';
      btn.style.display = 'none';
    };
    if (btn.dataset.mode === 'return') {
      returnThread(target, drop);
    } else {
      openHoldPicker(btn, target, drop);
    }
  });
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

async function openSettings() {
  if (settingsOpen) return;
  settingsOpen = true;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.addEventListener('click', closeSettings);

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.addEventListener('click', (e) => e.stopPropagation());

  panel.innerHTML = `
    <div class="glt-sp-head">
      <h2 class="glt-sp-title">Settings</h2>
      <button class="glt-sp-x" aria-label="Close settings">&#x2715;</button>
    </div>
    <div class="glt-sp-scroll">
      <div class="glt-sp-field">
        <label class="glt-sp-flabel" for="glt-hold-name">Hold tab &amp; label name</label>
        <input id="glt-hold-name" class="glt-sp-input" type="text" maxlength="40" placeholder="${escHtml(DEFAULT_HOLD_NAME)}">
      </div>
      <div class="glt-sp-sechead"><span>Tabs</span>
        <button class="glt-sp-add" id="glt-add-tab">+ Add tab</button></div>
      <p class="glt-sp-hint">Add a Gmail label or a saved search as a tab. Drag to reorder; click a tab to edit.</p>
      <div class="glt-sp-list" id="glt-tabs-list"><p class="glt-sp-msg">Loading&hellip;</p></div>
      <div id="glt-tab-form" class="glt-tabform" hidden></div>
    </div>
    <div class="glt-sp-foot"><button class="glt-sp-save" id="glt-sp-save">Save</button></div>
  `;

  document.body.append(overlay, panel);
  panel.querySelector('.glt-sp-x').addEventListener('click', closeSettings);
  panel.querySelector('#glt-hold-name').value = holdLabelName;

  let allLabels = [];
  let workingTabs = cachedPinned.map((t) => ({ ...t }));
  const listEl = panel.querySelector('#glt-tabs-list');
  const formEl = panel.querySelector('#glt-tab-form');

  try { allLabels = await fetchUserLabels(); } catch { /* labels optional for query tabs */ }
  renderTabsList();

  panel.querySelector('#glt-add-tab').addEventListener('click', () => openForm(null));
  panel.querySelector('#glt-sp-save').addEventListener('click', onSaveAll);

  function renderTabsList() {
    if (!workingTabs.length) {
      listEl.innerHTML = '<p class="glt-sp-msg">No tabs yet. Click “+ Add tab”.</p>';
      return;
    }
    listEl.innerHTML = '';
    let dragged = null;
    const commitOrder = () => {
      const order = [...listEl.querySelectorAll('.glt-trow')].map((r) => Number(r.dataset.i));
      workingTabs = order.map((idx) => workingTabs[idx]);
      renderTabsList();
    };
    workingTabs.forEach((tab, i) => {
      const row = document.createElement('div');
      row.className = 'glt-row glt-trow';
      row.draggable = true;
      row.dataset.i = String(i);
      const typeLabel = tab.type === 'query' ? 'query' : (tab.sublabels ? 'label + sub' : 'label');
      row.innerHTML = `
        <span class="glt-row-handle" title="Drag to reorder">&#x2807;</span>
        <span class="glt-trow-swatch" style="background:${escHtml(tab.bg || '#e8eaed')};color:${escHtml(tab.fg || '#202124')}">${escHtml((tab.name || '?').slice(0, 1))}</span>
        <span class="glt-trow-name">${escHtml(tab.name)}</span>
        <span class="glt-trow-type">${typeLabel}</span>
        <button class="glt-trow-edit">Edit</button>
        <button class="glt-trow-del" title="Remove tab">&#x2715;</button>
      `;
      row.querySelector('.glt-trow-edit').addEventListener('click', (e) => { e.stopPropagation(); openForm(i); });
      row.querySelector('.glt-trow-name').addEventListener('click', () => openForm(i));
      row.querySelector('.glt-trow-del').addEventListener('click', (e) => { e.stopPropagation(); workingTabs.splice(i, 1); renderTabsList(); });
      row.addEventListener('dragstart', (e) => { dragged = row; e.dataTransfer.effectAllowed = 'move'; setTimeout(() => row.classList.add('glt-row--dragging'), 0); });
      row.addEventListener('dragend', () => { row.classList.remove('glt-row--dragging'); commitOrder(); });
      row.addEventListener('dragover', (e) => { e.preventDefault(); if (row !== dragged) { listEl.querySelectorAll('.glt-row--over').forEach((r) => r.classList.remove('glt-row--over')); row.classList.add('glt-row--over'); } });
      row.addEventListener('dragleave', () => row.classList.remove('glt-row--over'));
      row.addEventListener('drop', (e) => { e.preventDefault(); row.classList.remove('glt-row--over'); if (!dragged || dragged === row) return; const rows = [...listEl.querySelectorAll('.glt-trow')]; const si = rows.indexOf(dragged); const di = rows.indexOf(row); si < di ? row.after(dragged) : row.before(dragged); });
      listEl.appendChild(row);
    });
  }

  function buildLabelQuery(labelName, includeSub) {
    if (!includeSub) return `label:"${labelName}"`;
    const subs = allLabels.filter((l) => l.name === labelName || l.name.startsWith(labelName + '/'));
    const names = subs.length ? subs.map((l) => l.name) : [labelName];
    return names.map((n) => `label:"${n}"`).join(' OR ');
  }

  function openForm(index) {
    const editing = index != null;
    const t = editing ? workingTabs[index] : { type: 'label', name: '', query: '', description: '', fg: '', bg: '', sublabels: false };
    const labelOpts = allLabels
      .map((l) => `<option value="${escHtml(l.name)}"${t.labelName === l.name ? ' selected' : ''}>${escHtml(l.name)}</option>`)
      .join('');
    formEl.hidden = false;
    formEl.innerHTML = `
      <div class="glt-tf-row"><label class="glt-tf-label">Type</label>
        <select id="glt-tf-type" class="glt-sp-input">
          <option value="label"${t.type === 'label' ? ' selected' : ''}>Gmail label</option>
          <option value="query"${t.type === 'query' ? ' selected' : ''}>Search query</option>
        </select></div>
      <div class="glt-tf-row" id="glt-tf-labelrow"><label class="glt-tf-label">Label</label>
        <select id="glt-tf-labelsel" class="glt-sp-input">${labelOpts || '<option value="">(no labels found)</option>'}</select></div>
      <label class="glt-tf-check" id="glt-tf-subrow"><input type="checkbox" id="glt-tf-sub"${t.sublabels ? ' checked' : ''}> Include sublabels</label>
      <div class="glt-tf-row" id="glt-tf-queryrow"><label class="glt-tf-label">Query</label>
        <input id="glt-tf-query" class="glt-sp-input" type="text" placeholder="e.g. has:attachment receipt" value="${escHtml(t.query || '')}"></div>
      <div class="glt-tf-row"><label class="glt-tf-label">Name</label>
        <input id="glt-tf-name" class="glt-sp-input" type="text" maxlength="30" value="${escHtml(t.name || '')}"></div>
      <div class="glt-tf-row"><label class="glt-tf-label">Description</label>
        <input id="glt-tf-desc" class="glt-sp-input" type="text" maxlength="80" placeholder="Optional tooltip" value="${escHtml(t.description || '')}"></div>
      <div class="glt-tf-colors">
        <label class="glt-tf-color">Text <input type="color" id="glt-tf-fg" value="${escHtml(t.fg || '#444746')}"></label>
        <label class="glt-tf-color">Background <input type="color" id="glt-tf-bg" value="${escHtml(t.bg || '#ffffff')}"></label>
        <button type="button" class="glt-tf-clear" id="glt-tf-clearcolors">Reset colors</button>
      </div>
      <div class="glt-tf-actions">
        <button class="glt-tf-cancel" id="glt-tf-cancel">Cancel</button>
        <button class="glt-tf-save" id="glt-tf-save">${editing ? 'Update tab' : 'Add tab'}</button>
      </div>
      <p class="glt-pop-err" id="glt-tf-err" style="display:none"></p>
    `;
    const typeSel = formEl.querySelector('#glt-tf-type');
    const labelSel = formEl.querySelector('#glt-tf-labelsel');
    const nameInput = formEl.querySelector('#glt-tf-name');
    let fgTouched = !!t.fg, bgTouched = !!t.bg, nameTouched = !!t.name;
    const syncTypeUI = () => {
      const isLabel = typeSel.value === 'label';
      formEl.querySelector('#glt-tf-labelrow').style.display = isLabel ? '' : 'none';
      formEl.querySelector('#glt-tf-subrow').style.display = isLabel ? '' : 'none';
      formEl.querySelector('#glt-tf-queryrow').style.display = isLabel ? 'none' : '';
    };
    typeSel.addEventListener('change', syncTypeUI);
    syncTypeUI();
    labelSel.addEventListener('change', () => { if (!nameTouched) nameInput.value = labelSel.value; });
    nameInput.addEventListener('input', () => { nameTouched = true; });
    formEl.querySelector('#glt-tf-fg').addEventListener('input', () => { fgTouched = true; });
    formEl.querySelector('#glt-tf-bg').addEventListener('input', () => { bgTouched = true; });
    formEl.querySelector('#glt-tf-clearcolors').addEventListener('click', () => { fgTouched = false; bgTouched = false; });
    formEl.querySelector('#glt-tf-cancel').addEventListener('click', () => { formEl.hidden = true; formEl.innerHTML = ''; });
    const showErr = (m) => { const e = formEl.querySelector('#glt-tf-err'); e.textContent = m; e.style.display = 'block'; };
    formEl.querySelector('#glt-tf-save').addEventListener('click', () => {
      const type = typeSel.value;
      let tab;
      if (type === 'label') {
        const labelName = labelSel.value;
        if (!labelName) return showErr('Pick a label.');
        const sub = formEl.querySelector('#glt-tf-sub').checked;
        tab = { type: 'label', labelName, sublabels: sub, query: buildLabelQuery(labelName, sub), labelId: (allLabels.find((l) => l.name === labelName) || {}).id };
      } else {
        const q = formEl.querySelector('#glt-tf-query').value.trim();
        if (!q) return showErr('Enter a search query.');
        tab = { type: 'query', query: q };
      }
      tab.name = nameInput.value.trim() || (type === 'label' ? labelSel.value : 'Tab');
      tab.description = formEl.querySelector('#glt-tf-desc').value.trim();
      if (fgTouched) tab.fg = formEl.querySelector('#glt-tf-fg').value;
      if (bgTouched) tab.bg = formEl.querySelector('#glt-tf-bg').value;
      tab.id = editing ? t.id : genId();
      if (editing) workingTabs[index] = tab; else workingTabs.push(tab);
      formEl.hidden = true; formEl.innerHTML = '';
      renderTabsList();
    });
    formEl.scrollIntoView({ block: 'nearest' });
  }

  async function onSaveAll() {
    const saveBtn = panel.querySelector('#glt-sp-save');
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    const newName = (panel.querySelector('#glt-hold-name')?.value || '').trim() || DEFAULT_HOLD_NAME;
    workingTabs.forEach((t) => { if (!t.id) t.id = genId(); });
    await saveTabs(workingTabs);
    cachedPinned = workingTabs;
    if (newName !== holdLabelName) {
      holdLabelName = newName;
      await saveHoldLabelName(newName);
      try { await sendBg({ type: 'SET_HOLD_LABEL_NAME', name: newName }); }
      catch (err) { toast(`Saved, but renaming the Gmail label failed: ${err.message}`, true); }
    }
    closeSettings();
    injectBar(cachedPinned);
  }
}

function closeSettings() {
  document.getElementById(OVERLAY_ID)?.remove();
  document.getElementById(PANEL_ID)?.remove();
  settingsOpen = false;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function formatWhen(ts) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (sameDay(d, today)) return `today ${time}`;
  if (sameDay(d, tomorrow)) return `tomorrow ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function flashError(container, msg) {
  let el = container.querySelector('.glt-pop-err');
  if (!el) {
    el = document.createElement('p');
    el.className = 'glt-pop-err';
    container.appendChild(el);
  }
  el.textContent = msg;
}

let toastTimer;
function toast(msg, isError = false) {
  document.getElementById('glt-toast')?.remove();
  const el = document.createElement('div');
  el.id = 'glt-toast';
  el.className = isError ? 'glt-toast glt-toast--err' : 'glt-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 4000);
}

// ─── Keep the bar alive across Gmail's DOM churn ──────────────────────────────

const debouncedEnsure = debounce(() => {
  if (!isBarVisible()) tryInjectWithRetry();
  else { updateHoldUI(); ensureNotePanel(); }
  safeDecorateNoteRows();
}, 300);

const domObserver = new MutationObserver(debouncedEnsure);

window.addEventListener('hashchange', () => {
  updateActiveTab();
  updateHoldUI();
  tryInjectWithRetry();
  ensureNotePanel();
  [200, 500, 1000, 1500].forEach((d) =>
    setTimeout(() => { tryInjectWithRetry(); ensureNotePanel(); safeDecorateNoteRows(); }, d)
  );
});

// ─── Email notes — in-conversation panel + list-row markers ────────────────────

const NOTE_PANEL_ID = 'glt-note';
const ROW_NOTE_ID   = 'glt-rnote';

// Yellow sticky note (folded corner + two text lines). Used on list rows and the panel head.
function stickyNoteIcon(size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 3h14a1 1 0 0 1 1 1v9.5L13.5 20H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
      fill="#ffd64a" stroke="#e6a900" stroke-width="1.1"></path>
    <path d="M13.5 20v-5.5a1 1 0 0 1 1-1H20"
      fill="#ffe896" stroke="#e6a900" stroke-width="1.1" stroke-linejoin="round"></path>
    <line x1="7.4" y1="8" x2="15.6" y2="8" stroke="#a9780b" stroke-width="1.3" stroke-linecap="round"></line>
    <line x1="7.4" y1="11" x2="13" y2="11" stroke="#a9780b" stroke-width="1.3" stroke-linecap="round"></line>
  </svg>`;
}

function noteIcon() { return stickyNoteIcon(15); }

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 260) + 'px';
}

// Inject (or refresh) the note panel for the open conversation.
function ensureNotePanel() {
  const convo = getOpenConversation();
  const existing = document.getElementById(NOTE_PANEL_ID);
  if (!convo || !convo.threadId) { existing?.remove(); return; }
  const main = findVisibleMain();
  if (!main) return;
  if (existing && existing.dataset.threadId === convo.threadId) return;
  existing?.remove();

  const panel = document.createElement('div');
  panel.id = NOTE_PANEL_ID;
  panel.dataset.threadId = convo.threadId;
  panel.innerHTML = `
    <div class="glt-note-head">${noteIcon()}<span>Note</span>
      <span class="glt-note-status" id="glt-note-status"></span></div>
    <textarea class="glt-note-ta" id="glt-note-ta"
      placeholder="Add a private note to this email — only you can see it."></textarea>
  `;
  const bar = document.getElementById(BAR_ID);
  if (bar && bar.parentNode === main) bar.after(panel);
  else main.prepend(panel);

  const ta = panel.querySelector('#glt-note-ta');
  const status = panel.querySelector('#glt-note-status');
  getNote(convo.threadId).then((text) => { ta.value = text; autoGrow(ta); });

  const save = debounce(async () => {
    try {
      await saveNote(convo.threadId, ta.value);
      status.textContent = ta.value.trim() ? 'Saved' : '';
      safeDecorateNoteRows();
      setTimeout(() => { if (status.textContent === 'Saved') status.textContent = ''; }, 1500);
    } catch {
      status.textContent = 'Too long to sync';
    }
  }, 600);

  ta.addEventListener('input', () => { autoGrow(ta); status.textContent = 'Saving…'; save(); });
}

// Refresh the open panel if its note changed elsewhere (and it isn't being typed in).
function refreshOpenNote() {
  const panel = document.getElementById(NOTE_PANEL_ID);
  if (!panel) return;
  const ta = panel.querySelector('#glt-note-ta');
  if (!ta || document.activeElement === ta) return;
  getNote(panel.dataset.threadId).then((text) => { ta.value = text; autoGrow(ta); });
}

// Best-effort sticky-note marker on list rows whose thread has a note.
// Clicking it opens an inline editor — no need to open the email.
function decorateNoteRows() {
  const main = findVisibleMain();
  if (!main) return;
  main.querySelectorAll('tr.zA').forEach((row) => {
    const t = getRowThread(row);
    const has = !!(t && t.threadId && notesIndex.has(t.threadId));
    let chip = row.querySelector('.glt-note-chip');
    if (has && !chip) {
      const host = row.querySelector('.bog') || row.querySelector('.y6');
      if (host) {
        chip = document.createElement('span');
        chip.className = 'glt-note-chip';
        chip.title = 'View note';
        chip.dataset.threadId = t.threadId;
        chip.innerHTML = stickyNoteIcon(18);
        // Don't let the click bubble to Gmail's row handler (which would open the email).
        chip.addEventListener('mousedown', (e) => e.stopPropagation());
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          const r = chip.closest('tr.zA');
          const meta = r ? getRowThread(r) : null;
          openRowNotePopover(chip, (meta && meta.threadId) || chip.dataset.threadId);
        });
        host.prepend(chip);
      }
    } else if (has && chip) {
      chip.dataset.threadId = t.threadId; // keep fresh across Gmail row recycling
    } else if (!has && chip) {
      chip.remove();
    }
  });
}

function safeDecorateNoteRows() {
  try { decorateNoteRows(); } catch { /* Gmail DOM shape varies; non-critical */ }
}

// ─── Inline note quick-editor (from list rows) ────────────────────────────────

let rowNoteThreadId = null;

function ensureRowNotePop() {
  let pop = document.getElementById(ROW_NOTE_ID);
  if (pop) return pop;

  pop = document.createElement('div');
  pop.id = ROW_NOTE_ID;
  pop.innerHTML = `
    <div class="glt-rnote-head">${stickyNoteIcon(15)}<span>Note</span>
      <span class="glt-rnote-status"></span>
      <button class="glt-rnote-x" title="Close" aria-label="Close">&#x2715;</button></div>
    <textarea class="glt-rnote-ta"
      placeholder="Add a private note to this email — only you can see it."></textarea>`;
  document.body.appendChild(pop);

  const ta = pop.querySelector('.glt-rnote-ta');
  const status = pop.querySelector('.glt-rnote-status');
  const save = debounce(async () => {
    if (!rowNoteThreadId) return;
    try {
      await saveNote(rowNoteThreadId, ta.value);
      status.textContent = ta.value.trim() ? 'Saved' : '';
      safeDecorateNoteRows();
      refreshOpenNote();
      setTimeout(() => { if (status.textContent === 'Saved') status.textContent = ''; }, 1500);
    } catch {
      status.textContent = 'Too long to sync';
    }
  }, 600);

  ta.addEventListener('input', () => { status.textContent = 'Saving…'; save(); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRowNotePop(); });
  pop.querySelector('.glt-rnote-x').addEventListener('click', closeRowNotePop);
  pop.addEventListener('mousedown', (e) => e.stopPropagation());

  // Click outside closes it.
  document.addEventListener('mousedown', (e) => {
    if (!pop.classList.contains('show')) return;
    if (pop.contains(e.target) || e.target.closest?.('.glt-note-chip')) return;
    closeRowNotePop();
  });
  return pop;
}

function openRowNotePopover(anchorEl, threadId) {
  if (!threadId) return;
  const pop = ensureRowNotePop();
  rowNoteThreadId = threadId;
  const ta = pop.querySelector('.glt-rnote-ta');
  pop.querySelector('.glt-rnote-status').textContent = '';
  ta.value = '';
  getNote(threadId).then((text) => { ta.value = text; });

  pop.classList.add('show');
  const r = anchorEl.getBoundingClientRect();
  const pw = pop.offsetWidth || 320;
  const ph = pop.offsetHeight || 150;
  let left = r.left;
  let top = r.bottom + 6;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (top + ph > window.innerHeight - 8) top = r.top - ph - 6;
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top = Math.max(8, top) + 'px';
  setTimeout(() => ta.focus(), 0);
}

function closeRowNotePop() {
  const pop = document.getElementById(ROW_NOTE_ID);
  if (pop) pop.classList.remove('show');
  rowNoteThreadId = null;
}

// ─── Label name reconciliation ────────────────────────────────────────────────

// Keep plain label tabs pointing at the right label if it was renamed in Gmail.
async function reconcileTabs(tabs) {
  if (!tabs.length) return tabs;
  try {
    const allLabels = await fetchUserLabels();
    const nameById = new Map(allLabels.map((l) => [l.id, l.name]));
    let changed = false;
    const updated = tabs.map((t) => {
      if (t.type === 'label' && t.labelId && !t.sublabels) {
        const fresh = nameById.get(t.labelId);
        if (fresh && fresh !== t.labelName) {
          changed = true;
          return { ...t, labelName: fresh, query: `label:"${fresh}"` };
        }
      }
      return t;
    });
    if (changed) await saveTabs(updated);
    return updated;
  } catch {
    return tabs;
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function init() {
  holdLabelName = await loadHoldLabelName();
  customDurations = await loadCustomDurations();
  cachedPinned = await reconcileTabs(await loadTabs());
  await loadNotesIndex();
  refreshHolds();
  setupRowHoldHover();

  if (injectBar(cachedPinned)) {
    domObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    const waitObs = new MutationObserver(
      debounce(() => {
        if (injectBar(cachedPinned)) {
          waitObs.disconnect();
          domObserver.observe(document.body, { childList: true, subtree: true });
        }
      }, 200)
    );
    waitObs.observe(document.body, { childList: true, subtree: true });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.tabs) {
      cachedPinned = changes.tabs.newValue || [];
      injectBar(cachedPinned);
    }
    if (area === 'sync' && changes.holdLabelName) {
      holdLabelName = changes.holdLabelName.newValue || DEFAULT_HOLD_NAME;
      updateHoldUI();
    }
    if (area === 'sync' && Object.keys(changes).some((k) => k.startsWith(NOTE_PREFIX))) {
      Object.keys(changes).forEach((k) => {
        if (!k.startsWith(NOTE_PREFIX)) return;
        const id = k.slice(NOTE_PREFIX.length);
        if (changes[k].newValue == null) notesIndex.delete(id);
        else notesIndex.add(id);
      });
      safeDecorateNoteRows();
      refreshOpenNote();
    }
    if (area === 'local' && changes.customDurations) {
      customDurations = changes.customDurations.newValue || [];
    }
    if (area === 'local' && changes.heldThreads) {
      cachedHolds = changes.heldThreads.newValue || [];
      updateHoldUI();
    }
  });
}

init();
