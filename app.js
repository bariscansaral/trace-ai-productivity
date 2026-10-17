
"use strict";

// ========================================
// TRACE - Uygulama ayarları
// ========================================

let modelConfig = null;
let chartInstance = null;
let modelLoadError = null;

const MODEL_CONFIG_URL = "./model_config.json";
const COACH_FUNCTION_URL = "/.netlify/functions/coach";

// ========================================
// 1. Model konfigürasyonunu yükle
// ========================================

async function loadModelConfig() {
  try {
    const response = await fetch(MODEL_CONFIG_URL, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        `model_config.json yüklenemedi. HTTP ${response.status}`
      );
    }

    const config = await response.json();

    // Model yapısını doğrula
    if (
      !config ||
      !config.scaler ||
      !config.model ||
      !Array.isArray(config.scaler.mean) ||
      !Array.isArray(config.scaler.scale) ||
      !Array.isArray(config.model.coefficients) ||
      typeof config.model.intercept !== "number"
    ) {
      throw new Error(
        "model_config.json içindeki model veya scaler yapısı hatalı."
      );
    }

    if (
      config.scaler.mean.length !== 6 ||
      config.scaler.scale.length !== 6 ||
      config.model.coefficients.length !== 6
    ) {
      throw new Error(
        "Modelde mean, scale ve coefficients dizilerinin her biri 6 eleman içermeli."
      );
    }

    if (
      !config.scaler.mean.every(Number.isFinite) ||
      !config.scaler.scale.every(
        value => Number.isFinite(value) && value !== 0
      ) ||
      !config.model.coefficients.every(Number.isFinite)
    ) {
      throw new Error(
        "Model katsayılarında geçersiz veya sıfır ölçek değeri var."
      );
    }

    modelConfig = config;
    modelLoadError = null;

    console.log(
      "TRACE: Model başarıyla yüklendi.",
      modelConfig
    );

  } catch (error) {
    modelConfig = null;
    modelLoadError = error;

    console.error("TRACE model yükleme hatası:", error);

    alert(
      "Model dosyası yüklenemedi.\n\n" +
      error.message +
      "\n\nmodel_config.json dosyasının index.html ile aynı klasörde olduğundan emin ol."
    );
  }
}

// ========================================
// 2. Verimlilik skorunu hesapla
// ========================================

function calculateProductivityScore(inputs) {
  if (!modelConfig) {
    throw new Error("Model henüz yüklenmedi.");
  }

  const { mean, scale } = modelConfig.scaler;
  const { coefficients, intercept } = modelConfig.model;

  // Sıralama eğitim sırasında kullanılan özelliklerle aynı olmalı.
  const rawValues = [
    inputs.study_hours,
    inputs.sleep_hours,
    inputs.phone_usage,
    inputs.attendance,
    inputs.stress,
    inputs.focus * 10
  ];

  let totalScore = intercept;

  for (let i = 0; i < rawValues.length; i++) {
    const normalizedValue = (rawValues[i] - mean[i]) / scale[i];

    totalScore += normalizedValue * coefficients[i];
  }

  const clampedScore = Math.max(0, Math.min(100, totalScore));

  return Math.round(clampedScore * 10) / 10;
}

// ========================================
// 3. Geçmiş kayıtlarını yönet
// ========================================

function getStoredHistory() {
  try {
    const stored = localStorage.getItem("trace_history");

    if (!stored) {
      return [];
    }

    const history = JSON.parse(stored);

    if (!Array.isArray(history)) {
      console.warn("TRACE: Kayıtlı geçmiş formatı hatalı.");
      return [];
    }

    return history;
  } catch (error) {
    console.error("TRACE geçmiş okuma hatası:", error);
    return [];
  }
}

function saveToHistory(entry) {
  try {
    const history = getStoredHistory();

    history.push(entry);

    // En fazla son 30 kayıt
    while (history.length > 30) {
      history.shift();
    }

    localStorage.setItem(
      "trace_history",
      JSON.stringify(history)
    );

    return true;
  } catch (error) {
    console.error("TRACE geçmiş kaydetme hatası:", error);
    return false;
  }
}

