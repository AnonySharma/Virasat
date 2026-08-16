# Kinship terms — review sheet

This is the full vocabulary the **"how are they related to me"** feature can name
(`lib/features/kin-terms.js`). Please review the **Hindi** column and correct
anything that reads wrong for your family's usage — the code is the only place
these live, so a change here means a one-line edit there.

**How to read it**
- **Path** is the chain of hops from **you** to the other person: `U` = up to a
  parent, `D` = down to a child, `S` = across to a spouse. So `SUD` = your
  spouse → their parent → their child = your spouse's sibling.
- **Hindi = —** means there's no single distinct Hindi word, so the app shows
  the **English** word even in Hindi mode (an honest fallback, never a guess).
- Two rules keep it from ever guessing:
  1. **Seniority** (elder vs younger — ताऊ vs चाचा, जेठ vs देवर) is only asserted
     when **both** people have a birth year. Otherwise it falls back to the
     neutral term.
  2. **Side** (which uncle/aunt links a cousin; whether an in-law is on the
     husband's or wife's side) is only named when the linking person's gender is
     known. Otherwise it falls back to the plain word.
- Terms are also chosen by the **target's** gender (म = male form, स्त्री = female
  form). Where a relation has no single word for the whole family, only the
  gendered forms exist.

Anything **not** in this sheet (second cousins, great-grandparents, longer or
more exotic chains) shows **no term** — the app keeps its step-by-step path
instead of inventing a word.

---

## Direct family

| Path | English | Hindi | Notes |
|------|---------|-------|-------|
| `U`  | father  | पिता  | your parent, male |
| `U`  | mother  | माता  | your parent, female |
| `U`  | parent  | अभिभावक | parent, gender unknown |
| `D`  | son     | पुत्र  | your child, male |
| `D`  | daughter| पुत्री | your child, female |
| `D`  | child   | संतान | child, gender unknown |
| `S`  | husband | पति   | your spouse, male |
| `S`  | wife    | पत्नी  | your spouse, female |
| `S`  | spouse  | जीवनसाथी | spouse, gender unknown |

## Grandparents (`UU`) — side = the linking parent's gender

| English | Hindi | Which one |
|---------|-------|-----------|
| paternal grandfather | दादा | father's father |
| paternal grandmother | दादी | father's mother |
| maternal grandfather | नाना | mother's father |
| maternal grandmother | नानी | mother's mother |
| grandfather | — | side unknown |
| grandmother | — | side unknown |
| grandparent | — | side + gender unknown |

## Grandchildren (`DD`) — side = the linking child's gender

| English | Hindi | Which one |
|---------|-------|-----------|
| grandson      | पोता   | son's son |
| granddaughter | पोती   | son's daughter |
| grandson      | नाती   | daughter's son |
| granddaughter | नातिन  | daughter's daughter |
| grandson      | —     | side unknown |
| granddaughter | —     | side unknown |
| grandchild    | —     | side + gender unknown |

## Siblings (`UD`) — elder/younger only when both birth years are known

| English | Hindi |
|---------|-------|
| brother | भाई |
| sister  | बहन |
| elder brother   | बड़ा भाई |
| younger brother | छोटा भाई |
| elder sister    | बड़ी बहन |
| younger sister  | छोटी बहन |
| sibling | — |

## Parent's siblings (`UUD`) — the headline case

| English | Hindi | Which one |
|---------|-------|-----------|
| paternal uncle (elder)   | ताऊ  | father's **elder** brother — only when both years known |
| paternal uncle (younger) | चाचा | father's **younger** brother — only when both years known |
| paternal uncle | — | father's brother, seniority unknown |
| paternal aunt  | बुआ  | father's sister |
| maternal uncle | मामा | mother's brother |
| maternal aunt  | मौसी | mother's sister |
| uncle / aunt   | — | side unknown |

## Cousins (`UUDD`) — named by which uncle/aunt links them

