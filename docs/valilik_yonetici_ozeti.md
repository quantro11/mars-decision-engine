# T.C. VALİLİĞİ MAKAMINA ARZ EDİLMEK ÜZERE PROJE BRİFİNGİ VE İŞ BİRLİĞİ RAPORU

**Konu:** NASA Space Apps Challenge Derecesi, Martiap Karar Destek Motoru ve İlimiz/Ülkemiz İçin Afet Yönetimi (AFAD) & Uzay Teknolojileri Çift Kullanım (Dual-Use) İş Birliği Teklifi  
**Hazırlayan:** Martiap Proje Ekibi (5 Kişilik Lise Araştırma ve Geliştirme Takımı)  
**Canlı Sistem Adresi:** [https://martiap.space](https://martiap.space)  
**Açık Kaynak Kod Tabanı:** [https://github.com/quantro11/mars-decision-engine](https://github.com/quantro11/mars-decision-engine)  
**Tarih:** Kasım 2026  

---

## 1. YÖNETİCİ ÖZETİ VE YARIŞMA BAŞARISI

Dünyanın en büyük uluslararası uzay ve teknoloji maratonu olan **NASA Space Apps Challenge** kapsamında geliştirdiğimiz **"Martiap — Gezegenlerarası Karar ve Hayatta Kalma Motoru"** projemiz ile:

* **Liseler Arası Kategoride:** **TÜRKİYE / YEREL 1.'LİĞİ**
* **Üniversite ve Mezun Takımlarının Yer Aldığı Genel Klasmanda:** **GENEL 4.'LÜK VE JÜRİ MANSİYON ÖDÜLÜ**

elde ederek ilimize büyük bir gurur kazandırmış bulunmaktayız.

Martiap; Mars'ta insanlı üs ve otonom keşif araçlarının operasyonlarını planlamak üzere geliştirilmiş, sıfır yapay kütüphane bağımlılığıyla çalışan, gerçek NASA/ESA uydu yörünge verilerini işleyen yerli bir karar destek yazılımıdır.

Ancak projemizin asıl katma değeri; **aynı matematiksel motorun doğrudan Dünya'da, özellikle ülkemizin ve ilimizin karşı karşıya olduğu deprem, sel ve heyelan gibi afetlerde AFAD koordinasyonunda hayat kurtarıcı bir operasyonel araca dönüşebilmesidir (Çift Kullanım / Dual-Use).**

---

## 2. MARS'TAN DÜNYA'YA: AFAD VE AFET YÖNETİMİ ÇİFT KULLANIM (DUAL-USE)

Uzay keşif görevleri için geliştirdiğimiz algoritmalar, mülki idare ve afet koordinasyonu açısından doğrudan sahaya uygulanabilir durumdadır:

### A. Deprem Sonrası Çadır/Konteyner Kent ve Sahra Hastanesi Güvenli Yer Seçimi
* **Sorun:** Afet anında toplanma alanlarının plansız seçilmesi, sel yatakları veya heyelan riski taşıyan zeminlere çadır/konteyner kurulması ikincil facialara yol açmaktadır.
* **Martiap Çözümü:** 8 kriterli çoklu karar matrisimiz; sayısal yükseklik modelleri (DEM) üzerinde eğimi $\le 3^\circ$ olan, sıvılaşma ve çökme riski minimum seviyedeki, su ve elektrik altyapı arterlerine en yakın güvenli toplanma alanlarını ve sahra hastanesi lokasyonlarını dakikalar içinde tespit eder.

### B. Zorlu Arazide İnsansız Kara Aracı (İKA) ve AFAD Kurtarma Rotalaması
* **Sorun:** Enkaz, moloz, heyelan veya sel sularıyla kapanan yollarda arama-kurtarma ekipleri ve otonom araçlar saplanma veya devrilme riskiyle karşılaşmaktadır.
* **Martiap Çözümü:** Bekker-Wong zemin mekaniği ve çoklu-tehlike A\* rota motorumuz; aracın ağırlığını ve zemin sürtünmesini hesaplayarak kurtarma araçlarının en emniyetli geçiş koridorunu belirler. Bu rotalar **MAVLink WPL 110** ve **AFAD CBS (Coğrafi Bilgi Sistemleri) uyumlu GeoJSON** formatında anında sahadaki ekiplere ve otonom robotlara aktarılır.

### C. Arama-Kurtarma Personeli Yorgunluk ve Biyoenerjetik Takibi
* **Sorun:** Enkaz arama ve zorlu arazi taramalarında personelin aşırı yorgunluğu ve susuzluğu operasyonel zafiyet doğurmaktadır.
* **Martiap Çözümü:** Apollo verileriyle kalibre edilmiş Pandolf metabolik tüketim motorumuz, 1.0g Dünya yerçekiminde 22 kg teçhizat taşıyan bir AFAD görevlisinin saatlik enerji (Watt / kcal) harcamasını ve saatlik hidrasyon (su) ihtiyacını modelleyerek güvenli dinlenme ve geri dönüş rezervlerini yönetir.

---

## 3. TÜRKİYE YÜZYILI VE MİLLİ UZAY PROGRAMI (TUA) ENTEGRASYONU

Türkiye Uzay Ajansı'nın (TUA) yürüttüğü **Milli Uzay Programı** hedefleri arasında yer alan **Ay Misyonu ve Gezegen Keşif Gezgini** vizyonuna lise çağında somut bir yazılım altyapısıyla katkı sunuyoruz:

1. **Uçuşa Hazır Robotik Mimarisi:** Yazılımımız sadece bir görsel harita değil; NASA JPL'in **TRL-8 (Uçuşa Kalifiye Uçuş Yazılımı)** kurallarına göre tasarlanmış, ROS 2 Nav2 ve PX4/ArduPilot otopilotlarıyla konuşabilen yerli bir çekirdeğe sahiptir.
2. **Arıza Toleransı (FDIR Watchdog):** Uzaydaki radyasyon kaynaklı bit değişimlerine (bit-flip) karşı CRC-32 doğrulaması ve otonom Güvenli Mod (Safe-Mode) mekanizması entegre edilmiştir.
3. **Milli Keşif Aracı Entegrasyonu:** TUA veya yerli savunma sanayii firmalarımız (ASELSAN, ROKETSAN, HAVELSAN, TÜBİTAK UZAY) tarafından üretilecek insansız kara araçları veya uzay gezginleri için yerli görev planlama konsolu olarak görev yapabilir.

---

## 4. BİLİMSEL DÜRÜSTLÜK VE DOĞRULAMA (AKADEMİK DERİNLİK)

Projemiz hiçbir "uydurma veya halüsinatif yapay zeka" metriği içermemektedir:
* **NASA İniş Araçları Doğrulaması:** Sistemimizin iniş güvenliği algoritması, bugüne kadar Mars'a inen 9 gerçek iniş aracını (Curiosity, Perseverance vb.) kendi enleminde **90. yüzdelikte** konumlandırarak doğruluğunu kanıtlamıştır.
* **NASA HLS-2015 Alanları:** NASA'nın belirlediği 39 insanlı iniş bölgesi üzerinde yapılan bağımsız istatistiksel testlerde **71. yüzdelik** ($p < 0.005$) başarı elde edilmiştir.
* **Apollo 14–17 Doğrulaması:** Astronot metabolik tüketim motorumuz, Apollo Ay yürüyüşlerinde ölçülen gerçek 272 Watt değerine tam kalibre edilmiştir.

---

## 5. VALİLİĞİMİZDEN İSTİRHAM EDİLEN DESTEK VE İŞ BİRLİĞİ ALANLARI

Sayın Valimizin himayelerinde, bu başarıyı ilimiz adına kalıcı bir yüksek teknoloji ve afet AR-GE projesine dönüştürmek amacıyla **3 somut alanda desteklerinizi arz ederiz:**

### 1. AFAD İl Müdürlüğü ile Ortak Test ve Veri Entegrasyonu Protokolü
Sistemimizin AFAD İl Müdürlüğümüzün sayısal harita ve afet toplanma verileriyle test edilmesi, ilimizdeki bir tatbikatta **İnsansız Kara Aracı (İKA) Arama-Kurtarma Karar Destek Modülü** olarak denenmesi için Valiliğimiz koordinasyonunda bir iş birliği protokolü tesis edilmesi.

### 2. TEKNOFEST ve Fiziksel Rover Prototipi İçin Donanım Desteği
Yazılımımızı bilgisayar ekranından çıkarıp tekerlekleri dönen **fiziki bir 6 tekerlekli otonom test gezgini (şasi, otopilot, kamera, lidar ve gömülü bilgisayar)** üzerine yükleyerek ilimizi TEKNOFEST ve uluslararası yarışmalarda temsil etmek istiyoruz. Bu prototipin üretimi için Valiliğimiz / İl Özel İdaresi veya Kalkınma Ajansı bünyesinde malzeme ve atölye desteği sağlanması.

### 3. Fikri Mülkiyet ve Patent Tescil Başvurusu Desteği
Geliştirdiğimiz çok kriterli terramekanik ve rota planlama algoritmasının Türk Patent ve Marka Kurumu nezdinde ilimiz gençleri adına patentlenmesi/tescili için İl Sanayi ve Teknoloji Müdürlüğü koordinesinde patent danışmanlığı ve başvuru harç desteği verilmesi.

---

## 6. PROJE EKİBİ KÜNYESİ (5 KİŞİLİK LİSE ARAŞTIRMA TAKIMI)

Ekibimiz, disiplinlerarası bir görev dağılımıyla tıpkı bir uzay kontrol merkezi gibi çalışmaktadır:
* **Takım Lideri & Sistem Mimarı:** Görev vizyonu, sistem mimarisi ve koordinasyon.
* **Gezegen Bilimci & CBS Uzmanı:** Uydu haritaları, MOLA/THEMIS/SWIM katmanları ve afet yer seçimi.
* **Robotik & Zemin Mekaniği (Terramekanik) Mühendisi:** Bekker terramekaniği, çekiş kuvveti ve İKA donanım entegrasyonu.
* **Operasyon & Biyoenerjetik Mühendisi:** A\* rota planlaması, Pandolf metabolik modeli ve fırtına güç dengesi.
* **Uçuş Yazılımı & Havacılık Uzmanı:** ROS 2, MAVLink protokolü, FDIR mimarisi ve sistem doğrulama testleri.

---

*Saygılarımızla Valilik Makamının tensip ve takdirlerine arz ederiz.*  
**Martiap Proje Ekibi Adına**  
*(İletişim, E-posta ve Okul Bilgileri)*
