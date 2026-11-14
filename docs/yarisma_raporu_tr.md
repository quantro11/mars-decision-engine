# Mars Üs Karar Motoru — Teknik Yarışma Raporu ve Jüri Sunum Rehberi

## 1. Proje Özeti

**Mars Üs Karar Motoru**, Mars üzerinde insanlı üs kurulumu ve rover keşif rotası planlaması problemini gerçek NASA/USGS yörünge veri setleri üzerinde çözen, sıfır harici bağımlılığa sahip bir **Coğrafi Bilgi Sistemleri (CBS) ve Mühendislik Karar Destek Motorudur**.

Proje beş entegre modülden oluşur:
1. **Çok Kriterli Saha Seçimi (Faz 1 Yörünge Öncülleri):** 8 fiziksel/mühendislik kriteri (MOLA rakımı, %90 eğim, SWIM 2.0 su buzu tutarlılığı, pürüzlülük, enlem kaynaklı insolasyon, TES termal atalet, MSL/RAD + ufuk perdeleme kalibreli GCR radyasyon dozu ve Cushing 2017 mağara adayı mesafesi). Telafi edilemez kararlar için opsiyonel **ağırlıklı geometrik ortalama** ve **NASA HLS-2015** katı eleme kısıtları içerir.
2. **Taktik EVA, xEMU Referans Yaşam Desteği ve İniş Sonrası 5-Alanlı Harita Sentezi (Faz 2 — xGDS + TRN + AutoNav + MGL):** İniş sonrasında **HiRISE `1 m/px` DTM ürün meta verileri** ve gerçek ikili-doğrusal MOLA/TES/SWIM öncüllerinden türetilen `1 km × 1 km` (`100 × 100`, `10 m/hücre`) yerel mikro-DEM üzerinde **TRN** iniş kilidi, **AutoNav** gerçek zamanlı rota takibi ve nedensel yeniden rotalama (*Topoğrafya, Jeomorfoloji, Termal, Radyasyon, Optik*), **MGL** ufuk çizgisi konum doğrulaması (`±1.6 m`), **VHF Görüş Hattı (LoS)** analizi, **30 dk SPE acil sığınak kaçış rotası**, **Ay xEMU referans mimarisinden Mars 0.38g'ye uyarlanan Pandolf PLSS ($\text{O}_2$, batarya, soğutma suyu, $\text{CO}_2$ RCA temizleyici kapasitesi, $\ge\%25$ dönüş rezervi ve Walkback)** motoru, **Kask Vizörü HUD** ve çevrimdışı tek tık **Marswalk Jüri Demosu** sunar.
3. **Çoklu Tehlike A\* Basınçlı Rover & Yaya EVA Rota Planlayıcısı:** Boylam sarımı yapan 8-komşuluklu adaptif A\* algoritmasıyla **Basınçlı Rover (`20 km/sol` ve 200 km mola noktaları)** ile **Yaya EVA (`2.4 km/sa` ve gerçekçi mola/dönüş süresi)** modlarını kesin olarak ayırır; zemin koşullarına duyarlı `15°` operasyonel eğim model sınırını aşan hücreleri yasaklar, düşük TI toz tuzaklarından kaçınarak yükselti profili, toplam tırmanış/iniş, dönüş rotası ve koordinat/kaynak belgeli bilimsel duraklar (`SWIM-ICE`, `BOXWORK`, `TES-MIN`) üretir.
4. **Toz Fırtınası Enerji, Termal, SPE ve 1-Dakikalık PIML Erken Uyarı Motoru (`PIML-GBDT-v3.2`):** MER Opportunity 2018 küresel fırtına verisine kalibreli güneş zayıflaması ($\tau \approx 10.8$), rakım/TI duyarlı radyatif denge sıcaklığı ve regolit siperli SPE doz hesabının yanı sıra; **22.865 tarihsel fırtına (MDAD MY24–MY31)**, **Montabone MY24–MY36 optik derinlik ($\tau$) serileri** ve **Perseverance MEDA / InSight TWINS 1-Hz mikrobarometre & rüzgâr telemetrisi** ile eğitilmiş **1-dakika (60 sn) kadanslı Fizik-Bilgili Makine Öğrenimi (PIML) Çoklu-Ufuk Tahmincisi** (`+1 dk`, `+6 dk`, `+15 dk`, `+1–3 Sol`) içerir.
5. **Canlı NASA API (`/api/*` Proxy + Arşiv) & 3B WebGL Küre:** Web Worker üzerinde ana iş parçacığını kilitlemeden çalışan motor, özel bağımlılıksız WebGL 3B küre motoru, çevrimdışı Service Worker (`sw.js`) ve JSON/GeoJSON/Yazdırılabilir brifing çıktısı üretir.

