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

let cachedPinned     = [];               // [{ id, name }, …] pinned label tabs
let cachedHolds      = [];               // [{ threadId, subject, returnAt }, …]
let customDurations  = [];               // [{ label, amount, unit }, …] (local cache)
let holdLabelName    = DEFAULT_HOLD_NAME; // user-customizable Hold label/tab name
let settingsOpen     = false;
let pickerOpen       = false;

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

function loadPinned() {
  return new Promise((resolve) =>
    chrome.storage.sync.get('pinnedLabels', (d) => resolve(d.pinnedLabels || []))
  );
}

function savePinned(labels) {
  return new Promise((resolve) => chrome.storage.sync.set({ pinnedLabels: labels }, resolve));
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

// Are we currently looking at the Hold label view?
function isCurrentViewHold() {
  const a = activeTabName();
  return !!a && a.toLowerCase() === holdLabelName.toLowerCase();
}

function threadIsHeld(threadId) {
  return !!threadId && cachedHolds.some((h) => h.threadId === threadId);
}

// ─── Tab Bar ──────────────────────────────────────────────────────────────────

function buildBar(pinned) {
  const activeName = activeTabName();
  const bar = document.createElement('div');
  bar.id = BAR_ID;
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Label tabs');

  const tabs = [{ id: 'INBOX', name: 'Inbox' }, ...pinned];

  tabs.forEach(({ id, name }) => {
    const btn = document.createElement('button');
    btn.className = 'glt-tab';
    btn.setAttribute('role', 'tab');
    btn.textContent = name;
    btn.dataset.labelId = id;
    btn.dataset.labelName = name;

    const isActive =
      id === 'INBOX'
        ? activeName === 'INBOX'
        : activeName?.toLowerCase() === name.toLowerCase();

    btn.classList.toggle('glt-tab--active', isActive);
    btn.setAttribute('aria-selected', String(isActive));

    btn.addEventListener('click', () => {
      goToLabel(id === 'INBOX' ? 'INBOX' : name);
      setActiveTab(btn);
    });

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
  const activeName = activeTabName();
  document.querySelectorAll(`#${BAR_ID} .glt-tab`).forEach((btn) => {
    const match =
      btn.dataset.labelId === 'INBOX'
        ? activeName === 'INBOX'
        : activeName?.toLowerCase() === btn.dataset.labelName?.toLowerCase();
    btn.classList.toggle('glt-tab--active', match);
    btn.setAttribute('aria-selected', String(match));
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

function injectBar(pinned) {
  document.getElementById(BAR_ID)?.remove();
  const main = findVisibleMain();
  if (!main) return false;
  main.prepend(buildBar(pinned));
  updateHoldUI();
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

// ─── Bar action + Hold tab state ────────────────────────────────────────────────

function updateHoldUI() {
  const action = document.querySelector(`#${BAR_ID} .glt-hold`);
  if (action) {
    const convo = getOpenConversation();
    if (!convo) {
      action.style.display = 'none';
    } else {
      action.style.display = '';
      const held = threadIsHeld(convo.threadId);
      action.dataset.mode = held ? 'return' : 'hold';
      action.querySelector('.glt-hold-label').textContent = held ? 'Return now' : 'Hold';
      action.title = held
        ? 'Return this email to the inbox now (marked unread)'
        : `Hold this email — return it to the inbox after a timer`;
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

// Bar action button: hold the open email, or return it if it's already held.
function onBarActionClick() {
  const convo = getOpenConversation();
  if (!convo) return;
  const anchor = document.querySelector(`#${BAR_ID} .glt-hold`);
  if (anchor.dataset.mode === 'return') {
    returnThread(convo, (ok) => { if (ok && getOpenConversation()) history.back(); });
  } else {
    openHoldPicker(anchor, convo, (held) => { if (held && getOpenConversation()) history.back(); });
  }
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

async function commitHold(target, returnAt, onAfter) {
  closePopover();
  try {
    const res = await sendBg({
      type: 'HOLD_THREAD',
      threadId: target.threadId,
      messageId: target.messageId,
      returnAt,
    });
    await refreshHolds();
    toast(`Held — returns ${formatWhen(res.returnAt)}`);
    onAfter?.(true);
  } catch (err) {
    toast(`Couldn't hold this email: ${err.message}`, true);
    onAfter?.(false);
  }
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

  let target = null;

  const hideSoon = () => {
    clearTimeout(rowHoldHideTimer);
    rowHoldHideTimer = setTimeout(() => {
      if (!pickerOpen) btn.style.display = 'none';
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
  panel.setAttribute('aria-labelledby', 'glt-panel-title');
  panel.addEventListener('click', (e) => e.stopPropagation());

  panel.innerHTML = `
    <div class="glt-sp-head">
      <h2 class="glt-sp-title" id="glt-panel-title">Settings</h2>
      <button class="glt-sp-x" aria-label="Close settings">&#x2715;</button>
    </div>
    <div class="glt-sp-field">
      <label class="glt-sp-flabel" for="glt-hold-name">Hold tab &amp; label name</label>
      <input id="glt-hold-name" class="glt-sp-input" type="text" maxlength="40" placeholder="${escHtml(DEFAULT_HOLD_NAME)}">
    </div>
    <p class="glt-sp-hint">Check labels to show as tabs. Drag rows to reorder.</p>
    <div class="glt-sp-list" id="glt-sp-list">
      <p class="glt-sp-msg">Loading your labels&hellip;</p>
    </div>
    <div class="glt-sp-foot">
      <button class="glt-sp-save" id="glt-sp-save">Save</button>
    </div>
  `;

  document.body.append(overlay, panel);

  panel.querySelector('.glt-sp-x').addEventListener('click', closeSettings);
  panel.querySelector('#glt-sp-save').addEventListener('click', handleSave);
  panel.querySelector('#glt-hold-name').value = holdLabelName;
  panel.querySelector('.glt-sp-x').focus();

  const listEl = panel.querySelector('#glt-sp-list');

  try {
    const [allLabels, pinned] = await Promise.all([fetchUserLabels(), loadPinned()]);
    const pinnedMap = new Map(pinned.map((l) => [l.id, l]));
    const pinnedOrdered = pinned
      .filter((p) => allLabels.some((l) => l.id === p.id))
      .map((p) => ({ ...p, name: allLabels.find((l) => l.id === p.id)?.name ?? p.name }));
    const unpinned = allLabels.filter((l) => !pinnedMap.has(l.id));
    populateList(listEl, [...pinnedOrdered, ...unpinned], pinnedMap);
  } catch (err) {
    listEl.innerHTML = `<p class="glt-sp-msg glt-sp-err">${escHtml(err.message)}</p>`;
  }
}

function populateList(container, labels, pinnedMap) {
  container.innerHTML = '';
  let dragged = null;

  if (labels.length === 0) {
    container.innerHTML = '<p class="glt-sp-msg">No user-created labels found.</p>';
    return;
  }

  labels.forEach((label) => {
    const row = document.createElement('div');
    row.className = 'glt-row';
    row.draggable = true;
    row.dataset.id = label.id;
    row.dataset.name = label.name;

    const checked = pinnedMap.has(label.id);
    row.innerHTML = `
      <span class="glt-row-handle" aria-hidden="true" title="Drag to reorder">&#x2807;</span>
      <label class="glt-row-label">
        <input type="checkbox" class="glt-row-cb"${checked ? ' checked' : ''}>
        <span class="glt-row-name">${escHtml(label.name)}</span>
      </label>
    `;

    row.addEventListener('dragstart', (e) => {
      dragged = row;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => row.classList.add('glt-row--dragging'), 0);
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('glt-row--dragging');
      container.querySelectorAll('.glt-row--over').forEach((r) => r.classList.remove('glt-row--over'));
      dragged = null;
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (row !== dragged) {
        container.querySelectorAll('.glt-row--over').forEach((r) => r.classList.remove('glt-row--over'));
        row.classList.add('glt-row--over');
      }
    });
    row.addEventListener('dragleave', () => row.classList.remove('glt-row--over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('glt-row--over');
      if (!dragged || dragged === row) return;
      const rows = [...container.querySelectorAll('.glt-row')];
      const si = rows.indexOf(dragged);
      const di = rows.indexOf(row);
      si < di ? row.after(dragged) : row.before(dragged);
    });

    container.appendChild(row);
  });
}

async function handleSave() {
  const rows = document.querySelectorAll('#glt-sp-list .glt-row');
  const pinned = [];
  rows.forEach((row) => {
    if (row.querySelector('.glt-row-cb')?.checked) {
      pinned.push({ id: row.dataset.id, name: row.dataset.name });
    }
  });

  const newName = (document.getElementById('glt-hold-name')?.value || '').trim() || DEFAULT_HOLD_NAME;

  const saveBtn = document.getElementById('glt-sp-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  await savePinned(pinned);
  cachedPinned = pinned;

  if (newName !== holdLabelName) {
    holdLabelName = newName;
    await saveHoldLabelName(newName);
    try {
      await sendBg({ type: 'SET_HOLD_LABEL_NAME', name: newName });
    } catch (err) {
      toast(`Saved, but renaming the Gmail label failed: ${err.message}`, true);
    }
  }

  closeSettings();
  injectBar(pinned);
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
  else updateHoldUI();
}, 300);

const domObserver = new MutationObserver(debouncedEnsure);

window.addEventListener('hashchange', () => {
  updateActiveTab();
  updateHoldUI();
  tryInjectWithRetry();
  [200, 500, 1000, 1500].forEach((d) => setTimeout(tryInjectWithRetry, d));
});

// ─── Label name reconciliation ────────────────────────────────────────────────

async function reconcileLabelNames(pinned) {
  if (pinned.length === 0) return pinned;
  try {
    const allLabels = await fetchUserLabels();
    const nameById = new Map(allLabels.map((l) => [l.id, l.name]));
    let changed = false;
    const updated = pinned.map((p) => {
      const freshName = nameById.get(p.id);
      if (freshName && freshName !== p.name) {
        changed = true;
        return { ...p, name: freshName };
      }
      return p;
    });
    if (changed) await savePinned(updated);
    return updated;
  } catch {
    return pinned;
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function init() {
  holdLabelName = await loadHoldLabelName();
  customDurations = await loadCustomDurations();
  cachedPinned = await reconcileLabelNames(await loadPinned());
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
    if (area === 'sync' && changes.pinnedLabels) {
      cachedPinned = changes.pinnedLabels.newValue || [];
      injectBar(cachedPinned);
    }
    if (area === 'sync' && changes.holdLabelName) {
      holdLabelName = changes.holdLabelName.newValue || DEFAULT_HOLD_NAME;
      updateHoldUI();
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
