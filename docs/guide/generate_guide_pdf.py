import os
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm, mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

# Register Unicode fonts for Turkish character support
pdfmetrics.registerFont(TTFont('Arial', 'C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('Arial-Bold', 'C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFont(TTFont('Arial-Italic', 'C:/Windows/Fonts/ariali.ttf'))

# Numbered canvas for page numbers and running header/footer
class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count):
        if self._pageNumber == 1:
            return  # Skip cover page
        
        self.saveState()
        self.setFont('Arial', 8)
        self.setFillColor(colors.HexColor('#64748b'))
        
        # Header
        self.drawString(18 * mm, 285 * mm, "MARS DECISION ENGINE — ÜRÜN & TEKNİK SATIŞ REHBERİ")
        self.drawRightString(192 * mm, 285 * mm, "NASA SPACE APPS 2026")
        self.setStrokeColor(colors.HexColor('#cbd5e1'))
        self.setLineWidth(0.5)
        self.line(18 * mm, 282 * mm, 192 * mm, 282 * mm)
        
        # Footer
        self.line(18 * mm, 15 * mm, 192 * mm, 15 * mm)
        self.drawString(18 * mm, 11 * mm, "GİZLİ & TİCARİ — YATIRIMCI, JÜRİ VE PAZARLAMA EKİBİ İÇİN HAZIRLANMIŞTIR")
        self.drawRightString(192 * mm, 11 * mm, f"Sayfa {self._pageNumber} / {page_count}")
        self.restoreState()

def build_pdf(filename):
    doc = SimpleDocTemplate(
        filename,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm
    )

    styles = getSampleStyleSheet()
    
    # Custom Palette
    c_primary = colors.HexColor('#0f172a')     # Slate 900
    c_mars = colors.HexColor('#c2410c')        # Mars Rust Orange
    c_mars_dark = colors.HexColor('#9a3412')
    c_blue = colors.HexColor('#0284c7')        # Science Blue
    c_text = colors.HexColor('#334155')        # Slate 700
    c_card_bg = colors.HexColor('#f8fafc')     # Slate 50
    c_border = colors.HexColor('#e2e8f0')      # Slate 200
    c_green = colors.HexColor('#15803d')

    body = ParagraphStyle(
        'CustomBody',
        parent=styles['Normal'],
        fontName='Arial',
        fontSize=9.5,
        leading=14,
        textColor=c_text,
        spaceAfter=6
    )

    body_bold = ParagraphStyle(
        'CustomBodyBold',
        parent=body,
        fontName='Arial-Bold'
    )

    title_cover = ParagraphStyle(
        'CoverTitle',
        fontName='Arial-Bold',
        fontSize=26,
        leading=32,
        textColor=colors.white,
        alignment=1,
        spaceAfter=12
    )

    subtitle_cover = ParagraphStyle(
        'CoverSubtitle',
        fontName='Arial',
        fontSize=12,
        leading=17,
        textColor=colors.HexColor('#cbd5e1'),
        alignment=1,
        spaceAfter=25
    )

    h1 = ParagraphStyle(
        'CustomH1',
        fontName='Arial-Bold',
        fontSize=16,
        leading=21,
        textColor=c_mars_dark,
        spaceBefore=14,
        spaceAfter=8,
        keepWithNext=True
    )

    h2 = ParagraphStyle(
        'CustomH2',
        fontName='Arial-Bold',
        fontSize=12,
        leading=16,
        textColor=c_primary,
        spaceBefore=10,
        spaceAfter=4,
        keepWithNext=True
    )

    pitch_quote = ParagraphStyle(
        'PitchQuote',
        fontName='Arial-Italic',
        fontSize=10,
        leading=15,
        textColor=c_primary,
        spaceBefore=4,
        spaceAfter=4
    )

    table_cell = ParagraphStyle(
        'TableCell',
        fontName='Arial',
        fontSize=8.5,
        leading=12,
        textColor=c_text
    )

    table_cell_bold = ParagraphStyle(
        'TableCellBold',
        parent=table_cell,
        fontName='Arial-Bold',
        textColor=c_primary
    )

    table_header = ParagraphStyle(
        'TableHeader',
        parent=table_cell,
        fontName='Arial-Bold',
        textColor=colors.white
    )

    story = []

    # ==================== COVER PAGE ====================
    cover_data = [
        [
            Paragraph("<font size=10 color='#f97316'><b>NASA SPACE APPS CHALLENGE 2026</b></font><br/><br/>"
                      "<b>MARS DECISION ENGINE</b><br/>"
                      "<font size=14 color='#fdba74'>Interplanetary Survival Guide & Tactical Mission Operating System</font><br/><br/>"
                      "<font size=10 color='#cbd5e1'>Ürün, Mimari ve Satış/Pazarlama Teknik El Kitabı (Master Pitch Guide)</font>",
                      title_cover)
        ]
    ]
    cover_table = Table(cover_data, colWidths=[174 * mm], rowHeights=[120 * mm])
    cover_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#0f172a')),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 20),
        ('TOPPADDING', (0, 0), (-1, -1), 20),
        ('LEFTPADDING', (0, 0), (-1, -1), 20),
        ('RIGHTPADDING', (0, 0), (-1, -1), 20),
    ]))
    story.append(cover_table)
    story.append(Spacer(1, 15 * mm))

    # Executive Meta Box
    meta_data = [
        [Paragraph("<b>Hedef Kitle:</b>", table_cell_bold), Paragraph("Jüri Üyeleri, Yatırımcılar, Savunma/Uzay Sanayii İş Birlikleri, Teknik Olmayan Satış Ekipleri", table_cell)],
        [Paragraph("<b>Ürün Kategorisi:</b>", table_cell_bold), Paragraph("Uzay Operasyonları CBS (Geographic Information System), Yaşam Destek Karar Motoru & Taktik Rota Optimizasyonu", table_cell)],
        [Paragraph("<b>Temel Slogan:</b>", table_cell_bold), Paragraph("<i>'Mars'ta sadece bir harita değil; mürettebatın her nefesini, kilowattını ve hayatta kalma saniyesini yöneten otonom zekâ.'</i>", pitch_quote)],
        [Paragraph("<b>Sürüm & Altyapı:</b>", table_cell_bold), Paragraph("v2.4.0 Enterprise / %100 WebGL, Zero-Dependency Offline & Canlı NASA Donki/InSight API Entegre", table_cell)],
    ]
    meta_table = Table(meta_data, colWidths=[40 * mm, 134 * mm])
    meta_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), c_card_bg),
        ('BOX', (0, 0), (-1, -1), 1, c_border),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, c_border),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(meta_table)

    story.append(PageBreak())

    # ==================== BÖLÜM 1: 30 SANİYELİK ELEVATOR PITCH & DEĞER ÖNERİSİ ====================
    story.append(Paragraph("1. Giriş: Ürün Nedir ve Neden Hayati?", h1))
    story.append(HRFlowable(width="100%", thickness=1.5, color=c_mars, spaceBefore=2, spaceAfter=8))

    story.append(Paragraph(
        "<b>Mars Decision Engine (MDE)</b>, insanlı Mars görevlerinde üs yeri seçimini, keşif rotalarını, "
        "yaşam destek (ECLSS) tüketimini ve gezegensel afet risklerini tek bir etkileşimli ekranda yöneten "
        "<b>yeni nesil bir Görev Kontrol ve Karar Destek Sistemidir</b>. "
        "Dünya üzerindeki Google Maps veya ArcGIS neyse; MDE, Mars yüzeyindeki astronotlar ve Dünya'daki uçuş direktörleri için onun çok daha gelişmiş, çok disiplinli yaşam destek ve hayatta kalma karşılığıdır.",
        body
    ))

    # Değer Önerisi Kartı
    usp_data = [
        [
            Paragraph("<b>Pazarlamacının Cephanesi: 30 Saniyelik Asansör Konuşması (Elevator Pitch)</b><br/>"
                      "<i>'Mars'a insan göndermek roketle bitmiyor; asıl meydan okuma indiğiniz ilk gün donmamak, susuz kalmamak, kozmik radyasyondan kanser olmamak ve kum fırtınasında bataryanız bitmeden sığınak bulabilmektir. "
                      "Mars Decision Engine; NASA'nın MOLA, TES, SHARAD ve Donki uydularından gelen milyarlarca veriyi birleştirir. Bir astronot ekibine tek tıkla 'Nereye inmelisiniz, fırtına ne zaman vuracak, günde kaç litre su çıkarabilirsiniz ve acil durumda hangi lav tüpüne kaçmalısınız?' sorularının yanıtını matematiksel kesinlikle verir.'</i>",
                      pitch_quote)
        ]
    ]
    usp_table = Table(usp_data, colWidths=[174 * mm])
    usp_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#fff7ed')),
        ('BOX', (0, 0), (-1, -1), 1.5, c_mars),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
    ]))
    story.append(usp_table)
    story.append(Spacer(1, 4 * mm))

    story.append(Paragraph("Hangi Problemi Çözüyor? (Pazar Boşluğu)", h2))
    pazar_data = [
        [Paragraph("Geleneksel Durum (Rakipler / Mevcut Çözümler)", table_header), Paragraph("Mars Decision Engine Çözümü", table_header)],
        [
            Paragraph("• Veriler dağınık: Yükseklik NASA'da, su buz verisi SHARAD'da, hava durumu ayrı PDF raporlarında.<br/>"
                      "• Statik 2D haritalar: Eğimi gösterir ama rover'ın devrilme riskini ve batarya tüketimini hesaplamaz.<br/>"
                      "• Yaşam destekten kopuk: Rota çizen yazılımlar astronotun oksijen veya su ihtiyacını bilmez.<br/>"
                      "• Yüksek kurulum maliyeti: GB'larca GIS yazılımı, sunucu bağımlılığı ve internet gereksinimi.", table_cell),
            Paragraph("• <b>Tekleşik Taktik Konsol:</b> 9 bilimsel katman tek ekranda entegre.<br/>"
                      "• <b>3D Fiziksel Kinematik A*:</b> 20° üzeri uçurumları ve düşük termal ataleti (kum tuzağı) otomatik eler.<br/>"
                      "• <b>Entegre ECLSS & ISRU:</b> Her kilometre için O2, H2O ve regolit su çıkarım debisini anlık simüle eder.<br/>"
                      "• <b>Sıfır Kurulum & Sıfır Bağımlılık:</b> Tek HTML dosyasıyla yerel tarayıcıda veya Mars habitasında tam çevrimdışı çalışır.", table_cell)
        ]
    ]
    pazar_table = Table(pazar_data, colWidths=[87 * mm, 87 * mm])
    pazar_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), c_primary),
        ('BACKGROUND', (0, 1), (-1, 1), c_card_bg),
        ('BOX', (0, 0), (-1, -1), 1, c_border),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, c_border),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(pazar_table)

    story.append(PageBreak())

    # ==================== BÖLÜM 2: TEKNİK MİMARİ & BİLİMSEL MODÜLLER ====================
    story.append(Paragraph("2. Teknik Mimari ve Bilimsel Modüller (Derinlemesine)", h1))
    story.append(HRFlowable(width="100%", thickness=1.5, color=c_mars, spaceBefore=2, spaceAfter=8))

    story.append(Paragraph(
        "Ürün, yüzeysel bir konsept tasarım değildir. Kod tabanında NASA ve ESA hakemli literatüründen "
        "türetilmiş 5 ana bilimsel motor eşzamanlı çalışır:",
        body
    ))

    modules = [
        ("Modül 1: A* Taktik Rota & Kinematik Güvenlik Motoru (web/astar.js)",
         "• <b>Kinematik Eğim Kontrolü:</b> Yüzey eğimi >20° olan kanyon ve krater duvarlarını devrilme riski nedeniyle 'aşılamaz engel' ilan eder.<br/>"
         "• <b>Termal Ataletsel Toz Tuzağı Cezası (dPen):</b> Düşük termal ataletli (TI < 100 J/m²·K·s½) gevşek kum havuzlarını algılar ve rovere 80 kata kadar maliyet yükleyerek rotayı güvenli sert ana kayaya saptırır.<br/>"
         "• <b>Safe Haven (Acil Durum Sığınağı):</b> Güzergâh boyunca her 15 km'de bir lav tüpleri, derin hendekler ve sığınak koordinatlarını otonom işaretler."),

        ("Modül 2: ISRU Su Çıkarımı ve Yaşam Destek (ECLSS) Dengesi (web/scoring.js)",
         "• <b>NASA ECLSS Standardı:</b> Astronot başına 0.84 kg O2/gün, 2.50 kg içme suyu/gün ve 1.83 kg kuru gıda/gün metabolik tüketim modeli.<br/>"
         "• <b>Buzul Regolit Madenciliği (W_yield):</b> Yüzey altı buz derinliği (d_ice) ve kütlece su içeriği (wt%) kullanılarak günde kaç metreküp regolit kazılması gerektiği ve net üretilen su miktarı (kg/sol) canlı hesaplanır.<br/>"
         "• <b>Geri Dönüşüm Verimi:</b> %98 su geri kazanım döngüsü ve net harici ikmal açığı anında raporlanır."),

        ("Modül 3: Termal Şok ve Gece Donma Riski Simülatörü (web/storm.js)",
         "• <b>Mars Gecesi Termal Düşüşü:</b> -125°C'ye varan kutup ve krater gecelerinde habitatın iç sıcaklığını korumak için gereken kW cinsinden ısıtma gücünü hesaplar.<br/>"
         "• <b>Freeze-Out Sol Süresi:</b> Güç kesintisi veya fırtına nedeniyle jeneratör devre dışı kalırsa habitatın kaç sol (Mars günü) içinde donarak yaşanamaz hale geleceğini önceden tahmin eder.<br/>"
         "• <b>Kalıcı Toz Çöküntüsü (Dust Fallout):</b> Küresel fırtına sonrası solar panellerin %40'a varan verim kaybını ve temizleme gereksinimini modeller."),

        ("Modül 4: Akut Güneş Radyasyonu (SPE) ve Regolit Zırhı (web/scoring.js)",
         "• <b>GCR (Galaktik Kozmik Işınlar) + SPE (Solar Proton Olayları):</b> Fırtına anındaki öldürücü 850 mSv/sol dozunu modeller.<br/>"
         "• <b>Yarı-Değer Katmanı (HVL):</b> Mars regoliti zırhı (Yoğunluk 1.55 g/cm³) kullanarak astronotun NASA yıllık 500 mSv sınırının altına inmesi için habitat tavanına kaç metre regolit serilmesi gerektiğini (metre cinsinden) hesaplar."),

        ("Modül 5: Canlı Gezegensel API'ler ve Dünyaya Göre Yaşanabilirlik Endeksi (web/live_api.js)",
         "• <b>NASA DONKI (Space Weather):</b> Güneş koronal kütle atılımlarını (CME) ve jeomanyetik fırtınaları canlı sorgular.<br/>"
         "• <b>NASA InSight Lander Mars Weather:</b> Elysium Planitia'daki basınç (Pa), rüzgâr (m/s) ve sıcaklık verilerini entegre eder.<br/>"
         "• <b>Dünya vs. Mars Yaşanabilirlik Skoru:</b> Dünya (100) referans alınarak Mars sahasının yaşanabilirlik puanını (ör. 18.4 / 100) dinamik karşılaştırır.")
    ]

    for title, desc in modules:
        mod_table = Table([
            [Paragraph(f"<b>{title}</b>", table_cell_bold)],
            [Paragraph(desc, table_cell)]
        ], colWidths=[174 * mm])
        mod_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e0f2fe')),
            ('BACKGROUND', (0, 1), (-1, 1), c_card_bg),
            ('BOX', (0, 0), (-1, -1), 1, c_border),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ]))
        story.append(mod_table)
        story.append(Spacer(1, 2.5 * mm))

    story.append(PageBreak())

    # ==================== BÖLÜM 3: GÖRSEL MOTOR & FOTOGERÇEKÇİ WEBGL ====================
    story.append(Paragraph("3. Görsel Güç: Fotogerçekçi 3D WebGL Küresi", h1))
    story.append(HRFlowable(width="100%", thickness=1.5, color=c_mars, spaceBefore=2, spaceAfter=8))

    story.append(Paragraph(
        "Müşteriye ve jüriye ilk izlenimi veren şey arayüzün akıcılığı ve görsel kalitesidir. "
        "Mars Decision Engine, harici hiçbir ağır oyun motoru (Three.js, Cesium veya Unity) kullanmadan, "
        "<b>saf WebGL GLSL Shader'ları</b> ile 60 FPS performans sunar:",
        body
    ))

    gfx_data = [
        [Paragraph("Görsel Özellik", table_header), Paragraph("Teknik Karşılığı", table_header), Paragraph("Satış & Jüri Etkisi (Neden Önemli?)", table_header)],
        [
            Paragraph("<b>İnertial Celestial Starfield</b>", table_cell_bold),
            Paragraph("Kamera Euler açılarıyla (yaw/pitch) senkronize dönen gök küresi matrisi.", table_cell),
            Paragraph("Kullanıcı gezegeni çevirdiğinde yıldızlar sabit uzay koordinatlarında kalır; gerçek uzay aracı hissi yaşatır.", table_cell)
        ],
        [
            Paragraph("<b>Spektral Sınıflandırma (O-M)</b>", table_cell_bold),
            Paragraph("7 aşamalı termal Planck spektrumu renk eşleme algoritması.", table_cell),
            Paragraph("Yıldızlar tek düze beyaz nokta değildir; mavi devler, sarı güneşler ve kırmızı cücelerle gerçek gökyüzü doğruluk oranına sahiptir.", table_cell)
        ],
        [
            Paragraph("<b>Diffraction Spikes</b>", table_cell_bold),
            Paragraph("1. kadir parlak yıldızlar için 4 uçlu optik saçılma fonksiyonu.", table_cell),
            Paragraph("James Webb ve Hubble uzay teleskoplarının karakteristik optik imzasını ekrana getirir.", table_cell)
        ],
        [
            Paragraph("<b>Samanyolu Toz Bandı</b>", table_cell_bold),
            Paragraph("Galaktik ekvator boyunca modellenen hacimsel diffuse gaz simülasyonu.", table_cell),
            Paragraph("Mars'ın ince atmosferinden görülen büyüleyici Samanyolu kuşağını arka plana işler.", table_cell)
        ],
        [
            Paragraph("<b>MOLA 3D Topografya</b>", table_cell_bold),
            Paragraph("Yükseklik haritasından tepe noktalarını yerinde kabartan vertex displacement.", table_cell),
            Paragraph("Olympus Mons veya Valles Marineris kanyonlarının derinliği üç boyutlu hissedilir.", table_cell)
        ]
    ]
    gfx_table = Table(gfx_data, colWidths=[40 * mm, 62 * mm, 72 * mm])
    gfx_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), c_primary),
        ('BACKGROUND', (0, 1), (-1, -1), c_card_bg),
        ('BOX', (0, 0), (-1, -1), 1, c_border),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, c_border),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(gfx_table)
    story.append(Spacer(1, 4 * mm))

    # ==================== BÖLÜM 4: RAKİP ANALİZİ & KARŞILAŞTIRMA ====================
    story.append(Paragraph("4. Rekabet Analizi & Pazar Konumlandırması", h1))
    story.append(HRFlowable(width="100%", thickness=1.5, color=c_mars, spaceBefore=2, spaceAfter=8))

    comp_data = [
        [Paragraph("Kriter / Özellik", table_header), Paragraph("NASA Mars Trek", table_header), Paragraph("Google Mars", table_header), Paragraph("Mars Decision Engine", table_header)],
        [Paragraph("3D Etkileşimli Küre", table_cell), Paragraph("Var (Ağır)", table_cell), Paragraph("Kısmi (Eski 2D/3D)", table_cell), Paragraph("<b>Var (60 FPS Saf WebGL)</b>", table_cell_bold)],
        [Paragraph("A* Taktik Rota Planlama", table_cell), Paragraph("Yok (Sadece mesafe)", table_cell), Paragraph("Yok", table_cell), Paragraph("<b>Var (Eğim + Kum Cezalı)</b>", table_cell_bold)],
        [Paragraph("ECLSS / Yaşam Destek", table_cell), Paragraph("Yok", table_cell), Paragraph("Yok", table_cell), Paragraph("<b>Var (O2/Su/Kalori canlı)</b>", table_cell_bold)],
        [Paragraph("Güneş Fırtınası / SPE Uyarısı", table_cell), Paragraph("Yok", table_cell), Paragraph("Yok", table_cell), Paragraph("<b>Var (Canlı DONKI entegre)</b>", table_cell_bold)],
        [Paragraph("Çevrimdışı Çalışabilirlik", table_cell), Paragraph("Hayır (Sunucu şart)", table_cell), Paragraph("Hayır (İnternet şart)", table_cell), Paragraph("<b>EVET (Tek dosya / Offline)</b>", table_cell_bold)],
        [Paragraph("Kurulum Zorluğu", table_cell), Paragraph("Web portalı", table_cell), Paragraph("Web portalı", table_cell), Paragraph("<b>Sıfır Kurulum (Çift tıkla aç)</b>", table_cell_bold)],
    ]
    comp_table = Table(comp_data, colWidths=[42 * mm, 38 * mm, 38 * mm, 56 * mm])
    comp_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), c_primary),
        ('BACKGROUND', (3, 1), (3, -1), colors.HexColor('#ecfdf5')),
        ('BOX', (0, 0), (-1, -1), 1, c_border),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, c_border),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(comp_table)

    story.append(PageBreak())

    # ==================== BÖLÜM 5: SATIŞ, PİTCH & JÜRİ SIKÇA SORULAN SORULAR ====================
    story.append(Paragraph("5. Satış ve Jüri Sunum Rehberi: Sıkça Sorulan Sorular (SSS)", h1))
    story.append(HRFlowable(width="100%", thickness=1.5, color=c_mars, spaceBefore=2, spaceAfter=8))

    story.append(Paragraph(
        "Bir jüri üyesi, yatırımcı veya müşteri teknik bir soru sorduğunda hiç tereddüt etmeden "
        "kullanabileceğiniz hazır profesyonel yanıt kalıpları:",
        body
    ))

    qa_list = [
        ("Soru 1: 'Bu sadece harita üzerine çizilmiş renkli bir görselleştirme mi?'",
         "<b>Pazarlamacı Yanıtı:</b> Kesinlikle hayır. Arka planda çalışan 5 farklı deterministik fizik ve uzay biyolojisi algoritması bulunmaktadır. Yükseklik verisi MOLA uydusundan, mineral verisi TES spektrometresinden, su buz derinliği ise SHARAD radarından piksel piksel okunur. Çizilen her rota, Mars Pathfinder ve Curiosity verileriyle kalibre edilmiş kinematik devrilme ve regolit sürtünme katsayılarıyla test edilir."),

        ("Soru 2: 'Mars'ta internet yok, canlı NASA API'leri nasıl çalışacak?'",
         "<b>Pazarlamacı Yanıtı:</b> MDE, 'Offline-First' mimarisiyle tasarlanmıştır. Dünya'dan gelen DSN (Deep Space Network) veri paketleri senkronize olduğunda en son güneş patlamalarını ve fırtına uyarılarını çeker. Ancak bağlantı kesildiğinde dahili yerel iklim modeli ve sentetik telemetri jeneratörü devreye girerek astronotların hayati kararlarını kesintisiz sürdürmesini sağlar."),

        ("Soru 3: 'Mürettebat bir fırtınada dışarıda kalırsa sistem ne yapar?'",
         "<b>Pazarlamacı Yanıtı:</b> Sistem anında 'Safe Haven Mode' (Sığınak Protokolü) çalıştırır. Güzergâh boyunca topografik derinliği en yüksek krater çukurlarını veya lav tüplerini tarar. Rover'ın bataryası bitmeden sığınılabilecek en yakın 3 acil güvenli koordinatı ekranda yeşil emniyet halkalarıyla parlatır."),

        ("Soru 4: 'Neden büyük bir kütüphane (Three.js/Cesium) yerine saf WebGL yazıldı?'",
         "<b>Pazarlamacı Yanıtı:</b> Kritik görev yazılımlarında (Mission-Critical Software) kütüphane şişkinliği ve bilinmeyen bağımlılıklar güvenlik açığı yaratır. MDE sıfır harici paketle çalışır, toplam boyutu birkaç yüz kilobayttır ve radyasyona dayanıklı düşük işlemcili uzay donanımlarında dahi donmadan saniyede 60 kare hızla çalışabilir.")
    ]

    for q, a in qa_list:
        qa_table = Table([
            [Paragraph(f"<b>{q}</b>", table_cell_bold)],
            [Paragraph(a, table_cell)]
        ], colWidths=[174 * mm])
        qa_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f1f5f9')),
            ('BACKGROUND', (0, 1), (-1, 1), colors.white),
            ('BOX', (0, 0), (-1, -1), 1, c_border),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ]))
        story.append(qa_table)
        story.append(Spacer(1, 3 * mm))

    # ==================== BÖLÜM 6: DEMO ADIMLARI ====================
    story.append(Paragraph("6. Kusursuz Canlı Demo Akışı (5 Adımlı Satış Senaryosu)", h1))
    story.append(HRFlowable(width="100%", thickness=1.5, color=c_mars, spaceBefore=2, spaceAfter=8))

    demo_steps = [
        ("Adım 1: Küreyi Çevirin & Atmosferi Gösterin", "Kullanıcıya 3D küreyi fareyle döndürün, arkadaki spektral renkli yıldızları ve Samanyolu bandını göstererek 'Gördüğünüz derin uzay tamamen otonom GLSL shader kodudur' deyin."),
        ("Adım 2: Bir İniş Bölgesi Seçin", "Ekranda Jezero Crater veya Arcadia Planitia'ya tıklayın. Sağ panelde anında fırlayan ISRU su debisini (ör. 185 kg/sol su verimi) gösterin."),
        ("Adım 3: İki Nokta Arasında Rota Çizin", "Kanyonun karşısına rota atın. A* algoritmasının uçurumlardan kaçıp güvenli sırtlardan dolandığını ve güzergâhtaki Safe Haven sığınak noktalarını gösterin."),
        ("Adım 4: Toz Fırtınası Başlatın", "'Simulate Dust Storm' butonuna basın. Güneş paneli veriminin düştüğünü, habitat donma süresinin (Freeze-out Sol) hesaplandığını vurgulayın."),
        ("Adım 5: NASA Canlı API Kartını Açın", "Module IV Canlı API kartında InSight hava durumunu ve Dünya vs. Mars Yaşanabilirlik Skoru'nu göstererek sunumu bağlayın.")
    ]

    demo_data = []
    for step_num, step_desc in demo_steps:
        demo_data.append([Paragraph(f"<b>{step_num}</b>", table_cell_bold), Paragraph(step_desc, table_cell)])

    demo_table = Table(demo_data, colWidths=[55 * mm, 119 * mm])
    demo_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), c_card_bg),
        ('BOX', (0, 0), (-1, -1), 1, c_border),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, c_border),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(demo_table)
    story.append(Spacer(1, 6 * mm))

    # Kapanış İmzası
    story.append(Paragraph(
        "<b>Sonuç:</b> Mars Decision Engine, sadece bir yazılım projesi değil; insanlığın çok gezegenli tür olma yolculuğunda astronotların yanında taşıyacağı en güvenilir operasyonel kılavuzdur.",
        pitch_quote
    ))

    # PDF Build
    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"PDF successfully generated: {filename}")

if __name__ == '__main__':
    out_dir = os.path.dirname(os.path.abspath(__file__))
    pdf_path = os.path.join(out_dir, "Mars_Decision_Engine_Teknik_ve_Satis_Rehberi.pdf")
    build_pdf(pdf_path)