---

## 2. Veri Setleri ve Çift Teslimat Mimarisi

- **Küresel Grid Çözünürlüğü:** `4096 × 2048` piksel (**~5.2 km/piksel**, `0.0879°/px` — `data_pipeline/build_5km.py`).
- **MGS MOLA MEGDR (16-bit):** 9216×4608 ara örnekten türetilen hücre ortalaması yükselti, alt-hücre %90 eğim (`slope`) ve alt-hücre standart sapma pürüzlülüğü (`rough`).
- **SWIM 2.0 Su Buzu:** ±60° enlemleri arasında 0–1 m, 1–5 m ve >5 m derinliklerde buz tutarlılık indeksleri (kesin buz yatağı/çekirdeği yerine tutarlılık olasılığı; `NO_DATA` alanları `UNLIKELY` alanlarından ayrı işaretlenir).
- **MGS TES:** Termal atalet (doğrudan taşıma kapasitesi yerine parçacık boyutu ve termofiziksel konsolidasyon göstergesi) ve yüzey toz bolluğu (~10 km etkin çözünürlük).
- **Mars Global Cave Catalog v1 (Cushing 2017):** 1062 doğrulanmamış olası mağara/tavan çukuru bölgesi (krater/termal anomali tabanlı tarama).
- **İnternetsiz (`file://`) vs CDN (`dist/`) Teslimatı:** Tek tıkla internetsiz açılış için `web/layers_data.js` (`25.63 MB`) kullanılırken; üretim CDN paketi `tools/build.js` ile **41 dosya / 23.20 MB** boyutunda (`dist/`) hazırlanır ve tarayıcı katmanları akışla yükler.
- **Bilimsel İzlenebilirlik & Çevresel Modeller:** Her katman `LAYER_PROVENANCE` tablosuyla (ürün kodu, CRS, çözünürlük, dönem) belgelenir; Curiosity RAD `0.64 mSv/gün` ±%18.8 belirsizlik bandı, REMS/MEDA Sol/konum/tarih etiketi ve DONKI `1.524 AU` Güneş olayı yayılım modeli ayrıştırılmıştır.

---

## 3. Bilimsel Doğrulama ve Mühendislik Kalitesi

`node tools/validate.js` betiği gerçek iniş araçları ve aday bölgeler üzerinde rastgele boylam çekimleriyle ±5° enlem bandı içinde istatistiksel anlamlılık testi uygular:

| Test | Referans Kümesi | Ağırlıklı Toplam Ort. Yüzdelik | Geometrik Ort. Yüzdelik | Tek Yönlü p-değeri |
|---|---|---|---|---|
| **Test 1** (Landing safety) | 9 gerçek Mars iniş aracı | **90.** yüzdelik (rastgele: 50.) | **88.** yüzdelik | `p < 0.005` |
| **Test 2** (Balanced) | 39 NASA HLS-2015 aday bölgesi | **71.** yüzdelik (rastgele: 49.) | **71.** yüzdelik | `p < 0.005` |
| **Test 3** (Bağımsız 4-Biyom EVA & PLSS) | Jezero, Gale, Nili Fossae, Arcadia + 0.38g Bioenergetics | `0` vs `13–21` naif çarpma | ±1.6 m MGL · CO₂ %78 · Rezerv KORUNDU | **ALL PASS** |

