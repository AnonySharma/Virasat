// @ts-check
/**
 * KinTerms — name the exact Indian kinship relation for a relationship path.
 *
 * English "uncle / aunt / grandfather" collapses words that Hindi keeps
 * distinct by SIDE (paternal vs maternal) and SENIORITY (elder vs younger).
 * The graph already knows the topology; this module turns an ordered id
 * chain from `FamilyStore.findRelationPath(a, b)` into the one precise word
 * for how the LAST person relates to the FIRST — chacha vs mama, bua vs
 * mausi, tau vs chacha, dada vs nana.
 *
 * Read-only. Depends only on FamilyStore.getPerson / getYear. Deliberately
 * self-contained (bilingual lexicon lives here, not in i18n.js) so the
 * roadmapped "pin a self" engine can reuse the same resolver later.
 *
 * Two correctness rules baked in:
 *   1. Side + gender (chacha/mama, bua/mausi, dada/nana) is ALWAYS resolvable
 *      from the graph — no dates needed.
 *   2. The elder/younger split (tau vs chacha, elder/younger sibling) needs a
 *      birth YEAR on BOTH people. When either is unknown we NEVER guess — we
 *      fall back to the neutral term / English gloss.
 *
 * Public:
 *   KinTerms.forPath(idArray) -> { key, en, hi } | null   (structured)
 *   KinTerms.label(idArray)   -> localized string | null  (for chips)
 *
 * The lexicon covers close-kin signatures that have ONE fairly unambiguous
 * word, including the four cousin kinds Hindi names by the linking aunt/uncle
 * (chachera / fufera / mamera / mausera × bhai/bahen) and the spouse-side
 * in-laws that matter when someone married INTO the family (their whole world
 * is spouse-first S… paths): spouse's siblings (jeth/devar/nanad/saala/saali),
 * their spouses (jethani/devrani/nandoi/saadhu/salhaj), one's own siblings'
 * spouses (bhabhi/jija), and a spouse's sibling's child (bhatija/bhanja).
 * It also reaches up and out on the blood side: great-grandparents (par-dada /
 * par-nana line), a grandfather's elder/younger brother and his wife (bade /
 * chhote dada, badi / chhoti dadi), and the aunts/uncles who married in — a
 * parent's sibling's spouse (fufa, taai/chachi, mami, mausa).
 * Second cousins and anything longer resolve to null — the caller keeps its
 * per-hop arrows / step count for those.
 */
