// @ts-check
/**
 * Auth store — the sign-in layer and the single "is cloud live?" gate.
 *
 * Contract (relied on by app.js and sign-in.js):
 *   Auth.ready()  → Promise<{ cloud, session, user }>, resolved ONCE.
 *                   { cloud:false } when config is empty OR the SDK can't
 *                   load — the app then boots local-only, exactly as before.
 *                   { cloud:true, session } (session may be null = signed out)
 *                   when the client is live.
 *
 * Design notes:
 *   • The Supabase SDK (~210 KB) is loaded LAZILY and only when
 *     VirasatConfig.isConfigured() — a local-only user never fetches it.
 *   • Nothing here runs at module-load time except defining functions, so
 *     booting under the Node smoke harness (no window.supabase) is a no-op.
 *   • Any failure (missing config, blocked CDN, SDK throw) degrades to
 *     cloud:false rather than rejecting — the offline app must always boot.
 *   • flowType 'pkce' returns `?code=` in the query, NOT `#access_token` in
 *     the hash, so the app's #tree/#people/#timeline hash router is untouched.
 */
(function (global) {
  "use strict";

  // Pinned SDK build + Subresource Integrity. Bump both together; recompute
  // the hash with:  openssl dgst -sha384 -binary supabase.js | openssl base64 -A
  const SDK_VERSION = "2.112.2";
  const SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@"
    + SDK_VERSION + "/dist/umd/supabase.js";
  const SDK_SRI = "sha384-OUpie84zd1LdwNlK9uJJQRwab0BLqo3eKYKFh7hSVL58FSk7wPp2l0kfUMIIoaQd";
  const SDK_LOAD_TIMEOUT_MS = 12000;

  const cfg = global.VirasatConfig || null;

  let client = null;            // the Supabase client, once created
  let readyPromise = null;      // memoised — ready() resolves exactly once
  let currentSession = null;    // cached session snapshot (null = signed out)
  const listeners = new Set();  // onAuthChange subscribers

  function cloudEnabled() {
    return !!(cfg && typeof cfg.isConfigured === "function" && cfg.isConfigured());
  }

  // Inject the UMD bundle as a classic <script> with SRI. Resolves with the
  // global `supabase` factory, or rejects on error/timeout. Idempotent: if a
  // build (or a static tag) already exposed window.supabase, use it.
  function loadSdk() {
    if (global.supabase && typeof global.supabase.createClient === "function") {
      return Promise.resolve(global.supabase);
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
      const timer = setTimeout(
        () => done(reject, new Error("supabase SDK load timed out")),
        SDK_LOAD_TIMEOUT_MS
      );
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.integrity = SDK_SRI;
      script.crossOrigin = "anonymous";
      script.async = true;
      script.onload = () => {
        clearTimeout(timer);
        if (global.supabase && typeof global.supabase.createClient === "function") {
          done(resolve, global.supabase);
        } else {
          done(reject, new Error("supabase SDK loaded but createClient missing"));
        }
      };
      script.onerror = () => { clearTimeout(timer); done(reject, new Error("supabase SDK failed to load")); };
      document.head.appendChild(script);
    });
  }

  // The redirect target for OAuth / magic-link: this exact page, minus any
  // query or hash. On GitHub Pages this preserves the "/Virasat/" path.
  function redirectTo() {
    try { return global.location.origin + global.location.pathname; }
    catch (_) { return undefined; }
  }

  function notify() {
    listeners.forEach((fn) => { try { fn(currentSession); } catch (e) { console.error(e); } });
  }

  // Build the client, restore any existing session, wire the auth-change
  // stream, and claim any pending invites. Throws are caught by ready().
  async function initClient(sdk) {
    client = sdk.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    const { data } = await client.auth.getSession();
    currentSession = (data && data.session) || null;

    // Stream future changes (sign-in, sign-out, token refresh) to subscribers.
    client.auth.onAuthStateChange((event, session) => {
      currentSession = session || null;
      notify();
      // A fresh sign-in is the moment to pick up any email invites that were
      // sent before this account existed. Fire-and-forget; never blocks UI.
      if (event === "SIGNED_IN") { claimInvites().catch(() => {}); }
    });

    // Also claim on a returning session (page reload while already signed in).
    if (currentSession) { claimInvites().catch(() => {}); }
  }

  function ready() {
    if (readyPromise) return readyPromise;
    if (!cloudEnabled()) {
      readyPromise = Promise.resolve({ cloud: false, session: null, user: null });
      return readyPromise;
    }
    readyPromise = loadSdk()
      .then(initClient)
      .then(() => ({ cloud: true, session: currentSession, user: currentSession && currentSession.user || null }))
      .catch((err) => {
        // CDN blocked, bad config, SDK threw — fall back to local-only so the
        // app still boots. Surfaced as a warning, not a crash.
        console.warn("Cloud disabled — running local-only:", err && err.message || err);
        client = null;
        return { cloud: false, session: null, user: null };
      });
    return readyPromise;
  }

  // — Sign-in methods (all three the user asked for) ——————————————————

  function requireClient() {
    if (!client) throw new Error("Cloud is not enabled");
    return client;
  }

  async function signInWithPassword(email, password) {
    const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signUpWithPassword(email, password, firstName) {
    const name = String(firstName || "").trim();
    const { data, error } = await requireClient().auth.signUp({
      email, password,
      options: {
        emailRedirectTo: redirectTo(),
        // Stored on the user as user_metadata.first_name — we address people
        // by it in the greeting instead of showing a raw email. `name` mirrors
        // it so Supabase's own templates (and the OAuth-provided `name`) line
        // up on one field the UI can read.
        data: name ? { first_name: name, name } : undefined
      }
    });
    if (error) throw error;
    return data;
  }

  // Best first name we can show for the signed-in user: the explicit
  // first_name captured at sign-up, else the first token of an OAuth-provided
  // full name (Google), else null (magic-link users never gave one → callers
  // fall back to a generic greeting).
  function getFirstName() {
    const u = (currentSession && currentSession.user) || null;
    const m = (u && u.user_metadata) || {};
    const explicit = m.first_name && String(m.first_name).trim();
    if (explicit) return explicit;
    const full = (m.name || m.full_name) && String(m.name || m.full_name).trim();
    if (full) return full.split(/\s+/)[0];
    return null;
  }

  async function signInWithMagicLink(email) {
    const { data, error } = await requireClient().auth.signInWithOtp({
      email, options: { emailRedirectTo: redirectTo() }
    });
    if (error) throw error;
    return data;
  }

  async function signInWithGoogle() {
    const { data, error } = await requireClient().auth.signInWithOAuth({
      provider: "google", options: { redirectTo: redirectTo() }
    });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw error;
    currentSession = null;
    notify();
  }

  // Claim any tree_invites addressed to this account's email. Idempotent
  // server-side (SECURITY DEFINER RPC). Returns the number newly claimed.
  async function claimInvites() {
    if (!client) return 0;
    const { data, error } = await client.rpc("claim_invites");
    if (error) { console.warn("claim_invites failed:", error.message); return 0; }
    return typeof data === "number" ? data : 0;
  }

  function onAuthChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  global.Auth = {
    ready,
    isCloud: () => !!client,
    client: () => client,
    getSession: () => currentSession,
    getUser: () => (currentSession && currentSession.user) || null,
    getFirstName,
    signInWithPassword,
    signUpWithPassword,
    signInWithMagicLink,
    signInWithGoogle,
    signOut,
    claimInvites,
    onAuthChange
  };
})(window);