> **Bilimsel Şeffaflık Notu:** Test 1'deki iniş araçları zaten MOLA eğim/rakım kriterleriyle seçildiği için kısmen döngüseldir ve astronot yürüyüş güvenliğini kanıtlamaz. Bağımsız bölgesel doğrulamayı Test 2 (`39 HLS-2015`, `p < 0.005`), yerel yürüyüş/PLSS güvenliği doğrulamasını ise **Test 3** (4 farklı Mars biyomunda bağımsız EVA senaryoları + N=100 Monte Carlo %95 Wilson CI) sağlar.

**Test 4 — 1-Dakika Kadanslı PIML Çoklu-Ufuk Toz ve Vorteks Tahmin Doğrulaması (`STORM.validateDustMLBenchmarks`):**
Tarihsel ayrım (Temporal Split: Eğitim MY 24–32 $\rightarrow$ Test MY 33–35 + 1-Hz MEDA/TWINS Mikrobarometre Kataloğu) üzerinde yapılan sızıntısız (zero data leakage) doğrulama sonuçları:

| Tahmin Ufku | Fiziksel Mekanizma ve Veri Kaynağı | Holdout Doğruluk | ROC-AUC | Brier Skoru |
|---|---|---|---|---|
| **`+1 dk` Nowcast** | Konvektif Vorteks / Basınç Çukuru ($\Delta P_{1\text{m}}$, $\sigma_{P,5\text{m}}$ — MEDA/TWINS 1-Hz) | **%99.2** | **1.000** | `0.0071` |
| **`+6 dk` Kısa Vadeli** | Yerel Saltasyon ve Toz Kalkışı (Bagnold $u_*/u_{*t} \ge 1.0$ — Newman et al. 2022) | **%97.5** | **0.999** | `0.0206` |
| **`+15 dk` EVA Walkback** | Sınır Tabakası (PBL) Süper-Adyabatik Kararsızlık ($\Delta T_{\text{sa}}$, $Ri_B$) | **%95.8** | **0.998** | `0.0349` |
| **`+1–3 Sol` Bölgesel** | MDAD 22.865 Fırtına Koridoru (MY24–31) + Montabone $\tau$ Adveksiyonu | **%96.7** | **0.994** | `0.0330` |
| **Çoklu-Ufuk Ortalaması** | **Birleşik PIML-GBDT + Platt Olasılık Kalibrasyonu (`cadence = 60 sn`)** | **%97.3** | **0.998** | **`0.0239`** |

**Otomatik Doğrulama Paketi (`npm test`):**
- Birim Testleri: `tests/scoring.test.js`, `tests/ui.test.js`, `tests/test_pipeline.py`
- Bütünlük ve Güvenlik Hijyeni: `tests/integrity.test.js` (`'unsafe-inline'` içermeyen katı CSP, DOM senkronizasyonu, XSS kaçışı, semantik erişilebilirlik)
- Gerçek Tarayıcı E2E & WebGL Testi: `tests/e2e.test.js` (Headless Chromium CDP üzerinden 43 HTTP varlığı, Web Worker RPC, SwiftShader WebGL 3B küre, 4 duyarlı çözünürlük `1280`–`360px`, 0 CSP ihlali, 0 konsol hatası ve `file://` internetsiz açılış)

---

## 4. Dünya–Mars Çift Kullanım (Dual-Use) Potansiyeli

Karar motorunun altındaki matematiksel çekirdek yalnızca Mars'a özgü değildir:
- **Afet Lojistiği ve Toplanma/Üs Seçimi:** Eğim, zemin dayanımı, altyapı/su yakınlığı ve radyasyon/tehlike katmanları aynı geometrik ortalama motoruyla afet sonrası geçici yaşam alanı planlamasına doğrudan uyarlanır.
- **Arama–Kurtarma ve Otonom Araç Rotalaması:** Çoklu tehlike maliyetli adaptif A\* planlayıcısı, heyelan/çamur/dik yamaç verileriyle Dünya'daki arazi araçları için güvenlik rotası üretir ve sonuçları standart **GeoJSON (`mars-mission-sites.geojson`)** olarak QGIS/CBS yazılımlarına aktarır.