// ========================================
// 4. Geçmiş grafiğini güncelle
// ========================================

function updateChart() {
  const canvas = document.getElementById("historyChart");

  if (!canvas) {
    console.warn(
      "TRACE: historyChart bulunamadı. HTML içindeki canvas ID'sini kontrol et."
    );
    return;
  }

  if (typeof Chart === "undefined") {
    console.error(
      "TRACE: Chart.js yüklenmedi. HTML içindeki Chart.js script bağlantısını kontrol et."
    );
    return;
  }

  try {
    const history = getStoredHistory();

    const labels = history.map(
      (item, index) => item.date || `Gün ${index + 1}`
    );

    const scores = history.map(item => item.score);

    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    chartInstance = new Chart(canvas.getContext("2d"), {
      type: "line",

      data: {
        labels,

        datasets: [
          {
            label: "Verimlilik Skoru",
            data: scores,
            borderColor: "#10b981",
            backgroundColor: "rgba(16, 185, 129, 0.15)",
            borderWidth: 2,
            fill: true,
            tension: 0.35,
            pointBackgroundColor: "#10b981",
            pointRadius: 4
          }
        ]
      },

      options: {
        responsive: true,
        maintainAspectRatio: false,

        scales: {
          y: {
            min: 0,
            max: 100,

            grid: {
              color: "#334155"
            },

            ticks: {
              color: "#94a3b8"
            }
          },

          x: {
            grid: {
              display: false
            },

            ticks: {
              color: "#94a3b8"
            }
          }
        },

        plugins: {
          legend: {
            display: false
          }
        }
      }
    });

  } catch (error) {
    console.error("TRACE grafik hatası:", error);
  }
}

// ========================================
// 5. AI koçtan analiz al
// ========================================

async function fetchAICoachFeedback(entry) {
  const loadingEl = document.getElementById("ai-loading");
  const contentEl = document.getElementById("ai-content");

  // AI alanları HTML'de bulunmuyorsa uygulama çökmesin.
  if (!loadingEl || !contentEl) {
    console.warn(
      "TRACE: ai-loading veya ai-content HTML öğesi bulunamadı."
    );
    return;
  }

  loadingEl.classList.remove("hidden");
  contentEl.classList.add("hidden");
  contentEl.textContent = "";

  try {
    const response = await fetch(COACH_FUNCTION_URL, {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify(entry)
    });

    const responseText = await response.text();

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(
        `Sunucudan geçersiz yanıt geldi. HTTP ${response.status}`
      );
    }

    if (!response.ok) {
      const serverMessage =
        data.error || data.message || response.statusText;

      throw new Error(
        `AI servisi HTTP ${response.status}: ${serverMessage}`
      );
    }

    if (!data.feedback) {
      throw new Error(
        "AI servisi başarılı yanıt verdi ancak analiz metni bulunamadı."
      );
    }

    contentEl.textContent = data.feedback;

    console.log("TRACE: AI koç analizi başarıyla alındı.");

  } catch (error) {
    console.error("TRACE AI koç hatası:", error);

    // AI servisi çalışmasa da yerel öneri üret.
    const messages = [
      `Verimlilik skorun: ${entry.score}/100.`
    ];

    if (entry.phone_usage > 4) {
      messages.push(
        "Telefon kullanımını azaltmak için çalışma sırasında telefonu başka bir odada tut."
      );
    }

    if (entry.sleep_hours < 6.5) {
      messages.push(
        "Uyku süren düşük. Yarın uyku süreni artırmayı hedefle."
      );
    }

    if (entry.stress >= 7) {
      messages.push(
        "Stres seviyen yüksek. Çalışmayı kısa ve yönetilebilir bloklara böl."
      );
    }

    if (entry.focus <= 4) {
      messages.push(
        "Odak seviyeni artırmak için 25 dakikalık çalışma ve 5 dakikalık mola uygula."
      );
    }

    if (
      entry.phone_usage <= 4 &&
      entry.sleep_hours >= 6.5 &&
      entry.stress < 7 &&
      entry.focus > 4
    ) {
      messages.push(
        "Yarın aynı çalışma düzenini koruyup tek bir ölçülebilir hedef belirle."
      );
    }

    messages.push(
      "Kişisel AI analizi şu anda alınamadı. Ayrıntılar için tarayıcı konsolunu ve Netlify Function loglarını kontrol et."
    );

    contentEl.textContent = messages.join(" ");

  } finally {
    loadingEl.classList.add("hidden");
    contentEl.classList.remove("hidden");
  }
}

