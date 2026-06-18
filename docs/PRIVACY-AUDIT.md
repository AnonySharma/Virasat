# Pre-launch privacy audit — user-text rendering

Last verified: 2026-06-19. Re-run before any public launch and after any change to `UI.el` or any view module.

The convention this codebase follows: **every user-controlled string reaches the DOM via `textContent`, `.value`, or `UI.el(tag, attrs, children)` where `children` is normalised to a TextNode**. There are no string-to-HTML interpolation paths for user data anywhere. This file documents that convention site by site, so a future contributor can grep for any drift.

---

## The single safe primitive — `UI.el`

`lib/ui/dom.js`:

```js
function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) { for (const k in attrs) { /* class, style, dataset, on*, attrs */ } }
  if (children != null) {
    const arr = Array.isArray(children) ? children : [children];
    arr.forEach((c) => {
      if (c == null || c === false) return;
      node.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    });
  }
  return node;
}
```

Children that aren't already DOM nodes are wrapped in `document.createTextNode(String(c))`. **This is identical to React's JSX auto-escaping for text** — strings can't introduce new DOM nodes regardless of what they contain.

The previously-present `html: ...` attribute that bypassed this contract by assigning to `innerHTML` was **removed** in this round of hardening. There is no remaining path through `UI.el` that interprets a string as HTML.

---

## User-text fields — where they live and how they render

| Field | Source | Render path | Verdict |
|---|---|---|---|
| `person.name`, `name_hi` | user typed | `UI.el("h2"/"div"/"span", null, displayName)` in inspector / tree-node aria-label / people-card / modal headers | TextNode |
| `person.description`, `description_hi` | user typed | `UI.el("p", { class: "..." }, displayDesc)` in inspector "About" section | TextNode |
| `person.notes`, `notes_hi` | user typed | `<textarea>.value = displayNotes` in inspector notes field | `.value` (sandboxed) |
| `person.occupation`, `occupation_hi` | user typed | `UI.el("div", null, displayOcc)` inspector header + tree-node | TextNode |
| `person.birthPlace`, `birthPlace_hi` | user typed | `UI.el("dd"/"span", null, place)` inspector personal-info rows + tree | TextNode |
| `person.deathPlace`, `deathPlace_hi` | user typed | same as birth | TextNode |
| `person.achievements[]`, `achievements_hi[]` | user typed | `UI.el("li", null, item)` inside `<ul>` | TextNode |
| `person.education[]`, `education_hi[]` | user typed | `UI.el("li", null, item)` | TextNode |
| `person.contact.phone` | user typed | `UI.el("a", { href: "tel:" + ... }, value)` — value is text content; the `tel:` URL is sandboxed by the browser | TextNode + URL-attr |
| `person.contact.email` | user typed | `UI.el("a", { href: "mailto:" + ... }, value)` | TextNode + URL-attr |
| `person.contact.address` | user typed | `UI.el("a", { href: "https://www.google.com/maps/search/?...&query=" + encodeURIComponent(value) }, value)` | TextNode + encoded URL |
| `story.title`, `story.body`, `story.tags[]` | user typed | `UI.el("h4" / "p" / "span", null, value)` in inspector + story-result cards (people-view search) | TextNode |
| `marriage.story`, `marriage.date`, `marriage.place` | user typed | `UI.el("p" / "dd", null, value)` in marriage modal view-mode | TextNode |
| `meta.familyTitle`, `meta.familyName` | user typed | `UI.el("span", null, title)` in tree view-head | TextNode |
| Search query (highlighting) | user typed | `UI.el("mark", null, slice)` inside text content — slice is plain string passed as child, never as raw markup | TextNode |

**No user string reaches a string-to-HTML interpolation anywhere in the codebase.** Verified by grep:

```
grep -rn "innerHTML" lib/    # produces ~6 hits, all clearings (innerHTML = "") on non-user-input containers
```

---

## URL attributes carrying user text

The contact section builds three deep-links from user input:

- `tel:` — phone field. Browsers reject malformed URIs and won't execute embedded scripts; `tel:javascript:alert(1)` opens the dialer with the literal string, not as code.
- `mailto:` — email field. Same protection.
- Google Maps search URL — address field. We `encodeURIComponent(address)` before assigning to `href`, so `&`, `?`, `#`, and angle-brackets can't escape into the URL structure.

A user could still **type** a malicious-looking string like `<script>alert(1)</script>` into the address field — but it renders as text content (TextNode) and the `href` carries the URL-encoded form. No execution path.

---

## Photo / IDB / file-name surfaces

- **`a.download = filename`** in `UI.downloadFile` — `filename` is built from the family title via `slugify()`. The browser strips control chars from `download` regardless. Safe.
- **Image `src`** — every photo is either a Blob URL (`URL.createObjectURL`, never user-provided) or a path under `assets/sample/`. No user-supplied URLs.
- **Avatar `<img alt="">`** — alt is empty string; not a user-text vector.
- **Image-export PNG metadata** — `image-export.js` uses canvas → `toBlob(image/png)`. PNGs we generate carry no metadata.

---

## Import path — JSON ingestion

`export-import.js`'s `replaceAll(parsed)` walks the parsed JSON through `normalizePerson` and assigns. Every field above ends up rendered through the same TextNode path. **A malicious JSON file with `<script>` in a `description` field renders as the literal text in the inspector** — not as a script tag. Confirmed by trace.

`migrateLegacy()` re-encodes any base64 photos through the canvas pipeline before writing them to IDB, so an EXIF-poisoned imported photo has its metadata stripped on the way in.

---

## What would break this audit

A future change that:

1. Reintroduces a `html` attribute on `UI.el` (or any other helper) that takes a string and assigns it to `innerHTML`.
2. Adds a "rich text" feature without going through a sanitiser like DOMPurify.
3. Renders a person field via template-literal-into-`innerHTML` for a "performance" reason.
4. Builds a deep-link without `encodeURIComponent`.
5. Removes the `getField()` indirection and reads raw fields without considering language.

If you're a future contributor reviewing a PR that does any of these — push back. The bar is "every user string reaches the DOM as TextNode or `.value`". No exceptions without an explicit security review.

---

## Re-verification commands

```sh
# 1. Confirm UI.el has no html branch.
grep -n 'k === "html"' lib/ui/dom.js
# Expect: no matches.

# 2. Confirm no innerHTML calls take user data.
grep -rn 'innerHTML' lib/
# Expect: only `innerHTML = ""` clearings (~6 sites). Each one assigns the empty string; none assigns a user-controlled value.

# 3. Confirm no insertAdjacentHTML / outerHTML / document.write / eval / new Function.
grep -rEn 'insertAdjacentHTML|outerHTML|document\.write|\beval\(|new Function' lib/
# Expect: no matches.

# 4. Confirm encoded URL building for the address deep-link.
grep -rn 'encodeURIComponent' lib/
# Expect: at least one hit in inspector.js for the address row.
```

Run these before every public release. They take ~5 seconds.
