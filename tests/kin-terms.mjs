#!/usr/bin/env node
// Unit test for lib/features/kin-terms.js — the vernacular-kinship resolver.
//
// Boots i18n + data-store + kin-terms under the same minimal shim smoke.mjs
// uses, loads the sample family, and asserts KinTerms.forPath() names the
// exact relation for each close-kin path SHAPE. The two things worth testing
// are (1) the side/gender/seniority classification (chacha vs mama vs tau vs
// bua; dada vs nana) and (2) scope-fix #2: seniority is asserted ONLY when a
// birth year exists on both people — otherwise it must fall back to the
// neutral term, never guess elder/younger.
//
// Run: node tests/kin-terms.mjs   (exits 0 on pass, non-zero on any failure)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// --- minimal shim (subset of smoke.mjs — kin-terms touches no DOM) ----------
global.window = global;
global.window.addEventListener = () => {};
global.document = {
  documentElement: { setAttribute() {}, removeAttribute() {}, getAttribute() { return null; } },
  addEventListener() {},
  // I18n.setLang → applyToDOM walks the document; give it empty node lists.
  querySelector() { return null; },
  querySelectorAll() { return []; }
};
global.localStorage = (() => {
  const map = {};
  return { getItem: (k) => (k in map ? map[k] : null), setItem: (k, v) => { map[k] = String(v); }, removeItem: (k) => { delete map[k]; } };
})();

const boot = ["lib/core/i18n.js", "lib/core/data-store.js", "lib/features/kin-terms.js", "tests/sample-data.js"];
for (const f of boot) {
  new Function(fs.readFileSync(path.resolve(repoRoot, f), "utf8")).call(global);
}

const { FamilyStore, KinTerms, SampleData, I18n } = global;
const failures = [];
function check(name, cond) { if (!cond) failures.push(name); }

// Load the sample family into the store.
FamilyStore.replaceAll(SampleData.build());

// Resolve sample people by name → id (ids are internal, names are stable).
const byName = {};
FamilyStore.getPeople().forEach((p) => { byName[p.name] = p.id; });
function id(name) {
  if (!byName[name]) throw new Error("sample person not found: " + name);
  return byName[name];
}
// term(from, to) — the kin key for how `to` relates to `from`.
function term(fromName, toName) {
  const p = FamilyStore.findRelationPath(id(fromName), id(toName));
  const t = KinTerms.forPath(p);
  return t ? t.key : null;
}

// Sample tree (from tests/sample-data.js):
//   Ramesh (1935) + Sushila (1940)
//     ├─ Anil (1965) + Priya (1968) → Ankit (1995), Neha (1998)
//     ├─ Rohit (1970) + Anjali → Aditya (2001)
//     └─ Meera (1968, f)
//   Ankit's father is Anil; Anil's brothers are Rohit (younger) + the
//   comparison for elder uses Aditya→Anil (Anil elder than Rohit).

// ---- direct ----
check("Anil→Ankit = son",        term("Anil Sharma", "Ankit Sharma") === "son");
check("Ankit→Anil = father",     term("Ankit Sharma", "Anil Sharma") === "father");
check("Anil→Priya = wife",       term("Anil Sharma", "Priya Mehta") === "wife");

// ---- grandparents: paternal (dada/dadi) vs the term chosen by linking parent ----
check("Ankit→Ramesh = dada",     term("Ankit Sharma", "Ramesh Sharma") === "dada");
check("Ankit→Sushila = dadi",    term("Ankit Sharma", "Sushila Sharma") === "dadi");
// grandchild direction: Ramesh→Ankit through son Anil = pota (son's son)
check("Ramesh→Ankit = pota",     term("Ramesh Sharma", "Ankit Sharma") === "pota");

// ---- parent's siblings — the headline cases ----
// Ankit's father Anil; Anil's brother Rohit is YOUNGER (1970 > 1965) → chacha.
check("Ankit→Rohit = chacha",    term("Ankit Sharma", "Rohit Sharma") === "chacha");
// Aditya's father Rohit; Rohit's brother Anil is ELDER (1965 < 1970) → tau.
check("Aditya→Anil = tau",       term("Aditya Sharma", "Anil Sharma") === "tau");
// Ankit's father's sister Meera → bua (no seniority needed).
check("Ankit→Meera = bua",       term("Ankit Sharma", "Meera Sharma") === "bua");

// ---- sibling ----
check("Ankit→Neha = sister",     ["sister", "youngerSister", "elderSister"].includes(term("Ankit Sharma", "Neha Sharma")));
// Ankit (1995) elder than Neha (1998): from Neha, Ankit is elder brother.
check("Neha→Ankit = elderBrother", term("Neha Sharma", "Ankit Sharma") === "elderBrother");

