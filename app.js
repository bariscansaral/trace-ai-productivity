"use strict";

// ========================================
// TRACE - Uygulama ayarları
// ========================================

let modelConfig = null;
let chartInstance = null;
let modelLoadError = null;
let editingId = null; // CRUD Güncelleme takibi için

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
// 3. Geçmiş kayıtlarını yönet (CRUD)
// ========================================

function getStoredHistory() {
  try {
    const stored = localStorage.getItem("trace_history");
    if (!stored) return [];

    const history = JSON.parse(stored);
    if (!Array.isArray(history)) return [];

    return history;
  } catch (error) {
    console.error("TRACE geçmiş okuma hatası:", error);
    return [];
  }
}

// EKLEME (Create) ve GÜNCELLEME (Update)
function saveToHistory(entry) {
  try {
    let history = getStoredHistory();

    if (editingId) {
      // Güncelleme
      history = history.map(item => item.id === editingId ? { ...entry, id: editingId } : item);
      resetEditState();
    } else {
      // Yeni Ekleme
      entry.id = Date.now().toString();
      history.push(entry);
      while (history.length > 30) {
        history.shift();
      }
    }

    localStorage.setItem("trace_history", JSON.stringify(history));
    renderHistoryList();
    return true;
  } catch (error) {
    console.error("TRACE geçmiş kaydetme hatası:", error);
    return false;
  }
}

// SİLME (Delete)
function deleteHistoryItem(id) {
  try {
    let history = getStoredHistory();
    history = history.filter(item => item.id !== id);
    localStorage.setItem("trace_history", JSON.stringify(history));
    
    if (editingId === id) {
      resetEditState();
    }

    renderHistoryList();
    updateChart();
  } catch (error) {
    console.error("TRACE kayıt silme hatası:", error);
  }
}

