# Product Map

## Files at a glance

| File | Owns |
|---|---|
| `manifest.json` | MV3 manifest — permissions (`identity`, `storage`, `alarms`), host permissions (`mail.google.com`, `googleapis.com`), OAuth client + scopes, pinned extension ID (`key` field) |
| `content.js` (~1,500 lines) | Everything the user sees inside Gmail |
| `background.js` (~430 lines) | Service worker: OAuth token broker + snooze engine on a 1-minute `chrome.alarms` tick |
| `styles.css` | All injected styles, `glt-` prefixed |
| `popup.html` | Toolbar popup — description + "Open Gmail" link (no logic) |

## Surfaces → owners (all in `content.js` unless noted)

| Surface | Owner |
|---|---|
| Tab bar at the top of Gmail (Inbox + custom tabs) | `injectBar` / `renderTabs`, re-injected by a `MutationObserver` + `hashchange` handler |
| Contextual bar action ("Snooze" / "Return now" on an open email) | `updateHoldUI` |
| Snooze tab (right side, opens label view, grey count) | `updateHoldTab` |
| Snooze duration picker popover (presets, custom durations, specific date/time) | `openHoldPicker` |
| Inline Snooze button on hovered list rows + "returns when" chip | `setupRowHoldHover` |
| Bulk Snooze/Return over checkbox-selected rows | `onBarActionClick` → `commitHold` / `bulkReturn` |
| Note panel at the top of an open conversation | `ensureNotePanel` |
| Yellow sticky-note marker on list rows | `decorateNoteRows` |
| Inline note quick-editor popover (from a row marker) | `openRowNotePopover` / `ensureRowNotePop` |
| Settings (gear) panel — tab manager, label-name field | `openSettings` / `onSaveAll` |
| Toasts | `toast` |
| Token brokering, snooze engine, label self-healing | `background.js`: `holdThread`, `cancelHold`, `processHolds`, `ensureHeldLabel` |

## Core user flows

**Snooze an email.** Hover a row (or open the email) → click Snooze → pick 3 days / 1 week / a saved custom duration / a number of hours-days-weeks / a specific date & time. The worker resolves the thread, saves the hold record first, then archives the thread out of the inbox under the Snooze label. Bulk works over Gmail's checkboxes.

**It comes back three ways.** (1) Timer expires → the 1-minute alarm returns it to the inbox marked unread. (2) The other side replies → the early-return check notices a new *incoming* message (drafts and your own sent replies don't count) and just drops the label — the reply already pulled it back. (3) "Return now" on the row or open email → immediate return, marked unread.

**Notes.** Open any email → yellow note panel on top, autosaves as you type. Or click the sticky-note marker on a row to read/edit without opening the email. Notes sync across devices via `chrome.storage.sync`; they are never part of the email.

**Tabs.** Gear → add a tab for a label, a label + its sublabels, or any Gmail search query; name it, color it, describe it, drag to reorder. Clicking a plain-label tab uses Gmail's native label view; query/sublabel tabs run a Gmail search.
