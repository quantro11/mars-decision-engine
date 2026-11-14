// Bilingual (EN / TR) UI localization dictionary and live DOM translator (zero inline styles/CSP safe).
(function (global) {
  'use strict';

  const STRINGS = {
    en: {
      brandName: 'Mars EVA & Base Decision Engine',
      brandSub: 'Landing-site, Marswalk (EVA) route & science planning on real orbital data',
      'mode.score': 'Site selection',
      'mode.eva': 'Tactical EVA · 1m/px',
      'mode.route': 'Rover route',
      'mode.crisis': 'Dust-storm power',
      'mode.habitability': 'Habitability & APIs',
      zoomLocalEva: 'Zoom to Local EVA Zone (1 m/px) & HUD',
      'view.2d': 'Map',
      'view.3d': 'Globe',
      flytoDefault: 'Go to a region…',
      themeLight: 'Light theme',
      themeDark: 'Dark theme',
      exportBrief: 'Export brief',
      methodBtn: 'Method',
      'preset.landing': 'Landing safety',
      'preset.isru': 'Water ice & resources',
      'preset.balanced': 'Balanced crewed mission',
      'presetSub.landing': 'Flat ground and thick air for safest touchdown',
      'presetSub.isru': 'Prioritizes buried water ice for drinking, air, and fuel',
      'presetSub.balanced': 'Balances safe touchdown, water access, and daily life',
      'crit.elev': 'Elevation (air braking)',
      'crit.slope': 'Slope (terrain tilt)',
      'crit.ice': 'Water ice (underground)',
      'crit.rough': 'Surface smoothness',
      'crit.lat': 'Latitude (sunlight)',
      'crit.ti': 'Soil firmness (sand vs. dust)',
      'crit.rad': 'Cosmic radiation',
      'crit.cave': 'Shelter (nearby caves)',
      'critHelp.elev': 'Lower plains provide denser air to slow down spacecraft and reduce radiation.',
      'critHelp.slope': 'Flatter terrain reduces tip-over risk when landing or driving rovers.',
      'critHelp.ice': 'Underground ice supplies drinking water, breathable oxygen, and rocket fuel.',
      'critHelp.rough': 'Smoother surfaces have fewer hidden boulders and sudden drops.',
      'critHelp.lat': 'Closer to the equator means stronger year-round sunlight and milder cold.',
      'critHelp.ti': 'Firm packed soil handles weight better than loose dust or steep jagged rock.',
      'critHelp.rad': 'Lower-elevation areas get slightly more natural radiation shielding from the sky.',
      'critHelp.cave': 'Nearby lava-tube caves could offer future natural shelter from storms.',
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
      hudNoWebgl: 'WebGL unavailable; staying in 2D map view',
      proj2d: 'Equirectangular',
      proj3d: '3D MOLA globe',
      overlayPrefix: 'Layer',
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
      ovOn: 'Overlay on',
      ovOff: 'Overlay off',
      relief: 'Relief',
      sensRunning: 'Running 30 perturbed scorings…',
      sensRobust: 'Ranking is ROBUST to weight uncertainty.',
      sensSensitive: 'Ranking DEPENDS on the chosen weights.',
      apiShow: 'Show',
      apiHide: 'Hide',
      apiSaved: 'Saved NASA API Key',
      apiQuerying: 'Querying NASA Open APIs (api.nasa.gov)…',
      startPin: 'Start',
      goalPin: 'Goal',
    },
    tr: {
      brandName: 'Mars EVA & Üs Karar Motoru',
      brandSub: 'Gerçek yörünge verileriyle iniş sahası, Marswalk (EVA) rotası ve bilim planlaması',
      'mode.score': 'Saha seçimi',
      'mode.eva': 'Taktik EVA · 1m/px',
      'mode.route': 'Rover rotası',
      'mode.crisis': 'Toz fırtınası gücü',
      'mode.habitability': 'Yaşanabilirlik & API',
      zoomLocalEva: 'Yerel EVA Bölgesine Yakınlaş (1 m/px) & HUD',
      'view.2d': 'Harita',
      'view.3d': '3B Küre',
      flytoDefault: 'Bir bölgeye git…',
      themeLight: 'Açık tema',
      themeDark: 'Koyu tema',
      exportBrief: 'Rapor al',
      methodBtn: 'Yöntem',
      'preset.landing': 'İniş güvenliği',
      'preset.isru': 'Su buzu ve kaynaklar',
      'preset.balanced': 'Dengeli mürettebat',
      'presetSub.landing': 'En güvenli iniş için düz zemin ve daha yoğun atmosfer',
      'presetSub.isru': 'İçme suyu, oksijen ve yakıt için yeraltı buzunu öncelikler',
      'presetSub.balanced': 'Güvenli iniş, su erişimi ve günlük yaşamı dengeler',
      'crit.elev': 'Rakım (hava frenlemesi)',
      'crit.slope': 'Eğim (zemin dikliği)',
      'crit.ice': 'Su buzu (yeraltı)',
      'crit.rough': 'Zemin düzgünlüğü',
      'crit.lat': 'Enlem (güneş ışığı)',
      'crit.ti': 'Zemin sertliği (kum / toz)',
      'crit.rad': 'Kozmik radyasyon',
      'crit.cave': 'Mağara (doğal sığınak)',
      'critHelp.elev': 'Alçak ovalar iniş frenlemesi için daha yoğun hava ve daha az radyasyon sağlar.',
      'critHelp.slope': 'Daha düz arazide iniş ve araç sürüşü sırasında devrilme riski azalır.',
      'critHelp.ice': 'Yeraltı buzu içme suyu, solunabilir oksijen ve roket yakıtı kaynağıdır.',
      'critHelp.rough': 'Düzgün yüzeylerde gizli kaya ve ani yükselti tehlikesi daha azdır.',
      'critHelp.lat': 'Ekvatora yakın bölgeler yıl boyu daha fazla güneş ışığı ve ılıman sıcaklık sunar.',
      'critHelp.ti': 'Sıkı kumlu zemin, yumuşak kalın toz veya keskin kayaya göre yükü daha iyi taşır.',
      'critHelp.rad': 'Alçak bölgelerde üstteki hava sütunu kozmik radyasyona karşı kısmi koruma sağlar.',
      'critHelp.cave': 'Yakındaki lav tüneli mağaraları fırtınalara karşı doğal sığınak sunabilir.',
      'ov.score': 'UYGUNLUK SKORU',
      'ov.ice': 'SWIM 2.0 YERALTI BUZU',
      'ov.slope': 'MOLA %90 EĞİM',
      'ov.elev': 'MOLA YÜKSELTİ MODELİ',
      'ov.ti': 'TES TERMAL ATALET',
      'ov.dust': 'TES TOZ YOĞUNLUĞU',
      'ov.rad': 'GCR RADYASYON DOZU',
      'ov.cave': 'MAĞARA ADAYI MESAFESİ (DOĞRULANMAMIŞ)',
      'ov.none': 'NASA VIKING OPTİK MOZAİK',
      hudHint2d: 'Sürükle: kaydır · tekerlek: yakınlaştır · tıkla: incele',
      hudHint3d: 'Sürükle: döndür · tekerlek: yakınlaştır · tıkla: incele',
      hudNoWebgl: 'WebGL kapalı; 2B haritada kalınıyor',
      proj2d: 'Eşdikdörtgen',
      proj3d: '3B MOLA küre',
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
      ovOn: 'Katman açık',
      ovOff: 'Katman kapalı',
      relief: 'Kabartma',
      sensRunning: '30 sarsılmış ağırlık senaryosu hesaplanıyor…',
      sensRobust: 'Sıralama ağırlık belirsizliğine KARŞI SAĞLAMDIR.',
      sensSensitive: 'Sıralama seçilen ağırlıklara DUYARLIDIR.',
      apiShow: 'Göster',
      apiHide: 'Gizle',
      apiSaved: 'NASA API Anahtarı Kaydedildi',
      apiQuerying: 'NASA Open API sorgulanıyor (api.nasa.gov)…',
      startPin: 'Başlangıç',
      goalPin: 'Hedef',
    },
  };

  // Static DOM bindings: [selectorOrTuple, trText]
  const DOM_TR = [
    ['.brand-name', 'Mars EVA & Üs Karar Motoru'],
    ['.brand-sub', 'Gerçek yörünge verileriyle iniş sahası, Marswalk (EVA) rotası ve bilim planlaması'],
    ['.mode-btn[data-mode="score"] .mode-label', 'Saha seçimi'],
    ['.mode-btn[data-mode="eva"] .mode-label', 'Taktik EVA · 1m/px'],
    ['.mode-btn[data-mode="route"] .mode-label', 'Rover rotası'],
    ['.mode-btn[data-mode="crisis"] .mode-label', 'Toz fırtınası gücü'],
    ['.mode-btn[data-mode="habitability"] .mode-label', 'Yaşanabilirlik & API'],
    ['#btn-2d', 'Harita'],
    ['#btn-3d', '3B Küre'],
    ['#flyto option[value=""]', 'Bir bölgeye git…'],
    ['#btn-export', 'Rapor al'],
    ['#btn-about', 'Yöntem'],
    [['#panel-score .sec-head h2', 0], 'Görev önceliği'],
    ['#score-intro', 'Bir ön ayar seçin veya aşağıdaki kriter ağırlıklarını değiştirin.'],
    ['#guide-text', 'Aşağıdan bir aday bölge seçin veya haritada herhangi bir noktaya dokunup arazi, su buzu ve fırtına gücünü görün.'],
    ['#guide-dismiss', 'Gizle'],
    [['#panel-score .sec-head h2', 1], 'Kriter ağırlıkları'],
    [['#panel-score .sec-head .hint', 0], '%100’e normalize'],
    [['#panel-score .constraint-box .check b', 0], 'NASA iniş sahası kısıtları'],
    [['#panel-score .constraint-box .check b', 1], 'Telafisiz (geometrik ortalama)'],
    [['#panel-score .sec-head h2', 2], 'Buz derinliği'],
    [['#panel-score .sec-head h2', 3], 'Ağırlık duyarlılığı'],
    ['#panel-score p.help', 'Üst sıralardaki adayların ağırlık belirsizliğine dayanıp dayanmadığını görmek için her ağırlığı 30 kez sarsarak yeniden sıralayın.'],
    ['#sens-run', 'Sağlamlık testini çalıştır'],
    ['#panel-eva .sec-head h2', 'Taktik EVA / Mars Yürüyüşü'],
    ['#eva-intro', 'Kaya blokları, dik krater duvarları ve kum tuzakları etrafında 1 m/px yerel A* yürüyüş rotası, xEMU giysi O₂/batarya/soğutma telemetrisi, Güvenli Geri Dönüş Çemberi ve Kask İçi HUD.'],
    ['#hud-close', 'Kapat'],
    ['#panel-route .sec-head h2', 'Rover / Marswalk rotası'],
    ['#panel-route p.help', 'Harita veya küreden başlangıç ve varış seçin. Planlayıcı MOLA eğim haritasında Bilimsel Hedef Noktalarına (POI) uğrayan en güvenli rotayı bulur ve uzay giysisi (EVA) metabolik/O₂/radyasyon yükünü hesaplar.'],
    ['#route-mode-seg button[data-rmode="rover"]', 'Rover Sürüşü'],
    ['#route-mode-seg button[data-rmode="marswalk"]', 'EVA / Marswalk'],
    ['#route-demo', 'Jezero → Nili örneği'],
    ['#route-marswalk-demo', 'Gale Boxwork Marswalk'],
    ['#route-clear', 'Temizle'],
    ['#panel-crisis .sec-head h2', 'Toz fırtınası güç modeli'],
    ['#panel-crisis p.help', 'Haritadan veya aday kartından bir saha seçin; güç sistemini 2018-benzeri küresel toz fırtınasına göre boyutlandırın.'],
    ['#panel-crisis .station-lbl', 'Saha'],
    ['#panel-habitability .sec-head h2', 'Gezegen & Yaşanabilirlik API'],
    ['#panel-habitability p.help', '2025–2026 Curiosity REMS ve Perseverance MEDA yüzey meteorolojisi, canlı NASA DONKI Güneş Çevrimi 25 uzay havası ve InSight referans klimatolojisi.'],
    ['#panel-habitability .api-key-box label', 'NASA Open API Anahtarı (isteğe bağlı)'],
    ['#btn-save-key', 'Kaydet'],
    ['#panel-habitability .api-key-box .note-sm', 'Sunucu proxy için boş bırakın veya tek başına kullanım için kişisel NASA anahtarı girin (DEMO_KEY saatlik/günlük sınırla çalışır).'],
    ['#btn-fetch-live', 'Hava ve uzay havasını çek'],
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
    ['#btn-sun', 'Güneş'],
    ['#btn-spin', 'Dönüş'],
    ['#zoom-reset', 'Sığdır'],
    ['#loading .loading-title', 'Mars Karar Motoru'],
    ['#loading .loading-sub', 'NASA yükseklik, su buzu ve termal katmanlar yükleniyor…'],
    ['#candidates-sec .sec-head h2', 'En iyi aday bölgeler'],
    ['#candidates-sec .sec-head .hint', '2°×2° blok · ≥ 800 km ara'],
    ['#detail-sec .sec-head h2', 'Seçili konum'],
    ['#detail .empty-state p.help', 'Fiziksel verileri görmek için harita/küre üzerinde bir noktaya veya yukarıdaki adaylardan birine tıklayın.'],
    ['.sources-tag', 'Veri'],
    ['.sources-right span', 'Grid 4096 × 2048 · piksel başına ≈ 5 km'],
    ['#brief-modal .modal-header .hint', 'Brifing'],
    ['#brief-title', 'Üs seçimi ve hayatta kalma brifingi'],
    ['#btn-dl-json', 'JSON İndir'],
    ['#btn-dl-geojson', 'GeoJSON İndir'],
    ['#btn-print-brief', 'Yazdır / PDF'],
    ['#brief-close', 'Kapat'],
    ['#about .modal-header .hint', 'Yöntem'],
    ['#modal-title', 'Karar motoru nasıl çalışır?'],
    ['#about-close', 'Kapat'],
  ];

  // Slider control input selectors whose enclosing <label> first text node is localized
  const LEADS_TR = [
    ['#sens', 'Ağırlık belirsizliği '],
    ['#eva-zone-select', 'Yerel HiRISE / CTX EVA Bölgesi '],
    ['#eva-buddy-mode', 'EVA Mürettebat & Hareket Mimarisi '],
    ['#eva-load', 'Bilimsel ekipman / numune yükü '],
    ['#eva-speed', 'Astronot yürüyüş hızı '],
    ['#eva-maxslope', 'xEMU giysi azami eğim '],
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
    ['#route-sci-poi', ' SWIM 2.0 Buz Sondajı, Mount Sharp Boxwork ve TES Mineral Örnekleme duraklarını rotaya dahil et ve bilim skorunu hesapla.'],
    ['#show-regions', 'Yer adları ve iniş araçları'],
    ['#show-ez', 'NASA 2015 keşif zonları'],
  ];

  const ABOUT_TR_HTML = `
    <h3>1 · Kriter başına uygunluk, 0 ile 1 arası</h3>
    <table class="tbl">
      <thead><tr><th>Kriter</th><th>Veri Seti</th><th>Kural</th><th>Mühendislik Gerekçesi</th></tr></thead>
      <tbody>
        <tr><td><b>Rakım</b></td><td>MGS MOLA</td><td>−2 km altında 1 → +2 km üstünde 0</td><td>Daha kalın atmosfer paraşüt ve retro-itki emniyet payını artırır; NASA sınırı +2 km’dir.</td></tr>
        <tr><td><b>Eğim</b></td><td>MOLA, hücre içi %90 persentil</td><td>5° altında 1 → 15° üstünde 0</td><td>İniş platformları ≤ 5°, mürettebatlı roverlar ≤ 15° eğim ister.</td></tr>
        <tr><td><b>Su buzu</b></td><td>SWIM 2.0</td><td>tutarlılık −1…+1 → 0…1</td><td>Yerinde su, oksijen ve yakıt üretimi (ISRU) için kritik kaynak.</td></tr>
        <tr><td><b>Pürüzlülük</b></td><td>MOLA, hücre içi σ</td><td>30 m altında 1 → 250 m üstünde 0</td><td>Grid altı kaya, uçurum ve radar saçılma riski göstergesi.</td></tr>
        <tr><td><b>Termal atalet</b></td><td>MGS TES</td><td>&lt; 100 → ≤ 0.3 · 150–400 → 1 · 700’de 0</td><td>Zemin taşıma kapasitesi, güneş paneli toz riski ve kazı kolaylığı.</td></tr>
        <tr><td><b>Enlem</b></td><td>—</td><td>(cos φ − cos 50°) / (1 − cos 50°)</td><td>Ortalama güneş ışınımı enlemle düşer; NASA insanlı iniş sınırı ±50°’dir.</td></tr>
        <tr><td><b>Radyasyon (GCR)</b></td><td>MOLA + MSL/RAD</td><td>≤ 200 mSv/yıl → 1 · ≥ 290 → 0</td><td>Curiosity RAD (Gale Krateri: 0.64 mSv/gün) kalibreli atmosferik sütun zırhlaması.</td></tr>
      </tbody>
    </table>
    <div class="modal-grid">
      <div>
        <h3>2 · Ağırlıklı toplam veya geometrik ortalama</h3>
        <p>Varsayılan modda her hücre <code>S = Σ wᵢ·fᵢ</code> formülüyle skorlanır. Kısıtlar aktifken +2 km üstü, 15°’den dik veya ±50° dışı hücreler ağırlıktan bağımsız sıfır puan alır. Opsiyonel <b>Telafisiz</b> modu ağırlıklı geometrik ortalamaya geçer; zayıf tek bir kriter yüksek buzla telafi edilemez.</p>
        <h3>3 · 3B Küre Motoru</h3>
        <p>Gerçek MOLA rakım verisiyle (Hellas −8.2 km … Olympus +21 km) şekillendirilmiş, piksel bazlı ışıklandırılmış ve prosedürel galaktik yıldız alanı önünde Viking Orbiter renkli mozaiğiyle kaplanmış bağımlılıksız WebGL küresi.</p>
      </div>
      <div>
        <h3>4 · Çoklu tehlike rota planlayıcı (A*)</h3>
        <p>Boylam sarmalı 8-komşuluklu adaptif A* algoritması. Adım maliyeti <code>mesafe × (1 + k · (eğim + pürüzlülük + toz))</code>; eğim sınırı üstü yasaklanır, düşük termal ataletli (&lt;100 tiu) toz tuzakları cezalandırılır ve en az 200 km aralıkla düz/sert aday mola noktaları işaretlenir.</p>
        <h3>5 · Toz fırtınası enerji ve termal model</h3>
        <p>Günlük güneş enerjisi <code>3.0 kWh/m²/sol × S(φ, Lₛ) × e<sup>−0.35(τ−0.5)</sup></code> bağıntısıyla τ ≈ 10.8’de Opportunity 2018 kaybını doğrular; habitat ısıtması önce elektrik yükünün atık ısısından karşılanır.</p>
      </div>
    </div>
    <h3>6 · Mevsim, radyasyon ve Monte Carlo ağırlık duyarlılığı</h3>
    <p>Mevsimsel insolasyon Mars’ın 25.19° eksen eğikliğini ve yörünge dışmerkezliğini (e = 0.0934, günberi Lₛ = 251°) içerir. Atmosfer sütun kütlesi (16.4 g/cm², 11.1 km ölçek yüksekliği) hem kronik GCR dozunu hem Ağustos-1972 sınıfı tasarım SPE olayını (λ = 15 g/cm²) hesaplar. Monte Carlo testi tüm ağırlıkları 30 kez sarsarak İlk-5 kararlılığını ölçer.</p>
    <h3>7 · Modelin sınırları ve dürüst beyan</h3>
    <ul class="spec-list">
      <li><b>Çözünürlük:</b> Piksel başına ≈ 5 km (TES ≈ 10 km); metre ölçeğindeki kayalar ve küçük kraterler çözünmez, iniş elipsi için site kartındaki HiRISE bağlantısı incelenmelidir.</li>
      <li><b>Yükseklik adımı:</b> Küresel MOLA katmanı ≈ 115 m adımlıdır; eğimler bölgesel gradyanları yansıtır.</li>
      <li><b>Buz kapsamı:</b> SWIM yalnızca ±60° arası tutarlılık haritalar; derişim veya kazı verimi ölçmez, ±60° dışı sıfır sayılır.</li>
      <li><b>Modellenmeyenler:</b> Yerel ufuk gölgelemesi, aktif panel temizliği ve kriyojenik yakıt buharlaşması.</li>
    </ul>
    <h3>8 · İstatistiksel doğrulama ve karasal DEM taşınabilirliği</h3>
    <ul class="spec-list">
      <li><b>Yörünge doğrulaması (9 iniş aracı + 39 HLS-2015 bölgesi):</b> ±5° enlem bantları içinde 200 rastgele boylam çekimine karşı tarihsel 9 Mars iniş aracı ortalama <b>90. yüzdelikte</b> (<code>p &lt; 0.005</code>; geometrik <b>89.</b>) ve tüm 39 NASA HLS-2015 keşif bölgesi ortalama <b>71. yüzdelikte</b> (<code>p &lt; 0.005</code>, toplam &amp; geometrik) yer alır.</li>
      <li><b>Karasal DEM taşınabilirliği:</b> Kısıt-veto ÇKKV çekirdeği, eğim/toz cezalı A* rota planlayıcısı ve güneş-batarya modeli karasal yükseklik verileriyle geçici yaşam alanı seçimi, arama-kurtarma aracı rotalaması ve şebeke-dışı mikro-şebeke boyutlandırmada doğrudan çalışır; GeoJSON çıktısı QGIS/Leaflet ile uyumludur.</li>
    </ul>`;

  const DOMAIN_TR = {
    NO_DATA: 'VERİ YOK',
    LIKELY: 'YÜKSEK OLASILIK',
    POSSIBLE: 'OLASI',
    UNLIKELY: 'DÜŞÜK',
    'Outside SWIM coverage': 'SWIM kapsamı dışı (±60°)',
    'Ice likely (datasets agree)': 'Buz olası (veri setleri uyumlu)',
    'Ice possible (mixed evidence)': 'Buz mümkün (kısmi veri)',
    'Ice unlikely': 'Buz olasılığı düşük',
    '10% ice by mass, 10 L/sol crew make-up water': 'kütlece %10 buz, 10 L/sol mürettebat tamamlama suyu',
    'Smooth regional relief': 'Düzgün bölgesel kabartma',
    'Moderate regional relief': 'Orta düzey bölgesel kabartma',
    'Rugged regional relief': 'Engebeli bölgesel kabartma',
    'Regional class from MOLA only. Boulders and small craters are not resolved: check HiRISE / CTX before selecting an ellipse.': 'Yalnızca MOLA bazlı bölgesel sınıf. Kaya ve küçük kraterler çözünmez: iniş elipsi seçmeden önce HiRISE / CTX kontrol edilmelidir.',
    WITHIN_100_MSV: '100 mSv SINIRI İÇİNDE',
    ABOVE_100_MSV: '100 mSv ÜSTÜNDE',
    ABOVE_250_MSV: '250 mSv ÜSTÜNDE (KRİTİK)',
    'Annual Mean': 'Yıllık Ortalama',
    'Perihelion / S. Summer Dust Season': 'Günberi / G. Yaz Toz Mevsimi',
    'N. Spring / S. Autumn Equinox': 'K. İlkbahar / G. Sonbahar Ekinoksu',
    'N. Summer / Aphelion': 'K. Yaz / Günöte',
    'N. Autumn / S. Spring Equinox': 'K. Sonbahar / G. İlkbahar Ekinoksu',
    'N. Winter / S. Summer Solstice': 'K. Kış / G. Yaz Gündönümü',
  };

  const HAB_TR = {
    'Atmospheric Pressure': { marker: 'Atmosfer Basıncı', earth: '101.3 kPa', mars: '~0.65–0.90 kPa', deficit: 'Armstrong sınırı (6.3 kPa) altı; sıvılar kaynar', eclss: 'Tam basınçlı uzay giysisi ve 82 kPa habitat kabuğu.' },
    'Oxygen Partial Pressure': { marker: 'Oksijen Kısmi Basıncı', earth: '21.2 kPa (%20.95 O₂)', mars: '<0.001 kPa (%95.3 CO₂)', deficit: 'Anoksik atmosfer (<15 sn içinde hipoksi)', eclss: 'MOXIE / Katı Oksit Elektrolizi (SOXE) ile sürekli O₂.' },
    'Thermal Environment': { marker: 'Termal Ortam', earth: '+15°C ort (−50°C … +50°C)', mars: '−55°C ort (−125°C gece … +15°C gündüz)', deficit: 'Aşırı hipotermi / elektronik ve batarya donması', eclss: 'Aerojel MLI yalıtım + 10 kWe Kilopower atık ısısı.' },
    'Water Activity (aw)': { marker: 'Su Aktivitesi (aw)', earth: 'Yüzeyde bol sıvı su (aw = 1.0)', mars: 'Kuru yüzey; yeraltı buzu (aw ~ 0.001)', deficit: 'Sıvı su 0°C’de bile yüzeyde hızla süblimleşir', eclss: 'Kapalı döngü ECLSS su geri kazanımı + SWIM 2.0 bölgelerinde yeraltı permafrost kazısı (verim yerel derişime bağlıdır).' },
    'Radiation Exposure': { marker: 'Radyasyon Maruziyeti', earth: '2.4 mSv/yıl (manyetosfer + 1033 g/cm² hava)', mars: '230–300 mSv/yıl GCR + akut CME güneş fırtınaları', deficit: 'Dünya arka planının ~100 katı; ölümcül akut CME riski', eclss: '2.2 m regolit siperi veya >3.5 m bazalt lav tüpü.' },
    'Solar UV & Ozone Shielding': { marker: 'Güneş UV ve Ozon Kalkanı', earth: 'Stratosferik ozon UVC’nin %99’unu tutar', mars: 'Korunmasız güneş UVC radyasyon akısı', deficit: 'DNA parçalayıcı biyolojik sterilizan yüzey ışınımı', eclss: 'Altın kaplı polikarbonat vizör ve opak kabuk.' },
  };

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

  function trDomain(val, lang = activeLang) {
    return lang === 'tr' ? (DOMAIN_TR[val] ?? val) : val;
  }

  function trHab(item, lang = activeLang) {
    return lang === 'tr' && item && HAB_TR[item.marker] ? HAB_TR[item.marker] : item;
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

    const aboutC = doc.querySelector('#about-content');
    if (aboutC) {
      if (aboutC._mdeEnHtml === undefined) aboutC._mdeEnHtml = aboutC.innerHTML;
      aboutC.innerHTML = lang === 'tr' ? ABOUT_TR_HTML : aboutC._mdeEnHtml;
    }

    const btnTog = doc.querySelector('#btn-toggle-key');
    const inpKey = doc.querySelector('#nasa-api-key');
    if (btnTog && inpKey) btnTog.textContent = t(inpKey.type === 'text' ? 'apiHide' : 'apiShow', lang);
    if (inpKey) {
      if (inpKey._mdeEnPh === undefined) inpKey._mdeEnPh = inpKey.placeholder || '';
      inpKey.placeholder = lang === 'tr' ? 'boş = sunucu proxy kullan' : inpKey._mdeEnPh;
    }

    const apiSt = doc.querySelector('#live-api-status');
    if (apiSt && (!global.MDE_LIVE_STATE || apiSt.textContent.includes('Ready to query') || apiSt.textContent.includes('sorgusuna hazır'))) {
      apiSt.textContent = lang === 'tr' ? 'NASA API sorgusuna hazır' : 'Ready to query NASA APIs';
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

  const api = { STRINGS, t, trDomain, trHab, getLang, setLang, applyDom };
  global.MDE_I18N = api;
  if (typeof globalThis !== 'undefined') globalThis.MDE_I18N = api;
})(typeof module === 'object' && module.exports ? module.exports : globalThis);