Hindi names the four kinds by (your parent's side) × (the linking aunt/uncle),
with **-आ** for a male cousin and **-ई** for a female one. If either linking
person's gender is unknown, it falls back to plain **cousin (चचेरा/…)** → *cousin*.

| English | Hindi | Which one |
|---------|-------|-----------|
| cousin (paternal uncle's son)      | चचेरा भाई  | father's brother's son |
| cousin (paternal uncle's daughter) | चचेरी बहन  | father's brother's daughter |
| cousin (paternal aunt's son)       | फुफेरा भाई | father's sister's son |
| cousin (paternal aunt's daughter)  | फुफेरी बहन | father's sister's daughter |
| cousin (maternal uncle's son)      | ममेरा भाई  | mother's brother's son |
| cousin (maternal uncle's daughter) | ममेरी बहन  | mother's brother's daughter |
| cousin (maternal aunt's son)       | मौसेरा भाई | mother's sister's son |
| cousin (maternal aunt's daughter)  | मौसेरी बहन | mother's sister's daughter |
| cousin | — | linking side unknown |

## Sibling's children (`UDD`) — side = the sibling's gender

| English | Hindi | Which one |
|---------|-------|-----------|
| nephew | भतीजा | brother's son |
| niece  | भतीजी | brother's daughter |
| nephew | भांजा | sister's son |
| niece  | भांजी | sister's daughter |
| nephew / niece | — | side unknown |

---

## In-laws

### Spouse's parents (`SU`) and child's spouse (`DS`)

| Path | English | Hindi | Which one |
|------|---------|-------|-----------|
| `SU` | father-in-law | ससुर  | spouse's father |
| `SU` | mother-in-law | सास   | spouse's mother |
| `SU` | parent-in-law | —     | gender unknown |
| `DS` | son-in-law    | दामाद | daughter's/child's husband |
| `DS` | daughter-in-law | बहू | son's/child's wife |
| `DS` | child-in-law  | —     | gender unknown |

### Your own sibling's spouse (`UDS`)

| English | Hindi | Which one |
|---------|-------|-----------|
| brother's wife   | भाभी | your brother's wife |
| sister's husband | जीजा | your sister's husband |

### Spouse's siblings (`SUD`) — vocabulary depends on whether your spouse is a husband or a wife

| English | Hindi | Which one |
|---------|-------|-----------|
| husband's elder brother   | जेठ   | **only when both years known** |
| husband's younger brother | देवर  | **only when both years known** |
| husband's brother | — | seniority unknown |
| husband's sister  | ननद  | |
| wife's brother    | साला  | |
| wife's sister     | साली  | |
| brother/sister-in-law | — | spouse's gender unknown |

### Spouse's sibling's spouse (`SUDS`) — the co-in-laws

| English | Hindi | Which one |
|---------|-------|-----------|
| husband's elder brother's wife   | जेठानी | **only when both years known** |
| husband's younger brother's wife | देवरानी | **only when both years known** |
| husband's brother's wife | — | seniority unknown |
| husband's sister's husband | ननदोई | |
| wife's sister's husband    | साढ़ू  | |
| wife's brother's wife      | सलहज  | |

### Spouse's sibling's child (`SUDD`)

Treated as your own niece/nephew (भतीजा / भतीजी / भांजा / भांजी), keyed by the
linking sibling's gender — same words as the **Sibling's children** table above.

---

## Known limitations (by design)

- **Half-siblings** resolve as full brother/sister (भाई/बहन) — the everyday word
  covers both in common usage.
- **Step-relations, adoption** aren't distinguished — the graph doesn't record
  them yet.
- Terms beyond this sheet (great-grandparents, second cousins, spouse's cousins,
  etc.) show **no word** rather than a coined or approximate one.
- Regional variation is real (e.g. साढ़ू / साढू, ननदोई / नन्दोई). The forms here
  are the common Standard Hindi ones — flag any your family says differently.