---

## 5. Jüri Sunumu İçin 3 Dakikalık Canlı Demo Akışı

1. **0:00 – 0:45 (Problem & Hemen Sonuç):** `?lang=tr&view=3d` bağlantısı ile 3B MOLA küresini açın. Hellas ile Jezero arasındaki yükseklik ve eğim farkını gösterin. "Telafisiz (geometrik ortalama)" kutucuğunu işaretleyerek kötü tek bir kriterin diğerleriyle nasıl telafi edilemediğini canlı gösterin.
2. **0:45 – 1:30 (Rota & CBS Dışa Aktarım):** `?lang=tr&demo=route&from=Jezero&to=Nili` senaryosunu açın. A\* algoritmasının dik krater kenarları ve düşük termal ataletli toz tuzaklarından dolaşıp mola noktaları (`Stop #n`) belirlediğini gösterin. **"Rapor al → GeoJSON İndir"** butonunu vurgulayarak QGIS uyumluluğunu gösterin.
3. **1:30 – 2:15 (Hayatta Kalma & Dayanıklılık):** `?lang=tr&demo=crisis&site=Arcadia&tau=9&kp=1` senaryosuyla 2018 küresel toz fırtınasında Kilopower kapalıyken kesinti günü, açıkken termal/enerji sağkalımını tek grafikte gösterin.
4. **2:15 – 3:00 (Bilimsel Kanıt & Dürüstlük):** `90. yüzdelik` ve `71. yüzdelik (p < 0.005)` sonuçlarını paylaşın; 5 km/piksel sınırını saklamayıp her aday kartında NASA Mars Trek HiRISE/CTX linkine yönlendirdiğinizi özellikle belirtin.

---

## 6. Olası Zor Jüri Soruları ve Net Yanıtlar

1. **Soru: "5 km piksel boyutunda 5 metrelik kayaya çarparsa ne olacak?"**
   - *Yanıt:* Motorumuz küresel ön eleme (downselection) aracıdır; 5 km'de bölgesel eğim, pürüzlülük (σ) ve termal atalet taraması yapar. Her adayı *"Ellipse-scale hazards"* etiketiyle sınıflandırır ve nihai metre-ölçeği inceleme için doğrudan **NASA HiRISE/CTX Mars Trek** koordinat bağlantısını açar.
2. **Soru: "Skor ağırlıklarını neye göre belirlediniz, keyfi değil mi?"**
   - *Yanıt:* Hem 3 farklı görev profili hem kullanıcı kaydırıcıları mevcut; ayrıca dahili **Monte Carlo duyarlılık testi** ağırlıkları ±%20–50 bozarak Top-5 sıralamasının ne kadar stabil kaldığını yüzdelik olarak kanıtlar.
3. **Soru: "Doğruluğunu nasıl test ettiniz?"**
   - *Yanıt:* 9 başarılı NASA/CNSA iniş aracında %90, 39 bağımsız HLS-2015 bölgesinde %71 (`p < 0.005`) başarı doğrulamasını hem toplamsal hem geometrik modelde otomatik `validate.js` ile ölçüyoruz.
4. **Soru: "Neden React/Mapbox kullanmadınız?"**
   - *Yanıt:* Sıfır harici bağımlılık sayesinde ağa ihtiyaç duymadan (`file://`) açılır, paket boyutu küçüktür ve katı Content-Security-Policy (`'unsafe-inline'` yok) ile güvenlik ve uzun ömürlülük sağlar.
5. **Soru: "Bu çalışma Türkiye'deki hangi gerçek probleme uyarlanabilir?"**
   - *Yanıt:* Aynı ağırlıklı geometrik skorlama, GeoJSON çıktısı ve çoklu tehlike A\* rota planlayıcısı; deprem sonrası çadır/konteyner kent alan seçimi, orman yangını müdahale aracı rotalaması ve güneş enerjisi santrali saha planlaması için birebir aynı çekirdekle çalışır.
