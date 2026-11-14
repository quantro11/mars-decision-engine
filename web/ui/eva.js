// Phase 2: Hyper-Local Tactical EVA (Marswalk · 1 m/px) Planner, xEMU Suit Bioenergetics,
// Walkback Safety Limit Circle, Buddy System, and Helmet Visor HUD (Ground POV + LIBS/APXS Spectra).
(function (global) {
  'use strict';

  const MARS_G = 3.71; // m/s^2 (0.378 g_Earth)
  const SUIT_O2_CAP_G = 850; // Primary usable metabolic O2 (g) per astronaut suit
  const SUIT_BATT_CAP_WH = 960; // PLSS Li-Ion battery capacity (Wh)
  const SUIT_WATER_CAP_L = 3.8; // LCVG feedwater sublimator tank capacity (L)
  const BASE_AVIONICS_W = 95; // PLSS fan, CO2 RCA scrubber, HUD, radio, pump base power (W)

  const ZONES = {
    gale_boxwork: {
      id: 'gale_boxwork',
      name: 'Gale Crater · Mount Sharp Boxwork (Curiosity 2025)',
      nameTr: 'Gale Krateri · Mount Sharp Boxwork Oluşumları (Curiosity 2025)',
      lat: -5.08,
      lon: 137.85,
      elev: -4120,
      radMsvYr: 232,
      hiRiseId: 'ESP_078412_1745 · 0.25 m/px HiRISE + CTX 1 m/px DEM',
      summary: '2025 Curiosity campaign inspecting meter-scale polygonal boxwork fracture ridges cemented by mineralizing groundwater on Mount Sharp.',
      summaryTr: 'Curiosity 2025 görevinde incelenen, yeraltı sularıyla çimentolanmış metre ölçekli çokgen kutu (boxwork) sırtları ve sülfat-kil geçiş zonu.',
      base: { x: 14, y: 84, label: 'Rover / EVA Airlock' },
      boulders: [
        { x: 34, y: 66, r: 9, label: 'Gediz Vallis Boulder Apron' },
        { x: 56, y: 48, r: 10, label: 'Sulfate Megablock Field' },
        { x: 38, y: 31, r: 7, label: 'Fractured Caprock Talus' }
      ],
      walls: [
        { x1: 20, y1: 52, x2: 48, y2: 56, w: 5, slope: 23, label: 'Mount Sharp Sulfate Scarp (23°)' },
        { x1: 60, y1: 24, x2: 88, y2: 36, w: 5, slope: 21, label: 'Upper Boxwork Bench Wall (21°)' }
      ],
      sandTraps: [
        { x: 46, y: 74, rx: 12, ry: 7, label: 'Bagnold Dark Ripple Sand Trap' },
        { x: 69, y: 62, rx: 10, ry: 8, label: 'Aeolian Dust Trough (<85 tiu)' }
      ],
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
          cam: 'Curiosity Navcam + ChemCam LIBS · Sol 4385',
          rockType: 'Debris-Flow Alluvial Conglomerate & Sulfate Crust',
          rockTypeTr: 'Moloz Akıntısı Alüvyal Konglomera ve Sülfat Kabuğu',
          mineralogy: 'Kieserite (MgSO₄·H₂O) + Hematite nodules in fluvial matrix',
          mineralogyTr: 'Akarsu matriksinde kieserit (MgSO₄·H₂O) ve hematit yumruları',
          astrobio: 'Preserves final wet-to-dry climate transition episodes of Hesperian Mars.',
          astrobioTr: 'Hesperian Mars’ın son ıslak-kuru iklim geçiş evrelerini korur.',
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
      name: 'Jezero Crater · Western Delta & Cheyava Falls',
      nameTr: 'Jezero Krateri · Batı Deltası & Cheyava Falls',
      lat: 18.38,
      lon: 77.58,
      elev: -2540,
      radMsvYr: 251,
      hiRiseId: 'ESP_069124_1985 · 0.25 m/px HiRISE + Mastcam-Z DEM',
      summary: 'Perseverance Neretva Vallis delta front featuring Cheyava Falls leopard-spot mudstone, carbonate margin benches, and boulder conglomerates.',
      summaryTr: 'Perseverance Neretva Vallis delta cephesi: Cheyava Falls leopar benekli çamurtaşı, karbonat kıyı sekileri ve konglomera blokları.',
      base: { x: 16, y: 82, label: 'Three Forks Depot / Rover Base' },
      boulders: [
        { x: 38, y: 60, r: 9, label: 'Kodiak Flood Boulder Fan' },
        { x: 60, y: 44, r: 9, label: 'Washburn Impact Megablocks' },
        { x: 30, y: 28, r: 7, label: 'Delta Front Talus Cone' }
      ],
      walls: [
        { x1: 18, y1: 46, x2: 46, y2: 50, w: 5, slope: 24, label: 'Cape Nukshak Delta Cliff (24°)' },
        { x1: 58, y1: 24, x2: 86, y2: 32, w: 5, slope: 20, label: 'Neretva Vallis Margin Scarp (20°)' }
      ],
      sandTraps: [
        { x: 48, y: 74, rx: 13, ry: 7, label: 'Belva Transverse Aeolian Dune Trap' },
        { x: 72, y: 58, rx: 10, ry: 7, label: 'Fine Silt Sinkage Pocket (<90 tiu)' }
      ],
      waypoints: [
        {
          id: 'WP-1',
          code: 'CHY-A',
          name: 'Cheyava Falls Outcrop (Leopard-Spot Mudstone)',
          nameTr: 'Cheyava Falls Mostrası (Leopar Benekli Çamurtaşı)',
          x: 26,
          y: 36,
          elevRel: +22,
          heading: 34,
          cam: 'Perseverance Mastcam-Z + SHERLOC · Sol 1215',
          rockType: 'Organic-Bearing Vivianite-Greigite Reaction Front Mudstone',
          rockTypeTr: 'Organik İçerikli Viviyanit-Greigit Reaksiyon Çamurtaşı',
          mineralogy: 'Calcite Sulfate veins + mm-scale Fe-phosphate (vivianite) & Fe-sulfide rims',
          mineralogyTr: 'Kalsiyum sülfat damarları + mm ölçekli Fe-fosfat (viviyanit) ve Fe-sülfür halkaları',
          astrobio: 'Tier-1 Astrobiology Target: redox reaction spots linked to organic carbon detected by SHERLOC.',
          astrobioTr: '1. Derece Astrobiyoloji Hedefi: SHERLOC ile saptanan organik karbon bağlantılı redoks halkaları.',
          chem: { SiO2: 44.2, FeO: 17.9, SO3: 14.6, MgO: 8.1, CaO: 8.8, Al2O3: 5.4, H2O: 5.1 },
          specPeaks: [0.84, 0.92, 0.67, 0.89, 0.54, 0.78, 0.96, 0.71, 0.60, 0.88],
          povTheme: 'delta',
          sampleKg: 2.5
        },
        {
          id: 'WP-2',
          code: 'MRG-B',
          name: 'Margin Unit Olivine-Mg Carbonate Bench',
          nameTr: 'Kıyı Birimi Olivin-Mg Karbonat Sekisi',
          x: 54,
          y: 26,
          elevRel: +38,
          heading: 68,
          cam: 'Perseverance SuperCam + PIXL · Sol 1098',
          rockType: 'Lacustrine Shoreline Magnesite-Olivine Sandstone',
          rockTypeTr: 'Gölsel Kıyı Çizgisi Manyezit-Olivin Kumtaşı',
          mineralogy: 'Hydrated Mg-Carbonate + Forsteritic Olivine + Authigenic Silica',
          mineralogyTr: 'Hidratlı Mg-Karbonat + Forsteritik Olivin + Otijenik Silika',
          astrobio: 'Carbonate cements precipitate directly in neutral-alkaline lake shoreline waters.',
          astrobioTr: 'Nötr-alkali göl kıyı sularında doğrudan çökelmiş karbonat çimentosu.',
          chem: { SiO2: 40.5, FeO: 15.2, SO3: 5.4, MgO: 22.8, CaO: 6.3, Al2O3: 4.1, H2O: 4.4 },
          specPeaks: [0.44, 0.76, 0.93, 0.68, 0.81, 0.52, 0.74, 0.89, 0.65, 0.72],
          povTheme: 'delta',
          sampleKg: 2.5
        },
        {
          id: 'WP-3',
          code: 'KOD-C',
          name: 'Kodiak Delta Foreset Bedding Section',
          nameTr: 'Kodiak Deltası Eğimli Tabaka Kesiti',
          x: 78,
          y: 44,
          elevRel: +19,
          heading: 112,
          cam: 'Perseverance Mastcam-Z Telephoto · Sol 822',
          rockType: 'Gilbert-Type Deltaic Foreset & Topset Sandstone',
          rockTypeTr: 'Gilbert Tipi Deltaik Ön-Set ve Üst-Set Kumtaşı',
          mineralogy: 'Pyroxene + Plagioclase + Fe/Mg Phyllosilicate cement',
          mineralogyTr: 'Piroksen + Plajiyoklaz + Fe/Mg Fillosilikat çimento',
          astrobio: 'Confirms sustained standing lake level at -2400 m MOLA datum in Jezero.',
          astrobioTr: 'Jezero’da -2400 m MOLA kotunda kalıcı göl seviyesini kanıtlar.',
          chem: { SiO2: 48.9, FeO: 16.0, SO3: 4.9, MgO: 11.4, CaO: 7.8, Al2O3: 8.6, H2O: 3.2 },
          specPeaks: [0.62, 0.55, 0.78, 0.84, 0.69, 0.61, 0.73, 0.82, 0.58, 0.66],
          povTheme: 'channel',
          sampleKg: 3.0
        },
        {
          id: 'WP-4',
          code: 'EVAP-D',
          name: 'Hogwallow Flats Sulfate-Clay Mudstone',
          nameTr: 'Hogwallow Flats Sülfat-Kil Çamurtaşı',
          x: 64,
          y: 76,
          elevRel: +8,
          heading: 155,
          cam: 'Perseverance WATSON + PIXL · Sol 512',
          rockType: 'Fine-Grained Sulfate-Smectite Lakebed Evaporite',
          rockTypeTr: 'İnce Taneli Sülfat-Smektit Göl Tabanı Evaporiti',
          mineralogy: 'Fe/Mg Smectite + Hydrated Ca/Mg Sulfates',
          mineralogyTr: 'Fe/Mg Smektit + Hidratlı Ca/Mg Sülfatlar',
          astrobio: 'Prime Mars Sample Return benchmark lithology for biomarker preservation.',
          astrobioTr: 'Mars Numune Dönüşü (MSR) için birincil biyo-iz koruma litolojisi.',
          chem: { SiO2: 43.1, FeO: 17.4, SO3: 16.8, MgO: 9.6, CaO: 5.5, Al2O3: 5.2, H2O: 5.9 },
          specPeaks: [0.51, 0.88, 0.79, 0.64, 0.91, 0.73, 0.85, 0.68, 0.77, 0.90],
          povTheme: 'clay',
          sampleKg: 2.0
        }
      ]
    },
    nili_fossae: {
      id: 'nili_fossae',
      name: 'Nili Fossae · Carbonate & Clay Trough (HLS EZ)',
      nameTr: 'Nili Fossae · Karbonat & Kil Çöküntüsü (HLS EZ)',
      lat: 21.00,
      lon: 74.00,
      elev: -600,
      radMsvYr: 274,
      hiRiseId: 'PSP_002888_2015 · 0.25 m/px HiRISE + CRISM M-Type',
      summary: 'Noachian graben trough exposing the largest regional Mg-carbonate and Fe/Mg-smectite hydrothermal alteration suite on Mars.',
      summaryTr: 'Mars üzerindeki en geniş bölgesel Mg-karbonat ve Fe/Mg-smektit hidrotermal alterasyon istifini yüzeyleyen Noachian graben oluğu.',
      base: { x: 15, y: 84, label: 'Nili Valley Hab / Rover Airlock' },
      boulders: [
        { x: 35, y: 62, r: 8, label: 'Isidis Impact Breccia Megablocks' },
        { x: 58, y: 46, r: 9, label: 'Ultramafic Caprock Boulder Apron' },
        { x: 36, y: 29, r: 7, label: 'Fault Scarp Rockfall Talus' }
      ],
      walls: [
        { x1: 20, y1: 50, x2: 48, y2: 54, w: 5, slope: 22, label: 'Graben Normal Fault Wall (22°)' },
        { x1: 60, y1: 25, x2: 86, y2: 33, w: 5, slope: 19, label: 'Eastern Basalt Mesa Rim (19°)' }
      ],
      sandTraps: [
        { x: 47, y: 74, rx: 12, ry: 7, label: 'Trough Floor Aeolian Sand Sheet' },
        { x: 70, y: 60, rx: 10, ry: 7, label: 'Olivine Dune Slipface Trap' }
      ],
      waypoints: [
        {
          id: 'WP-1',
          code: 'CRB-A',
          name: 'Hydrothermal Mg-Carbonate Fracture Bench',
          nameTr: 'Hidrotermal Mg-Karbonat Kırık Sekisi',
          x: 28,
          y: 38,
          elevRel: +24,
          heading: 38,
          cam: 'HiRISE + CRISM Simulated Mastcam HUD · 1 m/px',
          rockType: 'Fractured Magnesite-Serpentine Altered Ultramafic',
          rockTypeTr: 'Kırıklı Manyezit-Serpantin Alterasyonlu Ultramafik Kaya',
          mineralogy: 'Magnesite (MgCO₃) + Saponite + trace Serpentine',
          mineralogyTr: 'Manyezit (MgCO₃) + Saponit + eser Serpantin',
          astrobio: 'Serpentinization H₂ production provides chemical energy for chemolithoautotrophic life.',
          astrobioTr: 'Serpantinleşme H₂ üretimi kemoototrofik yaşam için doğrudan kimyasal enerji sağlar.',
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
          x: 54,
          y: 27,
          elevRel: +31,
          heading: 75,
          cam: 'Simulated xEMU Visor Navcam + LIBS',
          rockType: 'Deeply Weathered Noachian Clay Basement',
          rockTypeTr: 'Derin Ayrışmış Noachian Kil Temel Kayası',
          mineralogy: 'Ferrosaponite + Nontronite + Kaolinite cap',
          mineralogyTr: 'Ferrosaponit + Nontronit + Kaolinit şapka',
          astrobio: 'High bound-water content (>6 wt% H₂O) ideal for both ISRU baking and biosignatures.',
          astrobioTr: 'Yüksek bağlı su içeriği (>%6 H₂O), hem ISRU su kazanımı hem biyo-izler için idealdir.',
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
          x: 78,
          y: 45,
          elevRel: +16,
          heading: 115,
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
          x: 64,
          y: 77,
          elevRel: +7,
          heading: 158,
          cam: 'Simulated xEMU Visor Macro Spectrometer',
          rockType: 'Opaline Silica Fracture Sinter Deposit',
          rockTypeTr: 'Opalin Silika Kırık Sinter Çökeli',
          mineralogy: 'Opal-A (SiO₂·nH₂O) + Chalcedony + Jarosite',
          mineralogyTr: 'Opal-A (SiO₂·nH₂O) + Kalsedon + Jarosit',
          astrobio: 'Opaline silica sinters are among the best microfossil preservation media on Earth and Mars.',
          astrobioTr: 'Opalin silika sinterleri Dünya ve Mars’taki en iyi mikrofosil koruma ortamlarındandır.',
          chem: { SiO2: 68.4, FeO: 8.9, SO3: 6.1, MgO: 4.2, CaO: 3.1, Al2O3: 4.0, H2O: 7.4 },
          specPeaks: [0.92, 0.87, 0.64, 0.52, 0.89, 0.96, 0.78, 0.61, 0.84, 0.93],
          povTheme: 'boxwork',
          sampleKg: 2.0
        }
      ]
    },
    arcadia_ice: {
      id: 'arcadia_ice',
      name: 'Arcadia Planitia · Shallow Polygon Ice Sheet',
      nameTr: 'Arcadia Planitia · Sığ Poligon Buz Örtüsü',
      lat: 39.20,
      lon: -188.00,
      elev: -4350,
      radMsvYr: 218,
      hiRiseId: 'ESP_054821_2195 · 0.25 m/px HiRISE Glacial Polygons',
      summary: 'Low-elevation northern plains combining maximum atmospheric braking margin (-4.35 km) with shallow SWIM 2.0 subsurface water ice.',
      summaryTr: 'Maksimum atmosferik frenleme payını (-4.35 km) sığ SWIM 2.0 yeraltı su buzu tablasıyla birleştiren kuzey alçak düzlüğü.',
      base: { x: 16, y: 84, label: 'Starship / Hab ISRU Pad' },
      boulders: [
        { x: 36, y: 62, r: 7, label: 'Secondary Crater Ejecta Blocks' },
        { x: 58, y: 46, r: 8, label: 'periglacial Frost-Heave Boulders' },
        { x: 36, y: 30, r: 6, label: 'Expanded Crater Rim Talus' }
      ],
      walls: [
        { x1: 20, y1: 50, x2: 46, y2: 53, w: 5, slope: 18, label: 'Sublimated Scarp Terrace (18°)' },
        { x1: 60, y1: 26, x2: 85, y2: 32, w: 5, slope: 19, label: 'Lobate Rampart Ridge (19°)' }
      ],
      sandTraps: [
        { x: 47, y: 74, rx: 11, ry: 7, label: 'High-Albedo Dust Pocket (<75 tiu)' },
        { x: 70, y: 58, rx: 10, ry: 7, label: 'Polygon Trough Loose Fines' }
      ],
      waypoints: [
        {
          id: 'WP-1',
          code: 'ICE-A',
          name: 'Thermal-Contraction Polygon Ice Trench',
          nameTr: 'Termal Büzülme Poligonu Buz Hendek Noktası',
          x: 28,
          y: 38,
          elevRel: +6,
          heading: 32,
          cam: 'xEMU Visor Navcam + Neutron/GPR Probe',
          rockType: 'Ice-Cemented Permafrost Regolith (1.2 m Depth)',
          rockTypeTr: 'Buz Çimentolu Permafrost Regolit (1.2 m Derinlik)',
          mineralogy: 'Pore Water Ice (H₂O) + Basaltic Regolith + Ca-Perchlorate trace',
          mineralogyTr: 'Gözenek Su Buzu (H₂O) + Bazaltik Regolit + eser Ca-perklorat',
          astrobio: 'Primary ISRU water feedstock for crew life support and methalox propellant.',
          astrobioTr: 'Mürettebat yaşam desteği ve metan-oksijen yakıt üretimi için birincil su kaynağı.',
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
          y: 27,
          elevRel: +14,
          heading: 72,
          cam: 'xEMU Visor Stereo Mastcam',
          rockType: 'Impact-Melted Cryosphere Mudflow Breccia',
          rockTypeTr: 'Çarpma Erimesi Kriyosfer Çamur Akıntısı Breşi',
          mineralogy: 'Palagonitic Glass + Smectite + Sulfate salts',
          mineralogyTr: 'Palagonitik Cam + Smektit + Sülfat tuzları',
          astrobio: 'Impact into ice-rich ground generated transient warm subsurface brines.',
          astrobioTr: 'Buzca zengin zemine çarpma, geçici sıcak yeraltı tuzlu suları oluşturmuştur.',
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
          y: 44,
          elevRel: +4,
          heading: 108,
          cam: 'xEMU Visor Engineering Down-Cam',
          rockType: 'Indurated Duricrust over Compacted Basalt Sand',
          rockTypeTr: 'Sıkışmış Bazalt Kumu Üzerinde Sertleşmiş Durikrast',
          mineralogy: 'Plagioclase + Augite + Sulfate-cemented duricrust',
          mineralogyTr: 'Plajiyoklaz + Ojit + Sülfat çimentolu durikrast kabuk',
          astrobio: 'High thermal inertia (245 tiu) resists rocket plume erosion during landing.',
          astrobioTr: 'Yüksek termal atalet (245 tiu), iniş sırasında roket egzoz aşındırmasına direnç gösterir.',
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
          cam: 'xEMU Visor Dosimeter + RAD Sensor',
          rockType: 'Fine-to-Coarse Regolith Aggregate (1.65 g/cm³)',
          rockTypeTr: 'İnce-Kaba Regolit Agregası (1.65 g/cm³)',
          mineralogy: 'Basaltic fines + Hydrogen-rich pore ice',
          mineralogyTr: 'Bazaltik ince taneler + Hidrojence zengin gözenek buzu',
          astrobio: 'Hydrogen-rich icy regolith attenuates secondary GCR neutrons 35% better than dry rock.',
          astrobioTr: 'Hidrojence zengin buzlu regolit, ikincil GCR nötronlarını kuru kayadan %35 daha iyi sönümler.',
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

  /**
   * Build a deterministic 1 km x 1 km (100x100 cell @ 10m/cell, rendered at 1 m/px) local terrain grid.
   */
  function buildLocalGrid(zone) {
    const N = 100;
    const slope = new Float32Array(N * N);
    const hazard = new Uint8Array(N * N); // 0=clear, 1=boulder, 2=wall, 3=sandTrap
    const elev = new Float32Array(N * N);
    const seed = Math.abs(Math.round(zone.lat * 100 + zone.lon * 100)) || 42;

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const wave = Math.sin((x + seed) * 0.11) * Math.cos((y + seed) * 0.09) * 14 +
                     Math.sin((x * 0.23 - y * 0.19)) * 6 +
                     (90 - y) * 0.35;
        elev[i] = zone.elev + wave;
        slope[i] = Math.max(1.2, Math.min(12.5, 2.8 + Math.abs(Math.sin(x * 0.17 + y * 0.13)) * 5.2));
      }
    }

    for (const st of zone.sandTraps) {
      for (let y = Math.max(0, st.y - st.ry - 2); y <= Math.min(N - 1, st.y + st.ry + 2); y++) {
        for (let x = Math.max(0, st.x - st.rx - 2); x <= Math.min(N - 1, st.x + st.rx + 2); x++) {
          const d = Math.hypot((x - st.x) / st.rx, (y - st.y) / st.ry);
          if (d <= 1.0) {
            hazard[y * N + x] = 3;
            slope[y * N + x] = Math.max(slope[y * N + x], 6.5);
          }
        }
      }
    }

    for (const b of zone.boulders) {
      for (let y = Math.max(0, b.y - b.r - 1); y <= Math.min(N - 1, b.y + b.r + 1); y++) {
        for (let x = Math.max(0, b.x - b.r - 1); x <= Math.min(N - 1, b.x + b.r + 1); x++) {
          const d = Math.hypot(x - b.x, y - b.y);
          if (d <= b.r) {
            hazard[y * N + x] = 1;
            slope[y * N + x] = 19.5 + (1 - d / b.r) * 8;
          }
        }
      }
    }

    for (const w of zone.walls) {
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1, len2 = dx * dx + dy * dy || 1;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const t = Math.max(0, Math.min(1, ((x - w.x1) * dx + (y - w.y1) * dy) / len2));
          const px = w.x1 + t * dx, py = w.y1 + t * dy;
          const d = Math.hypot(x - px, y - py);
          if (d <= w.w * 0.55) {
            hazard[y * N + x] = 2;
            slope[y * N + x] = w.slope;
            elev[y * N + x] += 14;
          }
        }
      }
    }

    // Ensure base and waypoints themselves sit on navigable micro-pads
    const clearPad = (cx, cy) => {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && nx < N && ny >= 0 && ny < N) {
            hazard[ny * N + nx] = 0;
            slope[ny * N + nx] = Math.min(slope[ny * N + nx], 4.5);
          }
        }
      }
    };
    clearPad(zone.base.x, zone.base.y);
    zone.waypoints.forEach(wp => clearPad(wp.x, wp.y));

    return { N, slope, hazard, elev };
  }

  /**
   * Meter-scale 8-connected A* between two points on the 100x100 (1 km x 1 km) local EVA grid.
   */
  function astarLeg(grid, sx, sy, gx, gy, maxSlope) {
    const N = grid.N, total = N * N;
    const gScore = new Float32Array(total).fill(Infinity);
    const fScore = new Float32Array(total).fill(Infinity);
    const parent = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const startIdx = sy * N + sx, goalIdx = gy * N + gx;
    gScore[startIdx] = 0;
    fScore[startIdx] = Math.hypot(gx - sx, gy - sy);
    const open = [startIdx];

    const dirs = [
      [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
      [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2]
    ];

    while (open.length) {
      let bestPos = 0;
      for (let i = 1; i < open.length; i++) {
        if (fScore[open[i]] < fScore[open[bestPos]]) bestPos = i;
      }
      const cur = open[bestPos];
      open[bestPos] = open[open.length - 1];
      open.pop();
      if (cur === goalIdx) break;
      if (closed[cur]) continue;
      closed[cur] = 1;

      const cy = (cur / N) | 0, cx = cur - cy * N;
      for (const [dx, dy, stepLen] of dirs) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue;
        const ni = ny * N + nx;
        if (closed[ni]) continue;
        const sl = grid.slope[ni], hz = grid.hazard[ni];
        if (hz === 1 || hz === 2 || sl > maxSlope) continue; // Impassable boulder or steep wall
        const sandPen = hz === 3 ? 3.8 : 0;
        const slopePen = 0.25 * sl;
        const tentative = gScore[cur] + stepLen * (1 + slopePen + sandPen);
        if (tentative < gScore[ni]) {
          parent[ni] = cur;
          gScore[ni] = tentative;
          fScore[ni] = tentative + Math.hypot(gx - nx, gy - ny);
          open.push(ni);
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
      // Fallback straight-line if user sets extremely low maxSlope
      const steps = Math.max(1, Math.round(Math.hypot(gx - sx, gy - sy)));
      for (let s = 0; s <= steps; s++) {
        path.push([Math.round(sx + (gx - sx) * s / steps), Math.round(sy + (gy - sy) * s / steps)]);
      }
    }
    return path;
  }

  /**
   * Compute full multi-waypoint EVA loop and Pandolf Martian bioenergetics.
   * @param {Object} zone Local 1 km x 1 km EVA zone
   * @param {Object} cfg { loadKg, speedKmh, maxSlope, buddyMode }
   */
  function simulateEVA(zone, cfg = {}) {
    const loadKg = cfg.loadKg ?? 15;
    const speedKmh = cfg.speedKmh ?? 2.4;
    const maxSlope = cfg.maxSlope ?? 15;
    const buddyMode = cfg.buddyMode || 'buddy'; // 'buddy' or 'rover_eva'
    const grid = buildLocalGrid(zone);
    const stops = [zone.base, ...zone.waypoints, zone.base];

    const safePath = [];
    const directPath = [];
    let safeDistM = 0, directDistM = 0;
    let maxSafeSlope = 0, maxDirectSlope = 0;
    let directBoulderHits = 0, directSandM = 0, safeSandM = 0;
    let maxRadiusFromBaseM = 0;

    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      const leg = astarLeg(grid, a.x, a.y, b.x, b.y, maxSlope);
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
          const stepM = Math.hypot(px - qx, py - qy) * 10;
          safeDistM += stepM;
          if (grid.hazard[idx] === 3) safeSandM += stepM;
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

    // Pandolf-Santee Martian Locomotion Bioenergetics (g = 3.71 m/s^2 = 0.378 g_Earth)
    const vMps = Math.max(0.25, speedKmh / 3.6);
    const bodyKg = 80, suitKg = 82;
    // Buddy system shares 20% of portable science tools; Rover+EVA carries tools on rover for 35% of route
    const effLoadKg = buddyMode === 'rover_eva' ? loadKg * 0.55 : loadKg * 0.90;
    const effMassMars = (bodyKg + suitKg + effLoadKg) * (MARS_G / 9.81);
    const meanGradePct = Math.tan((maxSafeSlope * 0.48) * Math.PI / 180) * 100;
    const terrainEta = 1.32 + (safeSandM / Math.max(100, safeDistM)) * 0.85;
    const suitJointWorkW = 115; // xEMU pressurized hip/knee bearing torque work
    const pandolfW = 1.5 * bodyKg * (MARS_G / 9.81) +
                     2.0 * effMassMars * Math.pow(effLoadKg / bodyKg, 2) +
                     terrainEta * effMassMars * (1.5 * vMps * vMps + 0.35 * vMps * meanGradePct) +
                     suitJointWorkW;
    const metabolicW = Math.round(Math.max(190, Math.min(680, pandolfW)));
    const metabolicKcalH = Math.round(metabolicW * 0.8598);

    // Traverse + science sampling time (15 min = 0.25 h per waypoint for LIBS/APXS & coring)
    const walkTimeH = (safeDistM / 1000) / Math.max(0.5, speedKmh);
    const scienceStopH = zone.waypoints.length * 0.22;
    const totalEvaH = (buddyMode === 'rover_eva' ? walkTimeH * 0.68 : walkTimeH) + scienceStopH;
    const totalKcal = Math.round(metabolicKcalH * totalEvaH);

    // O2, Battery, Cooling Water consumption
    const o2RateGh = 0.255 * metabolicW; // g O2/h
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

    // Walkback Safety Limit: max distance astronauts can walk back to base/rover on remaining O2 & H2O
    // keeping a mandatory 15% emergency reserve floor.
    const usableWalkbackO2G = Math.max(40, (SUIT_O2_CAP_G * 0.85) - o2UsedG * 0.5);
    const usableWalkbackHours = Math.min(
      usableWalkbackO2G / o2RateGh,
      Math.max(0.25, (SUIT_WATER_CAP_L * 0.85 - waterUsedL * 0.5) / waterRateLh)
    );
    const walkbackRadiusM = Math.round(Math.max(320, Math.min(4800, usableWalkbackHours * speedKmh * 1000 * 0.42)));
    const withinWalkback = maxRadiusFromBaseM <= walkbackRadiusM;

    // Radiation dose during this EVA (from MSL-RAD annual rate at site elevation)
    const radDoseUsv = Math.round((zone.radMsvYr * 1000 / (365.25 * 24)) * totalEvaH);

    return {
      zone,
      grid,
      safePath,
      directPath,
      safeDistM: Math.round(safeDistM),
      directDistM: Math.round(directDistM),
      maxSafeSlope: +maxSafeSlope.toFixed(1),
      maxDirectSlope: +maxDirectSlope.toFixed(1),
      directBoulderHits,
      directSandM: Math.round(directSandM),
      safeSandM: Math.round(safeSandM),
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
    };
  }

  /**
   * Build a custom 1 km x 1 km local EVA zone for any clicked coordinate on Mars.
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
    return {
      ...template,
      id: 'custom_site',
      name: `${regionName || 'Selected Site'} · Local 1m/px EVA Zone`,
      nameTr: `${regionName || 'Seçili Saha'} · Yerel 1m/px EVA Bölgesi`,
      lat: +(lat || 0).toFixed(2),
      lon: +(lon || 0).toFixed(2),
      elev: v ? Math.round(v.elev) : -2500,
      radMsvYr: v ? Math.round(v.rad) : 235,
    };
  }

  /**
   * Render the 1 km x 1 km (1 m/px) Local EVA Canvas with boulder hazards, steep walls,
   * sand traps, Walkback Safety Circle, A* footpath, and clickable Science Waypoints.
   */
  function drawLocalEvaCanvas(canvas, sim, activeWpIdx, laserOn) {
    if (!canvas || !sim) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const { grid, zone, safePath, directPath, walkbackRadiusM, maxRadiusFromBaseM } = sim;
    const N = grid.N;
    const sx = (x) => (x / N) * W;
    const sy = (y) => (y / N) * H;
    const tr = isTr();

    // 1. HiRISE / CTX micro-topography shaded relief background
    ctx.fillStyle = '#141110';
    ctx.fillRect(0, 0, W, H);
    const cellW = W / N, cellH = H / N;
    for (let y = 0; y < N; y += 2) {
      for (let x = 0; x < N; x += 2) {
        const i = y * N + x;
        const sl = grid.slope[i], hz = grid.hazard[i];
        const shade = Math.max(18, Math.min(72, Math.round(32 + (grid.elev[i] - zone.elev) * 0.9 - sl * 0.8)));
        if (hz === 3) ctx.fillStyle = `rgb(${shade + 22}, ${shade + 8}, ${shade - 6})`;
        else ctx.fillStyle = `rgb(${shade + 16}, ${shade + 4}, ${shade - 2})`;
        ctx.fillRect(x * cellW, y * cellH, cellW * 2 + 0.5, cellH * 2 + 0.5);
      }
    }

    // 2. 100 m metric grid lines (1 km x 1 km local frame)
    ctx.strokeStyle = 'rgba(237, 241, 247, 0.08)';
    ctx.lineWidth = 1;
    for (let g = 10; g < 100; g += 10) {
      ctx.beginPath(); ctx.moveTo(sx(g), 0); ctx.lineTo(sx(g), H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, sy(g)); ctx.lineTo(W, sy(g)); ctx.stroke();
    }

    // 3. Aeolian Sand Traps (amber hatched ellipses)
    for (const st of zone.sandTraps) {
      ctx.save();
      ctx.fillStyle = 'rgba(223, 179, 101, 0.20)';
      ctx.strokeStyle = 'rgba(223, 179, 101, 0.72)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.ellipse(sx(st.x), sy(st.y), (st.rx / N) * W, (st.ry / N) * H, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#dfb365';
      ctx.font = '500 10px "IBM Plex Mono", monospace';
      ctx.fillText(st.label, sx(st.x) - 36, sy(st.y) + 3);
      ctx.restore();
    }

    // 4. Boulder Hazards (crimson/ochre rock clusters)
    for (const b of zone.boulders) {
      const cx = sx(b.x), cy = sy(b.y), rad = (b.r / N) * W;
      ctx.save();
      ctx.fillStyle = 'rgba(222, 122, 107, 0.22)';
      ctx.strokeStyle = '#de7a6b';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      for (let k = 0; k < 6; k++) {
        const ang = k * 1.05, r2 = rad * 0.52;
        ctx.fillStyle = '#de7a6b';
        ctx.fillRect(cx + Math.cos(ang) * r2 - 2.5, cy + Math.sin(ang) * r2 - 2.5, 5, 5);
      }
      ctx.fillStyle = '#edf1f7';
      ctx.font = '500 10px "IBM Plex Mono", monospace';
      ctx.fillText(b.label, cx - rad, cy - rad - 4);
      ctx.restore();
    }

    // 5. Steep Crater / Scarp Walls (20-24 deg impassable cliffs)
    for (const w of zone.walls) {
      ctx.save();
      ctx.strokeStyle = '#de7a6b';
      ctx.lineWidth = ((w.w / N) * W) * 0.75;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx(w.x1), sy(w.y1));
      ctx.lineTo(sx(w.x2), sy(w.y2));
      ctx.stroke();
      ctx.fillStyle = '#edf1f7';
      ctx.font = '500 10px "IBM Plex Mono", monospace';
      ctx.fillText(w.label, sx((w.x1 + w.x2) / 2) - 44, sy((w.y1 + w.y2) / 2) - 8);
      ctx.restore();
    }

    // 6. Walkback Safety Limit Circle (Güvenli Geri Dönüş Çemberi)
    const bx = sx(zone.base.x), by = sy(zone.base.y);
    const wbRadiusPx = Math.min(W * 0.92, (walkbackRadiusM / 1000) * W);
    ctx.save();
    ctx.strokeStyle = sim.withinWalkback ? '#7dbb8e' : '#dfb365';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.arc(bx, by, wbRadiusPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = sim.withinWalkback ? '#7dbb8e' : '#dfb365';
    ctx.font = '600 10.5px "IBM Plex Mono", monospace';
    const wbLabel = tr
      ? `GÜVENLİ GERİ DÖNÜŞ SINIRI (WALKBACK): ${walkbackRadiusM} m (Maks uzaklık: ${maxRadiusFromBaseM} m)`
      : `WALKBACK SAFETY LIMIT: ${walkbackRadiusM} m (Max excursion: ${maxRadiusFromBaseM} m)`;
    ctx.fillText(wbLabel, 10, 18);
    ctx.restore();

    // 7. Direct Hazardous Path (dashed red) vs A* Safe Footpath (solid emerald)
    if (directPath.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(222, 122, 107, 0.75)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      directPath.forEach(([x, y], idx) => {
        if (idx === 0) ctx.moveTo(sx(x), sy(y));
        else ctx.lineTo(sx(x), sy(y));
      });
      ctx.stroke();
      ctx.restore();
    }

    if (safePath.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#7dbb8e';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      safePath.forEach(([x, y], idx) => {
        if (idx === 0) ctx.moveTo(sx(x), sy(y));
        else ctx.lineTo(sx(x), sy(y));
      });
      ctx.stroke();
      ctx.restore();
    }

    // 8. Airlock / Pressurized Rover Base Marker
    ctx.save();
    ctx.fillStyle = '#7fa2bf';
    ctx.strokeStyle = '#edf1f7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, by, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = '600 11px "IBM Plex Mono", monospace';
    ctx.fillStyle = '#edf1f7';
    ctx.fillText(zone.base.label, bx + 10, by + 4);
    ctx.restore();

    // 9. Science Waypoints (WP-1..WP-4) + Buddy EV-1 / EV-2 Astronaut Pair Icons
    zone.waypoints.forEach((wp, idx) => {
      const wx = sx(wp.x), wy = sy(wp.y);
      const isAct = idx === activeWpIdx;
      ctx.save();
      if (isAct) {
        ctx.strokeStyle = '#ea9662';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(wx, wy, 13, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = isAct ? '#d87a42' : '#181d26';
      ctx.strokeStyle = '#edf1f7';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(wx, wy, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#edf1f7';
      ctx.font = '600 10.5px "IBM Plex Mono", monospace';
      ctx.fillText(`${wp.id} · ${wp.code}`, wx + 10, wy + 3);
      ctx.restore();
    });

    // Draw EV-1 & EV-2 Buddy Astronaut pair at active waypoint
    const activeWp = zone.waypoints[activeWpIdx] || zone.waypoints[0];
    if (activeWp) {
      const ax = sx(activeWp.x) - 12, ay = sy(activeWp.y) + 12;
      ctx.save();
      ctx.fillStyle = '#7dbb8e';
      ctx.beginPath(); ctx.arc(ax, ay, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ax + 10, ay + 2, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#7dbb8e';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + 10, ay + 2); ctx.stroke();
      ctx.fillStyle = '#adc7dd';
      ctx.font = '500 9.5px "IBM Plex Mono", monospace';
      ctx.fillText(sim.buddyMode === 'rover_eva' ? 'ROVER + EV-1/EV-2' : 'EV-1 + EV-2 BUDDY', ax - 6, ay + 14);
      ctx.restore();
    }

    // Bottom scale bar: 1000 m x 1000 m (1 m/px HiRISE/CTX Local Tactical Grid)
    ctx.save();
    ctx.fillStyle = 'rgba(12, 15, 20, 0.84)';
    ctx.fillRect(8, H - 24, W - 16, 18);
    ctx.fillStyle = '#c9d1dc';
    ctx.font = '500 10px "IBM Plex Mono", monospace';
    ctx.fillText(
      tr
        ? `1 km × 1 km Yerel HiRISE/CTX Haritası (1 m/px) · HUD POV için WP-1..WP-4 hedeflerine tıklayın`
        : `1 km × 1 km Local HiRISE/CTX Map (1 m/px) · Click WP-1..WP-4 targets to open Helmet Visor HUD`,
      14,
      H - 11
    );
    ctx.restore();
  }

  /**
   * Render Ground POV (Curiosity Mastcam / Perseverance Navcam Surface Perspective)
   * inside the Helmet Visor HUD Canvas (#hud-pov-canvas).
   */
  function drawGroundPovCanvas(canvas, sim, wp, laserOn) {
    if (!canvas || !sim || !wp) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const tr = isTr();

    // 1. Martian Rayleigh/Dust Butterscotch Atmospheric Sky Gradient
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.46);
    if (wp.povTheme === 'ice') {
      sky.addColorStop(0, '#2a2423');
      sky.addColorStop(0.55, '#684e42');
      sky.addColorStop(1, '#b88c72');
    } else {
      sky.addColorStop(0, '#2d1c15');
      sky.addColorStop(0.55, '#7c482b');
      sky.addColorStop(1, '#c88355');
    }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H * 0.46);

    // Distant Mount Sharp / Jezero Delta / Nili Graben Rim Silhouette
    ctx.fillStyle = '#5c3724';
    ctx.beginPath();
    ctx.moveTo(0, H * 0.45);
    for (let x = 0; x <= W; x += 24) {
      const ridge = Math.sin(x * 0.012 + wp.heading) * 18 + Math.cos(x * 0.027) * 9;
      ctx.lineTo(x, H * 0.36 - ridge);
    }
    ctx.lineTo(W, H * 0.46);
    ctx.closePath();
    ctx.fill();

    // Mid-ground Stratified Sulfate / Mudstone Bench
    ctx.fillStyle = '#75462e';
    ctx.beginPath();
    ctx.moveTo(0, H * 0.46);
    for (let x = 0; x <= W; x += 18) {
      const bench = Math.cos(x * 0.019 + wp.x) * 8;
      ctx.lineTo(x, H * 0.43 - bench);
    }
    ctx.lineTo(W, H * 0.50);
    ctx.lineTo(0, H * 0.50);
    ctx.closePath();
    ctx.fill();

    // 2. Foreground Martian Surface Ground Plane
    const gnd = ctx.createLinearGradient(0, H * 0.45, 0, H);
    gnd.addColorStop(0, '#6a3d26');
    gnd.addColorStop(0.5, '#462819');
    gnd.addColorStop(1, '#22140d');
    ctx.fillStyle = gnd;
    ctx.fillRect(0, H * 0.45, W, H * 0.55);

    // 3. Geological Outcrop Geometry by POV Theme (Boxwork Ridges / Cheyava Leopard Spots / Ice Polygons)
    ctx.save();
    if (wp.povTheme === 'boxwork') {
      // Curiosity 2025 Mount Sharp Boxwork Polygonal Cemented Ridges
      ctx.strokeStyle = '#d9a97c';
      ctx.lineWidth = 3.2;
      const cx = W * 0.5, cy = H * 0.69;
      const polys = [
        [[-150, -35], [-55, -52], [25, -34], [10, 18], [-95, 24]],
        [[25, -34], [135, -45], [175, 8], [85, 32], [10, 18]],
        [[-95, 24], [10, 18], [55, 78], [-65, 92], [-145, 58]],
        [[10, 18], [85, 32], [160, 82], [55, 78]]
      ];
      for (const poly of polys) {
        ctx.fillStyle = 'rgba(48, 28, 19, 0.78)';
        ctx.beginPath();
        poly.forEach(([dx, dy], i) => {
          if (i === 0) ctx.moveTo(cx + dx, cy + dy);
          else ctx.lineTo(cx + dx, cy + dy);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    } else if (wp.povTheme === 'delta') {
      // Perseverance Cheyava Falls Outcrop with Calcium-Sulfate Veins & Leopard-Spot Rims
      const rx = W * 0.30, ry = H * 0.54, rw = W * 0.40, rh = H * 0.30;
      ctx.fillStyle = '#6c3926';
      ctx.strokeStyle = '#c98e63';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(rx, ry, rw, rh, 12) : ctx.rect(rx, ry, rw, rh);
      ctx.fill();
      ctx.stroke();
      // White CaSO4 veins
      ctx.strokeStyle = '#ede6dc';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(rx + 24, ry + 8); ctx.lineTo(rx + rw * 0.48, ry + rh - 8);
      ctx.moveTo(rx + rw * 0.68, ry + 10); ctx.lineTo(rx + rw * 0.82, ry + rh - 10);
      ctx.stroke();
      // Leopard spots (dark Fe-phosphate/sulfide rims with light cores)
      for (const [sx, sy] of [[0.32, 0.42], [0.46, 0.56], [0.58, 0.38], [0.64, 0.66], [0.40, 0.72]]) {
        ctx.fillStyle = '#181412';
        ctx.beginPath(); ctx.arc(rx + rw * sx, ry + rh * sy, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e5d4c0';
        ctx.beginPath(); ctx.arc(rx + rw * sx, ry + rh * sy, 3.8, 0, Math.PI * 2); ctx.fill();
      }
    } else if (wp.povTheme === 'ice') {
      // Arcadia / Subsurface Ice Polygon Trench exposing bright water-ice lens
      ctx.fillStyle = 'rgba(173, 199, 221, 0.78)';
      ctx.strokeStyle = '#edf1f7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(W * 0.5, H * 0.70, 125, 38, -0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      // Laminated Clay / Conglomerate Bench
      for (let l = 0; l < 6; l++) {
        ctx.strokeStyle = l % 2 === 0 ? '#b9855e' : '#855338';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(W * 0.22, H * (0.56 + l * 0.04));
        ctx.lineTo(W * 0.78, H * (0.54 + l * 0.04));
        ctx.stroke();
      }
    }
    ctx.restore();

    // 4. Buddy Astronaut (EV-2) Silhouette + Rover Mast on Left Horizon
    ctx.save();
    const bx = W * 0.16, by = H * 0.52;
    ctx.strokeStyle = '#adc7dd';
    ctx.fillStyle = 'rgba(24, 29, 38, 0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(bx, by - 18, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); // Helmet
    ctx.fillRect(bx - 8, by - 10, 16, 22); ctx.strokeRect(bx - 8, by - 10, 16, 22); // PLSS Torso
    ctx.fillStyle = '#7dbb8e';
    ctx.font = '600 9.5px "IBM Plex Mono", monospace';
    ctx.fillText('EV-2 BUDDY · 14m · O₂ 92%', bx - 44, by - 30);
    ctx.restore();

    // 5. xEMU Helmet Visor Curved Reticle, Compass Tape & LIBS Laser Target Crosshair
    const tx = W * 0.5, ty = H * 0.67;
    ctx.save();
    // Visor curved bezel
    ctx.strokeStyle = 'rgba(127, 162, 191, 0.38)';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, W - 16, H - 16);

    // Top Heading Compass Tape
    ctx.fillStyle = 'rgba(12, 15, 20, 0.76)';
    ctx.fillRect(W * 0.2, 14, W * 0.6, 24);
    ctx.strokeStyle = 'rgba(173, 199, 221, 0.45)';
    ctx.strokeRect(W * 0.2, 14, W * 0.6, 24);
    ctx.fillStyle = '#edf1f7';
    ctx.font = '600 10.5px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`◄ N 000° · NE 045° · [ HDG ${String(wp.heading).padStart(3, '0')}° ${wp.code} ] · E 090° · SE 135° ►`, W * 0.5, 30);

    // Target Crosshair + LIBS Pulsed Laser Beam
    if (laserOn) {
      ctx.strokeStyle = '#de7a6b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(W * 0.85, H * 0.92);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.fillStyle = '#edf1f7';
      ctx.beginPath();
      ctx.arc(tx, ty, 5, 0, Math.PI * 2);
      ctx.fill();
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

    ctx.fillStyle = '#7dbb8e';
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`TARGET: ${wp.id} (${wp.code}) · ${ laserOn ? 'LIBS PLASMA ACTIVE' : 'OPTICAL LOCK' }`, tx + 28, ty - 8);
    ctx.fillStyle = '#c9d1dc';
    ctx.fillText(`SiO₂ ${wp.chem.SiO2}% · SO₃ ${wp.chem.SO3}% · FeO ${wp.chem.FeO}% · H₂O ${wp.chem.H2O}%`, tx + 28, ty + 8);

    // Bottom Visor Telemetry Bar
    ctx.fillStyle = 'rgba(12, 15, 20, 0.84)';
    ctx.fillRect(14, H - 34, W - 28, 22);
    ctx.fillStyle = '#edf1f7';
    ctx.font = '500 10px "IBM Plex Mono", monospace';
    ctx.fillText(
      tr
        ? `KASK VİZÖRÜ HUD · ${wp.cam} · O₂ %${sim.o2RemainPct} · BAT %${sim.battRemainPct} · ${sim.metabolicKcalH} kcal/sa (${sim.metabolicW} W) · RAD ${sim.radDoseUsv} µSv`
        : `HELMET VISOR HUD · ${wp.cam} · O₂ ${sim.o2RemainPct}% · BATT ${sim.battRemainPct}% · ${sim.metabolicKcalH} kcal/h (${sim.metabolicW} W) · RAD ${sim.radDoseUsv} µSv`,
      22,
      H - 19
    );
    ctx.restore();
  }

  /**
   * Build SVG spectral signature chart for the Helmet Visor HUD modal (CSP compliant).
   */
  function renderSpectralSVG(wp) {
    const pts = (wp.specPeaks || [0.4, 0.7, 0.5, 0.9, 0.6, 0.8, 0.7, 0.95, 0.6, 0.8]).map((v, i) => {
      const x = 16 + i * 28;
      const y = Math.round(76 - v * 58);
      return `${x},${y}`;
    }).join(' ');
    return `<svg class="hud-spec-svg" viewBox="0 0 284 92" role="img" aria-label="LIBS and VNIR reflectance spectrum">
      <rect x="0" y="0" width="284" height="92" rx="4" fill="#12161d"/>
      <line x1="16" y1="78" x2="268" y2="78" stroke="#2c3545" stroke-width="1"/>
      <polyline fill="none" stroke="#7dbb8e" stroke-width="2.2" points="${pts}"/>
      <text x="16" y="14" fill="#adc7dd" font-size="9.5" font-family="IBM Plex Mono, monospace">VNIR / LIBS SPECTRUM (0.4–2.5 µm · Fe/Mg/SO₄/OH bands)</text>
      <text x="16" y="88" fill="#828c9c" font-size="8.5" font-family="IBM Plex Mono, monospace">0.45 µm (Fe³⁺)</text>
      <text x="116" y="88" fill="#828c9c" font-size="8.5" font-family="IBM Plex Mono, monospace">1.4 µm (OH/H₂O)</text>
      <text x="206" y="88" fill="#828c9c" font-size="8.5" font-family="IBM Plex Mono, monospace">1.9–2.3 µm (SO₄/CO₃)</text>
    </svg>`;
  }

  /**
   * Draw the Walkback Safety Limit Circle on the global 2D/3D planetary map when EVA or Route mode is active.
   */
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
    ctx.beginPath();
    ctx.arc(sx, sy, radiusPx, 0, Math.PI * 2);
    ctx.stroke();
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

  /**
   * Initialize the Phase 2 Tactical EVA & Helmet Visor HUD controller.
   */
  function createEvaController(opts) {
    const doc = (opts && opts.doc) || global.document;
    const S = opts && opts.S;
    const layers = opts && opts.layers;
    const onSelectCoord = opts && opts.onSelectCoord;
    const onRedraw = opts && opts.onRedraw;
    const $ = (s) => (doc && doc.querySelector ? doc.querySelector(s) : null);

    const state = {
      zoneId: 'gale_boxwork',
      customZone: null,
      loadKg: 15,
      speedKmh: 2.4,
      maxSlope: 15,
      buddyMode: 'buddy',
      activeWpIdx: 0,
      laserOn: true,
      sim: null,
    };

    function currentZone() {
      if (state.zoneId === 'custom_site' && state.customZone) return state.customZone;
      return ZONES[state.zoneId] || ZONES.gale_boxwork;
    }

    function recompute() {
      const zone = currentZone();
      state.sim = simulateEVA(zone, {
        loadKg: state.loadKg,
        speedKmh: state.speedKmh,
        maxSlope: state.maxSlope,
        buddyMode: state.buddyMode,
      });
      if (S) S.evaSim = state.sim;
      renderPanel();
      if (onRedraw) onRedraw();
      return state.sim;
    }

    function openHudModal(wpIdx) {
      if (typeof wpIdx === 'number') state.activeWpIdx = wpIdx;
      const modal = $('#hud-modal');
      if (!modal || !state.sim) return;
      renderHudModal();
      modal.classList.remove('hidden');
      const closeBtn = $('#hud-close');
      if (closeBtn && typeof closeBtn.focus === 'function') closeBtn.focus();
    }

    function closeHudModal() {
      const modal = $('#hud-modal');
      if (modal) modal.classList.add('hidden');
    }

    function renderHudModal() {
      const sim = state.sim || recompute();
      const zone = sim.zone;
      const wp = zone.waypoints[state.activeWpIdx] || zone.waypoints[0];
      const tr = isTr(), esc = getEsc();
      const titleEl = $('#hud-modal-title');
      if (titleEl) {
        titleEl.textContent = tr
          ? `xEMU Kask Vizörü (HUD) · ${wp.id}: ${wp.nameTr || wp.name}`
          : `xEMU Helmet Visor HUD · ${wp.id}: ${wp.name}`;
      }
      const subEl = $('#hud-modal-sub');
      if (subEl) {
        subEl.textContent = `${zone.name} · ${wp.cam} · HDG ${wp.heading}° · ΔElev +${wp.elevRel} m`;
      }

      const body = $('#hud-modal-body');
      if (!body) return;
      const chemRows = Object.entries(wp.chem).map(([ox, pct]) =>
        `<div class="hud-chem-cell"><span>${esc(ox)}</span><b>${pct.toFixed(1)} wt%</b></div>`
      ).join('');

      const wpTabs = zone.waypoints.map((w, idx) =>
        `<button type="button" class="ghost hud-wp-tab${idx === state.activeWpIdx ? ' active' : ''}" data-wp-idx="${idx}">${esc(w.id)} · ${esc(w.code)}</button>`
      ).join('');

      body.innerHTML = `
        <div class="hud-visor-frame">
          <div class="hud-top-tape">
            <span><b>SUIT O₂:</b> <b class="${sim.o2RemainPct >= 35 ? 'ok' : 'warn'}">${sim.o2RemainPct}%</b> (${SUIT_O2_CAP_G - sim.o2UsedG}g rem)</span>
            <span><b>PLSS BATT:</b> <b class="ok">${sim.battRemainPct}%</b></span>
            <span><b>LCVG H₂O:</b> <b class="ok">${(SUIT_WATER_CAP_L - sim.waterUsedL).toFixed(2)} L</b></span>
            <span><b>METABOLIC:</b> <b>${sim.metabolicKcalH} kcal/h</b> (${sim.metabolicW} W)</span>
            <span><b>SAMPLE LOAD:</b> <b>${sim.loadKg} kg</b></span>
          </div>
          <canvas id="hud-pov-canvas" class="hud-pov-canvas" width="680" height="320" aria-label="Ground POV surface camera view inside astronaut helmet visor"></canvas>
          <div class="hud-rad-banner ${sim.withinWalkback ? 'ok' : 'warn'}">
            <span><b>MSL-RAD DOSE:</b> ${(zone.radMsvYr / 365.25).toFixed(2)} mSv/sol (${sim.radDoseUsv} µSv EVA)</span>
            <span><b>WALKBACK LIMIT:</b> ${sim.walkbackRadiusM} m (${sim.withinWalkback ? (tr ? 'GÜVENLİ ÇEMBER İÇİNDE ✓' : 'WITHIN SAFE WALKBACK ✓') : (tr ? 'SINIR AŞILDI ⚠' : 'EXCEEDS LIMIT ⚠')})</span>
            <span><b>BUDDY LINK:</b> EV-1 ⇄ EV-2 NOMINAL</span>
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
            <div class="sec-head"><h2>${tr ? 'Kimyasal Oksit Analizi (ChemCam / SuperCam LIBS)' : 'Chemical Oxide Composition (ChemCam / SuperCam LIBS)'}</h2></div>
            <div class="hud-chem-grid">${chemRows}</div>
            <div class="kv mt-sm"><span>${tr ? 'Toplam EVA Enerji Harcaması' : 'Cumulative EVA Energy'}</span><b>${sim.totalKcal} kcal (${sim.totalEvaH} h)</b></div>
            <div class="kv"><span>${tr ? 'Yürüyüş Rotası (A* vs Doğrudan)' : 'EVA Footpath (A* vs Direct)'}</span><b>${sim.safeDistM} m vs ${sim.directDistM} m</b></div>
          </div>
        </div>`;

      const povCanvas = body.querySelector('#hud-pov-canvas');
      if (povCanvas) drawGroundPovCanvas(povCanvas, sim, wp, state.laserOn);

      body.querySelectorAll('.hud-wp-tab').forEach(btn => {
        btn.onclick = () => {
          state.activeWpIdx = +btn.dataset.wpIdx;
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
      const zone = sim.zone;
      const tr = isTr(), esc = getEsc();
      const activeWp = zone.waypoints[state.activeWpIdx] || zone.waypoints[0];

      const wpCards = zone.waypoints.map((wp, idx) => {
        const active = idx === state.activeWpIdx;
        return `<div class="eva-wp-card${active ? ' active' : ''}" data-wp="${idx}" role="button" tabindex="0">
          <div class="eva-wp-head">
            <b>${esc(wp.id)} · ${esc(tr ? (wp.nameTr || wp.name) : wp.name)}</b>
            <span class="badge-mode badge-live">HDG ${wp.heading}°</span>
          </div>
          <div class="help note-sm">${esc(tr ? (wp.rockTypeTr || wp.rockType) : wp.rockType)} · SO₃ ${wp.chem.SO3}% · H₂O ${wp.chem.H2O}%</div>
        </div>`;
      }).join('');

      out.innerHTML = `
        <div class="eva-zone-banner">
          <div class="eva-zone-title"><b>${esc(tr ? (zone.nameTr || zone.name) : zone.name)}</b></div>
          <div class="help note-sm">${esc(zone.hiRiseId)}</div>
          <p class="help note-sm">${esc(tr ? (zone.summaryTr || zone.summary) : zone.summary)}</p>
        </div>
        <div class="eva-canvas-wrap">
          <canvas id="eva-local-canvas" class="eva-local-canvas" width="420" height="320" role="img" aria-label="1 km by 1 km local HiRISE EVA hazard and A-star footpath map"></canvas>
        </div>
        <div class="row">
          <button type="button" id="btn-open-hud" class="btn-spec btn-full">${tr ? `Kask Vizörü (HUD) & Yüzey Kamerasını Aç (${activeWp.id})` : `Open Helmet Visor HUD & Ground POV (${activeWp.id})`}</button>
        </div>
        <div class="sec-head"><h2>${tr ? 'Astronot Giysi (xEMU/PLSS) & Metabolik Telemetri' : 'Astronaut Suit (xEMU/PLSS) & Metabolic Telemetry'}</h2></div>
        <div class="hls-checks">
          <div class="hls-check"><span class="hint">${tr ? 'O₂ Rezervi' : 'O₂ Reserve'}</span><b class="${sim.o2RemainPct >= 35 ? 'ok' : 'warn'}">${sim.o2RemainPct}% (${tr ? 'Tüketim' : 'Used'} ${sim.o2UsedPct}%)</b></div>
          <div class="hls-check"><span class="hint">${tr ? 'Giysi Bataryası' : 'Suit Battery'}</span><b class="${sim.battRemainPct >= 30 ? 'ok' : 'warn'}">${sim.battRemainPct}% (${tr ? 'Tüketim' : 'Used'} ${sim.battUsedPct}%)</b></div>
          <div class="hls-check"><span class="hint">${tr ? 'Soğutma Suyu' : 'Cooling H₂O'}</span><b class="${sim.waterRemainPct >= 30 ? 'ok' : 'warn'}">${sim.waterUsedL} L (${sim.waterRemainPct}% rem)</b></div>
        </div>
        <div class="kv"><span>${tr ? 'Metabolik Yük (Pandolf 0.38g)' : 'Metabolic Rate (Pandolf 0.38g)'}</span><b>${sim.metabolicKcalH} kcal/h · ${sim.metabolicW} W (${sim.totalKcal} kcal)</b></div>
        <div class="kv"><span>${tr ? 'Taşınan Ekipman / Kaya Numunesi' : 'Carried Equipment / Sample Load'}</span><b>${sim.loadKg} kg (${sim.buddyMode === 'rover_eva' ? (tr ? 'Rover + Yaya İkili' : 'Rover + Foot Pair') : (tr ? 'İkili Buddy Sistemi' : '2-Crew Buddy System')})</b></div>
        <div class="kv"><span>${tr ? 'Güvenli Geri Dönüş Sınırı (Walkback Limit)' : 'Walkback Safety Limit Radius'}</span><b class="${sim.withinWalkback ? 'ok' : 'warn'}">${sim.walkbackRadiusM} m (${tr ? 'Maks uzaklık' : 'Max excursion'} ${sim.maxRadiusFromBaseM} m)</b></div>
        <div class="kv"><span>${tr ? 'A* Yürüyüş Rotası vs Doğrudan Hat' : 'A* Safe Footpath vs Direct Line'}</span><b class="ok">${sim.safeDistM} m (${sim.maxSafeSlope}°) vs ${sim.directDistM} m (${sim.maxDirectSlope}°)</b></div>
        <div class="kv"><span>${tr ? 'Atlanan Kaya Bloğu / Kum Tuzağı' : 'Boulders & Sand Traps Avoided'}</span><b class="ok">${sim.directBoulderHits} ${tr ? 'kaya/dik duvar' : 'boulder/wall hits'} · ${sim.directSandM} m ${tr ? 'kum tuzağı' : 'sand trap'}</b></div>
        <div class="sec-head"><h2>${tr ? 'Bilimsel Hedef Noktaları (Science Waypoints)' : 'Science Waypoints (Click for Ground POV HUD)'}</h2></div>
        <div class="eva-wp-list">${wpCards}</div>`;

      const localCanvas = out.querySelector('#eva-local-canvas');
      if (localCanvas) {
        drawLocalEvaCanvas(localCanvas, sim, state.activeWpIdx, state.laserOn);
        localCanvas.onclick = (e) => {
          const r = localCanvas.getBoundingClientRect();
          const gx = ((e.clientX - r.left) / r.width) * 100;
          const gy = ((e.clientY - r.top) / r.height) * 100;
          let bestIdx = state.activeWpIdx, bestD = 999;
          zone.waypoints.forEach((wp, i) => {
            const d = Math.hypot(wp.x - gx, wp.y - gy);
            if (d < bestD) { bestD = d; bestIdx = i; }
          });
          state.activeWpIdx = bestIdx;
          renderPanel();
          if (bestD < 14) openHudModal(bestIdx);
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
      if (sel) {
        sel.onchange = () => zoomToZone(sel.value);
      }
      const modeSel = $('#eva-buddy-mode');
      if (modeSel) {
        modeSel.onchange = () => { state.buddyMode = modeSel.value; recompute(); };
      }
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
    ZONES,
    simulateEVA,
    zoneFromCoords,
    drawLocalEvaCanvas,
    drawGroundPovCanvas,
    drawGlobalWalkbackOverlay,
    createEvaController,
  };
})(typeof module === 'object' && module.exports ? module.exports : globalThis);
