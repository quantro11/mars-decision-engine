// Phase 2: NASA xGDS + Perseverance (TRN + AutoNav + MGL) 5-Domain Surface Assimilation,
// Real-Time Biome Scoring, xEMU Suit Bioenergetics, Walkback Limit, and Helmet Visor HUD.
(function (global) {
  'use strict';

  const MARS_G = 3.71; // m/s^2 (0.378 g_Earth)
  const SUIT_O2_CAP_G = 850; // Primary usable metabolic O2 (g) per astronaut suit
  const SUIT_BATT_CAP_WH = 960; // PLSS Li-Ion battery capacity (Wh)
  const SUIT_WATER_CAP_L = 3.8; // LCVG feedwater sublimator tank capacity (L)
  const BASE_AVIONICS_W = 95; // PLSS fan, CO2 RCA scrubber, HUD, radio, pump base power (W)

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

  function getEsc() {
    if (global.MDE_FMT && global.MDE_FMT.escHtml) return global.MDE_FMT.escHtml;
    return (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const getI18N = () => global.MDE_I18N || (typeof globalThis !== 'undefined' ? globalThis.MDE_I18N : null);
  const isTr = () => { const m = getI18N(); return !!(m && m.getLang && m.getLang() === 'tr'); };

  function makePrng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Build a deterministic 1 km x 1 km (100x100 cells @ 10m/cell, rendered at 1 m/px)
   * terrain grid containing BOTH coarse orbital priors and live in-situ ground truth.
   */
  function buildLocalGrid(zone) {
    const N = 100, total = N * N;
    const slope = new Float32Array(total);
    const hazard = new Uint8Array(total); // 0=clear, 1=boulder, 2=wall, 3=sandTrap
    const elev = new Float32Array(total);
    const ti = new Float32Array(total);
    const radLocal = new Float32Array(total);
    const albedo = new Float32Array(total);
    const driftFlag = new Uint8Array(total); // 1 = migrated/sub-grid anomaly missed by orbital prior

    const seed = Math.abs(Math.round((zone.lat || 0) * 100 + (zone.lon || 0) * 100)) || 42;
    const tiBase = zone.thermalInertiaBase || 260;
    const albBase = zone.albedoBase || 0.21;
    const radBase = zone.radMsvYr || 235;

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const wave = Math.sin((x + seed) * 0.11) * Math.cos((y + seed) * 0.09) * 14 +
                     Math.sin((x * 0.23 - y * 0.19)) * 6 +
                     (90 - y) * 0.35;
        elev[i] = (zone.elev || -2500) + wave;
        slope[i] = Math.max(1.2, Math.min(12.5, 2.8 + Math.abs(Math.sin(x * 0.17 + y * 0.13 + seed * 0.01)) * 5.2));
        ti[i] = Math.max(70, Math.min(480, tiBase + Math.sin(x * 0.09 + y * 0.07) * 55));
        albedo[i] = Math.max(0.11, Math.min(0.35, albBase + Math.cos(x * 0.12 - y * 0.1) * 0.035));
        radLocal[i] = radBase;
      }
    }

    // Coarse orbital prior BEFORE stamping sub-grid temporal drifts & sharp meter-scale boulders
    const orbSlope = new Float32Array(total);
    const orbHazard = new Uint8Array(total);
    const orbElev = new Float32Array(total);
    const orbTi = new Float32Array(total);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let sumE = 0, sumS = 0, sumT = 0, cnt = 0;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < N && ny >= 0 && ny < N) {
              const ni = ny * N + nx;
              sumE += elev[ni];
              sumS += slope[ni];
              sumT += ti[ni];
              cnt++;
            }
          }
        }
        const i = y * N + x;
        orbElev[i] = sumE / cnt;
        orbSlope[i] = Math.min(11.5, sumS / cnt);
        orbTi[i] = sumT / cnt;
      }
    }

    // Known macro sand pockets from stale orbit (shifted ~9 cells vs migrated dunes!)
    for (const st of zone.sandTraps) {
      for (let y = Math.max(0, st.y - st.ry - 2); y <= Math.min(N - 1, st.y + st.ry + 2); y++) {
        for (let x = Math.max(0, st.x - st.rx - 2); x <= Math.min(N - 1, st.x + st.rx + 2); x++) {
          const d = Math.hypot((x - st.x) / st.rx, (y - st.y) / st.ry);
          if (d <= 1.0) {
            const i = y * N + x;
            hazard[i] = 3;
            slope[i] = Math.max(slope[i], 7.0);
            ti[i] = Math.min(ti[i], 78);
            albedo[i] = Math.min(0.36, albedo[i] + 0.06);
          }
        }
      }
    }

    // Migrated temporal-drift aeolian sand sheet lying on direct orbital paths (invisible to stale orbit)
    const dt = zone.driftTrap;
    if (dt) {
      for (let y = Math.max(0, dt.y - dt.r - 1); y <= Math.min(N - 1, dt.y + dt.r + 1); y++) {
        for (let x = Math.max(0, dt.x - dt.r - 1); x <= Math.min(N - 1, dt.x + dt.r + 1); x++) {
          const d = Math.hypot(x - dt.x, y - dt.y);
          if (d <= dt.r) {
            const i = y * N + x;
            hazard[i] = 3;
            driftFlag[i] = 1;
            slope[i] = Math.max(slope[i], 8.2);
            ti[i] = 68;
          }
        }
      }
    }

    // Sub-grid boulders (unresolved in coarse orbital MOLA/TES prior, detected in-situ by AutoNav)
    for (const b of zone.boulders) {
      for (let y = Math.max(0, b.y - b.r - 1); y <= Math.min(N - 1, b.y + b.r + 1); y++) {
        for (let x = Math.max(0, b.x - b.r - 1); x <= Math.min(N - 1, b.x + b.r + 1); x++) {
          const d = Math.hypot(x - b.x, y - b.y);
          if (d <= b.r) {
            const i = y * N + x;
            hazard[i] = 1;
            driftFlag[i] = 1;
            slope[i] = 19.5 + (1 - d / b.r) * 8;
            ti[i] = Math.max(ti[i], 395);
          }
        }
      }
    }

    // Steep scarp / crater rim walls (provides local radiation sky-view shelter nearby)
    for (const w of zone.walls) {
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1, len2 = dx * dx + dy * dy || 1;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const t = Math.max(0, Math.min(1, ((x - w.x1) * dx + (y - w.y1) * dy) / len2));
          const px = w.x1 + t * dx, py = w.y1 + t * dy;
          const d = Math.hypot(x - px, y - py);
          const i = y * N + x;
          if (d <= w.w * 0.55) {
            hazard[i] = 2;
            slope[i] = w.slope;
            elev[i] += 14;
            ti[i] = 435;
          } else if (d <= 12) {
            // Horizon shadowing reduces local cosmic-ray sky-view dose beside rock scarps
            radLocal[i] = Math.min(radLocal[i], radBase * (0.86 + (d / 12) * 0.14));
          }
        }
      }
    }

    // Ensure a sub-grid boulder cluster and a migrated aeolian sand pocket lie along the primary
    // inter-waypoint chords (invisible in coarse 5 km/px orbSlope/orbHazard prior, detected in-situ by AutoNav)
    if (zone.waypoints && zone.waypoints.length >= 2) {
      const wp0 = zone.waypoints[0], wp1 = zone.waypoints[1];
      const bx = Math.round((zone.base.x + wp0.x) * 0.5), by = Math.round((zone.base.y + wp0.y) * 0.5);
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const nx = bx + dx, ny = by + dy;
          if (nx >= 0 && nx < N && ny >= 0 && ny < N && Math.hypot(dx, dy) <= 3.2) {
            const idx = ny * N + nx;
            hazard[idx] = 1;
            driftFlag[idx] = 1;
            slope[idx] = Math.max(slope[idx], 20.5);
            ti[idx] = Math.max(ti[idx], 395);
          }
        }
      }
      const sx = Math.round((wp0.x + wp1.x) * 0.5), sy = Math.round((wp0.y + wp1.y) * 0.5);
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const nx = sx + dx, ny = sy + dy;
          if (nx >= 0 && nx < N && ny >= 0 && ny < N && Math.hypot(dx, dy) <= 4.2) {
            const idx = ny * N + nx;
            if (hazard[idx] === 0) {
              hazard[idx] = 3;
              driftFlag[idx] = 1;
              slope[idx] = Math.max(slope[idx], 8.2);
              ti[idx] = 68;
            }
          }
        }
      }
    }

    // Ensure base and waypoints themselves sit on navigable micro-pads + expose high spectral bedrock at outcrops
    const clearPad = (cx, cy, isWp) => {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const nx = Math.round(cx + dx), ny = Math.round(cy + dy);
          if (nx >= 0 && nx < N && ny >= 0 && ny < N) {
            const i = ny * N + nx;
            if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) {
              hazard[i] = 0;
              driftFlag[i] = 0;
              slope[i] = Math.min(slope[i], 4.5);
            }
            if (isWp) {
              ti[i] = Math.max(ti[i], 360);
              albedo[i] = Math.max(0.14, albedo[i] - 0.03);
            }
          }
        }
      }
    };
    clearPad(zone.base.x, zone.base.y, false);
    zone.waypoints.forEach(wp => clearPad(wp.x, wp.y, true));

    return { N, slope, hazard, elev, ti, radLocal, albedo, driftFlag, orbSlope, orbHazard, orbElev, orbTi };
  }

  /**
   * Evaluate live 5-domain suitability scores across the 100x100 local micro-DEM grid (10 m/cell).
   */
  function scoreLocalDomains(grid, zone, scoreModeId = 'balanced', customWeights = null) {
    const N = grid.N, total = N * N;
    const w = resolveWeights(scoreModeId, customWeights);

    const topography = new Float32Array(total);
    const geomorphology = new Float32Array(total);
    const thermal = new Float32Array(total);
    const radiation = new Float32Array(total);
    const optical = new Float32Array(total);
    const composite = new Float32Array(total);

    let sumTopo = 0, sumGeo = 0, sumTherm = 0, sumRad = 0, sumOpt = 0, sumComp = 0;
    let orbTopo = 0, orbGeo = 0, orbTherm = 0, orbRad = 0, orbOpt = 0;
    const radBase = zone.radMsvYr || 235;

    for (let i = 0; i < total; i++) {
      const sl = grid.slope[i], hz = grid.hazard[i], tiVal = grid.ti[i], rLocal = grid.radLocal[i], alb = grid.albedo[i];
      const tScore = Math.max(5, Math.min(99, 98 - sl * 4.1));
      const gScore = Math.max(5, Math.min(99, (hz === 1 || hz === 2) ? 16 : (hz === 3 ? 38 : (92 - sl * 1.8))));
      const thScore = Math.max(8, Math.min(99, ((tiVal - 55) / 390) * 85 + 14));
      const rScore = Math.max(10, Math.min(99, 95 - ((rLocal - 180) / 140) * 48));
      const oScore = Math.max(12, Math.min(99, 92 - Math.abs(alb - 0.19) * 210 + (hz === 0 && tiVal > 300 ? 10 : 0)));
      const cScore = tScore * w.topography + gScore * w.geomorphology + thScore * w.thermal + rScore * w.radiation + oScore * w.optical;

      topography[i] = tScore;
      geomorphology[i] = gScore;
      thermal[i] = thScore;
      radiation[i] = rScore;
      optical[i] = oScore;
      composite[i] = cScore;

      sumTopo += tScore; sumGeo += gScore; sumTherm += thScore; sumRad += rScore; sumOpt += oScore; sumComp += cScore;

      orbTopo += Math.max(10, Math.min(98, 98 - grid.orbSlope[i] * 3.6));
      orbGeo += Math.max(15, Math.min(96, 86 - grid.orbSlope[i] * 1.4));
      orbTherm += Math.max(15, Math.min(96, ((grid.orbTi[i] - 55) / 390) * 80 + 18));
      orbRad += Math.max(15, Math.min(96, 95 - ((radBase - 180) / 140) * 48));
      orbOpt += 64;
    }

    return {
      topography, geomorphology, thermal, radiation, optical, composite,
      inSituMean: {
        topography: +(sumTopo / total).toFixed(1),
        geomorphology: +(sumGeo / total).toFixed(1),
        thermal: +(sumTherm / total).toFixed(1),
        radiation: +(sumRad / total).toFixed(1),
        optical: +(sumOpt / total).toFixed(1),
        composite: +(sumComp / total).toFixed(1)
      },
      orbitalMean: {
        topography: +(orbTopo / total).toFixed(1),
        geomorphology: +(orbGeo / total).toFixed(1),
        thermal: +(orbTherm / total).toFixed(1),
        radiation: +(orbRad / total).toFixed(1),
        optical: +(orbOpt / total).toFixed(1)
      }
    };
  }

  /**
   * Build progressive 0..8 AutoNav assimilation mask (+ interactive custom spot-scan pulses) across 1 km x 1 km.
   */
  function buildAssimilationMask(grid, zone, safePath, scanStep = 8, customScanPts = []) {
    const N = grid.N, total = N * N;
    const step = Math.max(0, Math.min(8, Math.round(scanStep)));
    const mask = new Uint8Array(total);
    if (step === 8) {
      mask.fill(1);
      const endPt = safePath.length ? safePath[safePath.length - 1] : [zone.base.x, zone.base.y];
      return { mask, assimilatedPct: 100, roverX: endPt[0], roverY: endPt[1] };
    }

    const frac = step / 8;
    const maxPathIdx = step === 0 ? 0 : Math.min(safePath.length - 1, Math.floor(safePath.length * frac));
    const landerRadius = 11.5; // immediate ~115m TRN landing lidar footprint (~4%)
    const beamRadius = 11 + step * 3.4;

    // Immediate landing footprint around base
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (Math.hypot(x - zone.base.x, y - zone.base.y) <= landerRadius) {
          mask[y * N + x] = 1;
        }
      }
    }

    // Progressive AutoNav corridor sweep along safePath up to current step
    if (step > 0 && safePath.length > 0) {
      const stride = Math.max(1, Math.floor(maxPathIdx / 28));
      for (let p = 0; p <= maxPathIdx; p += stride) {
        const [px, py] = safePath[p];
        const y0 = Math.max(0, Math.floor(py - beamRadius)), y1 = Math.min(N - 1, Math.ceil(py + beamRadius));
        const x0 = Math.max(0, Math.floor(px - beamRadius)), x1 = Math.min(N - 1, Math.ceil(px + beamRadius));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            if (Math.hypot(x - px, y - py) <= beamRadius) mask[y * N + x] = 1;
          }
        }
      }
    }

    // Interactive user-dispatched AutoNav Spot Scans
    if (Array.isArray(customScanPts)) {
      for (const sp of customScanPts) {
        const r = sp.r || 11;
        const y0 = Math.max(0, Math.floor(sp.y - r)), y1 = Math.min(N - 1, Math.ceil(sp.y + r));
        const x0 = Math.max(0, Math.floor(sp.x - r)), x1 = Math.min(N - 1, Math.ceil(sp.x + r));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            if (Math.hypot(x - sp.x, y - sp.y) <= r) mask[y * N + x] = 1;
          }
        }
      }
    }

    let count = 0;
    for (let i = 0; i < total; i++) count += mask[i];
    const roverPt = safePath[maxPathIdx] || [zone.base.x, zone.base.y];
    return {
      mask,
      assimilatedPct: Math.max(1, Math.min(99, Math.round((count / total) * 100))),
      roverX: roverPt[0],
      roverY: roverPt[1]
    };
  }

  /**
   * Meter-scale 8-connected A* between two points on the 100x100 local grid using an O(N log N) binary min-heap.
   */
  function astarLeg(grid, sx, sy, gx, gy, maxSlope, useOrbitalOnly = false) {
    const N = grid.N, total = N * N;
    const gScore = new Float32Array(total).fill(Infinity);
    const fScore = new Float32Array(total).fill(Infinity);
    const parent = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const startIdx = sy * N + sx, goalIdx = gy * N + gx;
    gScore[startIdx] = 0;
    fScore[startIdx] = Math.hypot(gx - sx, gy - sy);

    // Binary min-heap keyed on fScore
    const heap = [startIdx];
    const heapPush = (node) => {
      heap.push(node);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (fScore[heap[p]] <= fScore[node]) break;
        heap[i] = heap[p];
        i = p;
      }
      heap[i] = node;
    };
    const heapPop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length > 0) {
        let i = 0;
        const half = heap.length >> 1;
        while (i < half) {
          let l = (i << 1) + 1, r = l + 1;
          let best = (r < heap.length && fScore[heap[r]] < fScore[heap[l]]) ? r : l;
          if (fScore[last] <= fScore[heap[best]]) break;
          heap[i] = heap[best];
          i = best;
        }
        heap[i] = last;
      }
      return top;
    };

    const dirs = [
      [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
      [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2]
    ];

    while (heap.length) {
      const cur = heapPop();
      if (cur === goalIdx) break;
      if (closed[cur]) continue;
      closed[cur] = 1;

      const cy = (cur / N) | 0, cx = cur - cy * N;
      for (const [dx, dy, stepLen] of dirs) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue;
        const ni = ny * N + nx;
        if (closed[ni]) continue;

        const sl = useOrbitalOnly ? grid.orbSlope[ni] : grid.slope[ni];
        const hz = useOrbitalOnly ? grid.orbHazard[ni] : grid.hazard[ni];
        if (!useOrbitalOnly && (hz === 1 || hz === 2 || sl > maxSlope)) continue;

        const sandPen = !useOrbitalOnly && hz === 3 ? 4.2 : 0;
        const slopePen = useOrbitalOnly ? 0.015 * sl : 0.25 * sl;
        const cross = Math.abs((nx - sx) * (gy - sy) - (gx - sx) * (ny - sy)) * 0.002;
        const tentative = gScore[cur] + stepLen * (1 + slopePen + sandPen);
        if (tentative < gScore[ni]) {
          parent[ni] = cur;
          gScore[ni] = tentative;
          fScore[ni] = tentative + Math.hypot(gx - nx, gy - ny) + cross;
          heapPush(ni);
        }
      }
    }

    const path = [];
    if (parent[goalIdx] !== -1 || startIdx === goalIdx) {
      let cur = goalIdx;
      while (cur !== -1) {
        const y = (cur / N) | 0, x = cur - y * N;
        path.push([x, y]);
        cur = parent[cur];
      }
      path.reverse();
    } else {
      const steps = Math.max(1, Math.round(Math.hypot(gx - sx, gy - sy)));
      for (let s = 0; s <= steps; s++) {
        path.push([Math.round(sx + (gx - sx) * s / steps), Math.round(sy + (gy - sy) * s / steps)]);
      }
    }
    return path;
  }

  function applyDynamicHazards(grid, zone, dynamicHazards) {
    if (!Array.isArray(dynamicHazards) || !dynamicHazards.length) return;
    const N = grid.N;
    const nearPad = (px, py) => {
      if (Math.hypot(px - zone.base.x, py - zone.base.y) <= 4) return true;
      return zone.waypoints.some(wp => Math.hypot(px - wp.x, py - wp.y) <= 4);
    };
    for (const h of dynamicHazards) {
      const r = h.r || 5;
      const y0 = Math.max(0, Math.floor(h.y - r)), y1 = Math.min(N - 1, Math.ceil(h.y + r));
      const x0 = Math.max(0, Math.floor(h.x - r)), x1 = Math.min(N - 1, Math.ceil(h.x + r));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (Math.hypot(x - h.x, y - h.y) <= r && !nearPad(x, y)) {
            const idx = y * N + x;
            grid.hazard[idx] = 1;
            grid.driftFlag[idx] = 1;
            grid.slope[idx] = Math.max(grid.slope[idx], 21.5);
            grid.ti[idx] = Math.max(grid.ti[idx], 385);
          }
        }
      }
    }
  }

  function computeVhfLos(grid, bx, by, rx, ry) {
    const N = grid.N;
    const distCells = Math.hypot(rx - bx, ry - by);
    const distM = distCells * 10;
    const bIdx = Math.max(0, Math.min(N - 1, Math.round(by))) * N + Math.max(0, Math.min(N - 1, Math.round(bx)));
    const rIdx = Math.max(0, Math.min(N - 1, Math.round(ry))) * N + Math.max(0, Math.min(N - 1, Math.round(rx)));
    const h0 = grid.elev[bIdx] + 6; // 6 m hab mast antenna
    const h1 = grid.elev[rIdx] + 2; // 2 m astronaut/rover VHF whip
    const steps = 24;
    let occludedSteps = 0, minClearanceM = 999, blockPt = null;
    for (let s = 2; s < steps - 1; s++) {
      const t = s / steps;
      const sx = Math.max(0, Math.min(N - 1, Math.round(bx + (rx - bx) * t)));
      const sy = Math.max(0, Math.min(N - 1, Math.round(by + (ry - by) * t)));
      const idx = sy * N + sx;
      const hRay = h0 + (h1 - h0) * t;
      const clearance = hRay - grid.elev[idx];
      if (clearance < minClearanceM) minClearanceM = clearance;
      if (clearance < -0.5) {
        occludedSteps++;
        if (!blockPt) blockPt = { x: sx, y: sy };
      }
    }
    const losClear = occludedSteps === 0;
    const linkMarginDb = +(Math.max(-18, Math.min(28, 22 - distM * 0.008 - occludedSteps * 4.5))).toFixed(1);
    return {
      losClear,
      occludedSteps,
      minClearanceM: distCells < 2 ? 6.0 : +minClearanceM.toFixed(1),
      linkMarginDb,
      blockPt,
      distM: Math.round(distM),
      status: losClear ? 'DIRECT VHF LoS' : 'TERRAIN OCCLUDED -> RELAY'
    };
  }

  /**
   * Compute full multi-waypoint EVA loop, TRN/AutoNav/MGL localization, 5-domain xGDS fusion,
   * VHF Line-of-Sight check, 30-min SPE escape shelter path, and Pandolf Martian bioenergetics.
   */
  function simulateEVA(zone, cfg = {}) {
    const loadKg = cfg.loadKg ?? 15;
    const speedKmh = cfg.speedKmh ?? 2.4;
    const maxSlope = cfg.maxSlope ?? 15;
    const buddyMode = cfg.buddyMode || 'buddy';
    const scanStep = cfg.scanStep ?? 8;
    const mglLocked = cfg.mglLocked !== undefined ? !!cfg.mglLocked : true;
    const domainLayer = cfg.domainLayer || 'composite';
    const scoreMode = cfg.scoreMode || 'balanced';
    const customWeights = cfg.customWeights || null;
    const customScanPts = Array.isArray(cfg.customScanPts) ? cfg.customScanPts : [];
    const dynamicHazards = Array.isArray(cfg.dynamicHazards) ? cfg.dynamicHazards : [];
    const speAlert = !!cfg.speAlert;

    const grid = buildLocalGrid(zone);
    applyDynamicHazards(grid, zone, dynamicHazards);
    const domainGrid = scoreLocalDomains(grid, zone, scoreMode, customWeights);
    const stops = [zone.base, ...zone.waypoints, zone.base];

    const safePath = [];
    const directPath = [];
    const orbitalPath = [];
    let safeDistM = 0, directDistM = 0, orbitalDistM = 0;
    let maxSafeSlope = 0, maxDirectSlope = 0;
    let directBoulderHits = 0, directSandM = 0, safeSandM = 0;
    let orbitalHazardHits = 0, orbitalSandM = 0;
    let maxRadiusFromBaseM = 0;
    let upElev = 0, upDist = 0, dnElev = 0, dnDist = 0;

    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      const leg = astarLeg(grid, a.x, a.y, b.x, b.y, maxSlope, false);
      for (let j = 0; j < leg.length; j++) {
        if (i > 0 && j === 0) continue;
        const [px, py] = leg[j];
        safePath.push([px, py]);
        const idx = py * grid.N + px;
        if (grid.slope[idx] > maxSafeSlope) maxSafeSlope = grid.slope[idx];
        const rBase = Math.hypot(px - zone.base.x, py - zone.base.y) * 10;
        if (rBase > maxRadiusFromBaseM) maxRadiusFromBaseM = rBase;
        if (j > 0) {
          const [qx, qy] = leg[j - 1];
          const prevIdx = qy * grid.N + qx;
          const stepM = Math.hypot(px - qx, py - qy) * 10;
          safeDistM += stepM;
          if (grid.hazard[idx] === 3) safeSandM += stepM;
          const dz = grid.elev[idx] - grid.elev[prevIdx];
          if (dz > 0) { upElev += dz; upDist += stepM; }
          else if (dz < 0) { dnElev += -dz; dnDist += stepM; }
        }
      }

      // Naive orbital-prior route plans without awareness of sub-grid hazards or migrated sand dunes
      const oLeg = astarLeg(grid, a.x, a.y, b.x, b.y, maxSlope, true);
      for (let j = 0; j < oLeg.length; j++) {
        if (i > 0 && j === 0) continue;
        const [ox, oy] = oLeg[j];
        orbitalPath.push([ox, oy]);
        const idx = oy * grid.N + ox;
        if (grid.hazard[idx] === 1 || grid.hazard[idx] === 2 || grid.slope[idx] > maxSlope) orbitalHazardHits++;
        if (j > 0) {
          const [qx, qy] = oLeg[j - 1];
          const stepM = Math.hypot(ox - qx, oy - qy) * 10;
          orbitalDistM += stepM;
          if (grid.hazard[idx] === 3) orbitalSandM += stepM;
        }
      }

      const dSteps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y)));
      for (let s = 0; s <= dSteps; s++) {
        if (i > 0 && s === 0) continue;
        const dx = Math.round(a.x + (b.x - a.x) * s / dSteps);
        const dy = Math.round(a.y + (b.y - a.y) * s / dSteps);
        directPath.push([dx, dy]);
        const idx = dy * grid.N + dx;
        if (grid.slope[idx] > maxDirectSlope) maxDirectSlope = grid.slope[idx];
        if (grid.hazard[idx] === 1 || grid.hazard[idx] === 2) directBoulderHits++;
        if (s > 0) {
          const stepM = (Math.hypot(b.x - a.x, b.y - a.y) * 10) / dSteps;
          directDistM += stepM;
          if (grid.hazard[idx] === 3) directSandM += stepM;
        }
      }
    }

    const meanUphillGradePct = upDist > 0 ? +((upElev / upDist) * 100).toFixed(2) : 0;
    const meanDownhillGradePct = dnDist > 0 ? +((dnElev / dnDist) * 100).toFixed(2) : 0;

    // Progressive assimilation mask & confidence convergence
    const assim = buildAssimilationMask(grid, zone, safePath, scanStep, customScanPts);
    const assimFrac = assim.assimilatedPct / 100;
    const orbitalConfidencePct = Math.round(Math.max(24, Math.min(44, 39 - (zone.orbitalAgeYears || 12) * 0.45)));
    const mglConfBoost = mglLocked ? 4 : 0;
    const assimilatedConfidencePct = Math.round(
      Math.min(98, orbitalConfidencePct + (93 - orbitalConfidencePct) * assimFrac + mglConfBoost)
    );

    const blendDom = (k) => +(domainGrid.orbitalMean[k] * (1 - assimFrac) + domainGrid.inSituMean[k] * assimFrac).toFixed(1);
    const domainScores = {
      topography: blendDom('topography'),
      geomorphology: blendDom('geomorphology'),
      thermal: blendDom('thermal'),
      radiation: blendDom('radiation'),
      optical: blendDom('optical')
    };
    const w = resolveWeights(scoreMode, customWeights);
    domainScores.composite = +(
      domainScores.topography * w.topography +
      domainScores.geomorphology * w.geomorphology +
      domainScores.thermal * w.thermal +
      domainScores.radiation * w.radiation +
      domainScores.optical * w.optical
    ).toFixed(1);

    // MGL Pose Error vs Uncorrected Visual Odometry Drift
    const uncorrectedOdometryDriftM = +Math.max(18.5, safeDistM * 0.0155).toFixed(1);
    const mglCorrectedErrorM = mglLocked
      ? +Math.max(1.2, 2.7 - assimFrac * 1.1).toFixed(1)
      : uncorrectedOdometryDriftM;

    let hazardsMapped = 0;
    for (let i = 0; i < grid.N * grid.N; i++) {
      if (assim.mask[i] && grid.hazard[i] > 0) hazardsMapped++;
    }

    const baseDiscrepancies = [
      {
        id: 'DISC-1',
        domain: 'geomorphology',
        x: zone.sandTraps[0] ? zone.sandTraps[0].x : 44,
        y: zone.sandTraps[0] ? zone.sandTraps[0].y : 68,
        title: 'Migrated Aeolian Sand Ripple vs Orbital Prior',
        titleTr: 'Uydu Öncülüne Göre Kaymış Kumul Zonu',
        delta: '+82 m Δx (wheel/boot sinkage risk)'
      },
      {
        id: 'DISC-2',
        domain: 'topography',
        x: zone.boulders[0] ? zone.boulders[0].x : 35,
        y: zone.boulders[0] ? zone.boulders[0].y : 60,
        title: 'Sub-Grid Boulder Apron Unresolved in MOLA/CTX',
        titleTr: 'MOLA/CTX Çözünürlüğü Altında Kaya Bloğu Alanı',
        delta: `${zone.boulders[0] ? zone.boulders[0].r * 10 : 80} m cluster > ${maxSlope}°`
      },
      {
        id: 'DISC-3',
        domain: 'thermal',
        x: zone.driftTrap ? zone.driftTrap.x : 40,
        y: zone.driftTrap ? zone.driftTrap.y : 60,
        title: 'Fresh Dust Coating Thermal Inertia Drop',
        titleTr: 'Taze Toz Örtüsü Termal Atalet Düşüşü',
        delta: `TI 68 vs orbital ${zone.thermalInertiaBase || 260} tiu`
      },
      {
        id: 'DISC-4',
        domain: 'radiation',
        x: zone.walls[0] ? Math.round((zone.walls[0].x1 + zone.walls[0].x2) / 2) : 34,
        y: zone.walls[0] ? Math.round((zone.walls[0].y1 + zone.walls[0].y2) / 2) : 50,
        title: 'Local Scarp Sky-View GCR Attenuation',
        titleTr: 'Yerel Yamaç Ufuk Kalkanı Radyasyon Düşüşü',
        delta: '-12% GCR dose vs coarse column'
      },
      {
        id: 'DISC-5',
        domain: 'optical',
        x: zone.waypoints[0] ? zone.waypoints[0].x : 28,
        y: zone.waypoints[0] ? zone.waypoints[0].y : 40,
        title: 'Hydrated Mineral Vein Contrast Confirmed',
        titleTr: 'Hidratlı Mineral Damarı Kontrastı Doğrulandı',
        delta: 'SuperCam VNIR 1.9–2.3 µm peak'
      }
    ];
    dynamicHazards.forEach((h, idx) => {
      baseDiscrepancies.push({
        id: `DISC-DYN-${idx + 1}`,
        domain: 'geomorphology',
        x: h.x,
        y: h.y,
        title: h.label || 'Live Dynamic Dust/Rockfall Anomaly',
        titleTr: 'Canlı Tespit Edilen Dinamik Engel / Kaya Düşmesi',
        delta: `${Math.round((h.r || 5) * 10)} m radius -> AutoNav rerouted`
      });
    });
    const discrepancies = baseDiscrepancies.filter(d => {
      if (String(d.id).startsWith('DISC-DYN')) return true;
      const cx = Math.max(0, Math.min(grid.N - 1, Math.round(d.x)));
      const cy = Math.max(0, Math.min(grid.N - 1, Math.round(d.y)));
      return assim.mask[cy * grid.N + cx] === 1 || scanStep === 8;
    });

    // VHF Line-of-Sight terrain shadowing + 30-min SPE emergency walkback path
    const commsLos = computeVhfLos(grid, zone.base.x, zone.base.y, assim.roverX, assim.roverY);
    const farWp = zone.waypoints.reduce((best, wp) =>
      Math.hypot(wp.x - zone.base.x, wp.y - zone.base.y) > Math.hypot(best.x - zone.base.x, best.y - zone.base.y) ? wp : best
    , zone.waypoints[0]);
    const frontierAway = Math.hypot(assim.roverX - zone.base.x, assim.roverY - zone.base.y) > 3;
    const speOrigin = frontierAway ? { x: Math.round(assim.roverX), y: Math.round(assim.roverY) } : { x: farWp.x, y: farWp.y };
    const spePath = astarLeg(grid, speOrigin.x, speOrigin.y, zone.base.x, zone.base.y, maxSlope, false);
    let speReturnDistM = 0;
    for (let k = 1; k < spePath.length; k++) {
      speReturnDistM += Math.hypot(spePath[k][0] - spePath[k - 1][0], spePath[k][1] - spePath[k - 1][1]) * 10;
    }
    const worstLeg = frontierAway ? astarLeg(grid, farWp.x, farWp.y, zone.base.x, zone.base.y, maxSlope, false) : spePath;
    let worstDistM = 0;
    for (let k = 1; k < worstLeg.length; k++) {
      worstDistM += Math.hypot(worstLeg[k][0] - worstLeg[k - 1][0], worstLeg[k][1] - worstLeg[k - 1][1]) * 10;
    }
    const effReturnSpeedKmh = buddyMode === 'rover_eva' ? Math.min(6.5, speedKmh * 1.45) : speedKmh;
    const speTimeToShelterMin = Math.max(1, Math.round(((speReturnDistM / 1000) / Math.max(0.5, effReturnSpeedKmh)) * 60));
    const speWorstCaseMin = Math.max(1, Math.round(((worstDistM / 1000) / Math.max(0.5, effReturnSpeedKmh)) * 60));
    const speWithin30Min = (speAlert ? speTimeToShelterMin : speWorstCaseMin) <= 30;

    let spotProbe = null;
    if (cfg.spotProbe && typeof cfg.spotProbe.x === 'number' && typeof cfg.spotProbe.y === 'number') {
      const px = Math.max(0, Math.min(grid.N - 1, Math.round(cfg.spotProbe.x)));
      const py = Math.max(0, Math.min(grid.N - 1, Math.round(cfg.spotProbe.y)));
      const pidx = py * grid.N + px;
      spotProbe = {
        x: px,
        y: py,
        xMeters: px * 10,
        yMeters: py * 10,
        slope: +grid.slope[pidx].toFixed(1),
        elevM: Math.round(grid.elev[pidx]),
        ti: Math.round(grid.ti[pidx]),
        radMsvYr: Math.round(grid.radLocal[pidx]),
        hazardClass: grid.hazard[pidx],
        compositeScore: Math.round(domainGrid.composite[pidx])
      };
    }

    const navStack = {
      trn: {
        name: SYSTEM_ARCH.TRN.name,
        landingErrorEllipseOrbitalM: 1200,
        touchdownErrorM: 28,
        divertExecutedM: 165,
        safeTouchdownClearanceM: 42,
        status: 'LOCKED'
      },
      autonav: {
        name: SYSTEM_ARCH.AUTONAV.name,
        scanStep,
        totalSteps: 8,
        assimilatedPct: assim.assimilatedPct,
        hazardsMapped,
        discrepanciesFound: discrepancies.length,
        status: scanStep === 0 ? 'ORBITAL PRIOR' : (scanStep < 8 ? 'MAPPING' : 'ASSIMILATED')
      },
      mgl: {
        name: SYSTEM_ARCH.MGL.name,
        locked: mglLocked,
        uncorrectedOdometryDriftM,
        mglCorrectedErrorM,
        horizonTiePoints: mglLocked ? 14 : 0,
        status: mglLocked ? 'MGL LOCKED' : 'VO DRIFT ONLY'
      },
      xgds: {
        name: SYSTEM_ARCH.XGDS.name,
        mode: scoreMode,
        activeLayer: domainLayer,
        orbitalConfidencePct,
        assimilatedConfidencePct
      }
    };

    // Pandolf-Santee Martian Locomotion Bioenergetics (g = 3.71 m/s^2 = 0.378 g_Earth)
    const vMps = Math.max(0.25, speedKmh / 3.6);
    const bodyKg = 80, suitKg = 82;
    const effLoadKg = buddyMode === 'rover_eva' ? loadKg * 0.55 : loadKg * 0.90;
    const effMassMars = (bodyKg + suitKg + effLoadKg) * (MARS_G / 9.81);
    const effGradePct = Math.max(meanUphillGradePct * 0.65, Math.tan((maxSafeSlope * 0.48) * Math.PI / 180) * 100);
    const terrainEta = 1.32 + (safeSandM / Math.max(100, safeDistM)) * 0.85;
    const suitJointWorkW = 115;
    const loadWorkW = effLoadKg * 2.8 + 2.5 * effMassMars * Math.pow(effLoadKg / bodyKg, 2);
    const pandolfW = 1.5 * bodyKg * (MARS_G / 9.81) +
                     loadWorkW +
                     terrainEta * effMassMars * (1.5 * vMps * vMps + 0.35 * vMps * effGradePct) +
                     suitJointWorkW;
    const metabolicW = Math.round(Math.max(190, Math.min(680, pandolfW)));
    const metabolicKcalH = Math.round(metabolicW * 0.8598);

    const walkTimeH = (safeDistM / 1000) / Math.max(0.5, speedKmh);
    const scienceStopH = zone.waypoints.length * 0.22;
    const totalEvaH = (buddyMode === 'rover_eva' ? walkTimeH * 0.68 : walkTimeH) + scienceStopH;
    const totalKcal = Math.round(metabolicKcalH * totalEvaH);

    const o2RateGh = 0.255 * metabolicW;
    const o2UsedG = o2RateGh * totalEvaH;
    const o2UsedPct = Math.min(99, Math.round((o2UsedG / SUIT_O2_CAP_G) * 100));
    const o2RemainPct = Math.max(1, 100 - o2UsedPct);

    const suitPowerW = BASE_AVIONICS_W + 0.06 * metabolicW;
    const battUsedWh = suitPowerW * totalEvaH;
    const battUsedPct = Math.min(99, Math.round((battUsedWh / SUIT_BATT_CAP_WH) * 100));
    const battRemainPct = Math.max(1, 100 - battUsedPct);

    const waterRateLh = Math.max(0.08, (0.72 * metabolicW) / 675);
    const waterUsedL = +(waterRateLh * totalEvaH).toFixed(2);
    const waterUsedPct = Math.min(99, Math.round((waterUsedL / SUIT_WATER_CAP_L) * 100));
    const waterRemainPct = Math.max(1, 100 - waterUsedPct);

    // Tactical Walkback Limit (1 km x 1 km PLSS contingency abort envelope):
    // nominal ~960 m unloaded buddy-protocol radius (secondary O2 / LCVG abort window at return pace),
    // shrunk by carried load, route slope, consumed O2, and pace; scaled by crew protocol.
    const buddyFactor = buddyMode === 'rover_eva' ? 1.24 : (buddyMode === 'solo' ? 0.86 : 1.0);
    const loadPenalty = Math.max(0.55, 1 - 0.0075 * effLoadKg);
    const slopePenalty = Math.max(0.7, 1 - Math.max(0, maxSafeSlope - 10) * 0.008);
    const paceFactor = Math.sqrt(Math.max(0.6, Math.min(1.25, speedKmh / 2.4)));
    const o2Factor = Math.max(0.55, Math.min(1, o2RemainPct / 80));
    const walkbackRadiusM = Math.round(Math.max(320, Math.min(980, 960 * loadPenalty * slopePenalty * paceFactor * o2Factor * buddyFactor)));
    const withinWalkback = maxRadiusFromBaseM <= walkbackRadiusM;
    const radDoseUsv = Math.round(((zone.radMsvYr || 235) * 1000 / (365.25 * 24)) * totalEvaH);

    return {
      zone,
      grid,
      domainGrid,
      assimMask: assim,
      safePath,
      directPath,
      orbitalPath,
      safeDistM: Math.round(safeDistM),
      directDistM: Math.round(directDistM),
      orbitalDistM: Math.round(orbitalDistM),
      maxSafeSlope: +maxSafeSlope.toFixed(1),
      maxDirectSlope: +maxDirectSlope.toFixed(1),
      meanUphillGradePct,
      meanDownhillGradePct,
      directBoulderHits,
      directSandM: Math.round(directSandM),
      safeSandM: Math.round(safeSandM),
      orbitalHazardHits,
      orbitalSandM: Math.round(orbitalSandM),
      orbitalConfidencePct,
      assimilatedConfidencePct,
      domainScores,
      discrepancies,
      navStack,
      scanStep,
      mglLocked,
      domainLayer,
      scoreMode,
      loadKg,
      speedKmh,
      maxSlope,
      buddyMode,
      metabolicW,
      metabolicKcalH,
      totalEvaH: +totalEvaH.toFixed(2),
      totalKcal,
      o2UsedG: Math.round(o2UsedG),
      o2UsedPct,
      o2RemainPct,
      battUsedPct,
      battRemainPct,
      waterUsedL,
      waterUsedPct,
      waterRemainPct,
      walkbackRadiusM,
      maxRadiusFromBaseM: Math.round(maxRadiusFromBaseM),
      withinWalkback,
      radDoseUsv,
      commsLos,
      speAlert,
      spePath,
      speReturnDistM: Math.round(speReturnDistM),
      speTimeToShelterMin,
      speWorstCaseMin,
      speWithin30Min,
      spotProbe,
      customScanPts,
      dynamicHazards,
      scoreWeights: w,
    };
  }

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
        { code: 'CRYO-1', pov: 'ice', rock: 'Polygonal Ice-Cemented Regolith (TES/SWIM Prior)', rockTr: 'Poligonal Buzlu Regolit (TES/SWIM Öncülü)', min: 'Buried water ice + magnesium-sulfate brines', minTr: 'Yeraltı su buzu + magnezyum sülfat tuzları', astro: 'ISRU water ice mining target (orbital prior — drill core verify)', astroTr: 'ISRU su buzu madenciliği hedefi (karot doğrulaması gerekir)', chem: { SO3: 7.4, SiO2: 33.2, FeO: 11.4, MgO: 6.2, Al2O3: 5.8, H2O: 36.0 }, peaks: [0.22, 0.36, 0.45, 0.88, 0.94, 0.72, 0.84, 0.96, 0.91] },
        { code: 'ICE-2', pov: 'ice', rock: 'Sub-Meter Thermokarst Rim Outcrop', rockTr: 'Metre-Altı Termokarst Yamaç Mostrası', min: 'Shallow frost lens & phyllosilicate silt', minTr: 'Sığ buz merceği ve fillosilikat silt', astro: 'Cryo-shielded organics preservation margin', astroTr: 'Dondurulmuş organik korunma sınırı', chem: { SO3: 6.1, SiO2: 30.8, FeO: 10.6, MgO: 5.9, Al2O3: 5.6, H2O: 41.0 }, peaks: [0.18, 0.31, 0.42, 0.86, 0.92, 0.78, 0.88, 0.98, 0.94] },
        { code: 'GEO-3', pov: 'delta', rock: 'Ejecta-Excavated Subsurface Lag', rockTr: 'Krater Fırlatması Alt Katman Çakılı', min: 'Basaltic lag + structural OH/H2O', minTr: 'Bazaltik çakıl + yapısal OH/H2O', astro: 'Regolith ice depth calibration point', astroTr: 'Regolit buz derinliği kalibrasyon noktası', chem: { SO3: 8.2, SiO2: 41.5, FeO: 14.8, MgO: 7.1, Al2O3: 7.4, H2O: 21.0 }, peaks: [0.35, 0.44, 0.56, 0.74, 0.82, 0.68, 0.79, 0.86, 0.78] }
      ],
      basalt: [
        { code: 'BSLT-1', pov: 'boxwork', rock: `Exposed Mafic Basalt Bedrock (TI ${Math.round(ti)} tiu)`, rockTr: `Yüzeylenmiş Mafik Bazalt Ana Kaya (TI ${Math.round(ti)} tiu)`, min: 'Olivine + low-Ca pyroxene + plagioclase', minTr: 'Olivin + düşük-Ca piroksen + plajiyoklaz', astro: 'Fresh igneous baseline; fracture fluid vein target', astroTr: 'Taze magmatik temel; çatlak akışkan damar hedefi', chem: { SO3: 3.8, SiO2: 48.2, FeO: 18.4, MgO: 10.6, Al2O3: 11.4, H2O: 2.1 }, peaks: [0.76, 0.84, 0.92, 0.58, 0.64, 0.52, 0.69, 0.56, 0.34] },
        { code: 'OLV-2', pov: 'boxwork', rock: 'Olivine-Cumulative Bench Scarp', rockTr: 'Olivin Zengin Yamaç Sekisi', min: 'Forsteritic olivine + secondary carbonate traces', minTr: 'Forsteritik olivin + ikincil karbonat izleri', astro: 'Past aqueous carbonation potential (SuperCam verify)', astroTr: 'Geçmiş sulu karbonasyon potansiyeli (SuperCam doğrulamalı)', chem: { SO3: 4.5, SiO2: 45.6, FeO: 19.2, MgO: 12.1, Al2O3: 9.8, H2O: 2.9 }, peaks: [0.81, 0.88, 0.86, 0.62, 0.71, 0.60, 0.77, 0.68, 0.42] },
        { code: 'SIL-3', pov: 'delta', rock: 'Altered Basalt & Silica Fracture Fill', rockTr: 'Ayrışmış Bazalt ve Silika Çatlak Dolgusu', min: 'Amorphous silica + Fe-oxide + trace sulfate', minTr: 'Amorf silika + Fe-oksit + eser sülfat', astro: 'Habitability porosity seal candidate', astroTr: 'Yaşanabilirlik gözenek mühür adayı', chem: { SO3: 6.2, SiO2: 50.4, FeO: 16.0, MgO: 8.4, Al2O3: 10.6, H2O: 3.4 }, peaks: [0.68, 0.72, 0.79, 0.71, 0.76, 0.65, 0.74, 0.62, 0.49] }
      ],
      dust: [
        { code: 'DUST-1', pov: 'delta', rock: `Ferric Aeolian Dust Mantle (TI ${Math.round(ti)} tiu)`, rockTr: `Ferrik Rüzgar Tozu Örtüsü (TI ${Math.round(ti)} tiu)`, min: 'Nanophase ferric oxide + fine sulfate dust', minTr: 'Nanofaz demir oksit + ince sülfat tozu', astro: 'Bearing capacity & wheel slip calibration priority', astroTr: 'Taşıma kapasitesi ve tekerlek kayma kalibrasyonu', chem: { SO3: 9.4, SiO2: 44.2, FeO: 19.8, MgO: 6.8, Al2O3: 8.9, H2O: 4.2 }, peaks: [0.58, 0.66, 0.72, 0.62, 0.68, 0.58, 0.75, 0.64, 0.46] },
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
      return {
        id: `WP-${idx + 1}`,
        code: sp.code,
        name: `${label} Target ${idx + 1} (${sp.code})`,
        nameTr: `${label} Hedef ${idx + 1} (${sp.code})`,
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

  function domainCellRgb(layerId, score, orbMode) {
    const t = Math.max(0, Math.min(1, score / 100));
    const dim = orbMode ? 0.55 : 1.0;
    if (layerId === 'thermal') {
      return [Math.round((42 + t * 175) * dim), Math.round((56 + t * 92) * dim), Math.round((130 - t * 82) * dim)];
    }
    if (layerId === 'radiation') {
      return [Math.round((135 - t * 80) * dim), Math.round((52 + t * 135) * dim), Math.round((125 - t * 40) * dim)];
    }
    if (layerId === 'optical') {
      return [Math.round((128 + t * 76) * dim), Math.round((78 + t * 94) * dim), Math.round((48 + t * 58) * dim)];
    }
    if (layerId === 'geomorphology') {
      return [Math.round((150 - t * 90) * dim), Math.round((58 + t * 124) * dim), Math.round((62 + t * 42) * dim)];
    }
    return [Math.round((54 + (1 - t) * 95) * dim), Math.round((46 + t * 112) * dim), Math.round((52 + t * 56) * dim)];
  }

  /**
   * Render 1 km x 1 km xGDS 5-domain heatmap, orbital-prior fog-of-war, TRN touchdown zone,
   * AutoNav scanned perimeter, Naive Orbital Route (red/amber) vs AutoNav Safe Route (emerald).
   */
  function drawLocalEvaCanvas(canvas, sim, activeWpIdx, laserOn) {
    if (!canvas || !sim) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const { grid, domainGrid, assimMask, zone, safePath, orbitalPath, walkbackRadiusM, maxRadiusFromBaseM, domainLayer } = sim;
    const N = grid.N;
    const sx = (x) => (x / N) * W;
    const sy = (y) => (y / N) * H;
    const tr = isTr();

    ctx.fillStyle = '#141110';
    ctx.fillRect(0, 0, W, H);
    const cellW = W / N, cellH = H / N;
    const layerArr = (domainGrid && domainGrid[domainLayer]) || (domainGrid && domainGrid.composite);

    for (let y = 0; y < N; y += 2) {
      for (let x = 0; x < N; x += 2) {
        const i = y * N + x;
        const known = assimMask && assimMask.mask[i] === 1;
        if (layerArr && domainLayer !== 'composite') {
          const val = known ? layerArr[i] : Math.max(25, Math.min(82, 64 - grid.orbSlope[i] * 2));
          const [r, g, b] = domainCellRgb(domainLayer, val, !known);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
        } else {
          const sl = known ? grid.slope[i] : grid.orbSlope[i];
          const hz = known ? grid.hazard[i] : 0;
          const shade = Math.max(16, Math.min(72, Math.round(32 + (grid.elev[i] - zone.elev) * 0.9 - sl * 0.8)));
          const boost = known ? 1.05 : 0.62;
          if (hz === 3) ctx.fillStyle = `rgb(${Math.round((shade + 26) * boost)},${Math.round((shade + 10) * boost)},${Math.round(Math.max(8, shade - 6) * boost)})`;
          else ctx.fillStyle = `rgb(${Math.round((shade + 14) * boost)},${Math.round((shade + 6) * boost)},${Math.round(Math.max(8, shade - 2) * boost)})`;
        }
        ctx.fillRect(x * cellW, y * cellH, cellW * 2 + 0.5, cellH * 2 + 0.5);
      }
    }

    // 100 m metric grid lines
    ctx.strokeStyle = 'rgba(237, 241, 247, 0.08)';
    ctx.lineWidth = 1;
    for (let g = 10; g < 100; g += 10) {
      ctx.beginPath(); ctx.moveTo(sx(g), 0); ctx.lineTo(sx(g), H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, sy(g)); ctx.lineTo(W, sy(g)); ctx.stroke();
    }

    // Sand Traps (revealed strongly inside AutoNav mask, faint orbital estimate outside)
    for (const st of zone.sandTraps) {
      const idx = Math.max(0, Math.min(N * N - 1, Math.round(st.y) * N + Math.round(st.x)));
      const revealed = !assimMask || assimMask.mask[idx] === 1;
      ctx.save();
      ctx.fillStyle = revealed ? 'rgba(223, 179, 101, 0.24)' : 'rgba(223, 179, 101, 0.08)';
      ctx.strokeStyle = revealed ? 'rgba(223, 179, 101, 0.78)' : 'rgba(223, 179, 101, 0.28)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.ellipse(sx(st.x), sy(st.y), (st.rx / N) * W, (st.ry / N) * H, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      if (revealed) {
        ctx.fillStyle = '#dfb365';
        ctx.font = '500 9.5px "IBM Plex Mono", monospace';
        ctx.fillText(st.label, sx(st.x) - 34, sy(st.y) + 3);
      }
      ctx.restore();
    }

    // Boulders & Steep Scarps
    for (const b of zone.boulders) {
      const idx = Math.max(0, Math.min(N * N - 1, Math.round(b.y) * N + Math.round(b.x)));
      const revealed = !assimMask || assimMask.mask[idx] === 1;
      if (!revealed) continue;
      const cx = sx(b.x), cy = sy(b.y), rad = (b.r / N) * W;
      ctx.save();
      ctx.fillStyle = 'rgba(222, 122, 107, 0.24)';
      ctx.strokeStyle = '#de7a6b';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#edf1f7';
      ctx.font = '500 9.5px "IBM Plex Mono", monospace';
      ctx.fillText(b.label, cx - rad, cy - rad - 4);
      ctx.restore();
    }

    for (const w of zone.walls) {
      ctx.save();
      ctx.strokeStyle = '#de7a6b';
      ctx.lineWidth = ((w.w / N) * W) * 0.75;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx(w.x1), sy(w.y1)); ctx.lineTo(sx(w.x2), sy(w.y2)); ctx.stroke();
      ctx.fillStyle = '#edf1f7';
      ctx.font = '500 9.5px "IBM Plex Mono", monospace';
      ctx.fillText(w.label, sx((w.x1 + w.x2) / 2) - 42, sy((w.y1 + w.y2) / 2) - 7);
      ctx.restore();
    }

    // Walkback Safety Limit Circle
    const bx = sx(zone.base.x), by = sy(zone.base.y);
    const wbRadiusPx = Math.min(W * 0.92, (walkbackRadiusM / 1000) * W);
    ctx.save();
    ctx.fillStyle = sim.withinWalkback ? 'rgba(127, 162, 191, 0.08)' : 'rgba(223, 179, 101, 0.09)';
    ctx.beginPath(); ctx.arc(bx, by, wbRadiusPx, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = sim.withinWalkback ? '#7fa2bf' : '#dfb365';
    ctx.lineWidth = 2.0;
    ctx.setLineDash([7, 5]);
    ctx.beginPath(); ctx.arc(bx, by, wbRadiusPx, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = sim.withinWalkback ? '#adc7dd' : '#dfb365';
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    const wbLabel = tr
      ? `WALKBACK SINIRI: ${walkbackRadiusM} m · SİNDİRİLEN: %${sim.navStack.autonav.assimilatedPct}`
      : `WALKBACK: ${walkbackRadiusM} m (Max ${maxRadiusFromBaseM} m) · ASSIM: ${sim.navStack.autonav.assimilatedPct}%`;
    ctx.fillText(wbLabel, 10, 17);
    ctx.restore();

    // Naive Orbital-Only Route (amber-red dashed) vs Live AutoNav A* Safe Route (emerald)
    if (orbitalPath && orbitalPath.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(222, 122, 107, 0.72)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      orbitalPath.forEach(([x, y], idx) => idx === 0 ? ctx.moveTo(sx(x), sy(y)) : ctx.lineTo(sx(x), sy(y)));
      ctx.stroke();
      ctx.restore();
    }
    if (safePath.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#7dbb8e';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      safePath.forEach(([x, y], idx) => idx === 0 ? ctx.moveTo(sx(x), sy(y)) : ctx.lineTo(sx(x), sy(y)));
      ctx.stroke();
      ctx.restore();
    }

    // Dynamic User-Injected Anomalies (Rockfall / Sudden Dust Drift)
    if (Array.isArray(sim.dynamicHazards)) {
      for (const dh of sim.dynamicHazards) {
        const dx = sx(dh.x), dy = sy(dh.y), dr = ((dh.r || 5) / N) * W;
        ctx.save();
        ctx.fillStyle = 'rgba(222, 122, 107, 0.34)';
        ctx.strokeStyle = '#de7a6b';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 2]);
        ctx.beginPath(); ctx.arc(dx, dy, dr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#edf1f7';
        ctx.font = '600 9.5px "IBM Plex Mono", monospace';
        ctx.fillText(tr ? '! DİNAMİK ENGEL' : '! ANOMALY', dx - dr, dy - dr - 4);
        ctx.restore();
      }
    }

    // Interactive User-Dispatched AutoNav Spot Scans & Probe Reticle
    if (Array.isArray(sim.customScanPts)) {
      for (const sp of sim.customScanPts) {
        ctx.save();
        ctx.strokeStyle = 'rgba(173, 199, 221, 0.65)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(sx(sp.x), sy(sp.y), ((sp.r || 11) / N) * W, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
    if (sim.spotProbe) {
      const px = sx(sim.spotProbe.x), py = sy(sim.spotProbe.y);
      ctx.save();
      ctx.strokeStyle = '#edf1f7';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(px - 6, py); ctx.lineTo(px + 6, py);
      ctx.moveTo(px, py - 6); ctx.lineTo(px, py + 6);
      ctx.stroke();
      ctx.restore();
    }

    // VHF Line-of-Sight Ray (Base Mast -> Rover/Crew Frontier)
    if (assimMask && sim.commsLos && sim.commsLos.distM >= 20) {
      ctx.save();
      ctx.strokeStyle = sim.commsLos.losClear ? 'rgba(125, 187, 142, 0.45)' : 'rgba(223, 179, 101, 0.85)';
      ctx.lineWidth = 1.3;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(sx(assimMask.roverX), sy(assimMask.roverY));
      ctx.stroke();
      if (!sim.commsLos.losClear && sim.commsLos.blockPt) {
        const ox = sx(sim.commsLos.blockPt.x), oy = sy(sim.commsLos.blockPt.y);
        ctx.strokeStyle = '#dfb365';
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(ox - 4, oy - 4); ctx.lineTo(ox + 4, oy + 4); ctx.moveTo(ox + 4, oy - 4); ctx.lineTo(ox - 4, oy + 4); ctx.stroke();
      }
      ctx.restore();
    }

    // 30-Min SPE Emergency Return Escape Vector
    if (sim.speAlert && Array.isArray(sim.spePath) && sim.spePath.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#dfb365';
      ctx.lineWidth = 3.2;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      sim.spePath.forEach(([x, y], idx) => idx === 0 ? ctx.moveTo(sx(x), sy(y)) : ctx.lineTo(sx(x), sy(y)));
      ctx.stroke();
      ctx.restore();
    }

    // Active AutoNav Sensor Cone at Frontier Rover/Crew Position
    if (assimMask && sim.scanStep < 8) {
      const rx = sx(assimMask.roverX), ry = sy(assimMask.roverY);
      ctx.save();
      ctx.strokeStyle = 'rgba(127, 162, 191, 0.78)';
      ctx.fillStyle = 'rgba(127, 162, 191, 0.14)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(rx, ry, 28, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // TRN Touchdown Pad Marker
    ctx.save();
    ctx.fillStyle = '#7fa2bf';
    ctx.strokeStyle = '#edf1f7';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = '600 10.5px "IBM Plex Mono", monospace';
    ctx.fillStyle = '#edf1f7';
    ctx.fillText(zone.base.label, bx + 10, by + 4);
    ctx.restore();

    // Waypoints
    zone.waypoints.forEach((wp, idx) => {
      const wx = sx(wp.x), wy = sy(wp.y);
      const isAct = idx === activeWpIdx;
      ctx.save();
      if (isAct) {
        ctx.strokeStyle = '#ea9662';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(wx, wy, 13, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = isAct ? '#d87a42' : '#181d26';
      ctx.strokeStyle = '#edf1f7';
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(wx, wy, 7.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#edf1f7';
      ctx.font = '600 10px "IBM Plex Mono", monospace';
      ctx.fillText(`${wp.id} · ${wp.code}`, wx + 10, wy + 3);
      ctx.restore();
    });

    // Bottom legend strip
    ctx.save();
    ctx.fillStyle = 'rgba(12, 15, 20, 0.86)';
    ctx.fillRect(8, H - 23, W - 16, 17);
    ctx.fillStyle = '#c9d1dc';
    ctx.font = '500 9.5px "IBM Plex Mono", monospace';
    ctx.fillText(
      tr
        ? `10m/hücre DEM · Yeşil=AutoNav | Kırmızı=Ham Uydu (${sim.orbitalHazardHits} risk)${sim.speAlert ? ' | Sarı=SPE Kaçış' : ''} · ${domainLayer.toUpperCase()}`
        : `10m/cell DEM · Green=AutoNav | Red=Orbital (${sim.orbitalHazardHits} haz)${sim.speAlert ? ' | Amber=SPE Escape' : ''} · ${domainLayer.toUpperCase()}`,
      12, H - 11
    );
    ctx.restore();
  }

  /**
   * Render Ground POV inside Helmet Visor HUD Canvas (#hud-pov-canvas) with MGL Pose Tie Points.
   * When opts.transparentBackdrop is true, only HUD reticle/telemetry overlays render so live NASA imagery shows through.
   */
  function drawGroundPovCanvas(canvas, sim, wp, laserOn, opts) {
    if (!canvas || !sim || !wp) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const tr = isTr();
    const o = opts || {};
    const transparentBackdrop = !!o.transparentBackdrop;
    const frameIdx = Number(o.frameIdx) || 0;
    const panPhase = frameIdx * 0.35;

    ctx.clearRect(0, 0, W, H);

    if (!transparentBackdrop) {
      const sky = ctx.createLinearGradient(0, 0, 0, H * 0.46);
      if (wp.povTheme === 'ice') {
        sky.addColorStop(0, '#2a2423'); sky.addColorStop(0.55, '#684e42'); sky.addColorStop(1, '#b88c72');
      } else {
        sky.addColorStop(0, '#2d1c15'); sky.addColorStop(0.55, '#7c482b'); sky.addColorStop(1, '#c88355');
      }
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H * 0.46);

      ctx.fillStyle = '#5c3724';
      ctx.beginPath();
      ctx.moveTo(0, H * 0.45);
      for (let x = 0; x <= W; x += 24) {
        const ridge = Math.sin(x * 0.012 + wp.heading + panPhase) * 18 + Math.cos(x * 0.027 - panPhase * 0.5) * 9;
        ctx.lineTo(x, H * 0.36 - ridge);
      }
      ctx.lineTo(W, H * 0.46); ctx.closePath(); ctx.fill();

      const gnd = ctx.createLinearGradient(0, H * 0.45, 0, H);
      gnd.addColorStop(0, '#6a3d26'); gnd.addColorStop(0.5, '#462819'); gnd.addColorStop(1, '#22140d');
      ctx.fillStyle = gnd;
      ctx.fillRect(0, H * 0.45, W, H * 0.55);

      const shiftX = Math.sin(panPhase) * 28;
      ctx.save();
      if (wp.povTheme === 'ice') {
        ctx.fillStyle = 'rgba(173, 199, 221, 0.78)';
        ctx.strokeStyle = '#edf1f7';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(W * 0.5 + shiftX, H * 0.70, 125, 38, -0.08, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(237, 241, 247, 0.45)';
        ctx.lineWidth = 1.2;
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath(); ctx.moveTo(W * 0.28 + shiftX, H * (0.70 + i * 0.025)); ctx.lineTo(W * 0.72 + shiftX, H * (0.68 + i * 0.025)); ctx.stroke();
        }
      } else if (wp.povTheme === 'boxwork') {
        ctx.fillStyle = 'rgba(90, 57, 38, 0.85)';
        ctx.beginPath(); ctx.moveTo(W * 0.16 + shiftX, H * 0.82); ctx.lineTo(W * 0.26 + shiftX, H * 0.56); ctx.lineTo(W * 0.74 + shiftX, H * 0.54); ctx.lineTo(W * 0.84 + shiftX, H * 0.82); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#d8b28e';
        ctx.lineWidth = 2.6;
        const ribs = [
          [0.24, 0.76, 0.42, 0.58], [0.42, 0.58, 0.61, 0.74], [0.36, 0.78, 0.56, 0.56],
          [0.56, 0.56, 0.75, 0.73], [0.28, 0.65, 0.71, 0.62], [0.22, 0.72, 0.78, 0.69]
        ];
        for (let r = 0; r < ribs.length; r++) {
          ctx.beginPath();
          ctx.moveTo(W * ribs[r][0] + shiftX, H * ribs[r][1]);
          ctx.lineTo(W * ribs[r][2] + shiftX, H * ribs[r][3]);
          ctx.stroke();
        }
      } else if (wp.povTheme === 'delta') {
        for (let l = 0; l < 6; l++) {
          ctx.strokeStyle = l % 2 === 0 ? '#9f5539' : '#733e2b';
          ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(W * 0.20 + shiftX * 0.6, H * (0.56 + l * 0.04)); ctx.lineTo(W * 0.80 + shiftX * 0.6, H * (0.54 + l * 0.04)); ctx.stroke();
        }
        const spots = [[0.34, 0.64], [0.44, 0.71], [0.53, 0.62], [0.62, 0.69], [0.48, 0.66]];
        for (let s = 0; s < spots.length; s++) {
          const sxp = W * spots[s][0] + shiftX;
          const syp = H * spots[s][1];
          ctx.fillStyle = '#d8c2a6';
          ctx.beginPath(); ctx.arc(sxp, syp, 6.5, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#222936';
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.fillStyle = '#3b483d';
          ctx.beginPath(); ctx.arc(sxp, syp, 2.4, 0, Math.PI * 2); ctx.fill();
        }
      } else {
        for (let l = 0; l < 6; l++) {
          ctx.strokeStyle = l % 2 === 0 ? '#b9855e' : '#855338';
          ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(W * 0.22 + shiftX * 0.6, H * (0.56 + l * 0.04)); ctx.lineTo(W * 0.78 + shiftX * 0.6, H * (0.54 + l * 0.04)); ctx.stroke();
        }
      }
      ctx.restore();
    }

    // MGL Horizon Silhouette Tie Points
    if (sim.navStack && sim.navStack.mgl && sim.navStack.mgl.locked) {
      ctx.save();
      ctx.strokeStyle = '#7dbb8e';
      ctx.lineWidth = 1.4;
      for (let k = 1; k <= 5; k++) {
        const hx = Math.round((k / 6) * W);
        const hy = Math.round(H * 0.36 - (Math.sin(hx * 0.012 + wp.heading + panPhase) * 18 + Math.cos(hx * 0.027 - panPhase * 0.5) * 9));
        ctx.strokeRect(hx - 4, hy - 4, 8, 8);
      }
      ctx.restore();
    }

    const tx = W * 0.5, ty = H * 0.67;
    ctx.save();
    ctx.strokeStyle = 'rgba(127, 162, 191, 0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, W - 16, H - 16);

    ctx.fillStyle = 'rgba(12, 15, 20, 0.80)';
    ctx.fillRect(W * 0.14, 14, W * 0.72, 24);
    ctx.fillStyle = '#edf1f7';
    ctx.font = '600 10.5px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    const mglTag = sim.navStack && sim.navStack.mgl && sim.navStack.mgl.locked
      ? `MGL ±${sim.navStack.mgl.mglCorrectedErrorM}m`
      : `VO DRIFT ±${sim.navStack.mgl.mglCorrectedErrorM}m`;
    const hdgVal = Math.round((wp.heading + frameIdx * 12) % 360);
    ctx.fillText(`HDG ${String(hdgVal).padStart(3, '0')}° ${wp.code} · ${mglTag} · ASSIM ${sim.navStack.autonav.assimilatedPct}%`, W * 0.5, 30);

    if (laserOn) {
      ctx.strokeStyle = '#de7a6b';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(W * 0.85, H * 0.92); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.fillStyle = '#edf1f7';
      ctx.beginPath(); ctx.arc(tx, ty, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = '#7dbb8e';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(tx, ty, 22, 0, Math.PI * 2);
    ctx.moveTo(tx - 32, ty); ctx.lineTo(tx - 12, ty);
    ctx.moveTo(tx + 12, ty); ctx.lineTo(tx + 32, ty);
    ctx.moveTo(tx, ty - 32); ctx.lineTo(tx, ty - 12);
    ctx.moveTo(tx, ty + 12); ctx.lineTo(tx, ty + 32);
    ctx.stroke();

    ctx.fillStyle = 'rgba(12, 15, 20, 0.72)';
    ctx.fillRect(tx + 24, ty - 22, 250, 38);
    ctx.fillStyle = '#7dbb8e';
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`TARGET: ${wp.id} (${wp.code}) · ${laserOn ? 'LIBS PLASMA ACTIVE' : 'OPTICAL LOCK'}`, tx + 30, ty - 8);
    ctx.fillStyle = '#c9d1dc';
    ctx.fillText(`SiO2 ${wp.chem.SiO2}% · SO3 ${wp.chem.SO3}% · FeO ${wp.chem.FeO}% · H2O ${wp.chem.H2O}%`, tx + 30, ty + 8);

    ctx.fillStyle = 'rgba(12, 15, 20, 0.84)';
    ctx.fillRect(14, H - 34, W - 28, 22);
    ctx.fillStyle = '#edf1f7';
    ctx.font = '500 10px "IBM Plex Mono", monospace';
    const camTag = (o.camLabel) || wp.cam;
    ctx.fillText(
      tr
        ? `xEMU HUD · ${camTag} · O2 %${sim.o2RemainPct} · BAT %${sim.battRemainPct} · ${sim.metabolicKcalH} kcal/h · ${mglTag}`
        : `xEMU HUD · ${camTag} · O2 ${sim.o2RemainPct}% · BATT ${sim.battRemainPct}% · ${sim.metabolicKcalH} kcal/h · ${mglTag}`,
      22, H - 19
    );
    ctx.restore();
  }

  function renderSpectralSVG(wp) {
    const chem = (wp && wp.chem) || {};
    const chemVal = (k, scale) => {
      const raw = chem[k] !== undefined ? chem[k] : chem[k.toLowerCase()];
      const parsed = typeof raw === 'number' ? raw : parseFloat(String(raw || '0'));
      return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed / scale)) : 0;
    };
    const fe = chemVal('FeO', 24);
    const mg = chemVal('MgO', 20);
    const si = chemVal('SiO2', 58);
    const ca = chemVal('CaO', 14);
    const al = chemVal('Al2O3', 18);
    const so4 = chemVal('SO3', 26);
    const h2o = chemVal('H2O', 18);
    const hasChem = (fe + mg + si + ca + al + so4 + h2o) > 0.01;
    const basePeaks = (wp && wp.specPeaks) || [0.35, 0.65, 0.48, 0.82, 0.55, 0.72, 0.64, 0.88, 0.58, 0.75];
    const coupled = hasChem ? [
      0.16 + fe * 0.80,
      0.14 + mg * 0.78,
      0.22 + si * 0.68,
      0.18 + (fe + si) * 0.34,
      0.15 + ca * 0.76,
      0.14 + al * 0.72,
      0.18 + so4 * 0.80,
      0.16 + (so4 + fe) * 0.38,
      0.15 + h2o * 0.82,
      0.20 + (h2o + so4) * 0.36
    ] : basePeaks;
    const series = coupled.map((v, i) => {
      const b = basePeaks[i % basePeaks.length] || 0.5;
      const val = hasChem ? Math.max(0.08, Math.min(0.98, v * 0.78 + b * 0.22)) : b;
      const x = 16 + i * 28;
      const y = Math.round(78 - val * 54);
      return `${x},${y}`;
    }).join(' ');
    const bands = [
      { x: 16, lbl: '248nm FeII' },
      { x: 44, lbl: '280nm MgII' },
      { x: 184, lbl: '545nm S/SO4' },
      { x: 240, lbl: '656nm Ha/OH' }
    ];
    const markers = bands.map((b) =>
      `<line x1="${b.x}" y1="22" x2="${b.x}" y2="78" stroke="#2c3545" stroke-width="1" stroke-dasharray="2 2"/>` +
      `<text x="${b.x}" y="90" text-anchor="middle" fill="#828c9c" font-size="7.5" font-family="IBM Plex Mono, monospace">${b.lbl}</text>`
    ).join('');
    const oxideSummary = hasChem
      ? `FeO ${chem.FeO ?? '-'} · MgO ${chem.MgO ?? '-'} · SO3 ${chem.SO3 ?? '-'} · H2O ${chem.H2O ?? '-'}`
      : 'LIBS + VNIR (0.25-2.5 um · Fe/Mg/Si/Ca/Al/SO4/OH)';
    return `<svg class="hud-spec-svg" viewBox="0 0 284 98" role="img" aria-label="LIBS and VNIR reflectance spectrum">
      <rect x="0" y="0" width="284" height="98" rx="4" fill="#12161d"/>
      <line x1="16" y1="78" x2="268" y2="78" stroke="#2c3545" stroke-width="1"/>
      ${markers}
      <polyline fill="none" stroke="#7dbb8e" stroke-width="2.2" points="${series}"/>
      <text x="14" y="13" fill="#adc7dd" font-size="8.2" font-family="IBM Plex Mono, monospace">${oxideSummary}</text>
    </svg>`;
  }

  function drawGlobalWalkbackOverlay(ctx, projectGrid, L, S, dpr = 1) {
    if (!ctx || !projectGrid || !L || !S) return;
    const anchor = (S.mode === 'route' && S.route && S.route.goal)
      ? S.route.goal
      : (S.selected || (S.candidates && S.candidates[0]));
    if (!anchor) return;
    const [sx, sy, vis] = projectGrid(anchor.x + 0.5, anchor.y + 0.5);
    if (!vis) return;
    const evaSim = S.evaSim;
    const walkbackKm = evaSim ? (evaSim.walkbackRadiusM / 1000) : 1.25;
    const radiusPx = Math.max(18 * dpr, Math.min(56 * dpr, (S.view ? S.view.scale : 2) * 5.5 * dpr));
    ctx.save();
    ctx.strokeStyle = '#7dbb8e';
    ctx.lineWidth = 1.8 * dpr;
    ctx.setLineDash([5 * dpr, 4 * dpr]);
    ctx.beginPath(); ctx.arc(sx, sy, radiusPx, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(12, 15, 20, 0.85)';
    const lbl = `EVA WALKBACK ${walkbackKm.toFixed(2)} km`;
    ctx.font = `600 ${Math.round(9.5 * dpr)}px "IBM Plex Mono", monospace`;
    const tw = ctx.measureText(lbl).width;
    ctx.fillRect(sx - tw / 2 - 4 * dpr, sy - radiusPx - 14 * dpr, tw + 8 * dpr, 13 * dpr);
    ctx.fillStyle = '#7dbb8e';
    ctx.textAlign = 'center';
    ctx.fillText(lbl, sx, sy - radiusPx - 5 * dpr);
    ctx.restore();
  }

  function createEvaController(opts) {
    const doc = (opts && opts.doc) || global.document;
    const S = opts && opts.S;
    const layers = opts && opts.layers;
    const onSelectCoord = opts && opts.onSelectCoord;
    const onRedraw = opts && opts.onRedraw;
    const $ = (s) => (doc && doc.querySelector ? doc.querySelector(s) : null);

    const state = {
      zoneId: 'jezero_delta',
      customZone: null,
      loadKg: 15,
      speedKmh: 2.4,
      maxSlope: 15,
      buddyMode: 'buddy',
      scanStep: 4,
      mglLocked: true,
      speAlert: false,
      domainLayer: 'composite',
      scoreMode: 'balanced',
      customWeights: { topography: 24, geomorphology: 24, thermal: 16, radiation: 18, optical: 18 },
      customScanPts: [],
      dynamicHazards: [],
      spotProbe: null,
      playing: false,
      playTimer: null,
      povPlaying: false,
      povTimer: null,
      povFrameIdx: 0,
      povCache: {},
      hudReqId: 0,
      flareAdvisory: null,
      activeWpIdx: 0,
      laserOn: true,
      sim: null,
    };

    function resolveRoverMeta(zone, wp) {
      const rover = zone.rover || (zone.id === 'jezero_delta' || zone.id === 'nili_fossae' ? 'perseverance' : 'curiosity');
      const cameraHint = (wp && wp.cameraHint) || 'MAST';
      const searchQuery = zone.searchQuery || `${rover} rover ${zone.name}`;
      return { rover, cameraHint, searchQuery };
    }

    function readStoredApiKey() {
      try {
        return (typeof localStorage !== 'undefined' && localStorage && localStorage.getItem('nasa_api_key')) || '';
      } catch (e) {
        return '';
      }
    }

    function currentZone() {
      if (state.zoneId === 'custom_site' && state.customZone) return state.customZone;
      return ZONES[state.zoneId] || ZONES.jezero_delta;
    }

    function syncStepUi(sim) {
      const tr = isTr();
      const sl = $('#eva-scan-step');
      if (sl) sl.value = String(state.scanStep);
      const lbl = $('#eva-scan-step-v');
      if (lbl && sim) {
        lbl.textContent = tr
          ? `Adım ${state.scanStep}/8 · %${sim.navStack.autonav.assimilatedPct}`
          : `Step ${state.scanStep}/8 · ${sim.navStack.autonav.assimilatedPct}%`;
      }
      const mglBtn = $('#btn-eva-mgl');
      if (mglBtn) {
        mglBtn.textContent = state.mglLocked
          ? (tr ? 'MGL Ufuk Kilidi: AÇIK' : 'MGL Pose Lock: ON')
          : (tr ? 'MGL Ufuk Kilidi: KAPALI (VO Kayması)' : 'MGL Pose Lock: OFF (VO Drift)');
      }
      const speBtn = $('#btn-eva-spe');
      if (speBtn) {
        speBtn.textContent = state.speAlert
          ? (tr ? 'SPE 30dk Kaçış: AKTİF' : 'SPE 30m Escape: ACTIVE')
          : (tr ? 'SPE Fırtına Kaçışı (30dk)' : 'SPE 30m Escape Sim');
        speBtn.classList.toggle('active', state.speAlert);
      }
      const cwWrap = $('#eva-custom-weights');
      if (cwWrap) cwWrap.classList.toggle('hidden', state.scoreMode !== 'custom');
      const playBtn = $('#btn-eva-play');
      if (playBtn) {
        playBtn.textContent = state.playing ? (tr ? 'Duraklat' : 'Pause') : (tr ? 'Otomatik Tara' : 'Auto-Scan');
      }
    }

    function recompute() {
      const zone = currentZone();
      state.sim = simulateEVA(zone, {
        loadKg: state.loadKg,
        speedKmh: state.speedKmh,
        maxSlope: state.maxSlope,
        buddyMode: state.buddyMode,
        scanStep: state.scanStep,
        mglLocked: state.mglLocked,
        speAlert: state.speAlert,
        domainLayer: state.domainLayer,
        scoreMode: state.scoreMode,
        customWeights: state.customWeights,
        customScanPts: state.customScanPts,
        dynamicHazards: state.dynamicHazards,
        spotProbe: state.spotProbe,
      });
      if (S) S.evaSim = state.sim;
      syncStepUi(state.sim);
      renderPanel();
      if (onRedraw) onRedraw();
      return state.sim;
    }

    function stopPlay() {
      state.playing = false;
      if (state.playTimer && typeof clearInterval === 'function') {
        clearInterval(state.playTimer);
      }
      state.playTimer = null;
      syncStepUi(state.sim);
    }

    function stopPovPlay() {
      state.povPlaying = false;
      if (state.povTimer && typeof clearInterval === 'function') {
        clearInterval(state.povTimer);
      }
      state.povTimer = null;
      const body = $('#hud-modal-body');
      const btn = body && body.querySelector ? body.querySelector('#hud-btn-pov-play') : null;
      if (btn) {
        const tr = isTr();
        btn.classList.remove('playing');
        btn.textContent = tr ? '▶ POV Yürüyüş Sekansını Oynat' : '▶ Play POV Walk Sequence';
      }
    }

    function togglePlay() {
      if (state.playing) {
        stopPlay();
        return;
      }
      if (state.scanStep >= 8) state.scanStep = 0;
      state.playing = true;
      syncStepUi(state.sim);
      if (typeof setInterval === 'function') {
        state.playTimer = setInterval(() => {
          if (state.scanStep >= 8) {
            stopPlay();
            return;
          }
          state.scanStep++;
          recompute();
        }, 550);
      }
    }

    function openHudModal(wpIdx) {
      if (typeof wpIdx === 'number') state.activeWpIdx = wpIdx;
      state.povFrameIdx = 0;
      stopPovPlay();
      const modal = $('#hud-modal');
      if (!modal || !state.sim) return;
      renderHudModal();
      modal.classList.remove('hidden');
      const closeBtn = $('#hud-close');
      if (closeBtn && typeof closeBtn.focus === 'function') closeBtn.focus();
    }

    function closeHudModal() {
      stopPovPlay();
      state.hudReqId++;
      const modal = $('#hud-modal');
      if (modal) modal.classList.add('hidden');
    }

    function renderHudModal() {
      const sim = state.sim || recompute();
      const zone = sim.zone;
      const wp = zone.waypoints[state.activeWpIdx] || zone.waypoints[0];
      const tr = isTr(), esc = getEsc();
      const reqId = ++state.hudReqId;
      const { rover, cameraHint, searchQuery } = resolveRoverMeta(zone, wp);
      const cacheKey = `${rover}:${cameraHint}`;
      const cachedPov = state.povCache[cacheKey] || null;
      const liveApi = global.LIVE_API || (typeof globalThis !== 'undefined' && globalThis.LIVE_API) || null;

      const titleEl = $('#hud-modal-title');
      if (titleEl) {
        titleEl.textContent = tr
          ? `xEMU Kask Vizörü (HUD) · ${wp.id}: ${wp.nameTr || wp.name}`
          : `xEMU Helmet Visor HUD · ${wp.id}: ${wp.name}`;
      }
      const subEl = $('#hud-modal-sub');
      if (subEl) {
        subEl.textContent = `${zone.name} · ${wp.cam} · HDG ${wp.heading}° · dElev +${wp.elevRel} m`;
      }

      const body = $('#hud-modal-body');
      if (!body) return;
      const chemRows = Object.entries(wp.chem).map(([ox, pct]) =>
        `<div class="hud-chem-cell"><span>${esc(ox)}</span><b>${pct.toFixed(1)} wt%</b></div>`
      ).join('');
      const wpTabs = zone.waypoints.map((w, idx) =>
        `<button type="button" class="ghost hud-wp-tab${idx === state.activeWpIdx ? ' active' : ''}" data-wp-idx="${idx}">${esc(w.id)} · ${esc(w.code)}</button>`
      ).join('');

      const mglStatus = sim.navStack.mgl.locked
        ? `LOCKED (±${sim.navStack.mgl.mglCorrectedErrorM}m)`
        : `VO DRIFT (±${sim.navStack.mgl.mglCorrectedErrorM}m)`;
      const flareTxt = state.flareAdvisory
        ? `${esc(state.flareAdvisory.classType)} (${esc(state.flareAdvisory.evaAdvisory)})`
        : (tr ? 'Senkronize ediliyor…' : 'Syncing DONKI…');
      const playLabel = state.povPlaying
        ? (tr ? '⏸ POV Akışını Duraklat' : '⏸ Pause POV Stream')
        : (tr ? '▶ POV Yürüyüş Sekansını Oynat' : '▶ Play POV Walk Sequence');

      body.innerHTML = `
        <div class="hud-visor-frame">
          <div class="hud-top-tape">
            <span><b>SUIT O2:</b> <b class="${sim.o2RemainPct >= 35 ? 'ok' : 'warn'}">${sim.o2RemainPct}%</b> (${SUIT_O2_CAP_G - sim.o2UsedG}g rem)</span>
            <span><b>MGL POSE:</b> <b class="${sim.navStack.mgl.locked ? 'ok' : 'warn'}">${mglStatus}</b></span>
            <span><b>LCVG H2O:</b> <b class="ok">${(SUIT_WATER_CAP_L - sim.waterUsedL).toFixed(2)} L</b></span>
            <span><b>METABOLIC:</b> <b>${sim.metabolicKcalH} kcal/h</b> (${sim.metabolicW} W)</span>
            <span><b>DONKI FLR:</b> <b id="hud-flare-chip" class="${state.flareAdvisory && String(state.flareAdvisory.classType).startsWith('X') ? 'warn' : 'ok'}">${flareTxt}</b></span>
          </div>
          <div class="hud-visor-stage">
            <img id="hud-pov-img" class="hud-pov-img hidden" alt="${esc(rover)} rover camera surface view at ${esc(wp.code)}">
            <canvas id="hud-pov-canvas" class="hud-pov-canvas" width="680" height="320" aria-label="Ground POV surface camera view inside astronaut helmet visor"></canvas>
            <div class="hud-visor-vignette" aria-hidden="true"></div>
          </div>
          <div class="hud-cam-status-bar">
            <span id="hud-cam-meta">${tr ? 'NASA Mars Rover Kamera Akışı bağlanıyor…' : 'Connecting NASA Mars Rover Camera feed…'}</span>
            <div class="hud-pov-controls">
              <button type="button" id="hud-btn-pov-prev" class="ghost" aria-label="${tr ? 'Önceki kare' : 'Previous POV frame'}">&#9664;</button>
              <button type="button" id="hud-btn-pov-play" class="btn-pov-play${state.povPlaying ? ' playing' : ''}">${playLabel}</button>
              <button type="button" id="hud-btn-pov-next" class="ghost" aria-label="${tr ? 'Sonraki kare' : 'Next POV frame'}">&#9654;</button>
            </div>
          </div>
          <div class="hud-rad-banner ${sim.withinWalkback ? 'ok' : 'warn'}">
            <span><b>MSL-RAD DOSE:</b> ${(zone.radMsvYr / 365.25).toFixed(2)} mSv/sol (${sim.radDoseUsv} uSv EVA)</span>
            <span><b>WALKBACK LIMIT:</b> ${sim.walkbackRadiusM} m (${sim.withinWalkback ? (tr ? 'GÜVENLİ ÇEMBER İÇİNDE' : 'WITHIN SAFE WALKBACK') : (tr ? 'SINIR AŞILDI' : 'EXCEEDS LIMIT')})</span>
            <span><b>TRN+AUTONAV:</b> ${sim.navStack.autonav.assimilatedPct}% MAPPED</span>
          </div>
        </div>
        <div class="hud-Action-row">
          <div class="hud-wp-tabs">${wpTabs}</div>
          <div class="hud-action-btns">
            <button type="button" id="hud-btn-laser" class="btn-spec">${state.laserOn ? (tr ? 'LIBS Lazer: AÇIK' : 'LIBS Laser: ON') : (tr ? 'LIBS Lazer: KAPALI' : 'LIBS Laser: OFF')}</button>
            <button type="button" id="hud-btn-sample" class="btn-spec">${tr ? `+${wp.sampleKg} kg Kaya Numunesi Al` : `Collect +${wp.sampleKg} kg Rock Sample`}</button>
          </div>
        </div>
        <div class="hud-telemetry-grid">
          <div class="live-card">
            <div class="sec-head"><h2>${tr ? 'Hedef Kaya & Mineraloji (Mastcam / PIXL)' : 'Target Lithology & Mineralogy (Mastcam / PIXL)'}</h2></div>
            <div class="kv"><span>${tr ? 'Kaya Türü' : 'Lithology'}</span><b>${esc(tr ? (wp.rockTypeTr || wp.rockType) : wp.rockType)}</b></div>
            <div class="kv"><span>${tr ? 'Mineral Fazı' : 'Mineral Phase'}</span><b>${esc(tr ? (wp.mineralogyTr || wp.mineralogy) : wp.mineralogy)}</b></div>
            <div class="kv"><span>${tr ? 'Astrobiyoloji & ISRU' : 'Astrobiology & ISRU'}</span><b>${esc(tr ? (wp.astrobioTr || wp.astrobio) : wp.astrobio)}</b></div>
            ${renderSpectralSVG(wp)}
          </div>
          <div class="live-card">
            <div class="sec-head"><h2>${tr ? 'Kimyasal Oksit Analizi (SuperCam LIBS)' : 'Chemical Oxide Composition (SuperCam LIBS)'}</h2></div>
            <div class="hud-chem-grid">${chemRows}</div>
            <div class="kv mt-sm"><span>${tr ? 'Toplam EVA Enerji Harcaması' : 'Cumulative EVA Energy'}</span><b>${sim.totalKcal} kcal (${sim.totalEvaH} h)</b></div>
            <div class="kv"><span>${tr ? 'AutoNav Güvenli vs Ham Uydu Rotası' : 'AutoNav Verified vs Naive Orbital Route'}</span><b>${sim.safeDistM} m vs ${sim.orbitalDistM} m (${sim.orbitalHazardHits} risk)</b></div>
          </div>
        </div>`;

      const povCanvas = body.querySelector('#hud-pov-canvas');
      const povImg = body.querySelector('#hud-pov-img');
      const camMeta = body.querySelector('#hud-cam-meta');

      function activePov() {
        return state.povCache[cacheKey] || null;
      }

      function applyPovFrame(povRes) {
        if (state.hudReqId !== reqId) return;
        const frames = (povRes && Array.isArray(povRes.frames)) ? povRes.frames : [];
        if (frames.length > 0) {
          const idx = ((state.povFrameIdx % frames.length) + frames.length) % frames.length;
          const f = frames[idx];
          const roverTitle = rover === 'perseverance' ? 'Perseverance' : 'Curiosity';
          const solTag = f.sol !== null && f.sol !== undefined ? `Sol ${f.sol}` : (f.earthDate || 'Archive');
          if (camMeta) {
            camMeta.textContent = `● ${roverTitle} ${f.camera} · ${solTag} · ${tr ? 'Kare' : 'Frame'} ${idx + 1}/${frames.length} · ${povRes.source}`;
          }
          if (povImg && f.imgUrl) {
            povImg.onload = () => {
              if (state.hudReqId !== reqId) return;
              if (povImg.naturalWidth > 0) {
                povImg.classList.remove('hidden');
                if (povCanvas) {
                  drawGroundPovCanvas(povCanvas, sim, wp, state.laserOn, {
                    transparentBackdrop: true,
                    frameIdx: idx,
                    camLabel: `${roverTitle} ${f.camera}`
                  });
                }
              }
            };
            povImg.onerror = () => {
              if (state.hudReqId !== reqId) return;
              povImg.classList.add('hidden');
              if (povCanvas) {
                drawGroundPovCanvas(povCanvas, sim, wp, state.laserOn, {
                  transparentBackdrop: false,
                  frameIdx: state.povFrameIdx,
                  camLabel: wp.cam
                });
              }
            };
            if (povImg.getAttribute('src') !== f.imgUrl) {
              povImg.classList.add('hidden');
              if (povCanvas) {
                drawGroundPovCanvas(povCanvas, sim, wp, state.laserOn, {
                  transparentBackdrop: false,
                  frameIdx: idx,
                  camLabel: `${roverTitle} ${f.camera}`
                });
              }
              povImg.setAttribute('src', f.imgUrl);
            } else if (povImg.complete && povImg.naturalWidth > 0) {
              povImg.classList.remove('hidden');
              if (povCanvas) {
                drawGroundPovCanvas(povCanvas, sim, wp, state.laserOn, {
                  transparentBackdrop: true,
                  frameIdx: idx,
                  camLabel: `${roverTitle} ${f.camera}`
                });
              }
            }
            return;
          }
        }
        if (povImg) povImg.classList.add('hidden');
        if (povCanvas) {
          drawGroundPovCanvas(povCanvas, sim, wp, state.laserOn, {
            transparentBackdrop: false,
            frameIdx: state.povFrameIdx,
            camLabel: wp.cam
          });
        }
        if (camMeta) {
          camMeta.textContent = tr
            ? `● SENTETİK VİZÖR · ${rover.toUpperCase()} ${cameraHint} · Kare ${(Math.abs(state.povFrameIdx) % 6) + 1}/6`
            : `● PROCEDURAL VISOR · ${rover.toUpperCase()} ${cameraHint} · Frame ${(Math.abs(state.povFrameIdx) % 6) + 1}/6`;
        }
      }

      applyPovFrame(cachedPov);

      if (!cachedPov && liveApi && typeof liveApi.fetchRoverPovFrames === 'function') {
        liveApi.fetchRoverPovFrames(rover, {
          apiKey: readStoredApiKey(),
          cameraHint,
          searchQuery,
          limit: 6
        }).then((res) => {
          state.povCache[cacheKey] = res;
          if (state.hudReqId !== reqId) return;
          applyPovFrame(res);
        }).catch(() => {});
      }

      if (!state.flareAdvisory && liveApi && typeof liveApi.fetchSolarFlareAdvisory === 'function') {
        liveApi.fetchSolarFlareAdvisory(readStoredApiKey()).then((flr) => {
          state.flareAdvisory = flr;
          if (state.hudReqId !== reqId) return;
          const chip = body.querySelector('#hud-flare-chip');
          if (chip && flr) {
            chip.textContent = `${flr.classType} (${flr.evaAdvisory})`;
            chip.className = String(flr.classType).toUpperCase().startsWith('X') ? 'warn' : 'ok';
          }
        }).catch(() => {});
      }

      const btnPrev = body.querySelector('#hud-btn-pov-prev');
      if (btnPrev) {
        btnPrev.onclick = () => {
          stopPovPlay();
          state.povFrameIdx--;
          applyPovFrame(activePov());
        };
      }
      const btnNext = body.querySelector('#hud-btn-pov-next');
      if (btnNext) {
        btnNext.onclick = () => {
          stopPovPlay();
          state.povFrameIdx++;
          applyPovFrame(activePov());
        };
      }
      const btnPovPlay = body.querySelector('#hud-btn-pov-play');
      if (btnPovPlay) {
        btnPovPlay.onclick = () => {
          if (state.povPlaying) {
            stopPovPlay();
            return;
          }
          state.povPlaying = true;
          btnPovPlay.classList.add('playing');
          btnPovPlay.textContent = tr ? '⏸ POV Akışını Duraklat' : '⏸ Pause POV Stream';
          state.povFrameIdx++;
          applyPovFrame(activePov());
          if (typeof setInterval === 'function') {
            state.povTimer = setInterval(() => {
              if (state.hudReqId !== reqId) {
                stopPovPlay();
                return;
              }
              state.povFrameIdx++;
              applyPovFrame(activePov());
            }, 1650);
          }
        };
      }

      body.querySelectorAll('.hud-wp-tab').forEach(btn => {
        btn.onclick = () => {
          state.activeWpIdx = +btn.dataset.wpIdx;
          state.povFrameIdx = 0;
          stopPovPlay();
          renderHudModal();
          renderPanel();
        };
      });
      const btnLaser = body.querySelector('#hud-btn-laser');
      if (btnLaser) {
        btnLaser.onclick = () => {
          state.laserOn = !state.laserOn;
          renderHudModal();
        };
      }
      const btnSample = body.querySelector('#hud-btn-sample');
      if (btnSample) {
        btnSample.onclick = () => {
          state.loadKg = Math.min(35, +(state.loadKg + wp.sampleKg).toFixed(1));
          const loadSlider = $('#eva-load');
          if (loadSlider) loadSlider.value = String(Math.round(state.loadKg));
          if ($('#eva-load-v')) $('#eva-load-v').textContent = `${state.loadKg} kg`;
          recompute();
          renderHudModal();
        };
      }
    }

    function renderPanel() {
      const out = $('#eva-results');
      if (!out) return;
      const sim = state.sim || simulateEVA(currentZone(), state);
      syncStepUi(sim);
      const zone = sim.zone;
      const tr = isTr(), esc = getEsc();
      const activeWp = zone.waypoints[state.activeWpIdx] || zone.waypoints[0];

      const domainRows = DOMAINS.map(d => {
        const val = sim.domainScores[d.id];
        const cls = val >= 72 ? 'ok' : (val >= 52 ? 'warn' : 'bad');
        return `<div class="hls-check"><span class="hint">${esc(tr ? d.nameTr : d.name)}</span><b class="${cls}">${val}/100</b></div>`;
      }).join('');

      const discRows = sim.discrepancies.length
        ? sim.discrepancies.map(d =>
            `<div class="kv"><span>${esc(tr ? (d.titleTr || d.title) : d.title)}</span><b>${esc(d.delta)}</b></div>`
          ).join('')
        : `<div class="help note-sm">${tr ? 'Adım 0: Yalnızca ham uydu öncülü mevcut. Yüzey doğrulaması için taramayı başlatın.' : 'Step 0: Coarse Orbital Prior only. Step or Auto-Scan to assimilate live surface sensors.'}</div>`;

      const wpCards = zone.waypoints.map((wp, idx) => {
        const active = idx === state.activeWpIdx;
        return `<div class="eva-wp-card${active ? ' active' : ''}" data-wp="${idx}" role="button" tabindex="0">
          <div class="eva-wp-head">
            <b>${esc(wp.id)} · ${esc(tr ? (wp.nameTr || wp.name) : wp.name)}</b>
            <span class="badge-mode badge-live">HDG ${wp.heading}°</span>
          </div>
          <div class="help note-sm">${esc(tr ? (wp.rockTypeTr || wp.rockType) : wp.rockType)} · SO3 ${wp.chem.SO3}% · H2O ${wp.chem.H2O}%</div>
        </div>`;
      }).join('');

      const hazLbl = (c) => c === 1 ? (tr ? 'Kaya Kümesi' : 'Boulders') : (c === 2 ? (tr ? 'Dik Yamaç' : 'Steep Scarp') : (c === 3 ? (tr ? 'Gevşek Kum/Toz' : 'Drift Sand') : (tr ? 'Temiz Zemin' : 'Clear Ground')));
      const probeHTML = sim.spotProbe ? `
        <div class="eva-drift-card">
          <div class="sec-head"><h2>${tr ? 'Canlı AutoNav Nokta Sondajı (Harita Tıklaması)' : 'Live AutoNav Spot Probe (Canvas Click)'}</h2><span class="badge-mode badge-live">${sim.spotProbe.compositeScore}/100</span></div>
          <div class="kv"><span>${tr ? 'Yerel Hücre / Koordinat' : 'Local Metric Coords'}</span><b>(${sim.spotProbe.xMeters} m, ${sim.spotProbe.yMeters} m)</b></div>
          <div class="kv"><span>${tr ? 'Eğim / Termal Atalet' : 'Slope / Thermal Inertia'}</span><b>${sim.spotProbe.slope}° · TI ${sim.spotProbe.ti} tiu</b></div>
          <div class="kv"><span>${tr ? 'Zemin Sınıfı / GCR' : 'Surface Class / GCR'}</span><b>${esc(hazLbl(sim.spotProbe.hazardClass))} · ${sim.spotProbe.radMsvYr} mSv/${tr ? 'yıl' : 'yr'}</b></div>
        </div>` : '';

      const speTimeShown = sim.speAlert ? sim.speTimeToShelterMin : sim.speWorstCaseMin;
      const losOk = sim.commsLos && sim.commsLos.losClear;
      const losText = losOk
        ? (tr ? `Açık VHF Görüş (+${sim.commsLos.linkMarginDb} dB)` : `Direct VHF LoS (+${sim.commsLos.linkMarginDb} dB)`)
        : (tr ? `Arazi Gölgesi (${sim.commsLos.occludedSteps} adım → Röle)` : `Terrain Occluded (${sim.commsLos.occludedSteps} blk → Relay)`);

      out.innerHTML = `
        <div class="eva-zone-banner">
          <div class="eva-zone-title"><b>${esc(tr ? (zone.nameTr || zone.name) : zone.name)}</b></div>
          <div class="help note-sm">${esc(zone.hiRiseId)}</div>
          <p class="help note-sm">${esc(tr ? (zone.summaryTr || zone.summary) : zone.summary)}</p>
        </div>
        <div class="eva-canvas-wrap">
          <canvas id="eva-local-canvas" class="eva-local-canvas" width="420" height="320" role="img" aria-label="1 km by 1 km xGDS 5-domain surface assimilation map; click terrain to probe and expand scan"></canvas>
        </div>
        <div class="help note-sm">${tr ? 'İpucu: Haritada herhangi bir noktaya tıklayarak anlık AutoNav sondajı yapın ve tarama alanını genişletin.' : 'Tip: Click any point on the local DEM to dispatch an AutoNav spot scan probe, or click a WP circle for HUD.'}</div>
        <div class="row">
          <button type="button" id="btn-open-hud" class="btn-spec btn-full">${tr ? `Kask Vizörü (HUD) & Yüzey Kamerasını Aç (${activeWp.id})` : `Open Helmet Visor HUD & Ground POV (${activeWp.id})`}</button>
        </div>
        ${probeHTML}
        <div class="eva-drift-card">
          <div class="sec-head"><h2>${tr ? 'TRN + AutoNav + MGL Konum & Güven Kazancı' : 'TRN + AutoNav + MGL Localization & Confidence'}</h2></div>
          <div class="kv"><span>${tr ? 'TRN İniş Hassasiyeti' : 'TRN Touchdown'}</span><b class="ok">${sim.navStack.trn.touchdownErrorM} m (${tr ? 'uydu' : 'vs'} ${sim.navStack.trn.landingErrorEllipseOrbitalM} m)</b></div>
          <div class="kv"><span>${tr ? 'AutoNav Sindirim Alanı' : 'AutoNav Assimilation'}</span><b>%${sim.navStack.autonav.assimilatedPct} (${sim.navStack.autonav.hazardsMapped} ${tr ? 'engel hücresi' : 'hazard cells'})</b></div>
          <div class="kv"><span>${tr ? 'MGL Ufuk Kilidi' : 'MGL Horizon Lock'}</span><b class="${sim.navStack.mgl.locked ? 'ok' : 'warn'}">±${sim.navStack.mgl.mglCorrectedErrorM} m (VO ±${sim.navStack.mgl.uncorrectedOdometryDriftM} m)</b></div>
          <div class="kv"><span>${tr ? 'VHF Telsiz Görüş Hattı (LoS)' : 'VHF Radio Line-of-Sight'}</span><b class="${losOk ? 'ok' : 'warn'}">${esc(losText)}</b></div>
          <div class="kv"><span>${tr ? 'Uydu Öncülü -> Canlı xGDS Güveni' : 'Orbital Prior -> Live xGDS Confidence'}</span><b class="ok">${sim.orbitalConfidencePct}% -> ${sim.assimilatedConfidencePct}%</b></div>
        </div>
        <div class="sec-head"><h2>${tr ? 'xGDS 5-Alanlı Canlı Puanlama' : 'xGDS 5-Domain Dynamic Scoring'}</h2><span class="badge-mode badge-live">${sim.domainScores.composite}/100</span></div>
        <div class="hls-checks">${domainRows}</div>
        <div class="sec-head"><h2>${tr ? 'Uydu Öncülü vs Sahada Tespit Edilen Farklar (Δt Drift)' : 'Orbital Prior vs In-Situ Discrepancies (Δt Drift)'}</h2></div>
        ${discRows}
        <div class="sec-head"><h2>${tr ? 'Astronot Giysi (xEMU) & Walkback / SPE Sığınak Limiti' : 'xEMU Suit Bioenergetics, Walkback & SPE Shelter'}</h2></div>
        <div class="hls-checks">
          <div class="hls-check"><span class="hint">${tr ? 'O2 Rezervi' : 'O2 Reserve'}</span><b class="${sim.o2RemainPct >= 35 ? 'ok' : 'warn'}">${sim.o2RemainPct}% (${tr ? 'Tüketim' : 'Used'} ${sim.o2UsedPct}%)</b></div>
          <div class="hls-check"><span class="hint">${tr ? 'Batarya' : 'Suit Battery'}</span><b class="${sim.battRemainPct >= 30 ? 'ok' : 'warn'}">${sim.battRemainPct}%</b></div>
          <div class="hls-check"><span class="hint">${tr ? 'Soğutma H2O' : 'Cooling H2O'}</span><b class="${sim.waterRemainPct >= 30 ? 'ok' : 'warn'}">${sim.waterUsedL} L (${sim.waterRemainPct}%)</b></div>
        </div>
        <div class="kv"><span>${tr ? 'Metabolik Yük' : 'Metabolic Rate'}</span><b>${sim.metabolicKcalH} kcal/${tr ? 'sa' : 'h'} · ${sim.metabolicW} W</b></div>
        <div class="kv"><span>${tr ? 'Walkback Güvenli Geri Dönüş' : 'Walkback Safety Limit'}</span><b class="${sim.withinWalkback ? 'ok' : 'warn'}">${sim.walkbackRadiusM} m (${tr ? 'Azami' : 'Max'} ${sim.maxRadiusFromBaseM} m)</b></div>
        <div class="kv"><span>${tr ? 'SPE Sığınağa Acil Kaçış Süresi (≤30 dk)' : 'SPE Storm Time-to-Shelter (≤30m)'}</span><b class="${sim.speWithin30Min ? 'ok' : 'bad'}">${speTimeShown} ${tr ? 'dk' : 'min'} (${sim.speReturnDistM} m)</b></div>
        <div class="kv"><span>${tr ? 'AutoNav A* vs Ham Uydu Rotası' : 'AutoNav A* vs Naive Orbital Route'}</span><b class="ok">${sim.safeDistM} m (0 ${tr ? 'risk' : 'hits'}) vs ${sim.orbitalDistM} m (${sim.orbitalHazardHits} ${tr ? 'risk' : 'hazards'})</b></div>
        <div class="sec-head"><h2>${tr ? 'Bilimsel Hedef Noktaları (Science Waypoints)' : 'Science Waypoints (Click for HUD)'}</h2></div>
        <div class="eva-wp-list">${wpCards}</div>`;

      const localCanvas = out.querySelector('#eva-local-canvas');
      if (localCanvas) {
        drawLocalEvaCanvas(localCanvas, sim, state.activeWpIdx, state.laserOn);
        localCanvas.onclick = (e) => {
          const r = localCanvas.getBoundingClientRect();
          const gx = r.width ? ((e.clientX - r.left) / r.width) * 100 : 50;
          const gy = r.height ? ((e.clientY - r.top) / r.height) * 100 : 50;
          let bestIdx = state.activeWpIdx, bestD = 999;
          zone.waypoints.forEach((wp, i) => {
            const d = Math.hypot(wp.x - gx, wp.y - gy);
            if (d < bestD) { bestD = d; bestIdx = i; }
          });
          if (bestD < 11) {
            state.activeWpIdx = bestIdx;
            renderPanel();
            openHudModal(bestIdx);
          } else {
            const px = Math.max(2, Math.min(97, Math.round(gx)));
            const py = Math.max(2, Math.min(97, Math.round(gy)));
            state.customScanPts.push({ x: px, y: py, r: 11 });
            if (state.customScanPts.length > 12) state.customScanPts.shift();
            state.spotProbe = { x: px, y: py };
            recompute();
          }
        };
      }

      const btnHud = out.querySelector('#btn-open-hud');
      if (btnHud) btnHud.onclick = () => openHudModal(state.activeWpIdx);

      out.querySelectorAll('.eva-wp-card').forEach(card => {
        const activate = () => {
          state.activeWpIdx = +card.dataset.wp;
          renderPanel();
          openHudModal(state.activeWpIdx);
        };
        card.onclick = activate;
        card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } };
      });
    }

    function zoomToZone(zoneKeyOrCoords) {
      state.customScanPts = [];
      state.dynamicHazards = [];
      state.spotProbe = null;
      if (typeof zoneKeyOrCoords === 'string' && ZONES[zoneKeyOrCoords]) {
        state.zoneId = zoneKeyOrCoords;
      } else if (zoneKeyOrCoords && typeof zoneKeyOrCoords === 'object') {
        const { lat, lon, v, regionName } = zoneKeyOrCoords;
        const matched = zoneFromCoords(lat, lon, v, regionName);
        if (ZONES[matched.id]) {
          state.zoneId = matched.id;
        } else {
          state.zoneId = 'custom_site';
          state.customZone = matched;
        }
      }
      state.activeWpIdx = 0;
      const sel = $('#eva-zone-select');
      if (sel && ZONES[state.zoneId]) sel.value = state.zoneId;
      recompute();
      const z = currentZone();
      if (onSelectCoord && layers && layers.L) {
        onSelectCoord(layers.L.colOfLon(z.lon), layers.L.rowOfLat(z.lat), z.lat, z.lon);
      }
    }

    function bindControls() {
      const sel = $('#eva-zone-select');
      if (sel) sel.onchange = () => zoomToZone(sel.value);
      const domSel = $('#eva-domain-layer');
      if (domSel) domSel.onchange = () => { state.domainLayer = domSel.value; recompute(); };
      const scoreSel = $('#eva-score-mode');
      if (scoreSel) scoreSel.onchange = () => { state.scoreMode = scoreSel.value; recompute(); };
      const modeSel = $('#eva-buddy-mode');
      if (modeSel) modeSel.onchange = () => { state.buddyMode = modeSel.value; recompute(); };

      const scanSlider = $('#eva-scan-step');
      if (scanSlider) {
        scanSlider.oninput = () => {
          stopPlay();
          state.scanStep = +scanSlider.value;
          recompute();
        };
      }
      const btnReset = $('#btn-eva-reset');
      if (btnReset) {
        btnReset.onclick = () => {
          stopPlay();
          state.scanStep = 0;
          state.mglLocked = false;
          state.speAlert = false;
          state.customScanPts = [];
          state.dynamicHazards = [];
          state.spotProbe = null;
          recompute();
        };
      }
      const btnStep = $('#btn-eva-step');
      if (btnStep) btnStep.onclick = () => { stopPlay(); state.scanStep = Math.min(8, state.scanStep + 1); recompute(); };
      const btnPlay = $('#btn-eva-play');
      if (btnPlay) btnPlay.onclick = togglePlay;
      const btnScan = $('#btn-eva-scan');
      if (btnScan) btnScan.onclick = () => { stopPlay(); state.scanStep = 8; state.mglLocked = true; recompute(); };
      const btnMgl = $('#btn-eva-mgl');
      if (btnMgl) btnMgl.onclick = () => { state.mglLocked = !state.mglLocked; recompute(); };
      const btnSpe = $('#btn-eva-spe');
      if (btnSpe) btnSpe.onclick = () => { state.speAlert = !state.speAlert; recompute(); };
      const btnHazard = $('#btn-eva-hazard');
      if (btnHazard) {
        btnHazard.onclick = () => {
          const sim = state.sim || recompute();
          const path = sim.safePath || [];
          const pick = path.length > 6 ? path[Math.floor(path.length * (0.25 + (state.dynamicHazards.length * 0.23) % 0.6))] : [50, 50];
          state.dynamicHazards.push({ x: pick[0], y: pick[1], r: 5, label: 'Dynamic Rockfall / Drift Anomaly' });
          if (state.dynamicHazards.length > 4) state.dynamicHazards.shift();
          recompute();
        };
      }

      const bindWeight = (id, key) => {
        const el = $('#' + id);
        if (!el) return;
        el.oninput = () => {
          state.customWeights[key] = +el.value;
          if ($('#' + id + '-v')) $('#' + id + '-v').textContent = el.value + '%';
          recompute();
        };
      };
      bindWeight('eva-w-topo', 'topography');
      bindWeight('eva-w-geo', 'geomorphology');
      bindWeight('eva-w-therm', 'thermal');
      bindWeight('eva-w-rad', 'radiation');
      bindWeight('eva-w-opt', 'optical');

      const bindSlider = (id, fmt, fn) => {
        const el = $('#' + id);
        if (!el) return;
        const upd = () => {
          if ($('#' + id + '-v')) $('#' + id + '-v').textContent = fmt(+el.value);
          fn(+el.value);
        };
        el.oninput = upd;
        upd();
      };
      bindSlider('eva-load', v => v + ' kg', v => { state.loadKg = v; recompute(); });
      bindSlider('eva-speed', v => (v / 10).toFixed(1) + ' km/h', v => { state.speedKmh = v / 10; recompute(); });
      bindSlider('eva-maxslope', v => v + '°', v => { state.maxSlope = v; recompute(); });

      const closeBtn = $('#hud-close');
      if (closeBtn) closeBtn.onclick = closeHudModal;
      const modal = $('#hud-modal');
      if (modal) modal.onclick = (e) => { if (e.target.id === 'hud-modal') closeHudModal(); };
      recompute();
    }

    return {
      state,
      recompute,
      renderPanel,
      zoomToZone,
      openHudModal,
      closeHudModal,
      bindControls,
    };
  }

  global.MDE_EVA = {
    SYSTEM_ARCH,
    DOMAINS,
    SCORE_MODES,
    ZONES,
    buildLocalGrid,
    scoreLocalDomains,
    buildAssimilationMask,
    simulateEVA,
    zoneFromCoords,
    drawLocalEvaCanvas,
    drawGroundPovCanvas,
    drawGlobalWalkbackOverlay,
    createEvaController,
  };
})(typeof module === 'object' && module.exports ? module.exports : globalThis);