(function (global) {
  "use strict";

  // ---- lexicon -------------------------------------------------------------
  // Every entry is { en, hi }. `hi: ""` means "no distinct Hindi word — show
  // the English gloss even in Hindi mode" (the honest fallback, never a guess).
  // Hindi here is core kinship vocabulary, hand-written (not machine
  // translated), consistent with the app's no-auto-translate rule.
  const T = {
    // direct
    father:   { en: "father",   hi: "पिता" },
    mother:   { en: "mother",   hi: "माता" },
    parent:   { en: "parent",   hi: "अभिभावक" },
    son:      { en: "son",      hi: "बेटा" },
    daughter: { en: "daughter", hi: "बेटी" },
    child:    { en: "child",    hi: "संतान" },
    husband:  { en: "husband",  hi: "पति" },
    wife:     { en: "wife",     hi: "पत्नी" },
    spouse:   { en: "spouse",   hi: "जीवनसाथी" },
    // grandparents — English needs a "paternal/maternal" qualifier; Hindi has a word
    dada: { en: "paternal grandfather", hi: "दादा" },
    dadi: { en: "paternal grandmother", hi: "दादी" },
    nana: { en: "maternal grandfather", hi: "नाना" },
    nani: { en: "maternal grandmother", hi: "नानी" },
    grandfather: { en: "grandfather", hi: "" },
    grandmother: { en: "grandmother", hi: "" },
    grandparent: { en: "grandparent", hi: "" },
    // great-grandparents — paternal par-dada line / maternal par-nana line,
    // classified by the same first-link side as the grandparents above.
    parDada: { en: "paternal great-grandfather", hi: "परदादा" },
    parDadi: { en: "paternal great-grandmother", hi: "परदादी" },
    parNana: { en: "maternal great-grandfather", hi: "परनाना" },
    parNani: { en: "maternal great-grandmother", hi: "परनानी" },
    greatGrandfather: { en: "great-grandfather", hi: "" },
    greatGrandmother: { en: "great-grandmother", hi: "" },
    greatGrandparent:  { en: "great-grandparent", hi: "" },
    // grandfather's brother — bade (elder) / chhote (younger) dada on the
    // paternal line, nana on the maternal line; elder/younger only when both
    // birth years are known (never guess). His wife takes the feminine
    // badi/chhoti dadi (or nani). Any other grand-uncle/aunt (a grandmother's
    // sibling, a grandfather's sister) has no clean single word → English gloss.
    badeDada:   { en: "paternal grand-uncle (elder)",   hi: "बड़े दादा" },
    chhoteDada: { en: "paternal grand-uncle (younger)", hi: "छोटे दादा" },
    paternalGrandUncle: { en: "paternal grand-uncle", hi: "" },
    badeNana:   { en: "maternal grand-uncle (elder)",   hi: "बड़े नाना" },
    chhoteNana: { en: "maternal grand-uncle (younger)", hi: "छोटे नाना" },
    maternalGrandUncle: { en: "maternal grand-uncle", hi: "" },
    badiDadi:   { en: "paternal grand-uncle's wife (elder)",   hi: "बड़ी दादी" },
    chhotiDadi: { en: "paternal grand-uncle's wife (younger)", hi: "छोटी दादी" },
    paternalGrandUncleWife: { en: "paternal grand-uncle's wife", hi: "" },
    badiNani:   { en: "maternal grand-uncle's wife (elder)",   hi: "बड़ी नानी" },
    chhotiNani: { en: "maternal grand-uncle's wife (younger)", hi: "छोटी नानी" },
    maternalGrandUncleWife: { en: "maternal grand-uncle's wife", hi: "" },
    greatUncle: { en: "great-uncle", hi: "" },
    greatAunt:  { en: "great-aunt",  hi: "" },
    // grandchildren — English collapses the son's-side / daughter's-side split
    pota:  { en: "grandson",      hi: "पोता" },   // son's son
    poti:  { en: "granddaughter", hi: "पोती" },   // son's daughter
    nati:  { en: "grandson",      hi: "नाती" },   // daughter's son
    natin: { en: "granddaughter", hi: "नातिन" }, // daughter's daughter
    grandson:      { en: "grandson",      hi: "" },
    granddaughter: { en: "granddaughter", hi: "" },
    grandchild:    { en: "grandchild",    hi: "" },
    // siblings (elder/younger only when both years are known)
    brother:       { en: "brother",       hi: "भाई" },
    sister:        { en: "sister",        hi: "बहन" },
    sibling:       { en: "sibling",       hi: "" },
    elderBrother:  { en: "elder brother",   hi: "बड़ा भाई" },
    youngerBrother:{ en: "younger brother", hi: "छोटा भाई" },
    elderSister:   { en: "elder sister",    hi: "बड़ी बहन" },
    youngerSister: { en: "younger sister",  hi: "छोटी बहन" },
    // parent's siblings — the headline case
    tau:    { en: "paternal uncle (elder)",   hi: "ताऊ" },  // father's elder brother
    chacha: { en: "paternal uncle (younger)", hi: "चाचा" }, // father's younger brother
    paternalUncle: { en: "paternal uncle", hi: "" },          // seniority unknown → gloss
    bua:    { en: "paternal aunt", hi: "बुआ" },   // father's sister
    mama:   { en: "maternal uncle", hi: "मामा" }, // mother's brother
    mausi:  { en: "maternal aunt",  hi: "मौसी" }, // mother's sister
    uncle:  { en: "uncle", hi: "" },
    aunt:   { en: "aunt",  hi: "" },
    // parent's sibling's spouse — the aunt/uncle who married in. Father's
    // sister's husband → fufa; father's brother's wife → taai (elder) / chachi
    // (younger) by that brother's seniority (never guessed); mother's brother's
    // wife → mami; mother's sister's husband → mausa.
    fufa:   { en: "paternal aunt's husband",         hi: "फूफा" },
    taai:   { en: "paternal uncle's wife (elder)",   hi: "ताई" },
    chachi: { en: "paternal uncle's wife (younger)", hi: "चाची" },
    paternalUncleWife: { en: "paternal uncle's wife", hi: "" },
    mami:   { en: "maternal uncle's wife",   hi: "मामी" },
    mausa:  { en: "maternal aunt's husband", hi: "मौसा" },
    // sibling's children — English collapses brother's/sister's side
    bhatija: { en: "nephew", hi: "भतीजा" }, // brother's son
    bhatiji: { en: "niece",  hi: "भतीजी" }, // brother's daughter
    bhanja:  { en: "nephew", hi: "भांजा" },  // sister's son
    bhanji:  { en: "niece",  hi: "भांजी" },  // sister's daughter
    nephew:  { en: "nephew", hi: "" },
    niece:   { en: "niece",  hi: "" },
    // cousins — Hindi names the four kinds by which aunt/uncle links them,
    // with -आ/-ई adjective agreement for the cousin's own gender:
    //   father's brother's child  → चचेरा / चचेरी  (chachera / chacheri)
    //   father's sister's child   → फुफेरा / फुफेरी (fufera / fuferi)
    //   mother's brother's child  → ममेरा / ममेरी  (mamera / mameri)
    //   mother's sister's child   → मौसेरा / मौसेरी (mausera / mauseri)
    // Whenever a linking person's gender is unknown we can't tell which kind,
    // so we fall back to plain "cousin" rather than guess (same never-guess
    // rule as the tau/chacha seniority split).
    chacheraBhai:  { en: "cousin (paternal uncle's son)",    hi: "चचेरा भाई" },
    chacheriBahen: { en: "cousin (paternal uncle's daughter)", hi: "चचेरी बहन" },
    fuferaBhai:    { en: "cousin (paternal aunt's son)",     hi: "फुफेरा भाई" },
    fuferiBahen:   { en: "cousin (paternal aunt's daughter)", hi: "फुफेरी बहन" },
    mameraBhai:    { en: "cousin (maternal uncle's son)",    hi: "ममेरा भाई" },
    mameriBahen:   { en: "cousin (maternal uncle's daughter)", hi: "ममेरी बहन" },
    mauseraBhai:   { en: "cousin (maternal aunt's son)",     hi: "मौसेरा भाई" },
    mauseriBahen:  { en: "cousin (maternal aunt's daughter)", hi: "मौसेरी बहन" },
    cousin:        { en: "cousin", hi: "" },
    // in-laws — spouse's parents / child's spouse (unambiguous single words)
    sasur:  { en: "father-in-law", hi: "ससुर" }, // spouse's father
    saas:   { en: "mother-in-law", hi: "सास" },  // spouse's mother
    parentInLaw: { en: "parent-in-law", hi: "" },
    damaad: { en: "son-in-law",      hi: "दामाद" }, // daughter/child's husband
    bahu:   { en: "daughter-in-law", hi: "बहू" },   // son/child's wife
    childInLaw: { en: "child-in-law", hi: "" },
    // spouse's siblings — Hindi splits by whether the spouse is a husband or a
    // wife (so it keys on the SPOUSE's gender), and a husband's brother splits
    // by seniority (jeth = elder, devar = younger — same never-guess rule as
    // tau/chacha). When the spouse's gender is unknown we fall back to the
    // English brother/sister-in-law gloss rather than pick a side.
    jeth:   { en: "husband's elder brother",   hi: "जेठ" },
    devar:  { en: "husband's younger brother", hi: "देवर" },
    husbandsBrother: { en: "husband's brother", hi: "" }, // seniority unknown → gloss
    nanad:  { en: "husband's sister", hi: "ननद" },
    saala:  { en: "wife's brother",   hi: "साला" },
    saali:  { en: "wife's sister",    hi: "साली" },
    // spouse's sibling's spouse (co-in-laws)
    jethani: { en: "husband's elder brother's wife",   hi: "जेठानी" },
    devrani: { en: "husband's younger brother's wife", hi: "देवरानी" },
    husbandsBrotherWife: { en: "husband's brother's wife", hi: "" }, // seniority unknown → gloss
    nandoi:  { en: "husband's sister's husband", hi: "ननदोई" },
    saadhu:  { en: "wife's sister's husband",    hi: "साढ़ू" },
    salhaj:  { en: "wife's brother's wife",      hi: "सलहज" },
    // my own sibling's spouse
    bhabhi: { en: "brother's wife",   hi: "भाभी" },
    jija:   { en: "sister's husband", hi: "जीजा" },
    // neutral in-law glosses — used when the spouse's (or linking sibling's)
    // gender is unknown, so we can't name the exact side. English collapses
    // them anyway; Hindi shows the same gloss (no distinct word without side).
    broInLaw: { en: "brother-in-law", hi: "" },
    sisInLaw: { en: "sister-in-law",  hi: "" },
    siblingInLaw: { en: "sibling-in-law", hi: "" }
  };

  function store() { return global.FamilyStore; }
  function person(id) { const s = store(); return s && s.getPerson ? s.getPerson(id) : null; }
  function gender(id) { const p = person(id); return p ? p.gender : null; }
  function year(id) {
    const s = store(), p = person(id);
    if (!s || !s.getYear || !p) return null;
    return s.getYear(p.birthDate);
  }

  // One hop's direction, walking from x to y:
  //   "U" — y is x's parent  (stepped up a generation)
  //   "D" — y is x's child   (stepped down)
  //   "S" — y is x's spouse  (lateral, same generation)
  //   "?" — not one of the graph's edge kinds → not classifiable
  function hopKind(x, y) {
    const px = person(x), py = person(y);
    if (!px || !py) return "?";
    if ((px.parents || []).includes(y)) return "U";
    if ((py.parents || []).includes(x)) return "D";
    if ((px.spouses || []).includes(y)) return "S";
    return "?";
  }

  // Pick a gendered term by the TARGET's gender code ("m"|"f"|"o"|null),
  // falling back to a neutral key when gender is missing/other.
  function byGender(g, maleKey, femaleKey, neutralKey) {
    if (g === "m") return T[maleKey];
    if (g === "f") return T[femaleKey];
    return T[neutralKey];
  }

  // "elder" | "younger" | null — null whenever EITHER year is missing, so a
  // seniority split is only ever asserted on real data (scope-fix #2).
  function seniority(targetId, refId) {
    const a = year(targetId), b = year(refId);
    if (a == null || b == null) return null;
    if (a < b) return "elder";
    if (a > b) return "younger";
    return null; // same year — don't assert either way
  }

  /**
   * @param {string[]} path ordered id chain from findRelationPath(a, b)
   * @returns {{key:string, en:string, hi:string}|null} how path[last] relates
   *          to path[0], or null for shapes outside the close-kin lexicon.
   */
  function forPath(path) {
    if (!Array.isArray(path) || path.length < 2) return null;
    const hops = [];
    for (let i = 0; i < path.length - 1; i++) {
      const k = hopKind(path[i], path[i + 1]);
      if (k === "?") return null; // unknown edge (e.g. pet tether) → no term
      hops.push(k);
    }
    const sig = hops.join("");
    const B = path[path.length - 1];   // the person being named
    const gB = gender(B);
    let term = null, key = null;

    switch (sig) {
      // ---- direct ----
      case "U": term = byGender(gB, "father", "mother", "parent"); break;
      case "D": term = byGender(gB, "son", "daughter", "child"); break;
      case "S": term = byGender(gB, "husband", "wife", "spouse"); break;

      // ---- grandparents: side = gender of the linking parent path[1] ----
      case "UU": {
        const side = gender(path[1]);
        if (side === "m") term = byGender(gB, "dada", "dadi", "grandparent");
        else if (side === "f") term = byGender(gB, "nana", "nani", "grandparent");
        else term = byGender(gB, "grandfather", "grandmother", "grandparent");
        break;
      }

      // ---- great-grandparents: paternal (par-dada) / maternal (par-nana)
      //      line, by the same first-link side as UU. ----
      case "UUU": {
        const side = gender(path[1]);
        if (side === "m") term = byGender(gB, "parDada", "parDadi", "greatGrandparent");
        else if (side === "f") term = byGender(gB, "parNana", "parNani", "greatGrandparent");
        else term = byGender(gB, "greatGrandfather", "greatGrandmother", "greatGrandparent");
        break;
      }

      // ---- grandparent's sibling (UUUD): path[2]=my grandparent, path[4]=their
      //      sibling. A grandFATHER's brother is bade/chhote dada (paternal) or
      //      nana (maternal), elder/younger vs that grandfather — never guessed.
      //      Any other grand-uncle/aunt has no clean word → great-uncle/aunt gloss.
      case "UUUD": {
        const side = gender(path[1]); // paternal (m) / maternal (f)
        const gp = gender(path[2]);   // the grandparent whose sibling this is
        const rank = seniority(path[4], path[2]); // sibling vs that grandparent
        if (gB === "m" && gp === "m" && side === "m") {
          term = rank === "elder" ? T.badeDada : rank === "younger" ? T.chhoteDada : T.paternalGrandUncle;
        } else if (gB === "m" && gp === "m" && side === "f") {
          term = rank === "elder" ? T.badeNana : rank === "younger" ? T.chhoteNana : T.maternalGrandUncle;
        } else {
          term = byGender(gB, "greatUncle", "greatAunt", "greatUncle");
        }
        break;
      }

      // ---- grandparent's sibling's spouse (UUUDS): grandfather's brother's wife
      //      is badi/chhoti dadi (paternal) or nani (maternal), by that brother's
      //      seniority. Mirrors UUUD; path[4]=the sibling, path[5]=their spouse. ----
      case "UUUDS": {
        const side = gender(path[1]);
        const gp = gender(path[2]);
        const unc = gender(path[4]);              // the grand-uncle/aunt
        const rank = seniority(path[4], path[2]); // that sibling vs the grandparent
        if (unc === "m" && gp === "m" && side === "m") {
          term = rank === "elder" ? T.badiDadi : rank === "younger" ? T.chhotiDadi : T.paternalGrandUncleWife;
        } else if (unc === "m" && gp === "m" && side === "f") {
          term = rank === "elder" ? T.badiNani : rank === "younger" ? T.chhotiNani : T.maternalGrandUncleWife;
        } else {
          term = byGender(gB, "greatUncle", "greatAunt", "greatUncle");
        }
        break;
      }

      // ---- grandchildren: side = gender of the linking child path[1] ----
      case "DD": {
        const side = gender(path[1]);
        if (side === "m") term = byGender(gB, "pota", "poti", "grandchild");
        else if (side === "f") term = byGender(gB, "nati", "natin", "grandchild");
        else term = byGender(gB, "grandson", "granddaughter", "grandchild");
        break;
      }

      // ---- siblings (through a shared parent). Elder/younger vs SELF, dates permitting.
      case "UD": {
        const rank = seniority(B, path[0]);
        if (gB === "m") term = rank === "elder" ? T.elderBrother : rank === "younger" ? T.youngerBrother : T.brother;
        else if (gB === "f") term = rank === "elder" ? T.elderSister : rank === "younger" ? T.youngerSister : T.sister;
        else term = T.sibling;
        break;
      }

      // ---- parent's siblings: side = gender of MY parent path[1] ----
      case "UUD": {
        const side = gender(path[1]);
        if (side === "m") {
          if (gB === "m") {
            // father's brother: tau (elder) / chacha (younger) — needs both years
            const rank = seniority(B, path[1]);
            term = rank === "elder" ? T.tau : rank === "younger" ? T.chacha : T.paternalUncle;
          } else if (gB === "f") term = T.bua;
          else term = T.uncle; // father's other-gender sibling — no clean word
        } else if (side === "f") {
          if (gB === "m") term = T.mama;
          else if (gB === "f") term = T.mausi;
          else term = T.aunt;
        } else {
          term = byGender(gB, "uncle", "aunt", "uncle");
        }
        break;
      }

      // ---- cousins: path[1]=my parent, path[3]=the linking aunt/uncle. ----
      // Hindi names the kind by (my parent's side) × (aunt/uncle's gender):
      //   father(m) + his brother(m)  → chachera    father(m) + his sister(f) → fufera
      //   mother(f) + her brother(m)  → mamera      mother(f) + her sister(f) → mausera
      // Then -आ/-ई by the cousin's own gender. If either linking gender is
      // unknown we can't name the kind → plain "cousin" (never guess).
      case "UUDD": {
        const side = gender(path[1]); // my parent's gender
        const link = gender(path[3]); // the aunt/uncle who is the cousin's parent
        if (side === "m" && link === "m") term = byGender(gB, "chacheraBhai", "chacheriBahen", "cousin");
        else if (side === "m" && link === "f") term = byGender(gB, "fuferaBhai", "fuferiBahen", "cousin");
        else if (side === "f" && link === "m") term = byGender(gB, "mameraBhai", "mameriBahen", "cousin");
        else if (side === "f" && link === "f") term = byGender(gB, "mauseraBhai", "mauseriBahen", "cousin");
        else term = T.cousin; // a linking gender missing → don't guess the kind
        break;
      }

      // ---- parent's sibling's spouse (UUDS): the aunt/uncle who married in.
      //      side = my parent's gender (path[1]); the linking sibling's gender
      //      (path[3]) picks the word. Father's sister's husband → fufa; father's
      //      brother's wife → taai/chachi by that brother's seniority (never
      //      guessed); mother's brother's wife → mami; mother's sister's husband
      //      → mausa. Off-pattern (e.g. a same-gender spouse) → uncle/aunt gloss.
      case "UUDS": {
        const side = gender(path[1]); // paternal (m) / maternal (f)
        const sib = gender(path[3]);  // my parent's sibling
        if (side === "m") {
          if (sib === "f") term = gB === "m" ? T.fufa : byGender(gB, "uncle", "aunt", "uncle");
          else if (sib === "m") {
            if (gB === "f") {
              const rank = seniority(path[3], path[1]); // that brother vs my father
              term = rank === "elder" ? T.taai : rank === "younger" ? T.chachi : T.paternalUncleWife;
            } else term = byGender(gB, "uncle", "aunt", "uncle");
          } else term = byGender(gB, "uncle", "aunt", "uncle");
        } else if (side === "f") {
          if (sib === "m") term = gB === "f" ? T.mami : byGender(gB, "uncle", "aunt", "uncle");
          else if (sib === "f") term = gB === "m" ? T.mausa : byGender(gB, "uncle", "aunt", "uncle");
          else term = byGender(gB, "uncle", "aunt", "uncle");
        } else {
          term = byGender(gB, "uncle", "aunt", "uncle");
        }
        break;
      }

      // ---- sibling's children: side = gender of the sibling path[2] ----
      case "UDD": {
        const side = gender(path[2]);
        if (side === "m") term = byGender(gB, "bhatija", "bhatiji", "nephew");
        else if (side === "f") term = byGender(gB, "bhanja", "bhanji", "nephew");
        else term = byGender(gB, "nephew", "niece", "nephew");
        break;
      }

      // ---- spouse's parent ----
      case "SU": term = byGender(gB, "sasur", "saas", "parentInLaw"); break;
      // ---- child's spouse ----
      case "DS": term = byGender(gB, "damaad", "bahu", "childInLaw"); break;

      // ---- my sibling's spouse: bhabhi (brother's wife) / jija (sister's husband) ----
      // side = gender of MY sibling path[2]; the word is fixed by whether that
      // sibling is a brother or sister, refined by the target's own gender.
      case "UDS": {
        const sib = gender(path[2]);
        if (sib === "m") term = byGender(gB, "broInLaw", "bhabhi", "siblingInLaw");   // brother's wife → bhabhi
        else if (sib === "f") term = byGender(gB, "jija", "sisInLaw", "siblingInLaw"); // sister's husband → jija
        else term = byGender(gB, "broInLaw", "sisInLaw", "siblingInLaw");
        break;
      }

      // ---- spouse's sibling. Whether I'm the husband or wife (gender of my
      //      spouse path[1]) picks the vocabulary; a husband's brother also
      //      splits by seniority (jeth elder / devar younger — never guess). ----
      case "SUD": {
        const sp = gender(path[1]); // is my spouse a husband (m) or a wife (f)?
        if (sp === "m") {           // husband's sibling
          if (gB === "m") {
            const rank = seniority(B, path[1]); // this brother vs my husband
            term = rank === "elder" ? T.jeth : rank === "younger" ? T.devar : T.husbandsBrother;
          } else if (gB === "f") term = T.nanad; // husband's sister
          else term = T.siblingInLaw;
        } else if (sp === "f") {    // wife's sibling
          if (gB === "m") term = T.saala;       // wife's brother
          else if (gB === "f") term = T.saali;  // wife's sister
          else term = T.siblingInLaw;
        } else {
          term = byGender(gB, "broInLaw", "sisInLaw", "siblingInLaw");
        }
        break;
      }

      // ---- spouse's sibling's child → treated as one's own niece/nephew,
      //      keyed by the linking sibling's gender path[3] (like UDD). ----
      case "SUDD": {
        const sib = gender(path[3]);
        if (sib === "m") term = byGender(gB, "bhatija", "bhatiji", "nephew");
        else if (sib === "f") term = byGender(gB, "bhanja", "bhanji", "nephew");
        else term = byGender(gB, "nephew", "niece", "nephew");
        break;
      }

      // ---- spouse's sibling's spouse (co-in-law). Keyed by my spouse's gender
      //      path[1] × the linking sibling's gender path[3]; husband's-brother's
      //      -wife splits by that brother's seniority (jethani/devrani). ----
      case "SUDS": {
        const sp = gender(path[1]);   // husband (m) or wife (f)?
        const sib = gender(path[3]);  // my spouse's sibling
        if (sp === "m") {             // husband's sibling's spouse
          if (sib === "m") {          // husband's brother's wife
            const rank = seniority(path[3], path[1]); // that brother vs my husband
            term = rank === "elder" ? T.jethani : rank === "younger" ? T.devrani : T.husbandsBrotherWife;
          } else if (sib === "f") term = T.nandoi; // husband's sister's husband
          else term = byGender(gB, "broInLaw", "sisInLaw", "siblingInLaw");
        } else if (sp === "f") {      // wife's sibling's spouse
          if (sib === "f") term = T.saadhu;      // wife's sister's husband
          else if (sib === "m") term = T.salhaj; // wife's brother's wife
          else term = byGender(gB, "broInLaw", "sisInLaw", "siblingInLaw");
        } else {
          term = byGender(gB, "broInLaw", "sisInLaw", "siblingInLaw");
        }
        break;
      }

      default: return null; // second cousins, longer chains → no chip
    }

    if (!term) return null;
    // Recover the lexicon key for callers/tests that want a stable id. `term`
    // is always a T member (byGender / direct T.* above), so this always
    // assigns; the cast tells the checker `key` is a string by this point.
    for (const k in T) { if (T[k] === term) { key = k; break; } }
    return { key: /** @type {string} */ (key), en: term.en, hi: term.hi };
  }

  /**
   * Localized single word for the chip, or null. Hindi falls back to the
   * English gloss when there's no distinct Hindi word (or I18n isn't loaded).
   * @param {string[]} path
   * @returns {string|null}
   */
  function label(path) {
    const t = forPath(path);
    if (!t) return null;
    const lang = (global.I18n && global.I18n.getLang) ? global.I18n.getLang() : "en";
    if (lang === "hi") return t.hi || t.en;
    return t.en;
  }

  global.KinTerms = { forPath: forPath, label: label };
})(window);
