# Brand / Design System

**Product name:** Inbox Genie — Chrome Web Store listing name: *"Inbox Genie - Tabs & Notes for Gmail"*
**Publisher:** Lazo Labs — contact `info@lazolabs.app`

## Design principle (the rule above all others)

The extension's UI must read as **native Gmail**. Everything is styled to blend into Google's Material look — same font stack, same blues and greys, same pill/chip shapes. A user should not be able to tell where Gmail ends and Inbox Genie begins.

## Palette

All tokens live inline in `styles.css` — there is no variables/tokens file. Counts below reflect actual usage frequency in the stylesheet.

| Role | Hex | Notes |
|---|---|---|
| Primary blue | `#1a73e8` | Google blue — buttons, active tab, links (most-used color, 29 uses) |
| Primary blue (pressed/hover) | `#1765cc` | |
| Primary blue (dark-theme accent) | `#8ab4f8` | |
| Selected/active light-blue fill | `#e8f0fe` | Active tab background |
| Text primary | `#202124` | |
| Text secondary | `#5f6368` | Labels, hints, the grey snooze-count |
| Muted grey text | `#80868b`, `#9aa0a6`, `#bdc1c6` | Descending emphasis |
| Borders / dividers | `#dadce0`, `#e0e0e0`, `#e8eaed` | |
| Grey surfaces | `#f1f3f4`, `#f8f9fa` | Chips, hovers, panel backgrounds |
| Error red | `#c5221f` | Error toasts, destructive actions |
| Sticky-note yellow (icon) | `#f9ab00` | The note marker on list rows |
| Sticky-note fill / edge | `#fffbe6`, `#f0e6c0`, `#ecdca0` | Note popover/panel surfaces |
| Sticky-note text | `#8a6d00` | Dark amber for text on yellow |

## Typography

`font-family: 'Google Sans', Roboto, Arial, sans-serif` — declared per-component (8 sites in `styles.css`). No webfonts are loaded; the stack resolves to fonts Gmail already ships. **Never add an external font** (CSP forbids remote assets and it would break the native look).

## Logo & icon assets

| Asset | Path | Use |
|---|---|---|
| App icons 16/32/48/128 | `icons/icon16.png` … `icons/icon128.png` | Manifest `icons` + toolbar action (Lazo Labs "move-to-inbox" mark) |
| Store listing icon | `store-assets/store-icon-128.png` | 96px content + 16px margin, per CWS image guidelines |
| Store screenshots | `store-assets/screenshot-*.png`, `store-assets/shot-*.png` | Current listing set: hold options, snooze tab, bulk, return, notes, settings, colored tabs |
| Dev/demo captures | `preview/1-inbox.png` … `preview/9-bulk-hold.png` | Working shots used during development |
| Interactive mockup | `mockup.html` | Self-contained fake-Gmail page used to stage screenshots; not shipped in the zip |

## Rules that must not be broken

1. **Every CSS class is prefixed `glt-`** (legacy of the original name "Gmail Label Tabs"). Unprefixed classes risk colliding with Gmail's own obfuscated classes.
2. **Match Gmail's visual language** — Google Sans stack, `#1a73e8` blue, subtle greys. No brand colors of our own inside Gmail's UI; the yellow family is reserved exclusively for notes.
3. **No external assets** — no CDN fonts, images, or scripts. Everything ships in the package (also a Chrome Web Store review requirement).
4. **User-controlled colors are scoped**: tab font/background colors are user-chosen per tab and stored in the tab object — never hardcode tab colors.