// GÜNCELLEME HAZIRLIĞI (Forma Doldurma)
function editHistoryItem(id) {
  const history = getStoredHistory();
  const item = history.find(entry => entry.id === id);
  if (!item) return;

  document.getElementById("study_hours").value = item.study_hours;
  document.getElementById("sleep_hours").value = item.sleep_hours;
  document.getElementById("phone_usage").value = item.phone_usage;
  document.getElementById("attendance").value = item.attendance;
  document.getElementById("stress").value = item.stress;
  document.getElementById("focus").value = item.focus;
  document.getElementById("subject").value = item.subject || "";
  document.getElementById("struggle").value = item.struggle || "";

  editingId = id;

  const formTitle = document.getElementById("form-title");
  const btnSubmitText = document.getElementById("btn-submit-text");
  const btnCancel = document.getElementById("btn-cancel-edit");

  if (formTitle) formTitle.textContent = "Kaydı Düzenle";
  if (btnSubmitText) btnSubmitText.textContent = "Değişiklikleri Güncelle";
  if (btnCancel) btnCancel.classList.remove("hidden");

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetEditState() {
  editingId = null;
  const formTitle = document.getElementById("form-title");
  const btnSubmitText = document.getElementById("btn-submit-text");
  const btnCancel = document.getElementById("btn-cancel-edit");

  if (formTitle) formTitle.textContent = "Günün Kaydı";
  if (btnSubmitText) btnSubmitText.textContent = "Hesapla & Analiz Et";
  if (btnCancel) btnCancel.classList.add("hidden");
}

// LİSTELEME (Read)
function renderHistoryList() {
  const listEl = document.getElementById("history-list");
  if (!listEl) return;

  const history = getStoredHistory();

  if (history.length === 0) {
    listEl.innerHTML = `<p class="text-xs text-slate-500 py-3 text-center">Henüz geçmiş kayıt bulunmuyor.</p>`;
    return;
  }

  listEl.innerHTML = history.slice().reverse().map(item => `
    <div class="flex items-center justify-between p-3 rounded-xl bg-slate-800/40 border border-slate-700/50 hover:border-slate-600 transition">
      <div class="flex items-center gap-3 cursor-pointer flex-1" onclick="editHistoryItem('${item.id}')">
        <span class="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-semibold">${item.score}</span>
        <div>
          <p class="text-xs font-medium text-slate-200">${item.subject || 'Genel Çalışma'} <span class="text-[10px] text-slate-400 font-normal">(${item.study_hours}s çalışma, ${item.phone_usage}s tel)</span></p>
          <p class="text-[10px] text-slate-500">${item.date || 'Bugün'}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button type="button" onclick="editHistoryItem('${item.id}')" class="text-xs text-slate-300 hover:text-white px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 transition">Düzenle</button>
        <button type="button" onclick="deleteHistoryItem('${item.id}')" class="text-xs text-rose-400 hover:text-rose-300 px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 transition">Sil</button>
      </div>
    </div>
  `).join("");
}

// Global scope'a buton tıklamaları için fonksiyonları bağla
window.editHistoryItem = editHistoryItem;
window.deleteHistoryItem = deleteHistoryItem;

// ========================================
// 4. Geçmiş grafiğini güncelle
// ========================================

function updateChart() {
  const canvas = document.getElementById("historyChart");

  if (!canvas) {
    console.warn("TRACE: historyChart bulunamadı.");
    return;
  }

  if (typeof Chart === "undefined") {
    console.error("TRACE: Chart.js yüklenmedi.");
    return;
  }

  try {
    const history = getStoredHistory();
    const labels = history.map((item, index) => item.date || `Gün ${index + 1}`);
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
            grid: { color: "#334155" },
            ticks: { color: "#94a3b8" }
          },
          x: {
            grid: { display: false },
            ticks: { color: "#94a3b8" }
          }
        },
        plugins: {
          legend: { display: false }
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

  if (!loadingEl || !contentEl) return;

  loadingEl.classList.remove("hidden");
  contentEl.classList.add("hidden");
  contentEl.textContent = "";

  try {
    const response = await fetch(COACH_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry)
    });

    const responseText = await response.text();
    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(`Sunucudan geçersiz yanıt geldi. HTTP ${response.status}`);
    }

    if (!response.ok) {
      const serverMessage = data.error || data.message || response.statusText;
      throw new Error(`AI servisi HTTP ${response.status}: ${serverMessage}`);
    }

    if (!data.feedback) {
      throw new Error("Analiz metni bulunamadı.");
    }

    contentEl.textContent = data.feedback;
    console.log("TRACE: AI koç analizi başarıyla alındı.");

  } catch (error) {
    console.error("TRACE AI koç hatası:", error);

    const messages = [`Verimlilik skorun: ${entry.score}/100.`];
    if (entry.phone_usage > 4) messages.push("Telefon kullanımını azaltmak için çalışma sırasında telefonu başka bir odada tut.");
    if (entry.sleep_hours < 6.5) messages.push("Uyku süren düşük. Yarın uyku süreni artırmayı hedefle.");
    if (entry.stress >= 7) messages.push("Stres seviyen yüksek. Çalışmayı kısa bloklara böl.");
    if (entry.focus <= 4) messages.push("Odak seviyeni artırmak için Pomodoro tekniği uygula.");

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
  const btnCancel = document.getElementById("btn-cancel-edit");

  if (!form) return;

  if (btnCancel) {
    btnCancel.addEventListener("click", () => {
      resetEditState();
      form.reset();
    });
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();

    if (!modelConfig) {
      alert("Model henüz yüklenmedi. Lütfen birkaç saniye bekleyin.");
      return;
    }

    const fieldIds = ["study_hours", "sleep_hours", "phone_usage", "attendance", "stress", "focus"];

    for (const id of fieldIds) {
      const field = document.getElementById(id);
      if (!field || field.value.trim() === "" || !Number.isFinite(Number(field.value))) {
        alert(`${id} alanına geçerli bir sayı girin.`);
        return;
      }
    }

    const inputs = {
      study_hours: Number(document.getElementById("study_hours").value),
      sleep_hours: Number(document.getElementById("sleep_hours").value),
      phone_usage: Number(document.getElementById("phone_usage").value),
      attendance: Number(document.getElementById("attendance").value),
      stress: Number(document.getElementById("stress").value),
      focus: Number(document.getElementById("focus").value),
      subject: (document.getElementById("subject")?.value || "").trim(),
      struggle: (document.getElementById("struggle")?.value || "").trim()
    };

    let score;
    try {
      score = calculateProductivityScore(inputs);
    } catch (error) {
      alert("Skor hesaplanamadı: " + error.message);
      return;
    }

    const resultCard = document.getElementById("result-card");
    const scoreDisplay = document.getElementById("score-display");
    const scoreBadge = document.getElementById("score-badge");

    if (resultCard) resultCard.classList.remove("hidden");
    if (scoreDisplay) scoreDisplay.textContent = score;

    if (scoreBadge) {
      if (score >= 70) {
        scoreBadge.textContent = "Yüksek Verim";
        scoreBadge.className = "px-3 py-1 text-xs font-semibold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";
      } else if (score >= 45) {
        scoreBadge.textContent = "Orta Düzey";
        scoreBadge.className = "px-3 py-1 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30";
      } else {
        scoreBadge.textContent = "Düşük Verim";
        scoreBadge.className = "px-3 py-1 text-xs font-semibold rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30";
      }
    }

    const now = new Date();
    const dateStr = `${now.getDate()}.${now.getMonth() + 1}`;

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
  renderHistoryList();
  updateChart();

  await loadModelConfig();
});