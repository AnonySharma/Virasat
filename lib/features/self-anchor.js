// @ts-check
/**
 * SelfAnchor — remembers which person is "me", so every other relative can be
 * labelled by how they relate to you (paired with KinTerms).
 *
 * WHY THIS IS LOCAL-ONLY, NOT PART OF THE TREE STATE:
 *   Since cloud sync shipped, one tree can be opened by several people (owner +
 *   shared members). "Self" is a per-VIEWER lens, not a fact about the tree — my
 *   "me" is not your "me". If it lived in the synced `state` blob, whoever saved
 *   last would clobber everyone else's anchor. So it's stored in localStorage,
 *   keyed by the active tree id (mirroring data-store's per-tree cache key), and
 *   never travels to the backend.
 *
 * Read-only w.r.t. the family data. Depends on FamilyStore for the active tree
 * id + existence checks. Deliberately standalone (same shape as KinTerms) so the
 * inspector, tree, and any future perspective view can share one source of truth.
 *
 * Public:
 *   SelfAnchor.get()        -> person id | null   (null if unset or the person is gone)
 *   SelfAnchor.set(id)      -> void               (persists + notifies)
 *   SelfAnchor.clear()      -> void
 *   SelfAnchor.isSelf(id)   -> boolean
 *   SelfAnchor.onChange(fn) -> unsubscribe fn      (fn(currentSelfId))
 */
(function (global) {
  "use strict";

  const KEY_BASE = "familyTree.self";

  // Key by the active tree so each cloud tree remembers its own "me", and the
  // local-only tree keeps a plain key. Matches data-store's storageKeyFor shape.
  function storageKey() {
    const store = global.FamilyStore;
    const treeId = store && store.getActiveTreeId ? store.getActiveTreeId() : null;
    return treeId ? KEY_BASE + "." + treeId : KEY_BASE;
  }

  const listeners = new Set();
  function notify(id) {
    listeners.forEach((fn) => { try { fn(id); } catch (e) { console.error(e); } });
  }

  function rawGet() {
    try { return localStorage.getItem(storageKey()); } catch (e) { return null; }
  }

  /**
   * The pinned self id, or null. Returns null (and self-heals the stored value)
   * if the pinned person has since been deleted — so a stale id never drives a
   * label or a highlight.
   * @returns {string|null}
   */
  function get() {
    const id = rawGet();
    if (!id) return null;
    const store = global.FamilyStore;
    if (store && store.getPerson && !store.getPerson(id)) {
      // Person was removed — drop the dangling anchor QUIETLY, without firing
      // onChange. get() is called from inside consumers' render (e.g. the
      // inspector's selfChip), so a notify here would re-enter that render
      // mid-build and duplicate its output. The heal needs no broadcast anyway:
      // every consumer re-reads get() on its own next paint and sees null.
      try { localStorage.removeItem(storageKey()); } catch (e) {}
      return null;
    }
    return id;
  }

  function set(id) {
    if (!id) return;
    try { localStorage.setItem(storageKey(), id); } catch (e) {}
    notify(id);
  }

  function clear() {
    try { localStorage.removeItem(storageKey()); } catch (e) {}
    notify(null);
  }

  function isSelf(id) {
    return !!id && get() === id;
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  global.SelfAnchor = { get: get, set: set, clear: clear, isSelf: isSelf, onChange: onChange };
})(window);
