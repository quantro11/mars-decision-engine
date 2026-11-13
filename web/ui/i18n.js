// Bilingual (EN / TR) UI localization dictionary and live DOM translator (zero inline styles/CSP safe).
(function (global) {
  'use strict';

  const STRINGS = {
    en: {
      brandName: 'Mars Base Decision Engine',
      brandSub: 'Landing-site & survival planning on real orbital data',
      'mode.score': 'Site selection',
      'mode.route': 'Rover route',
      'mode.crisis': 'Dust-storm power',
      'mode.habitability': 'Live habitability',
      'view.2d': 'Map',
      'view.3d': 'Globe',
      flytoDefault: 'Go to a region…',
      themeLight: 'Light theme',
      themeDark: 'Dark theme',
      exportBrief: 'Export brief',
      methodBtn: 'Method',
      'preset.landing': 'Landing safety',
      'preset.isru': 'ISRU / sustainability',
      'preset.balanced': 'Balanced crewed mission',
      'crit.elev': 'Elevation (EDL density)',
      'crit.slope': 'Slope (p90 relief)',
      'crit.ice': 'Water ice (SWIM 2.0)',
      'crit.rough': 'Roughness (σ relief)',
      'crit.lat': 'Latitude (solar / thermal)',
      'crit.ti': 'Thermal inertia (surface)',
      'crit.rad': 'Radiation (GCR dose)',
      'crit.cave': 'Shelter (cave candidate)',
      'ov.score': 'SUITABILITY SCORE',
      'ov.ice': 'SWIM 2.0 SUBSURFACE ICE',
      'ov.slope': 'MOLA 90TH-PCT SLOPE',
      'ov.elev': 'MOLA MEGDR ELEVATION',
      'ov.ti': 'TES THERMAL INERTIA',
      'ov.dust': 'TES DUST ABUNDANCE',
      'ov.rad': 'GCR DOSE (MSL/RAD-ANCHORED)',
      'ov.cave': 'CAVE CANDIDATE PROXIMITY (UNCONFIRMED)',
      'ov.none': 'NASA VIKING MDIM 2.1 OPTICAL',
      hudHint2d: 'Drag to pan · scroll to zoom · click to inspect',
      hudHint3d: 'Drag to orbit · scroll to zoom · click to inspect',
      hudNoWebgl: '3D globe unavailable (WebGL disabled) — staying in 2D map view',
      proj2d: 'Map · equirectangular',
      proj3d: 'Globe · MOLA relief',
      overlayPrefix: 'Overlay',
      btnLang: 'TR',
      btnLangTitle: 'Switch interface to Turkish (Türkçe)',
      noCands: 'No surface block satisfies active constraints.',
      compositeSuit: 'Composite suitability',
      vetoed: 'Vetoed',
      withinConstraints: 'Within constraints',
      startRouteHere: 'Start a route here',
      useStormModel: 'Use in storm model',
      routeChooseStart: 'Choose a start point on the map.',
      routeChooseGoal: 'Now choose the destination.',
      routeFail: 'No slope-safe route found',
      crisisChooseSite: 'Choose a site on the map',
      stormSurvives: 'Survives the storm',
      stormBlackout: 'Blackout on sol',
    },
    tr: {
      brandName: 'Mars Üs Karar Motoru',
      brandSub: 'Gerçek yörünge verileriyle iniş sahası ve hayatta kalma planlaması',
      'mode.score': 'Saha seçimi',
      'mode.route': 'Rover rotası',
      'mode.crisis': 'Toz fırtınası gücü',
      'mode.habitability': 'Canlı yaşanabilirlik',
      'view.2d': 'Harita',
      'view.3d': '3B Küre',
      flytoDefault: 'Bir bölgeye git…',
      themeLight: 'Açık tema',
      themeDark: 'Koyu tema',
      exportBrief: 'Rapor al',
      methodBtn: 'Yöntem',
      'preset.landing': 'İniş güvenliği',
      'preset.isru': 'Yerinde kaynak (ISRU)',
      'preset.balanced': 'Dengeli mürettebat',
      'crit.elev': 'Rakım (EDL yoğunluğu)',
      'crit.slope': 'Eğim (%90 rölyef)',
      'crit.ice': 'Su buzu (SWIM 2.0)',
      'crit.rough': 'Pürüzlülük (σ)',
      'crit.lat': 'Enlem (güneş / ısı)',
      'crit.ti': 'Termal atalet (zemin)',
      'crit.rad': 'Radyasyon (GCR dozu)',
      'crit.cave': 'Mağara adayı (sığınak)',
      'ov.score': 'UYGUNLUK SKORU',
      'ov.ice': 'SWIM 2.0 YERALTI BUZU',
      'ov.slope': 'MOLA %90 EĞİM',
      'ov.elev': 'MOLA YÜKSELTİ MODELİ',
      'ov.ti': 'TES TERMAL ATALET',
      'ov.dust': 'TES TOZ YOĞUNLUĞU',
      'ov.rad': 'GCR RADYASYON DOZU',
      'ov.cave': 'MAĞARA ADAYI MESAFESİ (DOĞRULANMAMIŞ)',
      'ov.none': 'NASA VIKING OPTİK MOZAİK',
      hudHint2d: 'Kaydır: sürükle · yakınlaştır: tekerlek · incele: tıkla',
      hudHint3d: 'Küre döndür: sürükle · yakınlaştır: tekerlek · incele: tıkla',
      hudNoWebgl: '3B küre kullanılamıyor (WebGL kapalı) — 2B haritada kalınıyor',
      proj2d: 'Harita · eşdikdörtgen',
      proj3d: 'Küre · MOLA kabartma',
      overlayPrefix: 'Katman',
      btnLang: 'EN',
      btnLangTitle: 'Arayüzü İngilizceye çevir (English)',
      noCands: 'Etkin NASA kısıtlarını sağlayan yüzey bloğu yok.',
      compositeSuit: 'Bileşik uygunluk',
      vetoed: 'Elendi (Veto)',
      withinConstraints: 'Kısıtlar içinde',
      startRouteHere: 'Buradan rota başlat',
      useStormModel: 'Fırtına modelinde kullan',
      routeChooseStart: 'Harita üzerinde başlangıç noktası seçin.',
      routeChooseGoal: 'Şimdi hedef noktayı seçin.',
      routeFail: 'Eğim sınırına uygun güvenli rota bulunamadı',
      crisisChooseSite: 'Haritadan veya aday kartından bir saha seçin',
      stormSurvives: 'Fırtınayı atlatır',
      stormBlackout: 'Kesinti günü sol',
    },
  };

  // Static DOM bindings: [selectorOrTuple, trText]
  const DOM_TR = [
    ['.brand-name', 'Mars Üs Karar Motoru'],
    ['.brand-sub', 'Gerçek yörünge verileriyle iniş sahası ve hayatta kalma planlaması'],
    ['.mode-btn[data-mode="score"] .mode-label', 'Saha seçimi'],
    ['.mode-btn[data-mode="route"] .mode-label', 'Rover rotası'],
    ['.mode-btn[data-mode="crisis"] .mode-label', 'Toz fırtınası gücü'],
    ['.mode-btn[data-mode="habitability"] .mode-label', 'Canlı yaşanabilirlik'],
    ['#btn-2d', 'Harita'],
    ['#btn-3d', '3B Küre'],
    ['#flyto option[value=""]', 'Bir bölgeye git…'],
    ['#btn-export', 'Rapor al'],
    ['#btn-about', 'Yöntem'],
    [['#panel-score .sec-head h2', 0], 'Görev önceliği'],
    [['#panel-score .sec-head h2', 1], 'Kriter ağırlıkları'],
    [['#panel-score .sec-head .hint', 0], '%100’e normalize'],
    [['#panel-score .constraint-box .check b', 0], 'NASA iniş sahası kısıtları'],
    [['#panel-score .constraint-box .check b', 1], 'Telafisiz (geometrik ortalama)'],
    [['#panel-score .sec-head h2', 2], 'Buz derinliği'],
    [['#panel-score .sec-head h2', 3], 'Ağırlık duyarlılığı'],
    ['#panel-score p.help', 'Üst sıralardaki adayların ağırlık belirsizliğine dayanıp dayanmadığını görmek için her ağırlığı 30 kez sarsarak yeniden sıralayın.'],
    ['#sens-run', 'Sağlamlık testini çalıştır'],
    ['#panel-route .sec-head h2', 'Rover rotası'],
    ['#panel-route p.help', 'Harita veya küreden başlangıç ve varış seçin. Planlayıcı MOLA eğim haritasında en güvenli rotayı bulup kuş uçuşuyla kıyaslar.'],
    ['#route-demo', 'Jezero → Nili örneği'],
    ['#route-clear', 'Temizle'],
    ['#panel-crisis .sec-head h2', 'Toz fırtınası güç modeli'],
    ['#panel-crisis p.help', 'Haritadan veya aday kartından bir saha seçin; güç sistemini 2018-benzeri küresel toz fırtınasına göre boyutlandırın.'],
    ['#panel-crisis .station-lbl', 'Saha'],
    ['#panel-habitability .sec-head h2', 'Canlı Gezegen ve Yaşanabilirlik API'],
    ['#panel-habitability p.help', 'NASA Open API ile canlı uzay havası, Mars yüzey telemetrisi ve Dünya–Mars yaşanabilirlik metrikleri.'],
    ['#btn-fetch-live', 'Bağlan ve Canlı Veri Çek'],
    ['.layers .sec-head h2', 'Harita katmanı'],
    ['#overlay button[data-ov="score"]', 'Skor'],
    ['#overlay button[data-ov="ice"]', 'Buz'],
    ['#overlay button[data-ov="slope"]', 'Eğim'],
    ['#overlay button[data-ov="elev"]', 'Yükselti'],
    ['#overlay button[data-ov="ti"]', 'Termal'],
    ['#overlay button[data-ov="dust"]', 'Toz'],
    ['#overlay button[data-ov="rad"]', 'Radyasyon'],
    ['#overlay button[data-ov="cave"]', 'Mağara'],
    ['#overlay button[data-ov="none"]', 'Uydu'],
    ['#zoom-reset', 'Sığdır'],
    ['#candidates-sec .sec-head h2', 'En iyi aday bölgeler'],
    ['#candidates-sec .sec-head .hint', '2°×2° blok · ≥ 800 km ara'],
    ['#detail-sec .sec-head h2', 'Seçili konum'],
    ['#detail .empty-state p.help', 'Fiziksel verileri görmek için harita/küre üzerinde bir noktaya veya yukarıdaki adaylardan birine tıklayın.'],
    ['#brief-title', 'Üs seçimi ve hayatta kalma brifingi'],
    ['#btn-dl-json', 'JSON İndir'],
    ['#btn-dl-geojson', 'GeoJSON İndir'],
    ['#btn-print-brief', 'Yazdır / PDF'],
    ['#brief-close', 'Kapat'],
    ['#modal-title', 'Karar motoru nasıl çalışır?'],
    ['#about-close', 'Kapat'],
  ];

  // Slider control input selectors whose enclosing <label> first text node is localized
  const LEADS_TR = [
    ['#sens', 'Ağırlık belirsizliği '],
    ['#maxslope', 'Eğim sınırı '],
    ['#kslope', 'Eğim cezası '],
    ['#speed', 'Ortalama hız '],
    ['#ls', 'Mevsim, L'],
    ['#opacity', 'Katman opaklığı '],
    ['#tau', 'Tepe optik derinlik τ '],
    ['#area', 'Güneş paneli alanı '],
    ['#cons', 'Üs enerji tüketimi '],
    ['#batt', 'Batarya kapasitesi '],
    ['#kp', 'Kilopower reaktör · 10 kW '],
    ['#rego', 'Regolit siper kalınlığı '],
  ];

  // Checkbox/nested text nodes: [selector, trText] (targets element or last text node)
  const CHECK_DESC_TR = [
    ['#hard', ' +2 km rakım üstü, 15°’den dik veya ±50° enlem dışı hücreler elenir.'],
    ['#agg-geo', ' Ağırlıklı geometrik ortalama: sıfıra yakın bir kriter diğerleriyle telafi edilemez.'],
    ['#show-regions', 'Yer adları ve iniş araçları'],
    ['#show-ez', 'NASA 2015 keşif zonları'],
  ];

  function resolve(doc, spec) {
    try {
      if (Array.isArray(spec)) return doc.querySelectorAll(spec[0])[spec[1]] || null;
      return doc.querySelector(spec);
    } catch (_) { return null; }
  }

  let activeLang = 'en';

  function getLang(loc = global.location, storage = global.localStorage) {
    try {
      const q = loc && loc.search ? new URLSearchParams(loc.search).get('lang') : null;
      if (q === 'tr' || q === 'en') { activeLang = q; return q; }
      const saved = storage ? storage.getItem('mde_lang') : null;
      if (saved === 'tr' || saved === 'en') { activeLang = saved; return saved; }
    } catch (_) { /* ignore */ }
    return activeLang;
  }

  function t(key, lang = activeLang) {
    const tbl = STRINGS[lang] || STRINGS.en;
    return tbl[key] ?? STRINGS.en[key] ?? key;
  }

  function applyDom(doc, lang) {
    if (!doc || !doc.querySelector) return;
    if (doc.documentElement) doc.documentElement.setAttribute('lang', lang);

    for (const [spec, trVal] of DOM_TR) {
      const el = resolve(doc, spec);
      if (!el) continue;
      if (el._mdeEnText === undefined) el._mdeEnText = el.textContent;
      el.textContent = lang === 'tr' ? trVal : el._mdeEnText;
    }

    for (const [inputSel, trLead] of LEADS_TR) {
      const inp = doc.querySelector(inputSel);
      const lbl = inp && inp.closest ? inp.closest('label') : null;
      if (!lbl || !lbl.firstChild || lbl.firstChild.nodeType !== 3) continue;
      if (lbl._mdeEnLead === undefined) lbl._mdeEnLead = lbl.firstChild.nodeValue;
      lbl.firstChild.nodeValue = lang === 'tr' ? trLead : lbl._mdeEnLead;
    }

    for (const [inpSel, trVal] of CHECK_DESC_TR) {
      const inp = doc.querySelector(inpSel);
      const span = inp && inp.parentElement ? inp.parentElement.querySelector('span') : null;
      const node = span && span.lastChild && span.lastChild.nodeType === 3 ? span.lastChild : null;
      if (!node) continue;
      if (span._mdeEnLast === undefined) span._mdeEnLast = node.nodeValue;
      node.nodeValue = lang === 'tr' ? trVal : span._mdeEnLast;
    }

    const btnLang = doc.querySelector('#btn-lang');
    if (btnLang) {
      btnLang.textContent = t('btnLang', lang);
      btnLang.title = t('btnLangTitle', lang);
      btnLang.setAttribute('aria-pressed', lang === 'tr' ? 'true' : 'false');
    }
  }

  function setLang(lang, doc = global.document, storage = global.localStorage) {
    activeLang = lang === 'tr' ? 'tr' : 'en';
    try { if (storage) storage.setItem('mde_lang', activeLang); } catch (_) { /* ignore */ }
    applyDom(doc, activeLang);
    return activeLang;
  }

  global.MDE_I18N = { STRINGS, t, getLang, setLang, applyDom };
})(typeof module === 'object' && module.exports ? module.exports : globalThis);
