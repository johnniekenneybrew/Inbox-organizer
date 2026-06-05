'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const BAR_ID     = 'glt-bar';
const PANEL_ID   = 'glt-panel';
const OVERLAY_ID = 'glt-overlay';

// ─── State ────────────────────────────────────────────────────────────────────

let cachedPinned = [];   // [{ id, name }, …]  — kept in sync with storage
let settingsOpen = false;

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
    // Token may be stale — remove it and let the user retry.
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

// ─── Navigation ───────────────────────────────────────────────────────────────

/**
 * Returns the name of the currently-active label (or 'INBOX' for the inbox).
 * Reads from the URL hash because Gmail is a hash-router SPA.
 */
function activeTabName() {
  const hash = location.hash;
  if (!hash || hash === '#' || hash.startsWith('#inbox')) return 'INBOX';

  // Native label URL:  #label/To+Do
  const native = hash.match(/^#label\/(.+?)(?:[/?].*)?$/);
  if (native) return decodeURIComponent(native[1].replace(/\+/g, '%20'));

  // Legacy search-style URLs (e.g. if the user typed one in)
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
    // Use Gmail's native label URL (same as clicking a label in the sidebar).
    // The label view has the same DOM structure as the inbox, which keeps our
    // injected tab bar stable across navigation.
    location.hash = '#label/' + encodeURIComponent(name).replace(/%20/g, '+');
  }
}

// ─── Tab Bar ──────────────────────────────────────────────────────────────────

function buildBar(pinned) {
  const activeName = activeTabName();
  const bar = document.createElement('div');
  bar.id = BAR_ID;
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Label tabs');

  // Inbox is always the first, pinned tab.
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

    if (isActive) {
      btn.classList.add('glt-tab--active');
      btn.setAttribute('aria-selected', 'true');
    } else {
      btn.setAttribute('aria-selected', 'false');
    }

    btn.addEventListener('click', () => {
      goToLabel(id === 'INBOX' ? 'INBOX' : name);
      setActiveTab(btn);
    });

    bar.appendChild(btn);
  });

  // Settings gear button (right-aligned via CSS margin-left: auto)
  const gear = document.createElement('button');
  gear.className = 'glt-gear';
  gear.title = 'Configure label tabs';
  gear.setAttribute('aria-label', 'Configure label tabs');
  gear.innerHTML = gearIcon();
  gear.addEventListener('click', openSettings);
  bar.appendChild(gear);

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

// ─── Inject / remove bar ──────────────────────────────────────────────────────

/**
 * Gmail keeps multiple [role="main"] elements in the DOM (one per view) and
 * toggles their visibility. Always inject into the currently-visible one,
 * otherwise the bar lands inside a hidden container and disappears.
 */
function findVisibleMain() {
  const mains = document.querySelectorAll('[role="main"]');
  for (const m of mains) {
    if (m.offsetParent !== null && m.getBoundingClientRect().width > 0) {
      return m;
    }
  }
  return null;
}

function isBarVisible() {
  const bar = document.getElementById(BAR_ID);
  return !!(bar && bar.offsetParent !== null);
}

function injectBar(pinned) {
  document.getElementById(BAR_ID)?.remove();

  // Inject at the top of the visible [role="main"]. Inserting as a sibling of
  // [role="grid"] crashes Gmail's own event handlers, so we stay at the top.
  const main = findVisibleMain();
  if (!main) return false;

  main.prepend(buildBar(pinned));
  return true;
}

/**
 * After Gmail navigation the visible main may take a moment to appear.
 * Retry every 100 ms (up to 2 s) until we can inject into the visible one.
 */
function tryInjectWithRetry(attempts = 0) {
  if (isBarVisible()) {
    updateActiveTab();
    return;
  }
  if (injectBar(cachedPinned)) return;
  if (attempts < 20) {
    setTimeout(() => tryInjectWithRetry(attempts + 1), 100);
  }
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

async function openSettings() {
  if (settingsOpen) return;
  settingsOpen = true;

  // Backdrop
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.addEventListener('click', closeSettings);

  // Modal
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'glt-panel-title');
  panel.addEventListener('click', (e) => e.stopPropagation());

  panel.innerHTML = `
    <div class="glt-sp-head">
      <h2 class="glt-sp-title" id="glt-panel-title">Label Tabs</h2>
      <button class="glt-sp-x" aria-label="Close settings">&#x2715;</button>
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

  // Trap focus roughly: focus the close button on open
  panel.querySelector('.glt-sp-x').focus();

  const listEl = panel.querySelector('#glt-sp-list');

  try {
    const [allLabels, pinned] = await Promise.all([fetchUserLabels(), loadPinned()]);

    const pinnedMap = new Map(pinned.map((l) => [l.id, l]));

    // Pinned items first (preserve saved order, but use fresh API name), then unpinned alphabetically
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

    // ── Drag-and-drop reordering ──
    row.addEventListener('dragstart', (e) => {
      dragged = row;
      e.dataTransfer.effectAllowed = 'move';
      // Defer class to allow the drag ghost to render first
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

  const saveBtn = document.getElementById('glt-sp-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  await savePinned(pinned);
  cachedPinned = pinned;
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

// ─── MutationObserver — keeps bar alive across Gmail's DOM churning ───────────

const debouncedEnsure = debounce(() => {
  if (!isBarVisible()) {
    tryInjectWithRetry();
  }
}, 300);

const domObserver = new MutationObserver(debouncedEnsure);

// ─── Hash-change — update the active-tab indicator on Gmail navigation ────────

window.addEventListener('hashchange', () => {
  updateActiveTab();      // update indicator immediately if bar is already there
  tryInjectWithRetry();   // re-inject if bar already missing
  // Gmail usually removes the bar AFTER hashchange while it re-renders the
  // main panel. Re-check at several intervals so we catch the removal whenever
  // it happens and re-inject.
  [200, 500, 1000, 1500].forEach((d) => setTimeout(tryInjectWithRetry, d));
});

// ─── Label name reconciliation ────────────────────────────────────────────────

/**
 * Silently fetches fresh label names from the API and updates storage if any
 * pinned label was renamed in Gmail. Falls back to cached names on failure.
 */
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
    return pinned; // silently use cached names if the API call fails
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function init() {
  cachedPinned = await reconcileLabelNames(await loadPinned());

  if (injectBar(cachedPinned)) {
    // Gmail was already ready — start observing immediately.
    domObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    // [role="main"] / [role="grid"] not ready yet — poll until they appear.
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

  // Sync tab bar if another tab/window changes the pinned list.
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.pinnedLabels) {
      cachedPinned = changes.pinnedLabels.newValue || [];
      injectBar(cachedPinned);
    }
  });
}

init();
