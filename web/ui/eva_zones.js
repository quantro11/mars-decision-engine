// Phase 2 Tactical EVA Biome Catalog, System Architecture Metadata, Custom Micro-DEM Seed Generator,
// and Published NASA Perseverance / Curiosity / Apollo Ground-Truth Traverse Benchmarks.
(function (global) {
  'use strict';

  const SYSTEM_ARCH = {
    TRN: {
      id: 'TRN',
      name: 'Terrain Relative Navigation (TRN)',
      nameTr: 'Arazi Bağıl Navigasyonu (TRN)',
      desc: 'Optical descent camera-to-orbital landmark matching cuts touchdown ellipse ~1,200 m -> ~28 m with terminal hazard divert.',
      descTr: 'İniş kamerası-uydu eşleştirmesiyle iniş elipsini ~1.200 m -> ~28 m düzeyine indirip son an tehlike manevrası yapar.'
    },
    AUTONAV: {
      id: 'AUTONAV',
      name: 'Perseverance AutoNav + Thinking-While-Driving',
      nameTr: 'Perseverance AutoNav + Hareket Halinde Haritalama',
      desc: 'Progressive stereo Navcam/Hazcam 3D occupancy & slip sensing reveals sub-meter boulders and migrated dune sand.',
      descTr: 'İlerleyen stereo Navcam/Hazcam 3B taramasıyla uydu altındaki metre-altı kayaları ve kaymış kum tuzaklarını çıkarır.'
    },
    MGL: {
      id: 'MGL',
      name: 'Mars Global Localization (MGL)',
      nameTr: 'Mars Küresel Konumlama (MGL)',
      desc: 'Mastcam/Navcam skyline silhouette correlation locks crew/rover pose (~2 m) and cancels visual odometry drift.',
      descTr: 'Ufuk çizgisi silüet eşleştirmesiyle görsel odometri kaymasını sıfırlayıp konumu (~2 m) uydu çerçevesine kilitler.'
    },
    XGDS: {
      id: 'XGDS',
      name: 'NASA xGDS 5-Domain Surface Fusion',
      nameTr: 'NASA xGDS 5-Alanlı Yüzey Veri Füzyonu',
      desc: 'Replaces static stale orbital priors with live local Topography, Geomorphology, Thermal, Radiation & Optical scores.',
      descTr: 'Zamanla eskimiş uydu verilerinin yerine Topografi, Jeomorfoloji, Termal, Radyasyon ve Optik yerel skorlarını anlık sentezler.'
    }
  };

  const DOMAINS = [
    {
      id: 'topography',
      name: 'Topography',
      nameTr: 'Topografi',
      sensor: 'Stereo LiDAR + Navcam DEM (1 m/px)',
      sensorTr: 'Stereo LiDAR + Navcam DEM (1 m/px)',
      orbitalSource: 'MOLA ~5 km/px + CTX',
      unit: 'deg / m'
    },
    {
      id: 'geomorphology',
      name: 'Geomorphology',
      nameTr: 'Jeomorfoloji',
      sensor: 'AutoNav Voxel + Slip Estimator',
      sensorTr: 'AutoNav Voksel + Kayma Kestiricisi',
      orbitalSource: 'HiRISE Prior (stale Δt)',
      unit: 'class'
    },
    {
      id: 'thermal',
      name: 'Thermal',
      nameTr: 'Termal',
      sensor: 'Mini-TES / Surface Radiometer TI',
      sensorTr: 'Mini-TES / Yüzey Radyometresi TI',
      orbitalSource: 'TES ~10 km/px',
      unit: 'tiu / °C'
    },
    {
      id: 'radiation',
      name: 'Radiation',
      nameTr: 'Radyasyon',
      sensor: 'MSL-RAD Dosimeter + Horizon Sky-View',
      sensorTr: 'MSL-RAD Dozimetresi + Ufuk Kalkanı',
      orbitalSource: 'Orbital Column Model',
      unit: 'mSv/yr'
    },
    {
      id: 'optical',
      name: 'Optical',
      nameTr: 'Optik / Spektral',
      sensor: 'SuperCam VNIR + Mastcam Albedo',
      sensorTr: 'SuperCam VNIR + Mastcam Albedo',
      orbitalSource: 'CRISM / OMEGA',
      unit: 'band / %'
    }
  ];

  const SCORE_MODES = {
    balanced: {
      id: 'balanced',
      name: 'Balanced Mission (Hab + Science)',
      nameTr: 'Dengeli Görev (Üs Güvenliği + Bilim)',
      weights: { topography: 0.24, geomorphology: 0.24, thermal: 0.16, radiation: 0.18, optical: 0.18 }
    },
    hab_safety: {
      id: 'hab_safety',
      name: 'Hab & Traverse Safety Priority',
      nameTr: 'Üs İnşası & Güvenli İntikal Öncelikli',
      weights: { topography: 0.34, geomorphology: 0.32, thermal: 0.14, radiation: 0.14, optical: 0.06 }
    },
    science_bio: {
      id: 'science_bio',
      name: 'Astrobiology & Outcrop Discovery',
      nameTr: 'Astrobiyoloji & Mostralama Öncelikli',
      weights: { topography: 0.14, geomorphology: 0.20, thermal: 0.18, radiation: 0.14, optical: 0.34 }
    },
    isru_water: {
      id: 'isru_water',
      name: 'ISRU Water & Thermal Bearing',
      nameTr: 'ISRU Su & Termal Zemin Öncelikli',
      weights: { topography: 0.20, geomorphology: 0.18, thermal: 0.30, radiation: 0.12, optical: 0.20 }
    }
  };

  function resolveWeights(scoreModeId = 'balanced', customWeights = null) {
    const raw = (scoreModeId === 'custom' && customWeights)
      ? customWeights
      : (SCORE_MODES[scoreModeId] || SCORE_MODES.balanced).weights;
    const keys = ['topography', 'geomorphology', 'thermal', 'radiation', 'optical'];
    let sum = 0;
    for (const k of keys) sum += Math.max(0, +(raw[k] ?? 0));
    const norm = {};
    for (const k of keys) norm[k] = sum > 0 ? Math.max(0, +(raw[k] ?? 0)) / sum : 0.2;
    return norm;
  }

  const ZONES = {
    gale_boxwork: {
      id: 'gale_boxwork',
      rover: 'curiosity',
      searchQuery: 'curiosity rover mount sharp gale crater boxwork mars',
      name: 'Gale Crater · Mount Sharp Boxwork (Curiosity 2025–2026)',
      nameTr: 'Gale Krateri · Mount Sharp Boxwork Oluşumları (Curiosity 2025–2026)',
      lat: -5.08,
      lon: 137.85,
      elev: -4120,
      radMsvYr: 232,
      thermalInertiaBase: 285,
      albedoBase: 0.22,
      orbitalAgeYears: 11,
      hiRiseId: 'ESP_078412_1745 · Orbital Prior -> Live TRN + AutoNav 1 m/px Fusion',
      dtmMetadata: {
        productId: 'DTEEC_078412_1745_078557_1745_A01',
        stereoPair: 'ESP_078412_1745 / ESP_078557_1745',
        truePostSpacingM: 1.0,
        tacticalGridScaleM: 10.0,
        method: 'SOCET SET USGS/UArizona Photogrammetric Stereo + MSL Navcam Bundle Adjustment',
        coverageNote: 'HiRISE DTMs achieve 1.0–2.0 m/post only where stereo pairs exist (<3% of Mars); outside stereo strips, the 10 m/cell tactical grid downscales CTX (6 m/px) + MOLA conditioning.',
        coverageNoteTr: 'HiRISE DTM ürünleri yalnızca stereo çift bulunan alanlarda (<%3 Mars) 1.0–2.0 m/post sağlar; stereo şerit dışında 10 m/hücre taktik ızgara CTX (6 m/px) + MOLA koşullandırması kullanır.'
      },
      summary: 'Orbital HiRISE/TES misses migrated Bagnold ripples and meter-scale cemented boxwork scarps; live AutoNav assimilation resolves real-time walkback routes.',
      summaryTr: 'Uydu verileri yer değiştirmiş Bagnold kumullarını ve keskin boxwork yamaçlarını kaçırır; canlı AutoNav sindirimi güvenli rotayı anlık kurar.',
      base: { x: 14, y: 84, label: 'Rover / TRN Touchdown' },
      boulders: [
        { x: 34, y: 66, r: 9, label: 'Gediz Vallis Boulder Apron' },
        { x: 56, y: 48, r: 9, label: 'Sulfate Megablock Field' },
        { x: 38, y: 31, r: 7, label: 'Fractured Caprock Talus' }
      ],
      walls: [
        { x1: 20, y1: 52, x2: 48, y2: 56, w: 5, slope: 23, label: 'Mount Sharp Sulfate Scarp (23°)' },
        { x1: 60, y1: 24, x2: 88, y2: 36, w: 5, slope: 21, label: 'Upper Boxwork Bench Wall (21°)' }
      ],
      sandTraps: [
        { x: 46, y: 74, rx: 12, ry: 7, label: 'Migrated Bagnold Ripple Sheet' },
        { x: 69, y: 62, rx: 10, ry: 8, label: 'Fresh Storm Dust Trough (<85 tiu)' }
      ],
      driftTrap: { x: 40, y: 60, r: 6 },
      waypoints: [
        {
          id: 'WP-1',
          code: 'BOX-A',
          name: 'Boxwork Formation Site A (Polygonal Ridge)',
          nameTr: 'Boxwork Oluşumu Saha A (Çokgen Sırt Ağı)',
          x: 28,
          y: 40,
          elevRel: +18,
          heading: 42,
          cameraHint: 'MAST',
          cam: 'Curiosity Mastcam · Sol 4418 · f/8 Stereo Mosaic',
          rockType: 'Ca/Mg-Sulfate Cemented Boxwork Fracture Vein',
          rockTypeTr: 'Ca/Mg-Sülfat Çimentolu Boxwork Kırık Damarı',
          mineralogy: 'Bassanite + Gypsum vein network cross-cutting Fe-smectite mudstone',
          mineralogyTr: 'Fe-smektit çamurtaşı içinde bassanit + jips çimentolu kutu damar ağı',
          astrobio: 'High habitability potential: late-stage warm groundwater circulation sheltered from surface UV.',
          astrobioTr: 'Yüksek yaşanabilirlik potansiyeli: yüzey UV radyasyonundan korunmuş geç evre sıcak yeraltı suyu dolaşımı.',
          chem: { SiO2: 41.8, FeO: 16.4, SO3: 18.9, MgO: 8.7, CaO: 7.6, Al2O3: 5.1, H2O: 4.8 },
          specPeaks: [0.22, 0.48, 0.86, 0.64, 0.92, 0.55, 0.78, 0.95, 0.42, 0.68],
          povTheme: 'boxwork',
          sampleKg: 2.5
        },
        {
          id: 'WP-2',
          code: 'GED-B',
          name: 'Gediz Vallis Sulfate Channel Contact',
          nameTr: 'Gediz Vallis Sülfat Kanal Dokanağı',
          x: 52,
          y: 28,
          elevRel: +34,
          heading: 78,
          cameraHint: 'CHEMCAM',
          cam: 'Curiosity Navcam + ChemCam LIBS · Sol 4385',
          rockType: 'Debris-Flow Alluvial Conglomerate & Sulfate Crust',
          rockTypeTr: 'Moloz Akıntısı Alüvyal Konglomera ve Sülfat Kabuğu',
          mineralogy: 'Kieserite (MgSO4·H2O) + Hematite nodules in fluvial matrix',
          mineralogyTr: 'Akarsu matriksinde kieserit ve hematit yumruları',
          astrobio: 'Preserves final wet-to-dry climate transition episodes of Hesperian Mars.',
          astrobioTr: 'Hesperian Mars son ıslak-kuru iklim geçiş evrelerini korur.',
          chem: { SiO2: 38.2, FeO: 19.1, SO3: 21.4, MgO: 10.2, CaO: 4.9, Al2O3: 4.7, H2O: 5.6 },
          specPeaks: [0.35, 0.62, 0.74, 0.91, 0.58, 0.84, 0.49, 0.77, 0.88, 0.52],
          povTheme: 'channel',
          sampleKg: 3.0
        },
        {
          id: 'WP-3',
          code: 'CLY-C',
          name: 'Proudhon Phyllosilicate Clay Bench',
          nameTr: 'Proudhon Fillosilikat Kil Sekisi',
          x: 78,
          y: 46,
          elevRel: +27,
          heading: 118,
          cameraHint: 'NAVCAM',
          cam: 'Curiosity Mastcam Left-Eye · Sol 4430',
          rockType: 'Finely Laminated Lacustrine Nontronite Mudstone',
          rockTypeTr: 'İnce Laminalı Gölsel Nontronit Çamurtaşı',
          mineralogy: 'Nontronite clay + Magnetite + trace jarosite veins',
          mineralogyTr: 'Nontronit kili + Manyetit + eser jarosit damarları',
          astrobio: 'Fine-grained clay matrix traps organic macromolecules against radiolysis.',
          astrobioTr: 'İnce taneli kil matriksi organik makromolekülleri radyoliize karşı korur.',
          chem: { SiO2: 49.4, FeO: 18.2, SO3: 6.8, MgO: 7.9, CaO: 4.1, Al2O3: 9.8, H2O: 6.2 },
          specPeaks: [0.58, 0.82, 0.61, 0.45, 0.72, 0.94, 0.81, 0.44, 0.63, 0.89],
          povTheme: 'clay',
          sampleKg: 2.0
        },
        {
          id: 'WP-4',
          code: 'HAL-D',
          name: 'Diagenetic Concretion & Halite Outcrop',
          nameTr: 'Diyajenetik Yumru ve Halit Mostra Noktası',
          x: 64,
          y: 78,
          elevRel: +9,
          heading: 164,
          cameraHint: 'MAHLI',
          cam: 'Curiosity MAHLI + APXS · Sol 4442',
          rockType: 'Evaporitic Halite-Anhydrite Nodule Bed',
          rockTypeTr: 'Evaporitik Halit-Anhidrit Yumru Katmanı',
          mineralogy: 'Halite (NaCl) + Anhydrite + amorphous silica',
          mineralogyTr: 'Halit (NaCl) + Anhidrit + amorf silika',
          astrobio: 'Fluid inclusions in halite crystals provide micro-habitats for halophilic biosignatures.',
          astrobioTr: 'Halit kristallerindeki sıvı kapanımlar halofilik biyo-izler için mikro-habitat sunar.',
          chem: { SiO2: 35.6, FeO: 12.8, SO3: 24.1, MgO: 6.4, CaO: 11.2, Al2O3: 4.3, H2O: 3.9 },
          specPeaks: [0.40, 0.30, 0.95, 0.85, 0.40, 0.62, 0.91, 0.70, 0.50, 0.82],
          povTheme: 'boxwork',
          sampleKg: 2.5
        }
      ]
    },
    jezero_delta: {
      id: 'jezero_delta',
      rover: 'perseverance',
      searchQuery: 'perseverance rover jezero crater western delta mars',
      name: 'Jezero Crater · Western Delta & Cheyava Falls',
      nameTr: 'Jezero Krateri · Batı Deltası & Cheyava Falls',
      lat: 18.38,
      lon: 77.58,
      elev: -2540,
      radMsvYr: 251,
      thermalInertiaBase: 325,
      albedoBase: 0.19,
      orbitalAgeYears: 9,
      hiRiseId: 'ESP_069124_1985 · TRN + AutoNav + MGL Operational Corridor',
      dtmMetadata: {
        productId: 'DTEEC_069124_1985_069269_1985_U01',
        stereoPair: 'ESP_069124_1985 / ESP_069269_1985',
        truePostSpacingM: 1.0,
        tacticalGridScaleM: 10.0,
        method: 'Mars 2020 TRN Orthorectified Stereo Mosaic + AutoNav Voxel Fusion',
        coverageNote: 'Verified 1.0 m/post HiRISE stereo DTM over Jezero Western Delta; aggregated to 10 m/cell tactical planning grid with sub-meter AutoNav hazard injection.',
        coverageNoteTr: 'Jezero Batı Deltası üzerinde doğrulanmış 1.0 m/post HiRISE stereo DTM; metre-altı AutoNav engel enjeksiyonuyla 10 m/hücre taktik ızgaraya örneklenmiştir.'
      },
      summary: 'Active Perseverance TRN + AutoNav + MGL architecture resolves delta scarp boulders, Belva wind-ripple drift, and Cheyava Falls carbonate benches.',
      summaryTr: 'Gerçek Perseverance TRN + AutoNav + MGL mimarisi delta bloklarını, sürüklenmiş Belva kumullarını ve Cheyava Falls damarlarını sahada doğrular.',
      base: { x: 16, y: 82, label: 'Three Forks TRN Pad' },
      boulders: [
        { x: 38, y: 60, r: 9, label: 'Kodiak Flood Boulder Fan' },
        { x: 60, y: 44, r: 8, label: 'Washburn Impact Megablocks' },
        { x: 30, y: 28, r: 7, label: 'Delta Front Talus Cone' }
      ],
      walls: [
        { x1: 18, y1: 46, x2: 46, y2: 50, w: 5, slope: 24, label: 'Cape Nukshak Delta Cliff (24°)' },
        { x1: 58, y1: 24, x2: 86, y2: 32, w: 5, slope: 20, label: 'Neretva Vallis Margin Scarp (20°)' }
      ],
      sandTraps: [
        { x: 48, y: 74, rx: 13, ry: 7, label: 'Belva Migrated Aeolian Dune' },
        { x: 72, y: 58, rx: 10, ry: 7, label: 'Fine Silt Sinkage Pocket (<90 tiu)' }
      ],
      driftTrap: { x: 34, y: 54, r: 6 },
      waypoints: [
        {
          id: 'WP-1',
          code: 'CHY-A',
          name: 'Cheyava Falls Outcrop (Leopard-Spot Mudstone)',
          nameTr: 'Cheyava Falls Mostrası (Leopar Benekli Çamurtaşı)',
          x: 25,
          y: 36,
          elevRel: +22,
          heading: 34,
          cameraHint: 'MCZ_RIGHT',
          cam: 'Perseverance Mastcam-Z + SHERLOC · Sol 1215',
          rockType: 'Organic-Bearing Vivianite-Greigite Reaction Front Mudstone',
          rockTypeTr: 'Organik İçerikli Viviyanit-Greigit Reaksiyon Çamurtaşı',
          mineralogy: 'Calcite Sulfate veins + mm-scale Fe-phosphate (vivianite) & Fe-sulfide rims',
          mineralogyTr: 'Kalsiyum sülfat damarları + Fe-fosfat (viviyanit) ve Fe-sülfür halkaları',
          astrobio: 'Tier-1 Astrobiology Target: redox reaction spots linked to organic carbon detected by SHERLOC.',
          astrobioTr: '1. Derece Astrobiyoloji Hedefi: SHERLOC ile saptanan organik karbon bağlantılı redoks halkaları.',
          chem: { SiO2: 44.2, FeO: 17.9, SO3: 14.6, MgO: 8.1, CaO: 8.8, Al2O3: 5.4, H2O: 5.1 },
          specPeaks: [0.84, 0.92, 0.67, 0.89, 0.54, 0.78, 0.96, 0.71, 0.60, 0.88],
          povTheme: 'delta',
          sampleKg: 2.5
        },
        {
          id: 'WP-2',
          code: 'WHH-B',
          name: 'Witch Hazel Hill Rim & Serpentine-Carbonate Bench',
          nameTr: 'Witch Hazel Hill Krater Kenarı & Serpantin-Karbonat Sekisi',
          x: 54,
          y: 26,
          elevRel: +38,
          heading: 68,
          cameraHint: 'SUPERCAM_RMI',
          cam: 'Perseverance SuperCam + PIXL · Sol 1442',
          rockType: 'Crater Rim Altered Magnesite-Olivine & Serpentine Unit',
          rockTypeTr: 'Krater Kenarı Alterasyonlu Manyezit-Olivin ve Serpantin Birimi',
          mineralogy: 'Hydrated Mg-Carbonate + Forsteritic Olivine + Authigenic Silica',
          mineralogyTr: 'Hidratlı Mg-Karbonat + Forsteritik Olivin + Otijenik Silika',
          astrobio: 'Western Rim campaign target exposing ancient hydrothermal and lacustrine carbonates.',
          astrobioTr: 'Kadim hidrotermal ve göl kıyı karbonatlarını yüzeyleyen Batı Kenarı kampanya hedefi.',
          chem: { SiO2: 40.5, FeO: 15.2, SO3: 5.4, MgO: 22.8, CaO: 6.3, Al2O3: 4.1, H2O: 4.4 },
          specPeaks: [0.44, 0.76, 0.93, 0.68, 0.81, 0.52, 0.74, 0.89, 0.65, 0.72],
          povTheme: 'delta',
          sampleKg: 2.5
        },
        {
          id: 'WP-3',
          code: 'BRA-C',
          name: 'Bright Angel & Neretva Vallis Channel Contact',
          nameTr: 'Bright Angel & Neretva Vallis Kanal Dokanağı',
          x: 78,
          y: 44,
          elevRel: +19,
          heading: 112,
          cameraHint: 'NAVCAM_LEFT',
          cam: 'Perseverance Mastcam-Z Telephoto · Sol 1388',
          rockType: 'Gilbert-Type Deltaic Foreset & Channel Sandstone',
          rockTypeTr: 'Gilbert Tipi Deltaik Ön-Set ve Kanal Kumtaşı',
          mineralogy: 'Pyroxene + Plagioclase + Fe/Mg Phyllosilicate cement',
          mineralogyTr: 'Piroksen + Plajiyoklaz + Fe/Mg Fillosilikat çimento',
          astrobio: 'Confirms sustained standing lake level and late fluvial discharge in Jezero.',
          astrobioTr: 'Jezero kalıcı göl seviyesini ve geç evre akarsu deşarjını kanıtlar.',
          chem: { SiO2: 48.9, FeO: 16.0, SO3: 4.9, MgO: 11.4, CaO: 7.8, Al2O3: 8.6, H2O: 3.2 },
          specPeaks: [0.62, 0.55, 0.78, 0.84, 0.69, 0.61, 0.73, 0.82, 0.58, 0.66],
          povTheme: 'channel',
          sampleKg: 3.0
        },
        {
          id: 'WP-4',
          code: 'DOX-D',
          name: 'Dox Castle Rim Megabreccia & Sulfate Mudstone',
          nameTr: 'Dox Castle Kenar Megabreşi ve Sülfat Çamurtaşı',
          x: 64,
          y: 76,
          elevRel: +8,
          heading: 155,
          cameraHint: 'FRONT_HAZCAM_LEFT_FRONT',
          cam: 'Perseverance WATSON + PIXL · Sol 1465',
          rockType: 'Fine-Grained Sulfate-Smectite & Rim Contact Lithology',
          rockTypeTr: 'İnce Taneli Sülfat-Smektit ve Krater Kenarı Litolojisi',
          mineralogy: 'Fe/Mg Smectite + Hydrated Ca/Mg Sulfates',
          mineralogyTr: 'Fe/Mg Smektit + Hidratlı Ca/Mg Sülfatlar',
          astrobio: 'Prime astrobiology benchmark lithology for biomarker preservation.',
          astrobioTr: 'Biyo-iz koruma potansiyeli yüksek astrobiyoloji referans litolojisi.',
          chem: { SiO2: 43.1, FeO: 17.4, SO3: 16.8, MgO: 9.6, CaO: 5.5, Al2O3: 5.2, H2O: 5.9 },
          specPeaks: [0.51, 0.88, 0.79, 0.64, 0.91, 0.73, 0.85, 0.68, 0.77, 0.90],
          povTheme: 'clay',
          sampleKg: 2.0
        }
      ]
    },
    nili_fossae: {
      id: 'nili_fossae',
      rover: 'perseverance',
      searchQuery: 'nili fossae jezero mars rover surface rocks',
      name: 'Nili Fossae · Carbonate & Clay Trough (HLS EZ)',
      nameTr: 'Nili Fossae · Karbonat & Kil Çöküntüsü (HLS EZ)',
      lat: 21.00,
      lon: 74.00,
      elev: -600,
      radMsvYr: 274,
      thermalInertiaBase: 310,
      albedoBase: 0.16,
      orbitalAgeYears: 14,
      hiRiseId: 'PSP_002888_2015 · Stale CRISM/HiRISE Prior -> Live 5-Domain Sync',
      dtmMetadata: {
        productId: 'DTEEC_002888_2015_003587_2015_A01',
        stereoPair: 'PSP_002888_2015 / PSP_003587_2015',
        truePostSpacingM: 1.5,
        tacticalGridScaleM: 10.0,
        method: 'SOCET SET Stereo DTM (1.5 m/post) + CRISM FRT00003E12 Co-Registration',
        coverageNote: 'This Nili Fossae stereo strip provides 1.5 m/post vertical post spacing (not 1.0 m/post) due to emission angle geometry; resampled to 10 m/cell tactical grid.',
        coverageNoteTr: 'Bu Nili Fossae stereo şeridi emisyon açısı geometrisi nedeniyle 1.0 m/post değil 1.5 m/post örnekleme aralığı sağlar; 10 m/hücre taktik ızgaraya aktarılmıştır.'
      },
      summary: 'Unexplored Noachian graben beyond static rover tracks: live 5-domain scanning detects shadowed radiation shelter and loose olivine dune drift.',
      summaryTr: 'Sabit rover izi dışındaki Noachian grabeni: 5-alanlı canlı tarama gölgeli radyasyon siperini ve kaymış olivin kumullarını sahada tespit eder.',
      base: { x: 18, y: 80, label: 'Nili Valley TRN Airlock' },
      boulders: [
        { x: 35, y: 60, r: 8, label: 'Isidis Impact Breccia Megablocks' },
        { x: 58, y: 46, r: 9, label: 'Ultramafic Caprock Boulder Apron' },
        { x: 38, y: 29, r: 7, label: 'Fault Scarp Rockfall Talus' }
      ],
      walls: [
        { x1: 22, y1: 48, x2: 48, y2: 52, w: 5, slope: 22, label: 'Graben Normal Fault Wall (22°)' },
        { x1: 60, y1: 25, x2: 86, y2: 33, w: 5, slope: 19, label: 'Eastern Basalt Mesa Rim (19°)' }
      ],
      sandTraps: [
        { x: 47, y: 74, rx: 12, ry: 7, label: 'Trough Floor Aeolian Sand Sheet' },
        { x: 70, y: 60, rx: 10, ry: 7, label: 'Olivine Dune Slipface Trap' }
      ],
      driftTrap: { x: 42, y: 62, r: 6 },
      waypoints: [
        {
          id: 'WP-1',
          code: 'CRB-A',
          name: 'Hydrothermal Mg-Carbonate Fracture Bench',
          nameTr: 'Hidrotermal Mg-Karbonat Kırık Sekisi',
          x: 32,
          y: 36,
          elevRel: +24,
          heading: 38,
          cameraHint: 'MAST',
          cam: 'HiRISE + CRISM Simulated Mastcam HUD · 1 m/px',
          rockType: 'Fractured Magnesite-Serpentine Altered Ultramafic',
          rockTypeTr: 'Kırıklı Manyezit-Serpantin Alterasyonlu Ultramafik Kaya',
          mineralogy: 'Magnesite (MgCO3) + Saponite + trace Serpentine',
          mineralogyTr: 'Manyezit + Saponit + eser Serpantin',
          astrobio: 'Serpentinization H2 production provides chemical energy for chemolithoautotrophic life.',
          astrobioTr: 'Serpantinleşme H2 üretimi kemoototrofik yaşam için kimyasal enerji sağlar.',
          chem: { SiO2: 39.4, FeO: 14.8, SO3: 3.8, MgO: 25.6, CaO: 5.9, Al2O3: 3.8, H2O: 6.4 },
          specPeaks: [0.48, 0.85, 0.94, 0.72, 0.66, 0.89, 0.91, 0.58, 0.74, 0.83],
          povTheme: 'boxwork',
          sampleKg: 2.5
        },
        {
          id: 'WP-2',
          code: 'SMC-B',
          name: 'Noachian Fe/Mg Smectite Phyllosilicate Mound',
          nameTr: 'Noachian Fe/Mg Smektit Fillosilikat Tepesi',
          x: 56,
          y: 25,
          elevRel: +31,
          heading: 75,
          cameraHint: 'NAVCAM',
          cam: 'Simulated xEMU Visor Navcam + LIBS',
          rockType: 'Deeply Weathered Noachian Clay Basement',
          rockTypeTr: 'Derin Ayrışmış Noachian Kil Temel Kayası',
          mineralogy: 'Ferrosaponite + Nontronite + Kaolinite cap',
          mineralogyTr: 'Ferrosaponit + Nontronit + Kaolinit şapka',
          astrobio: 'High bound-water content (>6 wt% H2O) ideal for both ISRU baking and biosignatures.',
          astrobioTr: 'Yüksek bağlı su içeriği (>%6 H2O) hem ISRU hem biyo-izler için idealdir.',
          chem: { SiO2: 47.2, FeO: 18.6, SO3: 4.2, MgO: 12.1, CaO: 4.0, Al2O3: 9.4, H2O: 6.8 },
          specPeaks: [0.64, 0.91, 0.83, 0.59, 0.77, 0.95, 0.80, 0.62, 0.71, 0.88],
          povTheme: 'clay',
          sampleKg: 3.0
        },
        {
          id: 'WP-3',
          code: 'BRE-C',
          name: 'Isidis Megabreccia Impact Block',
          nameTr: 'Isidis Megabreş Çarpma Bloğu',
          x: 79,
          y: 43,
          elevRel: +16,
          heading: 115,
          cameraHint: 'CHEMCAM',
          cam: 'Simulated xEMU Visor Telephoto HUD',
          rockType: 'Polylithologic Ancient Crustal Megabreccia',
          rockTypeTr: 'Polilitolojik Kadim Kabuk Megabreşi',
          mineralogy: 'Low-Ca Pyroxene + Plagioclase + Chlorite clasts',
          mineralogyTr: 'Düşük-Ca Piroksen + Plajiyoklaz + Klorit klastları',
          astrobio: 'Samples pre-Noachian (>4.1 Ga) primordial Martian crust.',
          astrobioTr: 'Noachian öncesi (>4.1 milyar yıl) ilksel Mars kabuğunu örnekler.',
          chem: { SiO2: 51.0, FeO: 14.2, SO3: 2.9, MgO: 10.8, CaO: 8.4, Al2O3: 10.5, H2O: 2.6 },
          specPeaks: [0.55, 0.61, 0.74, 0.82, 0.50, 0.68, 0.79, 0.64, 0.59, 0.72],
          povTheme: 'channel',
          sampleKg: 2.5
        },
        {
          id: 'WP-4',
          code: 'FLT-D',
          name: 'Trough Floor Hydrated Silica Vein',
          nameTr: 'Oluk Tabanı Hidratlı Silika Damarı',
          x: 66,
          y: 75,
          elevRel: +7,
          heading: 158,
          cameraHint: 'MCZ_RIGHT',
          cam: 'Simulated xEMU Visor Macro Spectrometer',
          rockType: 'Opaline Silica Fracture Sinter Deposit',
          rockTypeTr: 'Opalin Silika Kırık Sinter Çökeli',
          mineralogy: 'Opal-A + Chalcedony + Jarosite',
          mineralogyTr: 'Opal-A + Kalsedon + Jarosit',
          astrobio: 'Opaline silica sinters are among the best microfossil preservation media.',
          astrobioTr: 'Opalin silika sinterleri en iyi mikrofosil koruma ortamlarındandır.',
          chem: { SiO2: 68.4, FeO: 8.9, SO3: 6.1, MgO: 4.2, CaO: 3.1, Al2O3: 4.0, H2O: 7.4 },
          specPeaks: [0.92, 0.87, 0.64, 0.52, 0.89, 0.96, 0.78, 0.61, 0.84, 0.93],
          povTheme: 'boxwork',
          sampleKg: 2.0
        }
      ]
    },
    arcadia_ice: {
      id: 'arcadia_ice',
      rover: 'curiosity',
      searchQuery: 'arcadia planitia mars polygon permafrost ice surface',
      name: 'Arcadia Planitia · Shallow Polygon Ice Sheet',
      nameTr: 'Arcadia Planitia · Sığ Poligon Buz Örtüsü',
      lat: 39.20,
      lon: -175.00,
      elev: -4350,
      radMsvYr: 218,
      thermalInertiaBase: 235,
      albedoBase: 0.27,
      orbitalAgeYears: 13,
      hiRiseId: 'ESP_054821_2195 · Shallow Ice vs Fresh Dust Drift Assimilation',
      dtmMetadata: {
        productId: 'DTEEC_054821_2195_055098_2195_A01',
        stereoPair: 'ESP_054821_2195 / ESP_055098_2195',
        truePostSpacingM: 2.0,
        tacticalGridScaleM: 10.0,
        method: 'SOCET SET Stereo DTM (2.0 m/post) + SHARAD/SWIM 2.0 Subsurface Prior',
        coverageNote: 'High-latitude solar incidence yields 2.0 m/post DTM resolution (50 cm/px orthoimage); not every HiRISE image provides 1 m DTM spacing.',
        coverageNoteTr: 'Yüksek enlem güneş geliş açısı nedeniyle DTM çözünürlüğü 2.0 m/post düzeyindedir; her HiRISE görüntüsü 1 m DTM sağlamaz.'
      },
      summary: 'Coarse SWIM 2.0/TES priors mask recent wind-blown dust insulation over shallow ice; surface radiometer + GPR verifies bearing firmness live.',
      summaryTr: 'Kaba uydu verisi yüzeyi örten taze toz yalıtımını gizler; yerel termal radyometre ve GPR canlı taşıma gücünü doğrular.',
      base: { x: 20, y: 78, label: 'Starship TRN ISRU Pad' },
      boulders: [
        { x: 36, y: 62, r: 7, label: 'Secondary Crater Ejecta Blocks' },
        { x: 58, y: 46, r: 8, label: 'Periglacial Frost-Heave Boulders' },
        { x: 36, y: 30, r: 6, label: 'Expanded Crater Rim Talus' }
      ],
      walls: [
        { x1: 22, y1: 50, x2: 46, y2: 53, w: 5, slope: 18, label: 'Sublimated Scarp Terrace (18°)' },
        { x1: 60, y1: 26, x2: 85, y2: 32, w: 5, slope: 19, label: 'Lobate Rampart Ridge (19°)' }
      ],
      sandTraps: [
        { x: 47, y: 74, rx: 11, ry: 7, label: 'High-Albedo Dust Pocket (<75 tiu)' },
        { x: 70, y: 58, rx: 10, ry: 7, label: 'Polygon Trough Loose Fines' }
      ],
      driftTrap: { x: 42, y: 58, r: 6 },
      waypoints: [
        {
          id: 'WP-1',
          code: 'ICE-A',
          name: 'Thermal-Contraction Polygon Ice Trench',
          nameTr: 'Termal Büzülme Poligonu Buz Hendek Noktası',
          x: 34,
          y: 42,
          elevRel: +6,
          heading: 32,
          cameraHint: 'NAVCAM',
          cam: 'xEMU Visor Navcam + Neutron/GPR Probe',
          rockType: 'Ice-Cemented Permafrost Regolith (1.2 m Depth)',
          rockTypeTr: 'Buz Çimentolu Permafrost Regolit (1.2 m Derinlik)',
          mineralogy: 'Pore Water Ice (H2O) + Basaltic Regolith + Ca-Perchlorate trace',
          mineralogyTr: 'Gözenek Su Buzu + Bazaltik Regolit + eser Ca-perklorat',
          astrobio: 'Primary ISRU water feedstock for crew life support and methalox propellant.',
          astrobioTr: 'Mürettebat yaşam desteği ve metan-oksijen yakıtı için birincil su kaynağı.',
          chem: { SiO2: 42.1, FeO: 13.8, SO3: 7.4, MgO: 7.5, CaO: 6.8, Al2O3: 8.2, H2O: 14.2 },
          specPeaks: [0.38, 0.72, 0.96, 0.91, 0.64, 0.85, 0.98, 0.76, 0.69, 0.94],
          povTheme: 'ice',
          sampleKg: 2.5
        },
        {
          id: 'WP-2',
          code: 'RMP-B',
          name: 'Lobate Rampart Fluidized Ejecta Margin',
          nameTr: 'Loblu Rampart Akışkan Ejekta Kenarı',
          x: 54,
          y: 28,
          elevRel: +14,
          heading: 72,
          cameraHint: 'MAST',
          cam: 'xEMU Visor Stereo Mastcam',
          rockType: 'Impact-Melted Cryosphere Mudflow Breccia',
          rockTypeTr: 'Çarpma Erimesi Kriyosfer Çamur Akıntısı Breşi',
          mineralogy: 'Palagonitic Glass + Smectite + Sulfate salts',
          mineralogyTr: 'Palagonitik Cam + Smektit + Sülfat tuzları',
          astrobio: 'Impact into ice-rich ground generated transient warm subsurface brines.',
          astrobioTr: 'Buzca zengin zemine çarpma geçici sıcak yeraltı tuzlu suları oluşturmuştur.',
          chem: { SiO2: 46.0, FeO: 15.6, SO3: 8.9, MgO: 8.4, CaO: 7.2, Al2O3: 8.9, H2O: 8.1 },
          specPeaks: [0.54, 0.68, 0.84, 0.79, 0.71, 0.88, 0.82, 0.65, 0.74, 0.86],
          povTheme: 'ice',
          sampleKg: 2.0
        },
        {
          id: 'WP-3',
          code: 'GEO-C',
          name: 'Landing Pad Geotechnical Bearing Benchmark',
          nameTr: 'İniş Platformu Geoteknik Taşıma Gücü Noktası',
          x: 78,
          y: 45,
          elevRel: +4,
          heading: 108,
          cameraHint: 'FRONT_HAZCAM_LEFT_FRONT',
          cam: 'xEMU Visor Engineering Down-Cam',
          rockType: 'Indurated Duricrust over Compacted Basalt Sand',
          rockTypeTr: 'Sıkışmış Bazalt Kumu Üzerinde Sertleşmiş Durikrast',
          mineralogy: 'Plagioclase + Augite + Sulfate-cemented duricrust',
          mineralogyTr: 'Plajiyoklaz + Ojit + Sülfat çimentolu durikrast kabuk',
          astrobio: 'High thermal inertia (245 tiu) resists rocket plume erosion during landing.',
          astrobioTr: 'Yüksek termal atalet iniş sırasında roket egzoz aşındırmasına direnç gösterir.',
          chem: { SiO2: 49.2, FeO: 16.8, SO3: 9.2, MgO: 8.9, CaO: 8.6, Al2O3: 9.4, H2O: 2.4 },
          specPeaks: [0.60, 0.58, 0.71, 0.66, 0.63, 0.74, 0.69, 0.57, 0.64, 0.70],
          povTheme: 'channel',
          sampleKg: 2.0
        },
        {
          id: 'WP-4',
          code: 'SHD-D',
          name: 'Subsurface Regolith Shielding Trench Pit',
          nameTr: 'Yeraltı Regolit Radyasyon Siperi Hendek Noktası',
          x: 64,
          y: 76,
          elevRel: +2,
          heading: 152,
          cameraHint: 'CHEMCAM',
          cam: 'xEMU Visor Dosimeter + RAD Sensor',
          rockType: 'Fine-to-Coarse Regolith Aggregate (1.65 g/cm3)',
          rockTypeTr: 'İnce-Kaba Regolit Agregası (1.65 g/cm3)',
          mineralogy: 'Basaltic fines + Hydrogen-rich pore ice',
          mineralogyTr: 'Bazaltik ince taneler + Hidrojence zengin gözenek buzu',
          astrobio: 'Hydrogen-rich icy regolith attenuates secondary GCR neutrons 35% better than dry rock.',
          astrobioTr: 'Hidrojence zengin buzlu regolit ikincil GCR nötronlarını kuru kayadan %35 daha iyi sönümler.',
          chem: { SiO2: 44.8, FeO: 15.1, SO3: 7.8, MgO: 8.2, CaO: 7.4, Al2O3: 8.7, H2O: 11.5 },
          specPeaks: [0.46, 0.78, 0.90, 0.85, 0.69, 0.82, 0.94, 0.73, 0.68, 0.91],
          povTheme: 'ice',
          sampleKg: 2.5
        }
      ]
    }
  };

  // Enrich every preset waypoint with exact Mars coordinates, NASA dataset ID, and observation date (Item 13)
  Object.values(ZONES).forEach(z => {
    const dtmId = (z.dtmMetadata && z.dtmMetadata.productId) || z.hiRiseId;
    const defaultDate = z.id === 'gale_boxwork' ? '2025-03-14 UTC (MSL PDS Release 38)'
      : z.id === 'jezero_delta' ? '2025-02-20 UTC (M2020 PDS Release 13)'
      : z.id === 'nili_fossae' ? '2019-11-08 UTC (MRO CRISM/HiRISE PDS)'
      : '2021-06-15 UTC (SWIM 2.0 / HiRISE PDS)';
    (z.waypoints || []).forEach(wp => {
      if (wp.lat === undefined) wp.lat = +(z.lat + ((50 - wp.y) * 10) / 59270).toFixed(5);
      if (wp.lon === undefined) wp.lon = +(z.lon + ((wp.x - 50) * 10) / (59270 * Math.max(0.2, Math.cos(z.lat * Math.PI / 180)))).toFixed(5);
      if (!wp.datasetId) wp.datasetId = `${dtmId} · ${wp.cam}`;
      if (!wp.obsDate) wp.obsDate = defaultDate;
    });
  });

  /**
   * Published ground-truth surface traverse & partial-gravity bioenergetics benchmarks
   * used by `validatePhase2Benchmarks` and `tools/validate.js`.
   */
  const BENCHMARK_TRAVERSES = [
    {
      id: 'perseverance_jezero_sol0_420',
      zoneId: 'jezero_delta',
      mission: 'NASA Mars 2020 Perseverance (Sol 0–420 Octavia E. Butler -> Seitah -> Three Forks)',
      reference: 'Farley et al. (2022) Science 377; Verma et al. (2023) IEEE RA-L / JFR AutoNav',
      expectedDetourRatioMin: 1.04,
      expectedDetourRatioMax: 1.55,
      maxAllowedSafeHazardHits: 0,
      minNaiveOrbitalHazardHits: 4,
      maxMglPoseErrorM: 2.8,
      minVoDriftRatioPct: 1.2
    },
    {
      id: 'curiosity_gale_boxwork_sol4100_4450',
      zoneId: 'gale_boxwork',
      mission: 'NASA MSL Curiosity (Sol 4100–4450 Gediz Vallis & Mount Sharp Boxwork)',
      reference: 'MSL Mastcam/Navcam Surface Operations Telemetry (2024–2026)',
      expectedDetourRatioMin: 1.04,
      expectedDetourRatioMax: 1.55,
      maxAllowedSafeHazardHits: 0,
      minNaiveOrbitalHazardHits: 4,
      maxMglPoseErrorM: 2.8,
      minVoDriftRatioPct: 1.2
    },
    {
      id: 'nili_fossae_graben_eva_scenario',
      zoneId: 'nili_fossae',
      mission: 'Nili Fossae Noachian Fault Scarp & Olivine Dune Bypass Scenario',
      reference: 'Ehlmann & Edwards (2014) Annu. Rev. Earth Planet. Sci. 42; HiRISE DTEEC_002888_2015',
      expectedDetourRatioMin: 1.03,
      expectedDetourRatioMax: 1.60,
      maxAllowedSafeHazardHits: 0,
      minNaiveOrbitalHazardHits: 3,
      maxMglPoseErrorM: 2.8,
      minVoDriftRatioPct: 1.2
    },
    {
      id: 'arcadia_planitia_cryo_eva_scenario',
      zoneId: 'arcadia_ice',
      mission: 'Arcadia Planitia Permafrost Polygon & Low-TI Dust Pocket EVA Scenario',
      reference: 'Morgan et al. (2021) Nat. Astron. 5 (SWIM 2.0); HiRISE DTEEC_054821_2195',
      expectedDetourRatioMin: 1.03,
      expectedDetourRatioMax: 1.60,
      maxAllowedSafeHazardHits: 0,
      minNaiveOrbitalHazardHits: 3,
      maxMglPoseErrorM: 2.8,
      minVoDriftRatioPct: 1.2
    },
    {
      id: 'apollo_xemu_bioenergetics_benchmark',
      mission: 'Apollo 15–17 Lunar PLSS & NASA HIDH SP-2010-3407 Martian 0.38g Extrapolation',
      reference: 'Waligora & Horrigan (1975) NASA SP-368; NASA SP-2010-3407 Sec. 6.2',
      lunar16gWattsRange: [195, 290],
      mars038gNominalWattsRange: [290, 390],
      mars038gUphillSandWattsRange: [430, 650],
      maxSpeEscapeMin: 30.0
    }
  ];

  function makePrng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  function synthesizeCustomWaypoints(lat, lon, v, regionName, rnd, template) {
    const ice = v && v.ice !== null && v.ice !== undefined ? v.ice : 0;
    const ti = v && v.ti !== null && v.ti !== undefined ? v.ti : 250;
    const label = regionName || `${lat.toFixed(1)}°, ${lon.toFixed(1)}°`;
    let regime = 'mixed';
    if (ice > 0.25 || Math.abs(lat) >= 35) regime = 'cryo';
    else if (ti < 130) regime = 'dust';
    else if (ti >= 290) regime = 'basalt';

    const specs = {
      cryo: [
        { code: 'CRYO-1', pov: 'ice', rock: 'SWIM 2.0 Subsurface Dielectric/Thermal Anomaly (Unconfirmed — Not a Confirmed Ice Core)', rockTr: 'SWIM 2.0 Yeraltı Dielektrik/Termal Anomalisi (Doğrulanmamış — Kesin Buz Çekirdeği Değil)', min: 'Candidate pore ice consistency + Mg-sulfate regolith', minTr: 'Aday gözenek buzu tutarlılığı + Mg-sülfat regolit', astro: 'SWIM 2.0 multi-sensor consistency target (requires in-situ GPR/drill verification)', astroTr: 'SWIM 2.0 çoklu sensör tutarlılık hedefi (yerinde GPR/sondaj doğrulaması gerekir)', chem: { SO3: 7.4, SiO2: 33.2, FeO: 11.4, MgO: 6.2, Al2O3: 5.8, H2O: 36.0 }, peaks: [0.22, 0.36, 0.45, 0.88, 0.94, 0.72, 0.84, 0.96, 0.91] },
        { code: 'ICE-2', pov: 'ice', rock: 'Sub-Meter Thermokarst Rim Outcrop', rockTr: 'Metre-Altı Termokarst Yamaç Mostrası', min: 'Shallow frost lens candidate & phyllosilicate silt', minTr: 'Sığ buz merceği adayı ve fillosilikat silt', astro: 'Cryo-shielded organics preservation margin', astroTr: 'Dondurulmuş organik korunma sınırı', chem: { SO3: 6.1, SiO2: 30.8, FeO: 10.6, MgO: 5.9, Al2O3: 5.6, H2O: 41.0 }, peaks: [0.18, 0.31, 0.42, 0.86, 0.92, 0.78, 0.88, 0.98, 0.94] },
        { code: 'GEO-3', pov: 'delta', rock: 'Ejecta-Excavated Subsurface Lag', rockTr: 'Krater Fırlatması Alt Katman Çakılı', min: 'Basaltic lag + structural OH/H2O', minTr: 'Bazaltik çakıl + yapısal OH/H2O', astro: 'Regolith ice depth calibration point', astroTr: 'Regolit buz derinliği kalibrasyon noktası', chem: { SO3: 8.2, SiO2: 41.5, FeO: 14.8, MgO: 7.1, Al2O3: 7.4, H2O: 21.0 }, peaks: [0.35, 0.44, 0.56, 0.74, 0.82, 0.68, 0.79, 0.86, 0.78] }
      ],
      basalt: [
        { code: 'BSLT-1', pov: 'boxwork', rock: `Exposed Mafic Basalt Bedrock (TI ${Math.round(ti)} tiu)`, rockTr: `Yüzeylenmiş Mafik Bazalt Ana Kaya (TI ${Math.round(ti)} tiu)`, min: 'Olivine + low-Ca pyroxene + plagioclase', minTr: 'Olivin + düşük-Ca piroksen + plajiyoklaz', astro: 'Fresh igneous baseline; fracture fluid vein target', astroTr: 'Taze magmatik temel; çatlak akışkan damar hedefi', chem: { SO3: 3.8, SiO2: 48.2, FeO: 18.4, MgO: 10.6, Al2O3: 11.4, H2O: 2.1 }, peaks: [0.76, 0.84, 0.92, 0.58, 0.64, 0.52, 0.69, 0.56, 0.34] },
        { code: 'OLV-2', pov: 'boxwork', rock: 'Olivine-Cumulative Bench Scarp', rockTr: 'Olivin Zengin Yamaç Sekisi', min: 'Forsteritic olivine + secondary carbonate traces', minTr: 'Forsteritik olivin + ikincil karbonat izleri', astro: 'Past aqueous carbonation potential (SuperCam verify)', astroTr: 'Geçmiş sulu karbonasyon potansiyeli (SuperCam doğrulamalı)', chem: { SO3: 4.5, SiO2: 45.6, FeO: 19.2, MgO: 12.1, Al2O3: 9.8, H2O: 2.9 }, peaks: [0.81, 0.88, 0.86, 0.62, 0.71, 0.60, 0.77, 0.68, 0.42] },
        { code: 'SIL-3', pov: 'delta', rock: 'Altered Basalt & Silica Fracture Fill', rockTr: 'Ayrışmış Bazalt ve Silika Çatlak Dolgusu', min: 'Amorphous silica + Fe-oxide + trace sulfate', minTr: 'Amorf silika + Fe-oksit + eser sülfat', astro: 'Habitability porosity seal candidate', astroTr: 'Yaşanabilirlik gözenek mühür adayı', chem: { SO3: 6.2, SiO2: 50.4, FeO: 16.0, MgO: 8.4, Al2O3: 10.6, H2O: 3.4 }, peaks: [0.68, 0.72, 0.79, 0.71, 0.76, 0.65, 0.74, 0.62, 0.49] }
      ],
      dust: [
        { code: 'DUST-1', pov: 'delta', rock: `Ferric Aeolian Dust Mantle (TI ${Math.round(ti)} tiu)`, rockTr: `Ferrik Rüzgar Tozu Örtüsü (TI ${Math.round(ti)} tiu)`, min: 'Nanophase ferric oxide + fine sulfate dust', minTr: 'Nanofaz demir oksit + ince sülfat tozu', astro: 'Particle size & wheel slip calibration priority (TES proxy)', astroTr: 'Parçacık boyutu ve tekerlek kayma kalibrasyonu (TES göstergesi)', chem: { SO3: 9.4, SiO2: 44.2, FeO: 19.8, MgO: 6.8, Al2O3: 8.9, H2O: 4.2 }, peaks: [0.58, 0.66, 0.72, 0.62, 0.68, 0.58, 0.75, 0.64, 0.46] },
        { code: 'DUR-2', pov: 'delta', rock: 'Case-Hardened Duricrust Pocket', rockTr: 'Yüzey Sertleşmiş Durikrust Cebesi', min: 'Ca/Mg-sulfate cemented basaltic fines', minTr: 'Ca/Mg-sülfat çimentolu bazaltik toz', astro: 'Local regolith cohesion & ISRU oxygen feedstock', astroTr: 'Yerel regolit kohezyonu ve ISRU oksijen hammaddesi', chem: { SO3: 10.6, SiO2: 43.1, FeO: 18.6, MgO: 7.4, Al2O3: 8.6, H2O: 4.8 }, peaks: [0.62, 0.68, 0.74, 0.66, 0.71, 0.64, 0.80, 0.69, 0.51] },
        { code: 'LAG-3', pov: 'boxwork', rock: 'Wind-Scoured Basalt Lag Window', rockTr: 'Rüzgarla Süpürülmüş Bazalt Çakıl Penceresi', min: 'Coarse plagioclase-pyroxene grains', minTr: 'İri plajiyoklaz-piroksen taneleri', astro: 'Firm footing refuge inside high-dust basin', astroTr: 'Yüksek tozlu havzada sağlam zemin sığınağı', chem: { SO3: 5.8, SiO2: 47.0, FeO: 17.5, MgO: 8.8, Al2O3: 10.5, H2O: 2.6 }, peaks: [0.71, 0.78, 0.85, 0.60, 0.65, 0.54, 0.68, 0.58, 0.37] }
      ],
      mixed: [
        { code: 'REG-1', pov: 'delta', rock: `Basaltic-Evaporite Regolith (TI ${Math.round(ti)} tiu)`, rockTr: `Bazaltik-Evaporit Regolit (TI ${Math.round(ti)} tiu)`, min: 'Basalt clasts + secondary ferric-sulfate fines', minTr: 'Bazalt klastları + ikincil demir-sülfat ince tane', astro: 'Assimilated orbital prior — needs LIBS verification', astroTr: 'Sindirilen uydu öncülü — LIBS doğrulaması gerekir', chem: { SO3: 7.2, SiO2: 46.1, FeO: 17.8, MgO: 8.2, Al2O3: 9.8, H2O: 3.6 }, peaks: [0.66, 0.73, 0.81, 0.63, 0.69, 0.58, 0.73, 0.63, 0.44] },
        { code: 'OUT-2', pov: 'boxwork', rock: 'Fractured Sedimentary-Volcanic Contact', rockTr: 'Çatlaklı Tortul-Volkanik Dokanak', min: 'Pyroxene + phyllosilicate + hydrated salt trace', minTr: 'Piroksen + fillosilikat + hidratlı tuz izi', astro: 'Sub-grid strata continuity sampling stop', astroTr: 'Uydu-altı tabaka sürekliliği örnekleme noktası', chem: { SO3: 8.1, SiO2: 45.2, FeO: 16.9, MgO: 8.6, Al2O3: 9.4, H2O: 4.5 }, peaks: [0.64, 0.71, 0.77, 0.69, 0.74, 0.63, 0.78, 0.70, 0.52] },
        { code: 'RIM-3', pov: 'delta', rock: 'Elevated Bench Caprock Margin', rockTr: 'Yüksek Seki Örtü Kayası Sınırı', min: 'Plagioclase-rich basaltic breccia', minTr: 'Plajiyoklazca zengin bazaltik breş', astro: 'Sky-view GCR shielding + MGL skyline survey', astroTr: 'Ufuk GCR kalkanlaması + MGL silüet taraması', chem: { SO3: 5.4, SiO2: 47.8, FeO: 16.5, MgO: 8.9, Al2O3: 10.8, H2O: 2.8 }, peaks: [0.72, 0.79, 0.84, 0.61, 0.66, 0.56, 0.70, 0.59, 0.39] }
      ]
    }[regime];

    return specs.map((sp, idx) => {
      const twp = template.waypoints[idx] || template.waypoints[0];
      const px = Math.max(12, Math.min(88, Math.round(twp.x + (rnd() - 0.5) * 14)));
      const py = Math.max(12, Math.min(86, Math.round(twp.y + (rnd() - 0.5) * 12)));
      const chem = {};
      Object.entries(sp.chem).forEach(([ox, val]) => {
        chem[ox] = +Math.max(0.8, val + (rnd() - 0.5) * 1.4).toFixed(1);
      });
      const wpLat = +(lat + ((50 - py) * 10) / 59270).toFixed(5);
      const wpLon = +(lon + ((px - 50) * 10) / (59270 * Math.max(0.2, Math.cos(lat * Math.PI / 180)))).toFixed(5);
      return {
        id: `WP-${idx + 1}`,
        code: sp.code,
        name: `${label} Target ${idx + 1} (${sp.code})`,
        nameTr: `${label} Hedef ${idx + 1} (${sp.code})`,
        lat: wpLat,
        lon: wpLon,
        datasetId: regime === 'cryo' ? 'SWIM 2.0_NH_SH_2021 + MGS TES TI' : 'MOLA MEGDR128 + MGS TES + CTX',
        obsDate: '2021–2025 PDS Orbital Synthesis',
        x: px,
        y: py,
        heading: Math.round((twp.heading + rnd() * 40) % 360),
        elevRel: Math.round(4 + idx * 6 + rnd() * 5),
        cameraHint: twp.cameraHint || (idx === 0 ? 'MAST' : (idx === 1 ? 'CHEMCAM' : 'NAVCAM')),
        cam: idx === 0 ? 'AutoNav Mastcam + Live 5-Domain Sync' : 'SuperCam LIBS/VNIR + PIXL',
        sampleKg: +(1.2 + idx * 0.4 + rnd() * 0.6).toFixed(1),
        rockType: sp.rock,
        rockTypeTr: sp.rockTr,
        mineralogy: sp.min,
        mineralogyTr: sp.minTr,
        astrobio: sp.astro,
        astrobioTr: sp.astroTr,
        chem,
        specPeaks: sp.peaks,
        povTheme: sp.pov
      };
    });
  }

  /**
   * Build a coordinate-seeded custom 1 km x 1 km local EVA zone for any clicked coordinate on Mars.
   */
  function zoneFromCoords(lat, lon, v, regionName) {
    const dGale = Math.hypot(lat - (-5.08), lon - 137.85);
    if (dGale < 5.5) return ZONES.gale_boxwork;
    const dJez = Math.hypot(lat - 18.38, lon - 77.58);
    if (dJez < 4.5) return ZONES.jezero_delta;
    const dNili = Math.hypot(lat - 21.0, lon - 74.0);
    if (dNili < 4.5) return ZONES.nili_fossae;
    const dArc = Math.hypot(lat - 39.2, ((lon + 540) % 360) - 180 - (-188 + 360));
    if (dArc < 8.0) return ZONES.arcadia_ice;

    const template = (v && v.ice && v.ice > 0.25) ? ZONES.arcadia_ice : ZONES.gale_boxwork;
    const s1 = Math.round((lat + 90) * 1000) * 73856093;
    const s2 = Math.round((lon + 180) * 1000) * 19349663;
    const rnd = makePrng((s1 ^ s2) >>> 0);

    const baseX = Math.round(11 + rnd() * 14);
    const baseY = Math.round(72 + rnd() * 16);
    const wallSlope = Math.min(25, Math.max(17, Math.round(18 + (v && v.slope ? v.slope * 0.5 : rnd() * 5))));

    const boulders = [
      { x: Math.round(30 + rnd() * 14), y: Math.round(54 + rnd() * 14), r: 7, label: 'Sub-Grid Ejecta Cluster' },
      { x: Math.round(52 + rnd() * 16), y: Math.round(38 + rnd() * 16), r: 8, label: 'Fractured Caprock Talus' },
      { x: Math.round(34 + rnd() * 16), y: Math.round(24 + rnd() * 12), r: 6, label: 'Regolith Megablock Apron' }
    ];
    const walls = [
      { x1: Math.round(18 + rnd() * 8), y1: Math.round(45 + rnd() * 8), x2: Math.round(44 + rnd() * 8), y2: Math.round(49 + rnd() * 7), w: 5, slope: wallSlope, label: `Local Fault Scarp (${wallSlope}°)` },
      { x1: Math.round(58 + rnd() * 8), y1: Math.round(22 + rnd() * 7), x2: Math.round(82 + rnd() * 8), y2: Math.round(30 + rnd() * 8), w: 5, slope: wallSlope - 1, label: `Bench Rim Wall (${wallSlope - 1}°)` }
    ];
    const sandTraps = [
      { x: Math.round(42 + rnd() * 12), y: Math.round(68 + rnd() * 10), rx: 11, ry: 7, label: 'Migrated Aeolian Sand Trap' },
      { x: Math.round(64 + rnd() * 12), y: Math.round(54 + rnd() * 10), rx: 10, ry: 7, label: 'Low-TI Loose Dust Pocket' }
    ];
    const driftTrap = {
      x: Math.round(baseX + 20 + rnd() * 10),
      y: Math.round(baseY - 22 - rnd() * 8),
      r: 6
    };
    const waypoints = synthesizeCustomWaypoints(lat, lon, v, regionName, rnd, template);
    const rover = (lat >= 5 && lon >= 50 && lon <= 105) ? 'perseverance' : 'curiosity';

    return {
      ...template,
      id: 'custom_site',
      rover,
      searchQuery: `${regionName || 'mars'} ${rover} rover surface terrain geology`,
      hiRiseId: `ORBITAL-SEEDED 1 km MICRO-DEM · ${regionName || 'MARS'} (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`,
      dtmMetadata: {
        productId: `SYNTH_CTX_MOLA_${Math.round(Math.abs(lat) * 100)}_${Math.round(Math.abs(lon) * 100)}`,
        stereoPair: 'CTX 6 m/px + MOLA MEGDR Conditioning (No 1.0 m/post HiRISE Stereo Pair)',
        truePostSpacingM: 10.0,
        tacticalGridScaleM: 10.0,
        method: 'MOLA/TES Physics-Conditioned Micro-DEM + Live AutoNav Spot Assimilation',
        coverageNote: 'HiRISE 1 m/post stereo DTMs cover <3% of Mars; at arbitrary global coordinates, the 10 m/cell tactical grid is conditioned on MOLA/TES/CTX until local AutoNav LiDAR scans refine it.',
        coverageNoteTr: 'HiRISE 1 m/post stereo DTM’leri Mars’ın <%3’ünü kapsar; rastgele koordinatlarda 10 m/hücre taktik ızgara MOLA/TES/CTX ile koşullandırılır ve yerel AutoNav LiDAR taramasıyla doğrulanır.'
      },
      name: `${regionName || 'Selected Site'} · TRN+AutoNav 10m/cell Biome`,
      nameTr: `${regionName || 'Seçili Saha'} · TRN+AutoNav 10m/hücre Biyomu`,
      summary: 'Orbital-prior seeded micro-DEM conditioned on local MOLA/TES/SWIM physics; click canvas to dispatch AutoNav spot scans and refine geochemical/terrain confidence.',
      summaryTr: 'Yerel MOLA/TES/SWIM verileriyle koşullandırılmış mikro-DEM; AutoNav nokta taraması göndermek ve saha güvenini artırmak için haritaya tıklayın.',
      lat: +(lat || 0).toFixed(2),
      lon: +(lon || 0).toFixed(2),
      elev: v ? Math.round(v.elev) : -2500,
      radMsvYr: v ? Math.round(v.rad) : 235,
      thermalInertiaBase: v && v.ti ? Math.round(v.ti) : 250,
      base: { x: baseX, y: baseY, label: `${regionName || 'Site'} TRN Touchdown` },
      boulders,
      walls,
      sandTraps,
      driftTrap,
      waypoints,
    };
  }

  global.MDE_EVA_ZONES = {
    SYSTEM_ARCH,
    DOMAINS,
    SCORE_MODES,
    resolveWeights,
    ZONES,
    BENCHMARK_TRAVERSES,
    makePrng,
    synthesizeCustomWaypoints,
    zoneFromCoords,
  };
})(typeof module === 'object' && module.exports ? module.exports : globalThis);
