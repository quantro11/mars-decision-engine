# Mars Üs Karar Motoru — Teknik Yarışma Raporu ve Jüri Sunum Rehberi

## 1. Proje Özeti

**Mars Üs Karar Motoru**, Mars üzerinde insanlı üs kurulumu ve rover keşif rotası planlaması problemini gerçek NASA/USGS yörünge veri setleri üzerinde çözen, sıfır harici bağımlılığa sahip bir **Coğrafi Bilgi Sistemleri (CBS) ve Mühendislik Karar Destek Motorudur**.

Proje dört entegre modülden oluşur:
1. **Çok Kriterli Saha Seçimi:** 8 fiziksel/mühendislik kriteri (MOLA rakımı, %90 eğim, SWIM 2.0 su buzu tutarlılığı, pürüzlülük, enlem kaynaklı insolasyon, TES termal atalet, MSL/RAD kalibreli GCR radyasyon dozu ve Cushing 2017 mağara adayı mesafesi). Telafi edilemez kararlar için opsiyonel **ağırlıklı geometrik ortalama** ve **NASA HLS-2015** katı eleme kısıtları içerir.
2. **Çoklu Tehlike A\* Rover Rota Planlayıcısı:** Boylam sarımı yapan 8-komşuluklu adaptif A\* algoritmasıyla eğim sınırını aşan hücreleri yasaklar; mikropürüzlülük ve düşük termal ataletli (`<100 tiu`) toz tuzaklarını cezalandırarak her 200 km'de bir düz/sert mola noktası adayları (`Stop #n`) belirler.
3. **Toz Fırtınası Enerji, Termal ve Akut Radyasyon (SPE) Simülatörü:** MER Opportunity 2018 küresel fırtına verisine kalibreli güneş zayıflaması ($\tau \approx 10.8$), radyatif denge yüzey sıcaklığı, atık ısı öncelikli üs ısıtma bütçesi ve regl siperli ($15\text{ g/cm}^2$ üstel sönümleme) SPE doz hesabını birleştirir.
4. **Canlı NASA API & 3B WebGL Küre:** Web Worker üzerinde ana iş parçacığını kilitlemeden çalışan motor, özel bağımlılıksız WebGL 3B küre motoru ve JSON/GeoJSON/Yazdırılabilir brifing çıktısı üretir.

---

## 2. Veri Setleri ve Çift Teslimat Mimarisi

- **Küresel Grid Çözünürlüğü:** `4096 × 2048` piksel (**~5.2 km/piksel**, `0.0879°/px` — `data_pipeline/build_5km.py`).
- **MGS MOLA MEGDR (16-bit):** 9216×4608 ara örnekten türetilen hücre ortalaması yükselti, alt-hücre %90 eğim (`slope`) ve alt-hücre standart sapma pürüzlülüğü (`rough`).
- **SWIM 2.0 Su Buzu:** ±60° enlemleri arasında 0–1 m, 1–5 m ve >5 m derinliklerde buz tutarlılık indeksleri.
- **MGS TES:** Termal atalet (zemin taşıma/kazı dayanımı) ve yüzey toz bolluğu (~10 km etkin çözünürlük).
- **Mars Global Cave Catalog v1 (Cushing 2017):** 1062 doğrulanmamış mağara/çukur adayı.
- **İnternetsiz (`file://`) vs CDN (`dist/`) Teslimatı:** Tek tıkla internetsiz açılış için `web/layers_data.js` (`25.63 MB`) kullanılırken; üretim CDN paketi `tools/build.js` ile yalnızca **34 dosya / 22.86 MB** boyutunda (`dist/`) hazırlanır ve tarayıcı katmanları akışla yükler.

---

## 3. Bilimsel Doğrulama ve Mühendislik Kalitesi

`node tools/validate.js` betiği gerçek iniş araçları ve aday bölgeler üzerinde rastgele boylam çekimleriyle ±5° enlem bandı içinde istatistiksel anlamlılık testi uygular:

| Test | Referans Kümesi | Ağırlıklı Toplam Ort. Yüzdelik | Geometrik Ort. Yüzdelik | Tek Yönlü p-değeri |
|---|---|---|---|---|
| **Test 1** (Landing safety) | 9 gerçek Mars iniş aracı | **90.** yüzdelik (rastgele: 50.) | **89.** yüzdelik | `p < 0.005` |
| **Test 2** (Balanced) | 39 NASA HLS-2015 aday bölgesi | **71.** yüzdelik (rastgele: 49.) | **71.** yüzdelik | `p < 0.005` |

> **Bilimsel Şeffaflık Notu:** Test 1'deki iniş araçları zaten MOLA eğim/rakım kriterleriyle seçildiği için kısmen döngüseldir (tutarlılık kontrolü). Bağımsız doğrulamayı Test 2'deki 39 NASA HLS-2015 aday bölgesi sağlar ve rastgelenin istatistiksel olarak anlamlı biçimde üzerindedir (`p < 0.005`).

**Otomatik Doğrulama Paketi (`npm test`):**
- Birim Testleri: `tests/scoring.test.js`, `tests/ui.test.js`, `tests/test_pipeline.py`
- Bütünlük ve Güvenlik Hijyeni: `tests/integrity.test.js` (`'unsafe-inline'` içermeyen katı CSP, DOM senkronizasyonu, XSS kaçışı, semantik erişilebilirlik)
- Gerçek Tarayıcı E2E & WebGL Testi: `tests/e2e.test.js` (Headless Chromium CDP üzerinden 36 HTTP varlığı, Web Worker RPC, SwiftShader WebGL 3B küre, 0 CSP ihlali, 0 konsol hatası ve `file://` internetsiz açılış)

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