// ---- niece/nephew: Anil→Aditya through brother Rohit (m) = bhatija ----
check("Anil→Aditya = bhatija",   term("Anil Sharma", "Aditya Sharma") === "bhatija");

// ---- in-law: Priya→Ramesh (husband's father) = sasur ----
check("Priya→Ramesh = sasur",    term("Priya Mehta", "Ramesh Sharma") === "sasur");

// ==== scope-fix #2: NEVER guess seniority when a birth year is missing ======
// Blank Rohit's birthDate and re-load: Ankit→Rohit must fall back from
// "chacha" (younger) to the neutral "paternalUncle", not silently pick one.
const data = SampleData.build();
const rohit = data.people.find((p) => p.name === "Rohit Sharma");
rohit.birthDate = null;
FamilyStore.replaceAll(data);
// rebuild name→id (replaceAll may re-normalize, ids are preserved from source)
FamilyStore.getPeople().forEach((p) => { byName[p.name] = p.id; });
check("no-year → paternalUncle (not chacha/tau)",
  term("Ankit Sharma", "Rohit Sharma") === "paternalUncle");

// Bilingual: the fallback still yields a label (English gloss) in both langs.
check("paternalUncle has hi=''(gloss)", (() => {
  const p = FamilyStore.findRelationPath(id("Ankit Sharma"), id("Rohit Sharma"));
  const t = KinTerms.forPath(p);
  return t && t.hi === "" && t.en === "paternal uncle";
})());

// label() honors language + gloss fallback.
I18n.setLang("hi");
check("label(hi) chip returns a string", (() => {
  FamilyStore.replaceAll(SampleData.build());
  FamilyStore.getPeople().forEach((p) => { byName[p.name] = p.id; });
  const p = FamilyStore.findRelationPath(id("Ankit Sharma"), id("Rohit Sharma"));
  return KinTerms.label(p) === "चाचा"; // hi word present
})());
I18n.setLang("en");

// ---- cousins: named by which aunt/uncle links them (UUDD) ----
// Ankit's father Anil and Aditya's father Rohit are brothers (both Ramesh's
// sons) → Aditya is Ankit's paternal-uncle's son → chachera bhai.
check("Ankit→Aditya = chacheraBhai", term("Ankit Sharma", "Aditya Sharma") === "chacheraBhai");

// ---- shapes still OUTSIDE the lexicon resolve to null ----
// Second cousins / longer chains have no single word. (No such pair exists in
// the sample tree; the synthetic block below covers the four cousin kinds.)

