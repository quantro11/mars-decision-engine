# Martiap — Teknik Yarışma Raporu ve Jüri Sunum Rehberi

## 1. Proje Özeti

**Martiap**, Mars'ta insanlı üs kurulumu için üç soruyu gerçek NASA/USGS yörünge verisi üzerinde yanıtlar:
**nereye inmeli**, **oradan ne kadar uzağa güvenle gidilebilir** ve **üs bir küresel toz fırtınasında ayakta kalır mı**.
Canlı sürüm: <https://mars-decision-engine.vercel.app>.

Uygulama tek bir akıştan ve dört sekmeden oluşur:
1. **İniş yeri:** Görev ön ayarları ve 8 kriterin ağırlıkları (MOLA rakımı, %90'lık eğim, SWIM 2.0 buz tutarlılığı, pürüzlülük, enlem, TES termal atalet, MSL-RAD kalibreli GCR dozu, doğrulanmamış mağara adayı mesafesi), NASA HLS-2015 eleme kuralları, ilk 5 aday ve 100 koşulu Monte Carlo duyarlılık testi (%95 Wilson aralığı). Haritaya iğne konunca uyumluluk puanı, puanı düşüren etkenler ve her gezgin sınıfı (Mini / Laboratuvar / İnsanlı) için menzil çemberi gösterilir.
2. **Taktik EVA · 16 km²:** 9 saha için önceden kesilmiş **4 km × 4 km, 100 m/hücre (40 × 40)** veriler (MOLA-HRSC 200 m arazi modeli + THEMIS 100 m gündüz kızılötesi). Her hücre sekiz alanda puanlanır ve HLS-2015 kurallarıyla elenir; eklenen saha ölçümleri çevredeki hücreleri günceller.
3. **Gezgin rotası:** Küresel ızgarada A\* ile en güvenli yol; seçilen gezgin sınıfına göre sol başına km, gereken sol sayısı, enerji, şarj durakları ve eğim sınırı kontrolü. Yaya EVA modu da vardır.
4. **Toz fırtınası gücü:** Opportunity 2018 fırtınasına kalibreli 120 sollük güç/ısı simülasyonu. Kaydırıcıların hemen altındaki şerit üssün ayakta kalıp kalmadığını ve her gezginin durumunu anında söyler.

---

## 2. Neyin veri, neyin model, neyin sezgisel olduğu

- **Ölçülmüş veri:** MOLA, MOLA-HRSC, THEMIS, TES, SWIM 2.0, MSL-RAD, Opportunity 2018 fırtınası, NASA gezgin sürüş kayıtları, Apollo EVA metabolik ölçümleri.
- **Varsayımları belirtilmiş fiziksel modeller:** fırtına güç/ısı dengesi, gezgin enerji/menzil modeli, A\* maliyetleri, giysi enerji modeli (tek serbest sabiti Apollo ortalamasına kalibre edildi).
- **Sezgisel, doğrulanmamış:** **toz kalkışı / toz şeytanı risk indeksi.** Elle ayarlanmış kurallardır; girdileri canlı sensörden değil saha, mevsim ve saatten modellenir. 0–100 indeks olarak gösterilir, olasılık değildir ve hiçbir doğruluk oranı iddia edilmez.
- **Konsept değerler:** basınçlı insanlı gezgin parametreleri (böyle bir araç henüz uçmadı).

---

## 3. Veri setleri

- **Küresel ızgara:** `4096 × 2048` (~5.2 km/piksel).
- **MOLA MEGDR (16-bit):** rakım, alt-hücre %90 eğim ve pürüzlülük.
- **SWIM 2.0:** ±60° arasında 0–1 m, 1–5 m ve >5 m buz tutarlılık indeksi (buz miktarı değil; `NO_DATA` ile `UNLIKELY` ayrı).
- **TES:** termal atalet ve toz (tane boyutu göstergesi; taşıma kapasitesi değil).
- **MOLA-HRSC 200 m ve THEMIS 100 m:** Taktik EVA kesitleri.
- **MGC³ (Cushing 2017):** doğrulanmamış mağara adayları.
- **Teslimat:** `file://` ile internetsiz açılış (`web/layers_data.js`) veya `tools/build.js` ile HTTP paketi (`dist/`). Barındırılan sürüm Taktik EVA için isteğe bağlı tek bir vekil (`/api/wms`, varsayılan kapalı) ve Google Fonts kullanır.

---

## 4. Bilimsel doğrulama

`node tools/validate.js` her sahayı kendi ±5° enlem bandında rastgele boylamlarla karşılaştırır:

| Test | Referans | Sonuç | p |
|---|---|---|---|
| **Test 1** (İniş güvenliği) | 9 gerçek Mars iniş aracı | **90.** yüzdelik (rastgele: 50.) | `p < 0.005` |
| **Test 2** (Dengeli görev) | 39 NASA HLS-2015 bölgesi | **71.** yüzdelik (rastgele: 49.) | `p < 0.005` |
| **Test 3** (Giysi enerji modeli) | Apollo 14–17 Ay EVA ölçümleri | Ay yerçekiminde ~271 W; Apollo aralığı 228–352 W (ort. 272 W) | — |
| **Toz indeksi** | Sadece yön kontrolleri | sakin → düşük, basınç düşüşü → yüksek, gece < öğleden sonra | doğruluk testi değil |

> **Şeffaflık notu:** Test 1 kısmen döngüseldir (iniş yerleri benzer eğim/rakım verisiyle seçildi). Daha bağımsız test Test 2'dir. Test 3'te modelin tek serbest sabiti Apollo ortalamasına ayarlandığı için bu bir tutarlılık kontrolüdür. Mars yürüyüşü değerleri tahmindir.

**Otomatik testler:** `tests/scoring.test.js`, `tests/ui.test.js`, `tests/tactical_eva.test.js`, `tests/integrity.test.js` (katı CSP, DOM/i18n senkronu, her service-worker dosyasının varlığı), `tests/test_pipeline.py`, `tests/e2e.test.js` (headless Chromium, HTTP + `file://`).

---

## 5. Dünya–Mars çift kullanım

- **Afet sonrası alan seçimi:** Aynı çok kriterli puanlama (eğim, zemin, su yakınlığı, tehlike katmanları) geçici yaşam alanı seçimine uyarlanabilir.
- **Arazi aracı rotalaması:** Çoklu tehlike A\* planlayıcısı heyelan/çamur/dik yamaç verisiyle çalışabilir; sonuçlar GeoJSON olarak QGIS'e aktarılır.

---

## 6. 3 dakikalık canlı demo

1. **0:00–0:45 İniş yeri – öncelikler:** "Landing safety" ve "Water ice & resources" ön ayarları arasında geçiş yapın; en iyi bölgenin ekvatordan kuzeye kaydığını gösterin. Bir adayı açıp puanını açıklayın.
2. **0:45–1:30 İğne ve Taktik EVA:** Haritada bir noktaya tıklayın, gezgin sınıfını değiştirip menzil çemberini gösterin; ardından 16 km² sekmesinde 100 m çözünürlüğe inin.
3. **1:30–2:15 Rota ve fırtına:** `?lang=tr&demo=route&from=Jezero&to=Nili` ile rotayı gösterin, gezgin sınıfını değiştirin. Sonra `?lang=tr&demo=crisis&site=Arcadia&tau=9` açın; şerit kırmızıya döner. Bir reaktör ekleyin, yeşile döner.
4. **2:15–3:00 Kanıt ve dürüstlük:** 90. ve 71. yüzdelik sonuçlarını, Apollo karşılaştırmasını ve toz indeksinin bilerek "sezgisel" etiketlendiğini anlatın.

---

## 7. Olası zor sorular

1. **"5 km pikselde 5 m'lik kaya ne olacak?"** — Küresel tarama ön elemedir. Taktik EVA 100 m'ye iner; kaya ölçeği için HiRISE gerekir ve her adayda NASA Mars Trek bağlantısı vardır.
2. **"Ağırlıklar keyfi değil mi?"** — Üç görev profili ve kaydırıcılar var; Monte Carlo testi ağırlıklar bozulduğunda ilk 5'in ne kadar sabit kaldığını gösterir.
3. **"Toz tahmini makine öğrenmesi mi?"** — Hayır. Fiziksel özelliklerden kurulmuş, elle ayarlanmış bir risk indeksidir. Etiketli veri olmadan doğruluk iddia etmiyoruz.
4. **"Gezgin rakamları nereden?"** — Sol başına sürüş saatleri Curiosity ve Perseverance kayıtlarına göre ayarlandı; insanlı gezgin değerleri konsept varsayımdır ve öyle etiketlidir.
5. **"Türkiye'de hangi soruna uyarlanır?"** — Deprem sonrası konteyner kent alan seçimi, orman yangını araç rotalaması ve güneş santrali saha planlaması.