// ========================================
// 6. Formu işle
// ========================================

function initializeForm() {
  const form = document.getElementById("metrics-form");

  if (!form) {
    console.error(
      "TRACE: metrics-form bulunamadı. HTML içindeki form ID'sini kontrol et."
    );
    return;
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();

    if (!modelConfig) {
      alert(
        modelLoadError
          ? `Model yüklenemedi: ${modelLoadError.message}`
          : "Model henüz yüklenmedi. Lütfen birkaç saniye bekleyip tekrar dene."
      );
      return;
    }

    const fieldIds = [
      "study_hours",
      "sleep_hours",
      "phone_usage",
      "attendance",
      "stress",
      "focus"
    ];

    for (const id of fieldIds) {
      const field = document.getElementById(id);

      if (!field || field.value.trim() === "") {
        alert(`${id} alanı bulunamadı veya boş bırakıldı.`);
        return;
      }

      if (!Number.isFinite(Number(field.value))) {
        alert(`${id} alanına geçerli bir sayı gir.`);
        return;
      }
    }

    const inputs = {
      study_hours: Number(
        document.getElementById("study_hours").value
      ),

      sleep_hours: Number(
        document.getElementById("sleep_hours").value
      ),

      phone_usage: Number(
        document.getElementById("phone_usage").value
      ),

      attendance: Number(
        document.getElementById("attendance").value
      ),

      stress: Number(
        document.getElementById("stress").value
      ),

      focus: Number(
        document.getElementById("focus").value
      ),

      subject: (
        document.getElementById("subject")?.value || ""
      ).trim(),

      struggle: (
        document.getElementById("struggle")?.value || ""
      ).trim()
    };

    let score;

    try {
      score = calculateProductivityScore(inputs);
    } catch (error) {
      console.error("TRACE skor hesaplama hatası:", error);
      alert("Skor hesaplanamadı: " + error.message);
      return;
    }

    const resultCard = document.getElementById("result-card");
    const scoreDisplay = document.getElementById("score-display");
    const scoreBadge = document.getElementById("score-badge");

    if (resultCard) {
      resultCard.classList.remove("hidden");
    }

    if (scoreDisplay) {
      scoreDisplay.textContent = score;
    }

    if (scoreBadge) {
      if (score >= 70) {
        scoreBadge.textContent = "Yüksek Verim";

        scoreBadge.className =
          "px-3 py-1 text-xs font-semibold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";

      } else if (score >= 45) {
        scoreBadge.textContent = "Orta Düzey";

        scoreBadge.className =
          "px-3 py-1 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30";

      } else {
        scoreBadge.textContent = "Düşük Verim";

        scoreBadge.className =
          "px-3 py-1 text-xs font-semibold rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30";
      }
    }

    const now = new Date();

    const dateStr =
      `${now.getDate()}.${now.getMonth() + 1}`;

    const entry = {
      date: dateStr,
      score,
      ...inputs
    };

    saveToHistory(entry);
    updateChart();

    await fetchAICoachFeedback(entry);
  });
}

// ========================================
// 7. Sayfa başlatma
// ========================================

document.addEventListener("DOMContentLoaded", async () => {
  initializeForm();

  // Model yüklenirken grafik de hazırlanabilir.
  updateChart();

  await loadModelConfig();

  // Sayfa yüklenirken model hatası varsa konsolda ayrıntısı bulunur.
  if (!modelConfig) {
    console.error(
      "TRACE: Model yüklenemedi. Form gönderimi kullanılamayacak."
    );
  }
});
