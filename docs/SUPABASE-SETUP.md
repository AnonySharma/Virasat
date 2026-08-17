# Supabase setup runbook — Virasat

Filled-in checklist for **this** project. Work top to bottom; steps 1–3 are
required before sign-in works, 5 is optional, and the keep-alive is a
later-but-don't-forget item.

- **Project ref:** `kogchpccsphiecitwaav`
- **Project URL:** `https://kogchpccsphiecitwaav.supabase.co`
- **Production site:** `https://anonysharma.github.io/Virasat/`
- **Local dev:** `http://localhost:8000/`

Credentials already live in `lib/auth/config.js` (the committed key is the
public **anon** key — safe to ship; RLS is the security boundary). So the app
already treats cloud as **ON**. What's missing is the database + auth config
below.

---

## 1. Run the schema  ▸ required

Dashboard → **SQL Editor** → **New query** → paste all of
[`supabase/schema.sql`](../supabase/schema.sql) → **Run**.

It's idempotent — if it errors partway, just fix and re-run; existing objects
are skipped.

**Verify:**
- **Table Editor** shows `trees`, `tree_members`, `tree_invites`.
- **Database → Functions** shows `claim_invites`, `is_tree_member`,
  `can_edit_tree`, `is_tree_owner`, `invite_to_tree`, `revoke_access`,
  `leave_tree`, and the redaction helpers `redact_contact`, `redact_person`,
  `get_tree` (the last three are defined but not yet called by the app — a
  staged fast-follow; creating them now is inert).
- **Storage** shows a **`tree-photos`** bucket marked **Private**.

---

## 2. Email + password  ▸ required

Dashboard → **Authentication → Providers → Email**:
- **Enable Email provider:** ON.
- **Confirm email:** turn **OFF while testing** — otherwise sign-up returns
  "check your email" instead of an immediate session. (Turn it back ON before
  real users sign up.)

---

## 3. URL configuration  ▸ required (for magic-link / Google; harmless for password)

Dashboard → **Authentication → URL Configuration**:
- **Site URL:** `https://anonysharma.github.io/Virasat/`
- **Redirect URLs** (add each):
  - `https://anonysharma.github.io/Virasat/**`
  - `http://localhost:8000/**`

The `/**` wildcards avoid trailing-slash / `index.html` mismatches. The app
uses PKCE, so the return lands as `?code=…` and never touches the app's hash
router.

---

## 4. Magic link  ▸ optional, works after step 3

Same Email provider — the OTP / magic-link path is on by default once Email is
enabled. Needs the redirect URLs from step 3. Test by entering an email and
clicking "Email me a sign-in link"; open the link **in the same browser**.

---

## 5. Google sign-in  ▸ optional, do later

1. Google Cloud Console → **APIs & Services → Credentials → Create OAuth client
   ID → Web application**.
2. **Authorized redirect URI:**
   `https://kogchpccsphiecitwaav.supabase.co/auth/v1/callback`
3. Copy the **Client ID** + **Client secret** into Supabase → **Authentication
   → Providers → Google** → enable + paste → save.

---

## 6. Test locally

```sh
python3 -m http.server 8000
# open http://localhost:8000/   (trailing slash — matches the redirect URL)
```

Expected: the **sign-in gate** appears (cloud is on). Create an account with
email + password → you land on the empty app. Sign out via the account menu
in the header.

After sign-in your tree lives in the cloud: edits sync across devices, and the
account menu's **Your trees** lets you keep several trees and share them by
email with view or edit access.

---

## Later — keep the free project awake  ▸ not blocking

Supabase free projects **pause after ~7 days with no API traffic**; the next
visitor then eats a multi-second cold start. A tiny GitHub Actions cron that
pings the REST endpoint every few days prevents it. This is already in the
repo as `.github/workflows/keep-alive.yml` (anon REST read every 3 days); all
that remains is to add the `SUPABASE_URL` and `SUPABASE_ANON_KEY` repo secrets
so the scheduled run can authenticate.

---

## Rollback / back to local-only

- `git checkout main` — `lib/auth/config.js` doesn't exist there, so the app
  boots as the offline PWA.
- Or blank the two values in `lib/auth/config.js` on this branch.
