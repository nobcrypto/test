// dashboard.js

'use strict';

// ============================================================
// State
// ============================================================
let allArticles = [];
let sourceChart = null;
const REFRESH_INTERVAL = 300_000; // 5 minutes

// ============================================================
// Boot
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  loadSummary();
  loadArticles();
  setInterval(() => { loadSummary(); loadArticles(); }, REFRESH_INTERVAL);
});

// ============================================================
// API helpers
// ============================================================
async function loadSummary() {
  try {
    const res  = await fetch('/api/summary');
    const data = await res.json();
    renderSummary(data);
  } catch (e) { console.error('summary fetch error', e); }
}

async function loadArticles() {
  try {
    const res  = await fetch('/api/articles?limit=200');
    allArticles = await res.json();
    applyFilters();
  } catch (e) { console.error('articles fetch error', e); }
}

async function manualRefresh() {
  await fetch('/api/refresh', { method: 'POST' });
  setTimeout(() => { loadSummary(); loadArticles(); }, 2000);
}

// ============================================================
// Summary render
// ============================================================
function renderSummary(d) {
  // Last updated
  if (d.last_fetch) {
    const dt = new Date(d.last_fetch);
    document.getElementById('last-updated').textContent =
      'Updated: ' + dt.toUTCString().replace('GMT', 'UTC');
  }

  // Risk badge + level
  const badge = document.getElementById('risk-badge');
  const levelEl = document.getElementById('risk-level-text');
  const scoreEl = document.getElementById('risk-score-num');
  const bar     = document.getElementById('risk-bar');

  badge.textContent = d.risk_level;
  badge.style.backgroundColor = d.risk_color + '33';
  badge.style.color = d.risk_color;
  badge.style.borderColor = d.risk_color;
  badge.style.border = '1px solid';

  levelEl.textContent = d.risk_level;
  levelEl.style.color = d.risk_color;

  const riskScore = d.risk_score ?? 0;
  scoreEl.textContent = (riskScore >= 0 ? '+' : '') + riskScore.toFixed(1);
  scoreEl.style.color = d.risk_color;

  // Risk bar: map [-5, +5] → [0%, 100%], neutral at 50%
  const pct = Math.min(100, Math.max(0, ((riskScore + 5) / 10) * 100));
  bar.style.width = pct + '%';
  bar.style.backgroundColor = d.risk_color;

  // Market signal bars
  renderSignalBar('oil',  d.oil_score);
  renderSignalBar('gold', d.gold_score);
  renderSignalBar('usd',  d.usd_score);

  // Active signals list
  const sigList = document.getElementById('signal-list');
  if (d.top_signals && d.top_signals.length) {
    const maxCount = d.top_signals[0].count;
    sigList.innerHTML = d.top_signals.map(s => {
      const w = Math.round((s.count / maxCount) * 100);
      const deesc = s.label.includes('Diplomatic') || s.label.includes('Relief');
      return `<li class="signal-item">
        <div>
          <div class="${deesc ? 'text-green-400' : 'text-orange-400'}">${s.label}</div>
          <div class="signal-bar-mini ${deesc ? 'bg-green-500' : ''}" style="width:${w}%"></div>
        </div>
        <span class="text-gray-400 text-xs ml-2">${s.count}</span>
      </li>`;
    }).join('');
  } else {
    sigList.innerHTML = '<li class="text-gray-600">No signals yet</li>';
  }

  // Source doughnut chart
  if (d.source_counts && d.source_counts.length) {
    renderSourceChart(d.source_counts);
  }
}

function renderSignalBar(asset, score) {
  const bar = document.getElementById(asset + '-bar');
  const txt = document.getElementById(asset + '-score-txt');
  const s   = score ?? 0;
  txt.textContent = (s >= 0 ? '+' : '') + s.toFixed(1);

  if (s >= 0) {
    // Positive: extend right from center
    const w = Math.min(50, (s / 5) * 50);
    bar.style.left  = '50%';
    bar.style.width = w + '%';
  } else {
    // Negative: extend left from center
    const w = Math.min(50, (Math.abs(s) / 5) * 50);
    bar.style.left  = (50 - w) + '%';
    bar.style.width = w + '%';
  }

  if (asset === 'oil')  bar.style.backgroundColor = s >= 0 ? '#f97316' : '#22c55e';
  if (asset === 'gold') bar.style.backgroundColor = s >= 0 ? '#facc15' : '#22c55e';
  if (asset === 'usd')  bar.style.backgroundColor = s >= 0 ? '#60a5fa' : '#f472b6';

  txt.style.color = s > 0 ? '#f97316' : s < 0 ? '#4ade80' : '#9ca3af';
}

