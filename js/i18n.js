/**
 * Tiny i18n layer. EN/HI strings; persisted in localStorage.
 *
 * Usage in JS: I18n.t("people.title")
 * Usage in HTML: <span data-i18n="people.title"></span>
 *               <input data-i18n-placeholder="people.searchPlaceholder">
 *               <button data-i18n-title="actions.export">⬇</button>
 *
 * Listen for changes: I18n.onChange(fn)
 */
(function (global) {
  "use strict";

  const STORAGE_KEY = "familyTree.lang";

  const dict = {
    en: {
      app: { title: "Family Tree" },
      nav: { people: "People", tree: "Tree", timeline: "Timeline" },
      actions: {
        add: "Add person", addFirst: "Add first person",
        edit: "Edit", delete: "Delete", save: "Save", cancel: "Cancel",
        close: "Close", remove: "Remove",
        upload: "Upload photo", import: "Import", export: "Export",
        download: "Download", today: "Today", zoomIn: "Zoom in", zoomOut: "Zoom out",
        reset: "Reset", back: "Back", openProfile: "Open profile",
        collect: "Collect", language: "Language",
        autoTranslate: "Auto-translate", autoTranslateDesc: "Translate names and stories to Hindi when missing"
      },
      people: {
        title: "People",
        countOne: "1 member", countMany: "{n} members",
        searchPlaceholder: "Search by name…",
        emptyTitle: "Plant your family tree",
        emptyText: "Start by adding the first family member.",
        noMatchTitle: "No matches",
        noMatchText: "Try a different search.",
        ageLiving: "Age {n}", ageLived: "Lived {n} years",
        living: "Living", deceased: "Deceased"
      },
      form: {
        addTitle: "Add person", editTitle: "Edit person",
        name: "Name", birthDate: "Birth date", deathDate: "Death date",
        birthPlace: "Birth place", deathPlace: "Death place",
        gender: "Gender", genderM: "Male", genderF: "Female", genderO: "Other", genderNone: "—",
        notes: "Notes", parents: "Parents", spouses: "Spouses",
        datePlaceholder: "YYYY-MM-DD or YYYY",
        photoHint: "JPG, PNG. Auto-resized to 512px.",
        nameRequired: "Please enter a name.",
        saved: "Saved", removed: "Removed",
        deleteTitle: "Delete this person?",
        deleteMsg: "This will remove them from the tree and unlink them from any relations.",
        occupation: "Occupation",
        description: "About", descriptionHint: "A short biography or memory.",
        achievements: "Life achievements", achievementsHint: "One per line.",
        education: "Education", educationHint: "One per line."
      },
      tree: {
        title: "Family tree",
        subtitle: "Pinch or scroll to zoom · Drag to pan",
        legendLiving: "Living", legendDeceased: "Deceased", legendCouple: "Couple",
        emptyTitle: "No tree yet",
        emptyText: "Add people in the People view to see your tree."
      },
      timeline: {
        title: "Timeline",
        subtitle: "See who was alive at any point in your family's history.",
        emptyTitle: "Nothing on the timeline yet",
        emptyText: "Add birth dates to family members to see them here.",
        pxPerYear: "{n} px / year"
      },
      profile: {
        about: "About", achievements: "Life achievements", education: "Education",
        family: "Family", parents: "Parents", spouses: "Spouse(s)", children: "Children", siblings: "Siblings",
        born: "Born", died: "Died", in: "in",
        none: "Not recorded", emptyAchievements: "No achievements recorded yet.",
        emptyEducation: "No education details recorded yet.",
        emptyDescription: "No description added yet.",
        edit: "Edit profile"
      },
      exp: {
        title: "Export family tree",
        body: "Choose what to include. Your data stays on your device — this just creates a JSON file you can keep or share.",
        photos: "Include photos", photosDesc: "Embeds images as base64. Larger file.",
        dates: "Include dates", datesDesc: "Birth and death dates.",
        places: "Include locations", placesDesc: "Birth and death places.",
        format: "Format", formatFull: "JSON (full data)", formatMin: "JSON (minimal — names + relations only)",
        size: "Approx. file size: {s}",
        exported: "Exported {n} people"
      },
      imp: {
        invalid: "Couldn't read file: not a valid export.",
        confirmTitle: "Import family tree?",
        confirmMsg: "This will replace your current tree ({a} people) with {b} people from the file. You can't undo this — consider exporting first.",
        confirmBtn: "Replace tree",
        imported: "Imported {n} people"
      },
      welcome: {
        title: "Welcome to your family tree",
        msg: "Looks like this is your first visit. Would you like to load a small sample family to explore the views? You can clear it anytime.",
        btn: "Load sample",
        loaded: "Sample family loaded"
      },
      collect: {
        title: "Collect family info",
        intro: "Send a Google Form link to relatives so they can fill in their details. When responses come in, download the spreadsheet as CSV and import it here.",
        step1Title: "1. Make your form",
        step1Body: "Open the Google Form template, save a copy, and share the link.",
        openTemplate: "Open template",
        copyLink: "Copy template link",
        step2Title: "2. Import responses (CSV)",
        step2Body: "After people submit, download the responses sheet as CSV (File → Download → CSV) and pick it here.",
        importCsv: "Import CSV responses",
        previewTitle: "Form questions preview",
        copyJson: "Copy form JSON",
        copied: "Copied to clipboard",
        importedCsv: "Imported {n} new people from CSV",
        csvInvalid: "Couldn't read CSV: missing required columns (at least Name)."
      },
      tx: {
        translatedTag: "auto-translated",
        translating: "Translating…",
        failed: "Translation failed",
        offlineNote: "Translation needs internet. Showing original text."
      }
    },
    hi: {
      app: { title: "पारिवारिक वृक्ष" },
      nav: { people: "सदस्य", tree: "वृक्ष", timeline: "समयरेखा" },
      actions: {
        add: "सदस्य जोड़ें", addFirst: "पहला सदस्य जोड़ें",
        edit: "संपादित करें", delete: "हटाएँ", save: "सहेजें", cancel: "रद्द करें",
        close: "बंद करें", remove: "हटाएँ",
        upload: "फ़ोटो अपलोड करें", import: "आयात", export: "निर्यात",
        download: "डाउनलोड", today: "आज", zoomIn: "ज़ूम इन", zoomOut: "ज़ूम आउट",
        reset: "रीसेट", back: "वापस", openProfile: "प्रोफ़ाइल खोलें",
        collect: "जानकारी एकत्र करें", language: "भाषा",
        autoTranslate: "स्वचालित अनुवाद", autoTranslateDesc: "उपलब्ध न होने पर नाम और कहानियाँ हिन्दी में अनुवादित करें"
      },
      people: {
        title: "परिवार के सदस्य",
        countOne: "1 सदस्य", countMany: "{n} सदस्य",
        searchPlaceholder: "नाम से खोजें…",
        emptyTitle: "अपना पारिवारिक वृक्ष शुरू करें",
        emptyText: "पहला सदस्य जोड़कर शुरुआत करें।",
        noMatchTitle: "कोई परिणाम नहीं",
        noMatchText: "कोई दूसरा नाम आज़माएँ।",
        ageLiving: "आयु {n}", ageLived: "{n} वर्ष जिए",
        living: "जीवित", deceased: "स्वर्गीय"
      },
      form: {
        addTitle: "नया सदस्य", editTitle: "सदस्य संपादित करें",
        name: "नाम", birthDate: "जन्म तिथि", deathDate: "मृत्यु तिथि",
        birthPlace: "जन्म स्थान", deathPlace: "मृत्यु स्थान",
        gender: "लिंग", genderM: "पुरुष", genderF: "महिला", genderO: "अन्य", genderNone: "—",
        notes: "टिप्पणियाँ", parents: "माता-पिता", spouses: "जीवनसाथी",
        datePlaceholder: "YYYY-MM-DD या YYYY",
        photoHint: "JPG, PNG. स्वचालित रूप से 512px तक छोटा कर दिया जाएगा।",
        nameRequired: "कृपया नाम दर्ज करें।",
        saved: "सहेजा गया", removed: "हटा दिया गया",
        deleteTitle: "क्या इस सदस्य को हटाएँ?",
        deleteMsg: "यह उन्हें वृक्ष से हटा देगा और सभी रिश्तों से अलग कर देगा।",
        occupation: "व्यवसाय",
        description: "परिचय", descriptionHint: "संक्षिप्त जीवनी या स्मृति।",
        achievements: "जीवन की उपलब्धियाँ", achievementsHint: "प्रत्येक पंक्ति में एक।",
        education: "शिक्षा", educationHint: "प्रत्येक पंक्ति में एक।"
      },
      tree: {
        title: "पारिवारिक वृक्ष",
        subtitle: "ज़ूम के लिए चिकोटी काटें या स्क्रॉल करें · खींचने के लिए ड्रैग करें",
        legendLiving: "जीवित", legendDeceased: "स्वर्गीय", legendCouple: "दंपत्ति",
        emptyTitle: "अभी तक कोई वृक्ष नहीं",
        emptyText: "वृक्ष देखने के लिए 'सदस्य' दृश्य में लोगों को जोड़ें।"
      },
      timeline: {
        title: "समयरेखा",
        subtitle: "देखें कि आपके परिवार के इतिहास के किस मोड़ पर कौन जीवित था।",
        emptyTitle: "समयरेखा में अभी कुछ नहीं है",
        emptyText: "यहाँ देखने के लिए सदस्यों में जन्म तिथि जोड़ें।",
        pxPerYear: "{n} px / वर्ष"
      },
      profile: {
        about: "परिचय", achievements: "जीवन की उपलब्धियाँ", education: "शिक्षा",
        family: "परिवार", parents: "माता-पिता", spouses: "जीवनसाथी", children: "संतान", siblings: "भाई-बहन",
        born: "जन्म", died: "निधन", in: "में",
        none: "दर्ज नहीं", emptyAchievements: "अभी तक कोई उपलब्धि दर्ज नहीं।",
        emptyEducation: "अभी तक शिक्षा का विवरण दर्ज नहीं।",
        emptyDescription: "अभी तक कोई विवरण नहीं जोड़ा गया।",
        edit: "प्रोफ़ाइल संपादित करें"
      },
      exp: {
        title: "पारिवारिक वृक्ष निर्यात करें",
        body: "चुनें कि क्या शामिल करना है। आपका डेटा आपके डिवाइस पर ही रहता है — यह बस एक JSON फ़ाइल बनाता है।",
        photos: "फ़ोटो शामिल करें", photosDesc: "तस्वीरें base64 में सम्मिलित। बड़ी फ़ाइल।",
        dates: "तिथियाँ शामिल करें", datesDesc: "जन्म और मृत्यु तिथियाँ।",
        places: "स्थान शामिल करें", placesDesc: "जन्म और मृत्यु स्थान।",
        format: "प्रारूप", formatFull: "JSON (पूरा डेटा)", formatMin: "JSON (केवल नाम और रिश्ते)",
        size: "लगभग फ़ाइल आकार: {s}",
        exported: "{n} सदस्य निर्यात किए गए"
      },
      imp: {
        invalid: "फ़ाइल नहीं पढ़ सका: मान्य निर्यात नहीं है।",
        confirmTitle: "वृक्ष आयात करें?",
        confirmMsg: "यह आपका वर्तमान वृक्ष ({a} सदस्य) फ़ाइल के {b} सदस्यों से बदल देगा। यह पूर्ववत नहीं किया जा सकता — पहले निर्यात कर लें।",
        confirmBtn: "वृक्ष बदलें",
        imported: "{n} सदस्य आयात किए गए"
      },
      welcome: {
        title: "आपके पारिवारिक वृक्ष में स्वागत है",
        msg: "लगता है यह आपकी पहली यात्रा है। क्या आप दृश्यों को देखने के लिए एक छोटा नमूना परिवार लोड करना चाहेंगे? आप इसे कभी भी हटा सकते हैं।",
        btn: "नमूना लोड करें",
        loaded: "नमूना परिवार लोड किया गया"
      },
      collect: {
        title: "पारिवारिक जानकारी एकत्र करें",
        intro: "रिश्तेदारों को Google Form का लिंक भेजें ताकि वे अपनी जानकारी भर सकें। जब उत्तर आ जाएँ, स्प्रेडशीट को CSV में डाउनलोड करें और यहाँ आयात करें।",
        step1Title: "1. अपना फ़ॉर्म बनाएँ",
        step1Body: "Google Form टेम्पलेट खोलें, उसकी प्रति सहेजें, और लिंक साझा करें।",
        openTemplate: "टेम्पलेट खोलें",
        copyLink: "लिंक कॉपी करें",
        step2Title: "2. उत्तर आयात करें (CSV)",
        step2Body: "लोगों के उत्तर देने के बाद, Sheet को CSV में डाउनलोड करें (File → Download → CSV) और यहाँ चुनें।",
        importCsv: "CSV उत्तर आयात करें",
        previewTitle: "फ़ॉर्म प्रश्न पूर्वावलोकन",
        copyJson: "फ़ॉर्म JSON कॉपी करें",
        copied: "क्लिपबोर्ड पर कॉपी किया",
        importedCsv: "CSV से {n} नए सदस्य आयात किए गए",
        csvInvalid: "CSV नहीं पढ़ सका: आवश्यक कॉलम (कम से कम नाम) नहीं मिला।"
      },
      tx: {
        translatedTag: "स्वतः अनुवादित",
        translating: "अनुवाद हो रहा है…",
        failed: "अनुवाद विफल",
        offlineNote: "अनुवाद के लिए इंटरनेट चाहिए। मूल पाठ दिखाया जा रहा है।"
      }
    }
  };

  let currentLang = (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && dict[saved]) return saved;
    } catch (e) {}
    const navLang = (navigator.language || "en").toLowerCase();
    return navLang.startsWith("hi") ? "hi" : "en";
  })();

  const listeners = new Set();

  function get(path) {
    const segs = String(path).split(".");
    let node = dict[currentLang];
    for (const s of segs) {
      if (node && typeof node === "object" && s in node) node = node[s];
      else { node = null; break; }
    }
    if (node == null) {
      // Fallback to EN
      let n = dict.en;
      for (const s of segs) {
        if (n && typeof n === "object" && s in n) n = n[s]; else { n = null; break; }
      }
      node = n;
    }
    return node == null ? path : node;
  }

  function format(template, vars) {
    if (typeof template !== "string" || !vars) return template;
    return template.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  }

  function t(path, vars) {
    const v = get(path);
    return format(v, vars);
  }

  function setLang(lang) {
    if (!dict[lang] || lang === currentLang) return;
    currentLang = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
    document.documentElement.setAttribute("lang", lang);
    applyToDOM();
    listeners.forEach((fn) => { try { fn(lang); } catch (e) { console.error(e); } });
  }

  function getLang() { return currentLang; }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  /**
   * Walk the DOM and apply data-i18n / data-i18n-placeholder / data-i18n-title.
   * Idempotent — call any time.
   */
  function applyToDOM(root) {
    const r = root || document;
    r.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      el.textContent = t(key);
    });
    r.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });
    r.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });
    r.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
    });
  }

  document.documentElement.setAttribute("lang", currentLang);

  global.I18n = { t, setLang, getLang, onChange, applyToDOM };
})(window);