// ==== synthetic tree: MATERNAL side + in-laws the sample can't reach ========
// The sample family's mother (Priya) married in with no linked parents, so the
// maternal terms (mama / mausi / nana / nani) and the son's-wife / daughter's-
// husband in-law directions are unreachable there. Build a small symmetric tree
// with reciprocal spouse edges (the app's real invariant — setMarriage writes
// both sides) so BFS traverses spouses correctly.
(function maternalAndInLaws() {
  const P = (pid, o) => Object.assign({ id: pid, name: pid, parents: [], spouses: [] }, o);
  const sp = (a, b) => { a.spouses = [b.id]; b.spouses = [a.id]; };
  const MGF = P("MGF", { gender: "m", birthDate: "1932" });
  const MGM = P("MGM", { gender: "f", birthDate: "1936" });
  const MOM = P("M_MOM", { gender: "f", birthDate: "1962", parents: ["MGF", "MGM"] });
  const MAMA = P("M_MAMA", { gender: "m", birthDate: "1959", parents: ["MGF", "MGM"] });
  const MAUSI = P("M_MAUSI", { gender: "f", birthDate: "1966", parents: ["MGF", "MGM"] });
  // Paternal grandparents + DAD's siblings, so the four cousin kinds all exist.
  const PGF = P("PGF", { gender: "m", birthDate: "1930" });
  const PGM = P("PGM", { gender: "f", birthDate: "1934" });
  const DAD = P("M_DAD", { gender: "m", birthDate: "1960", parents: ["PGF", "PGM"] });
  const CHACHA = P("M_CHACHA", { gender: "m", birthDate: "1963", parents: ["PGF", "PGM"] });
  const BUA = P("M_BUA", { gender: "f", birthDate: "1967", parents: ["PGF", "PGM"] });
  const SELF = P("M_SELF", { gender: "m", birthDate: "1990", parents: ["M_DAD", "M_MOM"] });
  // one child under each aunt/uncle → the four cousin signatures (all UUDD)
  const CH_CHILD = P("M_CHCHILD", { gender: "m", birthDate: "1992", parents: ["M_CHACHA"] }); // chachera bhai
  const BUA_CHILD = P("M_BUACHILD", { gender: "f", birthDate: "1991", parents: ["M_BUA"] });  // fuferi bahen
  const MAMA_CHILD = P("M_MAMACHILD", { gender: "m", birthDate: "1993", parents: ["M_MAMA"] }); // mamera bhai
  const MAUSI_CHILD = P("M_MAUSICHILD", { gender: "f", birthDate: "1994", parents: ["M_MAUSI"] }); // mauseri bahen
  const WIFE = P("M_WIFE", { gender: "f", birthDate: "1991", parents: ["M_WF"] });
  const WF = P("M_WF", { gender: "m", birthDate: "1965" });
  const SON = P("M_SON", { gender: "m", birthDate: "2015", parents: ["M_SELF", "M_WIFE"] });
  const DAU = P("M_DAU", { gender: "f", birthDate: "2018", parents: ["M_SELF", "M_WIFE"] });
  const SONW = P("M_SONW", { gender: "f", birthDate: "2016" });
  const DAUH = P("M_DAUH", { gender: "m", birthDate: "2017" });
  sp(MGF, MGM); sp(PGF, PGM); sp(DAD, MOM); sp(SELF, WIFE); sp(SON, SONW); sp(DAU, DAUH);
  FamilyStore.replaceAll({ people: [
    MGF, MGM, PGF, PGM, MOM, MAMA, MAUSI, DAD, CHACHA, BUA, SELF,
    CH_CHILD, BUA_CHILD, MAMA_CHILD, MAUSI_CHILD, WIFE, WF, SON, DAU, SONW, DAUH
  ] });
  const kk = (a, b) => { const t = KinTerms.forPath(FamilyStore.findRelationPath(a, b)); return t ? t.key : null; };
  // maternal grandparents + uncle/aunt (side = mother's gender on the link)
  check("SELF→MGF = nana",   kk("M_SELF", "MGF") === "nana");
  check("SELF→MGM = nani",   kk("M_SELF", "MGM") === "nani");
  check("SELF→MAMA = mama",  kk("M_SELF", "M_MAMA") === "mama");
  check("SELF→MAUSI = mausi", kk("M_SELF", "M_MAUSI") === "mausi");
  // sister's-son direction: MAMA→SELF is his sister's son → bhanja
  check("MAMA→SELF = bhanja", kk("M_MAMA", "M_SELF") === "bhanja");
  // maternal-side grandchild: MGF→SELF through daughter MOM → nati
  check("MGF→SELF = nati",   kk("MGF", "M_SELF") === "nati");
  // the four cousin kinds (UUDD), named by (my parent's side × aunt/uncle gender)
  check("SELF→chacha's son = chacheraBhai",   kk("M_SELF", "M_CHCHILD") === "chacheraBhai");
  check("SELF→bua's daughter = fuferiBahen",  kk("M_SELF", "M_BUACHILD") === "fuferiBahen");
  check("SELF→mama's son = mameraBhai",       kk("M_SELF", "M_MAMACHILD") === "mameraBhai");
  check("SELF→mausi's daughter = mauseriBahen", kk("M_SELF", "M_MAUSICHILD") === "mauseriBahen");
  // in-laws (need reciprocal spouse edges to resolve)
  check("SELF→WF = sasur",   kk("M_SELF", "M_WF") === "sasur");
  check("SELF→SONW = bahu",  kk("M_SELF", "M_SONW") === "bahu");
  check("SELF→DAUH = damaad", kk("M_SELF", "M_DAUH") === "damaad");
  // son's-son / son's-daughter grandchild split
  check("SELF→SON = son",    kk("M_SELF", "M_SON") === "son");
})();

// ==== never-guess: unknown linking gender → plain "cousin", not a kind ======
(function cousinFallback() {
  const P = (pid, o) => Object.assign({ id: pid, name: pid, parents: [], spouses: [] }, o);
  // DAD's sibling UNC has NO gender recorded, so we can't tell chachera (his
  // brother's kid) from fufera (his sister's kid) → must fall back to "cousin".
  const GF = P("F_GF", { gender: "m", birthDate: "1930" });
  const DAD = P("F_DAD", { gender: "m", birthDate: "1960", parents: ["F_GF"] });
  const UNC = P("F_UNC", { birthDate: "1962", parents: ["F_GF"] }); // gender: null
  const SELF = P("F_SELF", { gender: "m", birthDate: "1990", parents: ["F_DAD"] });
  const COUSIN = P("F_COUSIN", { gender: "m", birthDate: "1991", parents: ["F_UNC"] });
  FamilyStore.replaceAll({ people: [GF, DAD, UNC, SELF, COUSIN] });
  const t = KinTerms.forPath(FamilyStore.findRelationPath("F_SELF", "F_COUSIN"));
  check("unknown-link cousin → plain cousin (not guessed)", t && t.key === "cousin");
})();

// --- report ---
if (failures.length) {
  console.error("kin-terms FAILED:");
  for (const f of failures) console.error("  • " + f);
  process.exit(1);
}
console.log("kin-terms ok — all kinship classifications correct");
