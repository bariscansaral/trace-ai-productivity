// --- Durum Değişkenleri ---
let modelConfig = null;
let chartInstance = null;

// --- 1. Model Konfigürasyonunu Yükle ---
async function loadModelConfig() {
  try {
    const res = await fetch('./model_config.json');
    if (!res.ok) throw new Error("model_config.json yüklenemedi");
    modelConfig = await res.json();
    console.log("✓ Model katsayıları başarıyla yüklendi:", modelConfig);
  } catch (err) {
    console.error("Model yükleme hatası:", err);
    alert("Model konfigürasyon dosyası yüklenemedi. Lütfen model_config.json dosyasının doğru yerde olduğundan emin olun.");
  }
}

// --- 2. İstemci Tarafında Skor Tahmini (Linear Regression) ---
function calculateProductivityScore(inputs) {
  const { mean, scale } = modelConfig.scaler;
  const { coefficients, intercept } = modelConfig.model;

  // Girdilerin sıralaması modeldeki selected_features ile birebir aynı olmalı:
  // [study_hours, sleep_hours, phone_usage, attendance, stress, focus]
  const rawValues = [
    inputs.study_hours,
    inputs.sleep_hours,
    inputs.phone_usage,
    inputs.attendance,
    inputs.stress,
    inputs.focus * 10
  ];

  // StandardScaler: z = (x - mean) / scale
  // Tahmin: sum(z_i * w_i) + intercept
  let totalScore = intercept;

  for (let i = 0; i < rawValues.length; i++) {
    const z = (rawValues[i] - mean[i]) / scale[i];
    totalScore += z * coefficients[i];
  }

  // Skoru 0 ile 100 arasına sınırla ve yuvarla
  const clampedScore = Math.max(0, Math.min(100, totalScore));
  return Math.round(clampedScore * 10) / 10;
}

// --- 3. LocalStorage İşlemleri ---
function getStoredHistory() {
  const history = localStorage.getItem('trace_history');
  return history ? JSON.parse(history) : [];
}

function saveToHistory(entry) {
  const history = getStoredHistory();
  history.push(entry);
  // Son 30 kaydı tutalım
  if (history.length > 30) history.shift();
  localStorage.setItem('trace_history', JSON.stringify(history));
}

// --- 4. Chart.js Grafiğini Güncelle ---
function updateChart() {
  const history = getStoredHistory();
  const ctx = document.getElementById('historyChart').getContext('2d');

  const labels = history.map((item, index) => item.date || `Gün ${index + 1}`);
  const scores = history.map(item => item.score);

  if (chartInstance) {
    chartInstance.destroy();
  }

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Verimlilik Skoru',
        data: scores,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        borderWidth: 2,
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#10b981',
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: 0,
          max: 100,
          grid: { color: '#334155' },
          ticks: { color: '#94a3b8' }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8' }
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

// --- 5. AI Koç Analizini Çağır (Serverless Function) ---
async function fetchAICoachFeedback(entry) {
  const loadingEl = document.getElementById('ai-loading');
  const contentEl = document.getElementById('ai-content');

  loadingEl.classList.remove('hidden');
  contentEl.classList.add('hidden');
  contentEl.innerText = '';

  try {
    const response = await fetch('/.netlify/functions/coach', { {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });

    if (!response.ok) {
      throw new Error(`API hatası: ${response.status}`);
    }

    const data = await response.json();
    contentEl.innerText = data.feedback;
    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');
  } catch (err) {
    console.warn("AI Koç servisi henüz bağlı değil veya hata verdi:", err);
    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');

    // Serverless henüz çalışmıyorsa fallback yerel tavsiye
    let fallbackMsg = `Skorunuz: ${entry.score}/100. `;
    if (entry.phone_usage > 4) fallbackMsg += "Telefon kullanım süreniz verimliliğinizi ciddi şekilde aşağı çekiyor. ";
    if (entry.sleep_hours < 6.5) fallbackMsg += "Yetersiz uyku odaklanma kapasitenizi kısıtlamış. ";
    if (entry.study_hours >= 4) fallbackMsg += "Çalışma süreniz gayet iyi, odağınızı korumaya devam edin!";
    contentEl.innerText = fallbackMsg;
  }
}

// --- 6. Form Gönderimi Olayı (Submit Event) ---
document.getElementById('metrics-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!modelConfig) {
    alert("Model henüz yüklenmedi, lütfen sayfayı yenileyin.");
    return;
  }

  const inputs = {
    study_hours: parseFloat(document.getElementById('study_hours').value),
    sleep_hours: parseFloat(document.getElementById('sleep_hours').value),
    phone_usage: parseFloat(document.getElementById('phone_usage').value),
    attendance: parseFloat(document.getElementById('attendance').value),
    stress: parseFloat(document.getElementById('stress').value),
    focus: parseFloat(document.getElementById('focus').value),
    subject: document.getElementById('subject').value.trim(),
    struggle: document.getElementById('struggle').value.trim()
  };

  // 1. Skoru Hesapla
  const score = calculateProductivityScore(inputs);

  // 2. Arayüzde Skoru Göster
  const resultCard = document.getElementById('result-card');
  const scoreDisplay = document.getElementById('score-display');
  const scoreBadge = document.getElementById('score-badge');

  resultCard.classList.remove('hidden');
  scoreDisplay.innerText = score;

  if (score >= 70) {
    scoreBadge.innerText = "Yüksek Verim";
    scoreBadge.className = "px-3 py-1 text-xs font-semibold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";
  } else if (score >= 45) {
    scoreBadge.innerText = "Orta Düzey";
    scoreBadge.className = "px-3 py-1 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30";
  } else {
    scoreBadge.innerText = "Düşük Verim";
    scoreBadge.className = "px-3 py-1 text-xs font-semibold rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30";
  }

  // 3. Geçmişe Kaydet ve Grafiği Güncelle
  const now = new Date();
  const dateStr = `${now.getDate()}.${now.getMonth() + 1}`;
  const entry = { date: dateStr, score: score, ...inputs };

  saveToHistory(entry);
  updateChart();

  // 4. LLM Koç Analizini Başlat
  await fetchAICoachFeedback(entry);
});

// Sayfa yüklendiğinde modeli çek ve geçmiş grafiği çiz
window.addEventListener('DOMContentLoaded', () => {
  loadModelConfig();
  updateChart();
});