function renderSourceChart(sourceCounts) {
  const ctx = document.getElementById('source-chart').getContext('2d');
  const labels = sourceCounts.map(s => s.source);
  const data   = sourceCounts.map(s => s.count);

  if (sourceChart) { sourceChart.destroy(); }

  sourceChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: [
          '#f97316','#facc15','#60a5fa','#a78bfa','#34d399',
          '#f87171','#fb923c','#4ade80','#818cf8','#fbbf24',
        ],
        borderColor: '#111827',
        borderWidth: 2,
      }],
    },
    options: {
      plugins: {
        legend: {
          labels: { color: '#9ca3af', font: { size: 10, family: 'monospace' }, boxWidth: 10 },
        },
      },
      cutout: '60%',
    },
  });
}

// ============================================================
// Timeline render
// ============================================================
function applyFilters() {
  const bias    = document.getElementById('filter-bias').value;
  const signal  = document.getElementById('filter-signal').value.toLowerCase();
  const search  = document.getElementById('search-box').value.toLowerCase().trim();

  let filtered = allArticles;

  if (bias !== 'all') {
    filtered = filtered.filter(a => a.bias === bias);
  }
  if (signal) {
    filtered = filtered.filter(a =>
      (a.signals || []).some(s => s.toLowerCase().includes(signal))
    );
  }
  if (search) {
    filtered = filtered.filter(a =>
      a.title.toLowerCase().includes(search) ||
      a.summary.toLowerCase().includes(search)
    );
  }

  document.getElementById('article-count-label').textContent =
    filtered.length + ' articles';

  renderTimeline(filtered);
}

function renderTimeline(articles) {
  const container = document.getElementById('timeline');

  if (!articles.length) {
    container.innerHTML = '<div class="text-center text-gray-600 py-10 text-sm">No articles match the current filters.</div>';
    return;
  }

  container.innerHTML = articles.map((a, i) => {
    const risk    = riskClass(a.risk_delta);
    const tags    = (a.signals || []).map(s => {
      const deesc = s.includes('Diplomatic') || s.includes('Relief');
      return `<span class="signal-tag ${deesc ? 'deescalation' : ''}">${s}</span>`;
    }).join('');

    const date    = new Date(a.published);
    const dateStr = isNaN(date) ? a.published : formatDate(date);

    return `<div class="article-card ${risk}" onclick="toggleExpand(this)">
      <div class="article-title">${escHtml(a.title)}</div>
      <div class="article-meta">
        <span class="bias-${a.bias}">${escHtml(a.source)}</span>
        <span>${dateStr}</span>
        ${a.risk_delta !== 0
          ? `<span class="${a.risk_delta > 0 ? 'text-orange-400' : 'text-green-400'}">${a.risk_delta > 0 ? '+' : ''}${a.risk_delta} risk</span>`
          : ''}
        <a href="${escHtml(a.link)}" target="_blank" rel="noopener"
           onclick="event.stopPropagation()"
           class="text-blue-500 hover:underline ml-auto">Open</a>
      </div>
      ${tags ? `<div class="mt-1">${tags}</div>` : ''}
      <div class="article-summary">${escHtml(a.summary)}</div>
    </div>`;
  }).join('');
}

function toggleExpand(el) {
  el.classList.toggle('expanded');
}

// ============================================================
// Helpers
// ============================================================
function riskClass(delta) {
  if (delta >= 3)  return 'risk-high';
  if (delta >= 1)  return 'risk-mid';
  if (delta <= -1) return 'risk-low';
  return 'risk-none';
}

function formatDate(d) {
  const now = new Date();
  const diff = Math.floor((now - d) / 60000);
  if (diff < 1)   return 'Just now';
  if (diff < 60)  return diff + 'm ago';
  if (diff < 1440) return Math.floor(diff / 60) + 'h ago';
  return d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
