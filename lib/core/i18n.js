// @ts-check
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
      app: { title: "Virasat", tagline: "Your family's living legacy" },
      nav: { people: "People", tree: "Tree", timeline: "Timeline" },
      actions: {
        add: "Add person", addFirst: "Add first person",
        edit: "Edit", delete: "Delete", save: "Save", cancel: "Cancel",
        close: "Close", remove: "Remove", discard: "Discard",
        upload: "Upload photo", import: "Import", export: "Export",
        download: "Download", today: "Today", zoomIn: "Zoom in", zoomOut: "Zoom out",
        reset: "Reset", back: "Back", openProfile: "Open profile",
        collect: "Collect", collectVia: "Collect via Google Form",
        language: "Language", theme: "Theme",
        lightMode: "Light mode", darkMode: "Dark mode",
        openMenu: "Open menu", moreActions: "More actions",
        closeDetails: "Close details", searchPeople: "Search people",
        clearSearch: "Clear search",
        autoTranslate: "Auto-translate", autoTranslateDesc: "Translate names and stories to Hindi when missing"
      },
      common: { present: "present" },
      date: { circa: "c. {year}", before: "before {year}", after: "after {year}" },
      datePicker: {
        inputLabel: "Date", openCalendar: "Open calendar", chooseDate: "Choose date",
        prevMonth: "Previous month", nextMonth: "Next month", yearLabel: "Year",
        yearOnly: "Year only", today: "Today", clear: "Clear",
        title: "{month} {year}", dayAria: "{month} {day}, {year}",
        months: ["January","February","March","April","May","June","July","August","September","October","November","December"],
        weekdays: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]
      },
      path: {
        title: "Find a relation",
        hint: "Pick two relatives — Virasat will trace the shortest chain between them through parents, children, and spouses.",
        from: "From", to: "To", swap: "Swap", swapAria: "Swap people",
        needTwo: "Add at least two people to find a relation.",
        samePerson: "Same person — pick someone different.",
        noRelation: "No relation found through the family graph. They might be from separate branches that haven't been linked yet.",
        stepOne: "1 step", stepMany: "{n} steps",
        openProfile: "Show {name} in the tree"
      },
      people: {
        title: "People",
        countOne: "1 member", countMany: "{n} members",
        resultOne: "1 result", resultMany: "{n} results", resultNone: "No results",
        searchPlaceholder: "Search by name…",
        searchAria: "Search people by name",
        untitledStory: "Untitled story",
        openStory: "Open story: {title} — by {name}",
        emptyTitle: "Plant your family tree",
        emptyText: "Start by adding the first family member.",
        noMatchTitle: "No matches",
        noMatchText: "Try a different search.",
        addFirst: "Add first person",
        readOnly: "You have view-only access — you can't change this tree.",
        missingBanner: "Showing {n} people missing {what}.",
        missingBirth: "a birth date", missingPhoto: "a photo", missingDesc: "a description",
        clearFilter: "Clear",
        allSetTitle: "All set", allSetText: "Every relative has this field filled in.",
        notFound: "Person not found",
        ageLiving: "Age {n}", ageLived: "Lived {n} years",
        living: "Living", deceased: "Deceased"
      },
      form: {
        addTitle: "Add person", editTitle: "Edit person",
        name: "Name", birthDate: "Birth date", deathDate: "Death date",
        birthPlace: "Birth place", deathPlace: "Death place",
        gender: "Gender", genderM: "Male", genderF: "Female", genderO: "Other", genderNone: "—",
        notes: "Notes", parents: "Parents", spouses: "Spouse(s)",
        father: "Father", mother: "Mother",
        fatherNone: "— No father selected —",
        motherNone: "— No mother selected —",
        spouseNone: "— No spouse —",
        addSpouse: "Add another spouse",
        datePlaceholder: "YYYY-MM-DD or YYYY",
        dateInvalid: "Please enter a date as YYYY, YYYY-MM, or YYYY-MM-DD.",
        dateOrderInvalid: "Birth date can't be after the death date.",
        dateFutureInvalid: "That date is in the future.",
        datePrecisionLabel: "{field} — date precision",
        essentials: "Essentials",
        moreDetails: "More details",
        photoHint: "JPG, PNG. Auto-resized to 512px.",
        nameRequired: "Please enter a name.",
        saved: "Saved", removed: "Removed",
        saveAddAnother: "Save & add another", savedAddAnother: "Saved — add the next person",
        discardTitle: "Discard changes?",
        discardMsg: "Your edits to this person will be lost.",
        deleteTitle: "Delete this person?",
        deleteMsg: "This will remove them from the tree and unlink them from any relations.",
        occupation: "Occupation",
        description: "About", descriptionHint: "A short biography or memory.",
        achievements: "Life achievements", achievementsHint: "One per line.",
        education: "Education", educationHint: "One per line.",
        namePlaceholder: "Full name",
        deathDatePlaceholder: "Leave blank if living",
        placePlaceholder: "City, Country",
        notesPlaceholder: "Stories, milestones, anything to remember…",
        occupationPlaceholder: "Engineer, Teacher, …",
        descriptionPlaceholder: "A short biography or memory…",
        achievementsPlaceholder: "First in family to graduate\nWon district cricket trophy 1982\n…",
        educationPlaceholder: "BA, Delhi University, 1968\nPhD, IIT Bombay, 1976\n…",
        precExact: "Exact", precAbout: "About (c.)", precBefore: "Before", precAfter: "After",
        required: "Required", optional: "optional",
        addHindi: "हिन्दी जोड़ें", addHindiAria: "Add Hindi for {label}",
        contact: "Contact", contactHint: "Phone, email, address. Mark any field private to keep it out of exports.",
        phonePlaceholder: "+91 …", addressPlaceholder: "Street, city, pincode",
        phoneLabel: "Phone", emailLabel: "Email", addressLabel: "Address",
        private: "Private", privateHint: "Hide from JSON / PNG / poster exports",
        privateExportOnly: "Hidden from exports (still visible to people with access)",
        petLabel: "Companion animal (cat, dog, etc.)",
        relationsEmpty: "Add other people first to link relations",
        reframe: "Reframe", removeSpouse: "Remove",
        noPhotoReframe: "No photo to reframe.", cropsSaved: "Crops saved", saveFailed: "Save failed"
      },
      tree: {
        title: "Our family tree",
        subtitle: "Pinch or scroll to zoom · Drag to pan",
        memberOne: "1 member", memberMany: "{n} members",
        generationOne: "1 generation", generationMany: "{n} generations",
        addPerson: "Add person",
        panHint: "Drag to pan · Scroll to zoom · Right-click a person for more",
        touchMenuHint: "Tip: press and hold anyone for more actions.",
        legendLiving: "Living", legendDeceased: "Deceased", legendCouple: "Couple",
        emptyTitle: "Plant your family tree",
        emptyText: "Add people from the rail to see them here.",
        viewingAs: "Viewing as",
        resetView: "Reset view",
        viewOptions: "View options",
        fitView: "Fit view",
        focusLineage: "Focus descendants",
        focusBloodline: "Focus bloodline",
        addRelative: "Add a relative",
        addRelativeAria: "Add a relative to {name}",
        yourTrees: "Your trees",
        active: "Active",
        loading: "Loading your trees…",
        empty: "No trees yet.",
        loadError: "Couldn't load your trees. Check your connection.",
        switchTo: "Switch to {name}",
        switched: "Switched to {name}",
        switchError: "Couldn't switch trees. Try again.",
        create: "New tree",
        createTitle: "Create a new tree",
        created: "New tree created.",
        createError: "Couldn't create the tree. Try again.",
        rename: "Rename",
        renameTitle: "Rename tree",
        renamed: "Tree renamed.",
        renameError: "Couldn't rename the tree. Try again.",
        delete: "Delete",
        deleteConfirm: "Delete \"{name}\"? This permanently removes the tree and its photos for everyone it's shared with. This can't be undone.",
        deleted: "Tree deleted.",
        deleteError: "Couldn't delete the tree. Try again.",
        nameLabel: "Tree name",
        namePlaceholder: "e.g. Sharma family tree",
        roleOwner: "Owner",
        roleEditor: "Editor",
        roleViewer: "Viewer",
        needSignIn: "Sign in to keep and switch between multiple trees."
      },
      timeline: {
        title: "Timeline",
        eyebrow: "A horizontal lifeline",
        titleWord: "timeline",
        titleFallback: "Family",
        present: "present",
        pxPerYearTitle: "Pixels per year",
        subtitle: "See who was alive at any point in your family's history.",
        emptyTitle: "Nothing on the timeline yet",
        emptyText: "Add birth dates to family members to see them here.",
        pxPerYear: "{n} px / year",
        pxPerYearShort: "{n} px/year",
        today: "TODAY"
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
      inspector: {
        emptyTitle: "Select a person",
        emptyText: "Click anyone in the tree, list, or timeline to see their details here.",
        secAbout: "About",
        secPersonal: "Personal information",
        secAchievements: "Life achievements",
        secEducation: "Education",
        secFamily: "Family",
        secPhoto: "Photo",
        secNotes: "Notes & memories",
        secStories: "Stories",
        emptyStories: "No stories yet — write one and it'll live here.",
        addStory: "Add a story",
        emptyAbout: "No biography written yet.",
        emptyList: "None recorded yet.",
        emptyFamily: "No family connections recorded yet.",
        emptyPhoto: "No photograph yet",
        actAddNote: "Add note", actSaveImage: "Save as image",
        actEdit: "Edit", actDelete: "Remove", actOpenInTree: "Show in tree",
        imageSaved: "Profile image saved",
        deleteTitle: "Remove {name}?",
        deleteMsg: "They'll be unlinked from any parent or spouse relations. This can't be undone.",
        born: "Born", died: "Died", lifespan: "Lifespan", age: "Age",
        gender: "Gender", occupation: "Occupation",
        addChild: "Add child", addSpouse: "Add spouse", addParent: "Add parent",
        marriageDetails: "Marriage details",
        editPhoto: "Edit photo",
        notesPlaceholder: "Stories, memories, things to remember about {name}…",
        created: "Created", updated: "Updated"
      },
      rail: {
        overview: "Overview", filter: "Filter", tools: "Tools", stats: "Tree statistics",
        anniversaries: "Coming up", maintenance: "Needs attention",
        needsBirth: "Missing birth date", needsPhoto: "Missing photo", needsDescription: "Missing description",
        findRelation: "Find a relation", printBook: "Print family book",
        trySample: "Try sample family",
        all: "All", living: "Living", deceased: "Deceased",
        addPerson: "Add person", addCouple: "Add couple", editTree: "Manage people", treeSettings: "Settings",
        reset: "Reset everything",
        resetTitle: "Reset everything?",
        resetMsg: "This permanently deletes every person, photo, and note in your tree on this device. Export first if you want to keep a copy.",
        resetConfirm: "Yes, delete it all",
        resetDone: "Tree reset",
        sampleTitle: "Load sample family?",
        sampleMsg: "This replaces your current tree with the 4-generation Sharma sample (14 people, 5 marriages, photos, stories). Export your data first if you want to keep it.",
        sampleConfirm: "Replace with sample",
        sampleLoaded: "Sample family loaded",
        sampleError: "Couldn't load sample: {msg}",
        sampleNotLoaded: "Sample data not loaded — refresh the page to retry.",
        members: "Members", generations: "Generations", surnames: "Surnames", memories: "Memories",
        viewAnalytics: "View analytics",
        legacyTitle: "Preserve your legacy",
        legacyBody: "Names, photos, and stories — saved on your device.",
        legacyCta: "Get started",
        legacyBodyCloud: "Names, photos, and stories — synced to the cloud and backed up.",
        legacyCtaCloud: "Download a backup"
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
      },
      auth: {
        title: "Sign in",
        subtitle: "Sign in to keep your family tree safe and in sync across your devices.",
        email: "Email", password: "Password",
        emailPlaceholder: "you@example.com", passwordPlaceholder: "Your password",
        signIn: "Sign in", createAccount: "Create account",
        firstName: "First name", firstNamePlaceholder: "e.g. Aanya",
        firstNameHint: "So we can greet you — you can change it later.",
        toSignUp: "New here? Create an account", toSignIn: "Have an account? Sign in",
        backToIntro: "Back",
        or: "or",
        google: "Continue with Google",
        magic: "Email me a sign-in link",
        checkEmailLink: "Check your email for a sign-in link.",
        checkEmailConfirm: "Almost there — check your email to confirm your account, then sign in.",
        account: "Account",
        greeting: "Hi, {name}",
        signedInAs: "Signed in as",
        editProfile: "Edit profile",
        emailReadonly: "Your sign-in email can't be changed here.",
        errNameRequired: "Please enter your name.",
        profileSaved: "Profile updated",
        signOut: "Sign out",
        signOutConfirm: "Sign out of Virasat? Your tree stays saved in the cloud and on this device.",
        errFields: "Enter your email and password.",
        errEmail: "Enter your email first.",
        errInvalid: "That email or password doesn't match. Try again, or use “Email me a sign-in link” below.",
        errExists: "An account with this email already exists — try signing in.",
        errRate: "Too many attempts — wait a minute and try again.",
        errNetwork: "Can't reach the server. Check your connection.",
        errUnconfirmed: "Almost there — check your email and click the confirmation link, then sign in.",
        errGeneric: "Something went wrong. Please try again."
      },
      share: {
        title: "Share",
        subtitle: "Give family access by email. We don't send an email — they get this tree automatically the moment they sign in to Virasat with that address.",
        emailLabel: "Email address",
        emailPlaceholder: "name@example.com",
        roleLabel: "Access",
        roleEditor: "Can edit",
        roleViewer: "View only",
        roleHelp: "View only can read everything but not change it. Can edit can add and edit people.",
        invite: "Grant access",
        invited: "{email} will see this tree when they sign in with that email.",
        inviteError: "Couldn't save the invite. Try again.",
        errEmail: "Enter a valid email address.",
        members: "People with access",
        membersLoading: "Loading…",
        membersError: "Couldn't load who has access.",
        pending: "Invited — not signed in yet",
        you: "You",
        owner: "Owner",
        editor: "Editor",
        viewer: "Viewer",
        remove: "Remove",
        removeConfirm: "Remove {email}'s access to this tree?",
        removed: "Access removed.",
        removeError: "Couldn't remove access. Try again.",
        cancelInvite: "Cancel invite",
        roleChanged: "Access updated.",
        roleChangeError: "Couldn't update access. Try again.",
        ownerOnly: "Only the tree's owner can invite or remove people.",
        viewerNote: "You have view-only access to this tree.",
        linkLabel: "App link",
        linkHint: "Send this to family so they can open Virasat and sign in with the email you added.",
        copyLink: "Copy link",
        copyInviteLink: "Copy invite link",
        linkCopied: "Link copied",
        linkCopyFail: "Couldn't copy — select and copy the link manually."
      },
      sync: {
        loadingTree: "Loading your tree…",
        conflict: "This tree changed on another device — the latest version is now shown.",
        saveBackup: "Save my version",
        reload: "Reload",
        dismiss: "Dismiss",
        backupSaved: "Your version was saved to Downloads.",
        backupEmpty: "Nothing to back up.",
        backupError: "Couldn't save the backup.",
        cloudUnreachable: "Couldn't reach the cloud — showing your last saved copy.",
        persistDenied: "Heads-up: storage isn't pinned on this browser. Export regularly.",
        stSynced: "Saved", stSyncedAria: "All changes saved to the cloud",
        stPending: "Saving…", stPendingAria: "Saving your changes to the cloud",
        stOffline: "Offline", stOfflineAria: "Offline — your changes will sync when you reconnect"
      },
      landing: {
        pitch: "A calm, private home for your family's names, photos, and stories — one living tree that grows across generations.",
        feature1Title: "Private & yours",
        feature1Body: "Only people you invite can see a tree. No public pages, no ads, no selling your family's data.",
        feature2Title: "On every device",
        feature2Body: "Sign in once and your tree follows you — phone, laptop, tablet — always the latest version.",
        feature3Title: "Share with family",
        feature3Body: "Invite relatives by email to view or help build the tree together, each with their own login.",
        getStarted: "Get started",
        haveAccount: "Already have an account? Sign in",
        footer: "Your data stays private — visible only to you and the family you invite."
      },
      firstRun: {
        title: "Create your first family tree",
        subtitle: "Give it a name to begin. You can rename it, add relatives, and share it any time.",
        nameLabel: "Tree name",
        namePlaceholder: "e.g. Sharma family tree",
        create: "Create tree",
        creating: "Creating…",
        createError: "Couldn't create the tree. Check your connection and try again.",
        or: "or",
        importTitle: "Import a backup",
        importBody: "Already have a Virasat export? Bring it in as your first tree.",
        sampleTitle: "Try a sample family",
        sampleBody: "Explore a small ready-made tree to see how everything works.",
        sampleName: "Sample family tree",
        sampleNotLoaded: "Sample data isn't loaded — refresh and try again.",
        deviceTitle: "We found a tree on this device",
        deviceBody: "Bring the {count}-person tree already saved in this browser into your account.",
        greeting: "Welcome, {name}",
        signOut: "Sign out",
        inviteHint: "Were you invited to a family tree? An invite only opens for the exact email it was sent to. You're signed in as {email} — if that's not the address the invite went to, sign out and sign back in with the right one.",
        inviteHintNoEmail: "Were you invited to a family tree? An invite only opens for the exact email it was sent to. If you signed in with a different address, sign out and sign back in with the invited one."
      }
    },
    hi: {
      app: { title: "विरासत", tagline: "आपके परिवार की जीवंत विरासत" },
      nav: { people: "सदस्य", tree: "वृक्ष", timeline: "समयरेखा" },
      actions: {
        add: "सदस्य जोड़ें", addFirst: "पहला सदस्य जोड़ें",
        edit: "संपादित करें", delete: "हटाएँ", save: "सहेजें", cancel: "रद्द करें",
        close: "बंद करें", remove: "हटाएँ", discard: "छोड़ें",
        upload: "फ़ोटो अपलोड करें", import: "आयात", export: "निर्यात",
        download: "डाउनलोड", today: "आज", zoomIn: "ज़ूम इन", zoomOut: "ज़ूम आउट",
        reset: "रीसेट", back: "वापस", openProfile: "प्रोफ़ाइल खोलें",
        collect: "जानकारी एकत्र करें", collectVia: "Google फ़ॉर्म से एकत्र करें",
        language: "भाषा", theme: "थीम",
        lightMode: "लाइट मोड", darkMode: "डार्क मोड",
        openMenu: "मेन्यू खोलें", moreActions: "और विकल्प",
        closeDetails: "विवरण बंद करें", searchPeople: "सदस्य खोजें",
        clearSearch: "खोज साफ़ करें",
        autoTranslate: "स्वचालित अनुवाद", autoTranslateDesc: "उपलब्ध न होने पर नाम और कहानियाँ हिन्दी में अनुवादित करें"
      },
      common: { present: "अब तक" },
      date: { circa: "लगभग {year}", before: "{year} से पहले", after: "{year} के बाद" },
      datePicker: {
        inputLabel: "तिथि", openCalendar: "कैलेंडर खोलें", chooseDate: "तिथि चुनें",
        prevMonth: "पिछला माह", nextMonth: "अगला माह", yearLabel: "वर्ष",
        yearOnly: "केवल वर्ष", today: "आज", clear: "साफ़ करें",
        title: "{month} {year}", dayAria: "{day} {month} {year}",
        months: ["जनवरी","फ़रवरी","मार्च","अप्रैल","मई","जून","जुलाई","अगस्त","सितंबर","अक्तूबर","नवंबर","दिसंबर"],
        weekdays: ["रवि","सोम","मंगल","बुध","गुरु","शुक्र","शनि"]
      },
      path: {
        title: "रिश्ता खोजें",
        hint: "दो सदस्य चुनें — विरासत माता-पिता, संतान और जीवनसाथी के ज़रिए उनके बीच सबसे छोटी कड़ी खोजेगा।",
        from: "से", to: "तक", swap: "अदला-बदली", swapAria: "व्यक्तियों की अदला-बदली करें",
        needTwo: "रिश्ता खोजने के लिए कम से कम दो लोग जोड़ें।",
        samePerson: "एक ही व्यक्ति — कोई अलग व्यक्ति चुनें।",
        noRelation: "परिवार ग्राफ़ में कोई रिश्ता नहीं मिला। हो सकता है वे अलग शाखाओं से हों जिन्हें अभी जोड़ा नहीं गया है।",
        stepOne: "1 कदम", stepMany: "{n} कदम",
        openProfile: "{name} को वृक्ष में दिखाएँ"
      },
      people: {
        title: "परिवार के सदस्य",
        countOne: "1 सदस्य", countMany: "{n} सदस्य",
        resultOne: "1 परिणाम", resultMany: "{n} परिणाम", resultNone: "कोई परिणाम नहीं",
        searchPlaceholder: "नाम से खोजें…",
        searchAria: "नाम से सदस्य खोजें",
        untitledStory: "बिना शीर्षक की कहानी",
        openStory: "कहानी खोलें: {title} — {name} द्वारा",
        emptyTitle: "अपना पारिवारिक वृक्ष शुरू करें",
        emptyText: "पहला सदस्य जोड़कर शुरुआत करें।",
        noMatchTitle: "कोई परिणाम नहीं",
        noMatchText: "कोई दूसरा नाम आज़माएँ।",
        addFirst: "पहला सदस्य जोड़ें",
        readOnly: "आपके पास केवल-देखने की पहुँच है — आप इस वृक्ष को बदल नहीं सकते।",
        missingBanner: "{what} बिना {n} सदस्य दिखाए जा रहे हैं।",
        missingBirth: "जन्म तिथि", missingPhoto: "फ़ोटो", missingDesc: "परिचय",
        clearFilter: "साफ़ करें",
        allSetTitle: "सब पूर्ण", allSetText: "हर सदस्य का यह फ़ील्ड भरा हुआ है।",
        notFound: "सदस्य नहीं मिला",
        ageLiving: "आयु {n}", ageLived: "{n} वर्ष जिए",
        living: "जीवित", deceased: "स्वर्गीय"
      },
      form: {
        addTitle: "नया सदस्य", editTitle: "सदस्य संपादित करें",
        name: "नाम", birthDate: "जन्म तिथि", deathDate: "मृत्यु तिथि",
        birthPlace: "जन्म स्थान", deathPlace: "मृत्यु स्थान",
        gender: "लिंग", genderM: "पुरुष", genderF: "महिला", genderO: "अन्य", genderNone: "—",
        notes: "टिप्पणियाँ", parents: "माता-पिता", spouses: "जीवनसाथी",
        father: "पिता", mother: "माता",
        fatherNone: "— पिता चयनित नहीं —",
        motherNone: "— माता चयनित नहीं —",
        spouseNone: "— जीवनसाथी नहीं —",
        addSpouse: "एक और जीवनसाथी जोड़ें",
        datePlaceholder: "YYYY-MM-DD या YYYY",
        dateInvalid: "कृपया तिथि YYYY, YYYY-MM, या YYYY-MM-DD में दर्ज करें।",
        dateOrderInvalid: "जन्म तिथि मृत्यु तिथि के बाद नहीं हो सकती।",
        dateFutureInvalid: "यह तिथि भविष्य में है।",
        datePrecisionLabel: "{field} — तिथि परिशुद्धता",
        essentials: "आवश्यक जानकारी",
        moreDetails: "और विवरण",
        photoHint: "JPG, PNG. स्वचालित रूप से 512px तक छोटा कर दिया जाएगा।",
        nameRequired: "कृपया नाम दर्ज करें।",
        saved: "सहेजा गया", removed: "हटा दिया गया",
        saveAddAnother: "सहेजें और एक और जोड़ें", savedAddAnother: "सहेजा गया — अगला सदस्य जोड़ें",
        discardTitle: "परिवर्तन छोड़ें?",
        discardMsg: "इस सदस्य में किए गए बदलाव खो जाएँगे।",
        deleteTitle: "क्या इस सदस्य को हटाएँ?",
        deleteMsg: "यह उन्हें वृक्ष से हटा देगा और सभी रिश्तों से अलग कर देगा।",
        occupation: "व्यवसाय",
        description: "परिचय", descriptionHint: "संक्षिप्त जीवनी या स्मृति।",
        achievements: "जीवन की उपलब्धियाँ", achievementsHint: "प्रत्येक पंक्ति में एक।",
        education: "शिक्षा", educationHint: "प्रत्येक पंक्ति में एक।",
        namePlaceholder: "पूरा नाम",
        deathDatePlaceholder: "जीवित हों तो खाली छोड़ें",
        placePlaceholder: "नगर, देश",
        notesPlaceholder: "कहानियाँ, यादें, कुछ भी याद रखने योग्य…",
        occupationPlaceholder: "अभियंता, शिक्षक…",
        descriptionPlaceholder: "संक्षिप्त परिचय या स्मृति…",
        achievementsPlaceholder: "परिवार में पहली बार स्नातक\n1982 में ज़िला क्रिकेट ट्रॉफ़ी जीती\n…",
        educationPlaceholder: "बीए, दिल्ली विश्वविद्यालय, 1968\nपीएचडी, आईआईटी बॉम्बे, 1976\n…",
        precExact: "सटीक", precAbout: "लगभग (c.)", precBefore: "से पहले", precAfter: "के बाद",
        required: "आवश्यक", optional: "वैकल्पिक",
        addHindi: "हिन्दी जोड़ें", addHindiAria: "{label} के लिए हिन्दी जोड़ें",
        contact: "संपर्क", contactHint: "फ़ोन, ईमेल, पता। किसी भी फ़ील्ड को निजी चिह्नित करें ताकि वह निर्यात से बाहर रहे।",
        phonePlaceholder: "+91 …", addressPlaceholder: "गली, शहर, पिनकोड",
        phoneLabel: "फ़ोन", emailLabel: "ईमेल", addressLabel: "पता",
        private: "निजी", privateHint: "JSON / PNG / पोस्टर निर्यात से छिपाएँ",
        privateExportOnly: "निर्यात से छिपा (पहुँच वाले लोगों को फिर भी दिखेगा)",
        petLabel: "पालतू पशु (बिल्ली, कुत्ता, आदि)",
        relationsEmpty: "रिश्ते जोड़ने के लिए पहले अन्य लोगों को जोड़ें",
        reframe: "पुनःफ़्रेम", removeSpouse: "हटाएँ",
        noPhotoReframe: "पुनःफ़्रेम करने के लिए कोई फ़ोटो नहीं।", cropsSaved: "क्रॉप सहेजे गए", saveFailed: "सहेजना विफल"
      },
      tree: {
        title: "हमारा पारिवारिक वृक्ष",
        subtitle: "ज़ूम के लिए चिकोटी काटें या स्क्रॉल करें · खींचने के लिए ड्रैग करें",
        memberOne: "1 सदस्य", memberMany: "{n} सदस्य",
        generationOne: "1 पीढ़ी", generationMany: "{n} पीढ़ियाँ",
        addPerson: "सदस्य जोड़ें",
        panHint: "खींचने के लिए ड्रैग करें · ज़ूम के लिए स्क्रॉल करें · अधिक के लिए किसी व्यक्ति पर राइट-क्लिक करें",
        touchMenuHint: "सुझाव: अधिक विकल्पों के लिए किसी को दबाकर रखें।",
        legendLiving: "जीवित", legendDeceased: "स्वर्गीय", legendCouple: "दंपत्ति",
        emptyTitle: "अपना पारिवारिक वृक्ष लगाएँ",
        emptyText: "यहाँ देखने के लिए साइडबार से सदस्य जोड़ें।",
        viewingAs: "देख रहे हैं",
        resetView: "पूरा वृक्ष",
        viewOptions: "दृश्य विकल्प",
        fitView: "पूरा दिखाएँ",
        focusLineage: "वंशजों पर ध्यान दें",
        focusBloodline: "पूरी वंशावली पर ध्यान दें",
        addRelative: "संबंधी जोड़ें",
        addRelativeAria: "{name} में संबंधी जोड़ें",
        yourTrees: "आपके वृक्ष",
        active: "सक्रिय",
        loading: "आपके वृक्ष लोड हो रहे हैं…",
        empty: "अभी कोई वृक्ष नहीं।",
        loadError: "आपके वृक्ष लोड नहीं हो सके। अपना कनेक्शन जाँचें।",
        switchTo: "{name} पर जाएँ",
        switched: "{name} पर चले गए",
        switchError: "वृक्ष नहीं बदल सका। पुनः प्रयास करें।",
        create: "नया वृक्ष",
        createTitle: "नया वृक्ष बनाएँ",
        created: "नया वृक्ष बन गया।",
        createError: "वृक्ष नहीं बन सका। पुनः प्रयास करें।",
        rename: "नाम बदलें",
        renameTitle: "वृक्ष का नाम बदलें",
        renamed: "वृक्ष का नाम बदल गया।",
        renameError: "नाम नहीं बदल सका। पुनः प्रयास करें।",
        delete: "हटाएँ",
        deleteConfirm: "\"{name}\" हटाएँ? यह वृक्ष और उसकी तस्वीरें उन सभी के लिए स्थायी रूप से हट जाएँगी जिनके साथ यह साझा है। यह पूर्ववत नहीं किया जा सकता।",
        deleted: "वृक्ष हटा दिया गया।",
        deleteError: "वृक्ष नहीं हट सका। पुनः प्रयास करें।",
        nameLabel: "वृक्ष का नाम",
        namePlaceholder: "जैसे शर्मा परिवार वृक्ष",
        roleOwner: "स्वामी",
        roleEditor: "संपादक",
        roleViewer: "दर्शक",
        needSignIn: "कई वृक्ष रखने और उनके बीच स्विच करने के लिए साइन इन करें।"
      },
      timeline: {
        title: "समयरेखा",
        eyebrow: "एक क्षैतिज जीवनरेखा",
        titleWord: "समयरेखा",
        titleFallback: "परिवार",
        present: "अब तक",
        pxPerYearTitle: "पिक्सेल प्रति वर्ष",
        subtitle: "देखें कि आपके परिवार के इतिहास के किस मोड़ पर कौन जीवित था।",
        emptyTitle: "समयरेखा में अभी कुछ नहीं है",
        emptyText: "यहाँ देखने के लिए सदस्यों में जन्म तिथि जोड़ें।",
        pxPerYear: "{n} px / वर्ष",
        pxPerYearShort: "{n} px/वर्ष",
        today: "आज"
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
      inspector: {
        emptyTitle: "किसी सदस्य को चुनें",
        emptyText: "विवरण देखने के लिए वृक्ष, सूची, या समयरेखा में किसी पर क्लिक करें।",
        secAbout: "परिचय",
        secPersonal: "व्यक्तिगत जानकारी",
        secAchievements: "जीवन की उपलब्धियाँ",
        secEducation: "शिक्षा",
        secFamily: "परिवार",
        secPhoto: "फ़ोटो",
        secNotes: "टिप्पणियाँ और स्मृतियाँ",
        secStories: "कहानियाँ",
        emptyStories: "अभी कोई कहानी नहीं — एक लिखिए, यहीं संजोई जाएगी।",
        addStory: "कहानी जोड़ें",
        emptyAbout: "अभी तक कोई जीवनी नहीं लिखी गई।",
        emptyList: "अभी तक कुछ दर्ज नहीं।",
        emptyFamily: "अभी तक कोई पारिवारिक संबंध दर्ज नहीं।",
        emptyPhoto: "अभी तक कोई फ़ोटो नहीं",
        actAddNote: "टिप्पणी जोड़ें", actSaveImage: "छवि के रूप में सहेजें",
        actEdit: "संपादित करें", actDelete: "हटाएँ", actOpenInTree: "वृक्ष में दिखाएँ",
        imageSaved: "प्रोफ़ाइल छवि सहेजी गई",
        deleteTitle: "क्या {name} को हटाएँ?",
        deleteMsg: "वे सभी माता-पिता या जीवनसाथी संबंधों से अलग कर दिए जाएँगे। यह पूर्ववत नहीं किया जा सकता।",
        born: "जन्म", died: "निधन", lifespan: "जीवनकाल", age: "आयु",
        gender: "लिंग", occupation: "व्यवसाय",
        addChild: "संतान जोड़ें", addSpouse: "जीवनसाथी जोड़ें", addParent: "माता/पिता जोड़ें",
        marriageDetails: "विवाह विवरण",
        editPhoto: "फ़ोटो संपादित करें",
        notesPlaceholder: "{name} के बारे में कहानियाँ, यादें…",
        created: "बनाया", updated: "अद्यतन"
      },
      rail: {
        overview: "विहंगावलोकन", filter: "छानें", tools: "उपकरण", stats: "वृक्ष सांख्यिकी",
        anniversaries: "आगामी", maintenance: "ध्यान चाहिए",
        needsBirth: "जन्म तिथि नहीं है", needsPhoto: "फ़ोटो नहीं है", needsDescription: "परिचय नहीं है",
        findRelation: "रिश्ता खोजें", printBook: "पारिवारिक पुस्तक छापें",
        trySample: "नमूना परिवार आज़माएँ",
        all: "सभी", living: "जीवित", deceased: "स्वर्गीय",
        addPerson: "सदस्य जोड़ें", addCouple: "दंपत्ति जोड़ें", editTree: "सदस्य प्रबंधित करें", treeSettings: "सेटिंग्स",
        reset: "सब कुछ रीसेट करें",
        resetTitle: "क्या सब कुछ रीसेट करें?",
        resetMsg: "यह आपके इस डिवाइस पर हर सदस्य, फ़ोटो और टिप्पणी को स्थायी रूप से हटा देगा। प्रति रखनी हो तो पहले निर्यात कर लें।",
        resetConfirm: "हाँ, सब हटा दें",
        resetDone: "वृक्ष रीसेट हो गया",
        sampleTitle: "नमूना परिवार लोड करें?",
        sampleMsg: "यह आपके मौजूदा वृक्ष को 4-पीढ़ी के शर्मा नमूने से बदल देगा (14 सदस्य, 5 विवाह, फ़ोटो, कहानियाँ)। रखना हो तो पहले अपना डेटा निर्यात कर लें।",
        sampleConfirm: "नमूने से बदलें",
        sampleLoaded: "नमूना परिवार लोड हुआ",
        sampleError: "नमूना लोड नहीं हो सका: {msg}",
        sampleNotLoaded: "नमूना डेटा लोड नहीं है — पेज रीफ़्रेश करके पुनः प्रयास करें।",
        members: "सदस्य", generations: "पीढ़ियाँ", surnames: "उपनाम", memories: "स्मृतियाँ",
        viewAnalytics: "विश्लेषण देखें",
        legacyTitle: "अपनी विरासत संजोएँ",
        legacyBody: "नाम, फ़ोटो, कहानियाँ — आपके डिवाइस पर सुरक्षित।",
        legacyCta: "शुरू करें",
        legacyBodyCloud: "नाम, फ़ोटो, कहानियाँ — क्लाउड में सिंक और बैकअप।",
        legacyCtaCloud: "बैकअप डाउनलोड करें"
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
      },
      auth: {
        title: "साइन इन",
        subtitle: "अपने पारिवारिक वृक्ष को सुरक्षित रखने और सभी उपकरणों पर समन्वयित रखने के लिए साइन इन करें।",
        email: "ईमेल", password: "पासवर्ड",
        emailPlaceholder: "you@example.com", passwordPlaceholder: "आपका पासवर्ड",
        signIn: "साइन इन", createAccount: "खाता बनाएँ",
        firstName: "पहला नाम", firstNamePlaceholder: "जैसे आन्या",
        firstNameHint: "ताकि हम आपका अभिवादन कर सकें — इसे बाद में बदल सकते हैं।",
        toSignUp: "नए हैं? खाता बनाएँ", toSignIn: "खाता है? साइन इन करें",
        backToIntro: "वापस",
        or: "या",
        google: "Google से जारी रखें",
        magic: "मुझे साइन-इन लिंक ईमेल करें",
        checkEmailLink: "साइन-इन लिंक के लिए अपना ईमेल देखें।",
        checkEmailConfirm: "लगभग हो गया — अपने खाते की पुष्टि के लिए अपना ईमेल देखें, फिर साइन इन करें।",
        account: "खाता",
        greeting: "नमस्ते, {name}",
        signedInAs: "साइन इन:",
        editProfile: "प्रोफ़ाइल संपादित करें",
        emailReadonly: "आपका साइन-इन ईमेल यहाँ नहीं बदला जा सकता।",
        errNameRequired: "कृपया अपना नाम दर्ज करें।",
        profileSaved: "प्रोफ़ाइल अपडेट हो गई",
        signOut: "साइन आउट",
        signOutConfirm: "विरासत से साइन आउट करें? आपका वृक्ष क्लाउड और इस डिवाइस पर सहेजा रहेगा।",
        errFields: "अपना ईमेल और पासवर्ड दर्ज करें।",
        errEmail: "पहले अपना ईमेल दर्ज करें।",
        errInvalid: "यह ईमेल या पासवर्ड मेल नहीं खाता। पुनः प्रयास करें, या नीचे “मुझे साइन-इन लिंक भेजें” का उपयोग करें।",
        errExists: "इस ईमेल से पहले से एक खाता मौजूद है — साइन इन करके देखें।",
        errRate: "बहुत अधिक प्रयास — एक मिनट रुककर पुनः प्रयास करें।",
        errNetwork: "सर्वर से संपर्क नहीं हो पा रहा। अपना कनेक्शन जाँचें।",
        errUnconfirmed: "बस थोड़ा बाकी — अपना ईमेल देखें और पुष्टि लिंक पर क्लिक करें, फिर साइन इन करें।",
        errGeneric: "कुछ गड़बड़ हो गई। कृपया पुनः प्रयास करें।"
      },
      share: {
        title: "साझा करें",
        subtitle: "ईमेल से परिवार को पहुँच दें। हम कोई ईमेल नहीं भेजते — जैसे ही वे उस ईमेल से विरासत में साइन इन करेंगे, उन्हें यह वृक्ष अपने आप मिल जाएगा।",
        emailLabel: "ईमेल पता",
        emailPlaceholder: "name@example.com",
        roleLabel: "पहुँच",
        roleEditor: "संपादन कर सकते हैं",
        roleViewer: "केवल देख सकते हैं",
        roleHelp: "केवल देखने वाले सब कुछ पढ़ सकते हैं पर बदल नहीं सकते। संपादक सदस्य जोड़ और संपादित कर सकते हैं।",
        invite: "पहुँच दें",
        invited: "{email} को यह वृक्ष तब दिखेगा जब वे उस ईमेल से साइन इन करेंगे।",
        inviteError: "आमंत्रण सहेजा नहीं जा सका। पुनः प्रयास करें।",
        errEmail: "एक मान्य ईमेल पता दर्ज करें।",
        members: "पहुँच वाले लोग",
        membersLoading: "लोड हो रहा है…",
        membersError: "पहुँच सूची लोड नहीं हो सकी।",
        pending: "आमंत्रित — अभी साइन इन नहीं किया",
        you: "आप",
        owner: "स्वामी",
        editor: "संपादक",
        viewer: "दर्शक",
        remove: "हटाएँ",
        removeConfirm: "{email} की इस वृक्ष तक पहुँच हटाएँ?",
        removed: "पहुँच हटा दी गई।",
        removeError: "पहुँच नहीं हटाई जा सकी। पुनः प्रयास करें।",
        cancelInvite: "आमंत्रण रद्द करें",
        roleChanged: "पहुँच अपडेट हो गई।",
        roleChangeError: "पहुँच अपडेट नहीं हो सकी। पुनः प्रयास करें।",
        ownerOnly: "केवल वृक्ष का स्वामी ही लोगों को आमंत्रित या हटा सकता है।",
        viewerNote: "इस वृक्ष तक आपकी केवल-देखने की पहुँच है।",
        linkLabel: "ऐप लिंक",
        linkHint: "यह परिवार को भेजें ताकि वे विरासत खोलकर उसी ईमेल से साइन इन कर सकें जो आपने जोड़ा है।",
        copyLink: "लिंक कॉपी करें",
        copyInviteLink: "आमंत्रण लिंक कॉपी करें",
        linkCopied: "लिंक कॉपी हो गया",
        linkCopyFail: "कॉपी नहीं हो सका — लिंक को चुनकर मैन्युअली कॉपी करें।"
      },
      sync: {
        loadingTree: "आपका वृक्ष लोड हो रहा है…",
        conflict: "यह वृक्ष किसी अन्य डिवाइस पर बदल गया — अब नवीनतम संस्करण दिख रहा है।",
        saveBackup: "मेरा संस्करण सहेजें",
        reload: "फिर से लोड करें",
        dismiss: "खारिज करें",
        backupSaved: "आपका संस्करण डाउनलोड में सहेजा गया।",
        backupEmpty: "बैकअप के लिए कुछ नहीं है।",
        backupError: "बैकअप सहेजा नहीं जा सका।",
        cloudUnreachable: "क्लाउड तक नहीं पहुँच सके — आपकी अंतिम सहेजी प्रति दिखाई जा रही है।",
        persistDenied: "ध्यान दें: इस ब्राउज़र में स्टोरेज पिन नहीं है। नियमित रूप से निर्यात करें।",
        stSynced: "सहेजा गया", stSyncedAria: "सभी बदलाव क्लाउड में सहेजे गए",
        stPending: "सहेजा जा रहा है…", stPendingAria: "आपके बदलाव क्लाउड में सहेजे जा रहे हैं",
        stOffline: "ऑफ़लाइन", stOfflineAria: "ऑफ़लाइन — दोबारा कनेक्ट होने पर आपके बदलाव सिंक होंगे"
      },
      landing: {
        pitch: "आपके परिवार के नाम, तस्वीरें और कहानियों के लिए एक शांत, निजी घर — एक जीवंत वृक्ष जो पीढ़ियों तक बढ़ता है।",
        feature1Title: "निजी और आपका",
        feature1Body: "वृक्ष केवल वही देख सकते हैं जिन्हें आप आमंत्रित करें। कोई सार्वजनिक पेज नहीं, कोई विज्ञापन नहीं, आपके परिवार का डेटा बेचा नहीं जाता।",
        feature2Title: "हर डिवाइस पर",
        feature2Body: "एक बार साइन इन करें और आपका वृक्ष आपके साथ रहे — फ़ोन, लैपटॉप, टैबलेट — हमेशा नवीनतम।",
        feature3Title: "परिवार के साथ साझा करें",
        feature3Body: "रिश्तेदारों को ईमेल से आमंत्रित करें ताकि वे वृक्ष देखें या साथ मिलकर बनाएँ, हर एक के अपने लॉगिन से।",
        getStarted: "शुरू करें",
        haveAccount: "पहले से खाता है? साइन इन करें",
        footer: "आपका डेटा निजी रहता है — केवल आपको और आपके आमंत्रित परिवार को दिखता है।"
      },
      firstRun: {
        title: "अपना पहला पारिवारिक वृक्ष बनाएँ",
        subtitle: "शुरू करने के लिए इसे एक नाम दें। आप इसे कभी भी बदल सकते हैं, सदस्य जोड़ सकते हैं, और साझा कर सकते हैं।",
        nameLabel: "वृक्ष का नाम",
        namePlaceholder: "जैसे शर्मा परिवार वृक्ष",
        create: "वृक्ष बनाएँ",
        creating: "बनाया जा रहा है…",
        createError: "वृक्ष नहीं बन सका। अपना कनेक्शन जाँचें और पुनः प्रयास करें।",
        or: "या",
        importTitle: "बैकअप आयात करें",
        importBody: "पहले से विरासत निर्यात है? इसे अपने पहले वृक्ष के रूप में लाएँ।",
        sampleTitle: "नमूना परिवार आज़माएँ",
        sampleBody: "सब कुछ कैसे काम करता है यह देखने के लिए एक छोटा तैयार वृक्ष देखें।",
        sampleName: "नमूना परिवार वृक्ष",
        sampleNotLoaded: "नमूना डेटा लोड नहीं है — पेज रीफ़्रेश करके पुनः प्रयास करें।",
        deviceTitle: "इस डिवाइस पर एक वृक्ष मिला",
        deviceBody: "इस ब्राउज़र में पहले से सहेजे {count} सदस्यों वाले वृक्ष को अपने खाते में लाएँ।",
        greeting: "स्वागत है, {name}",
        signOut: "साइन आउट",
        inviteHint: "क्या आपको किसी पारिवारिक वृक्ष के लिए आमंत्रित किया गया था? आमंत्रण केवल उसी ईमेल के लिए खुलता है जिस पर वह भेजा गया था। आप {email} के रूप में साइन इन हैं — यदि आमंत्रण इस पते पर नहीं आया था, तो साइन आउट करके सही पते से दोबारा साइन इन करें।",
        inviteHintNoEmail: "क्या आपको किसी पारिवारिक वृक्ष के लिए आमंत्रित किया गया था? आमंत्रण केवल उसी ईमेल के लिए खुलता है जिस पर वह भेजा गया था। यदि आपने किसी अन्य पते से साइन इन किया है, तो साइन आउट करके आमंत्रित पते से दोबारा साइन इन करें।"
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
      // Fallback to EN. `n` is a dynamic dot-path cursor (string → object →
      // string → null), so it's genuinely `any`, like `node` above.
      let n = /** @type {any} */ (dict.en);
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
