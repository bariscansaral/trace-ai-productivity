exports.handler = async (event) => {
  // Yalnızca POST isteklerine izin ver
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Yalnızca POST metoduna izin verilir." })
    };
  }

  try {
    const data = JSON.parse(event.body);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "GEMINI_API_KEY ortam değişkeni bulunamadı." })
      };
    }

    // 1. LLM için bağlamı ve promptu hazırla
    const prompt = `
Sen gerçekçi, analitik ve doğrudan sonuca odaklanan bir öğrenci verimlilik koçusun.
Asla boş motivasyon cümleleri kurma; verilere dayanarak net teşhis koy ve aksiyon ver.

Öğrencinin Bugünkü Verileri:
- Çalışma Süresi: ${data.study_hours} saat
- Uyku Süresi: ${data.sleep_hours} saat
- Telefon / Ekran Süresi: ${data.phone_usage} saat
- Derse Katılım: %${data.attendance}
- Stres Seviyesi: ${data.stress} / 10
- Odak Seviyesi: ${data.focus} / 10
- Makine Öğrenmesi ile Hesaplanan Verimlilik Skoru: ${data.score} / 100
- Çalışılan Konu: ${data.subject ? data.subject : "Belirtilmedi"}
- Zorlanılan / Tıkanılan Nokta: ${data.struggle ? data.struggle : "Belirtilmedi"}

Senden İstenen Çıktı Formatı:
Aşağıdaki 3 maddeyi kısa, net ve doğrudan öğrenciye hitap eden bir dille yanıtla (toplamda 3-4 cümleyi geçmesin):
1. **Teşhis:** Verimliliği en çok düşüren (veya yükselten) 1 temel faktörü direkt yüzüne söyle.
2. **Çalışma Yöntemi:** Eğer çalışılan konu/zorluk belirtilmişse o konuya özel (örneğin Feynman, Pomodoro, aktif hatırlama vb.), belirtilmemişse genel odaklanma için pratik bir teknik öner.
3. **Yarın İçin Tek Hedef:** Yarın uygulayabileceği tek ve net bir aksiyon ver.
`;

    // 2. Gemini API çağrısı
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 300,
          temperature: 0.6
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API Hatası:", errText);
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: "AI servisinden yanıt alınamadı." })
      };
    }

    const result = await response.json();
    const feedbackText = result.candidates?.[0]?.content?.parts?.[0]?.text || "Analiz üretilemedi.";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ feedback: feedbackText })
    };

  } catch (err) {
    console.error("Fonksiyon Hatası:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Sunucusuz fonksiyon yürütülürken hata oluştu." })
    };
  }
};