# 🌳 Family Tree

A beautiful, mobile-friendly family tree you can host on GitHub Pages — preserve names, photos, and dates of every family member, view them as a tree or on a horizontal timeline, and export the data anytime.

**No backend.** Everything lives in your browser's `localStorage`. Photos are stored as compressed base64. Export to JSON to back up or move between devices.

## Features

- **People** — add/edit/delete family members with photo, name, dates (full or year-only), birth/death place, gender, notes, parents and spouses.
- **Tree** — a clean SVG family tree with pan, pinch-zoom, and wheel-zoom. Couples are connected; parents are linked to children with neat L-shaped lines.
- **Timeline** — horizontal scrolling lifespan timeline. One row per person, showing exactly when each was alive, with a "Today" line and zoomable years.
- **Export** — JSON export with toggles to include/exclude photos, dates, and locations. Or a "minimal" mode that only keeps names + relationships.
- **Import** — load a previously-exported JSON file.
- **Mobile** — bottom nav, full-width modals that slide up, touch-pan/zoom on the tree, touch-scroll on the timeline.
- **Dark mode** — follows your system preference.

## Quick start (local)

Just open `index.html` in a browser. That's it — no build, no install.

If your browser blocks `file://` (some Safari builds do), serve the folder:

```sh
# Python 3
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Hosting on GitHub Pages

1. Create a new repo on GitHub and push this folder to it.
2. Go to **Settings → Pages**.
3. Source: **Deploy from a branch** → branch `main`, folder `/ (root)`.
4. Save. After ~1 minute, your tree will be live at `https://<your-username>.github.io/<repo-name>/`.

The included `.nojekyll` file disables Jekyll processing so GitHub Pages serves the files as-is.

## Data & privacy

- All data is stored locally in your browser under the key `familyTree.v1`.
- Clearing site data wipes your tree — export first.
- Photos are downscaled to 512px max and saved as JPEG (~85% quality) before storage.
- The site has no analytics, no network calls, no third-party CDNs.

## File structure

```
index.html
.nojekyll
styles/
  tokens.css       — design tokens (color, type, spacing)
  base.css         — reset + app layout
  components.css   — buttons, cards, modal, avatar, chip, toast
  views.css        — view-specific styles
js/
  data-store.js    — localStorage CRUD + helpers (single source of truth)
  ui-utils.js      — DOM helpers, modal, toast, confirm
  people-view.js   — list, add/edit form
  tree-view.js     — SVG tree with pan/zoom
  timeline-view.js — horizontal timeline
  export-import.js — export modal + JSON import
  app.js           — view router + first-run sample data
```

## Keyboard / gestures

- `Esc` — close any open modal
- Tree: drag to pan, wheel/pinch to zoom, buttons to fine-tune
- Timeline: scroll horizontally; press **Today** to jump back

## Acknowledgements

Built with no dependencies — just modern browser APIs.
