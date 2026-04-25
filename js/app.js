// ===== ParkDK – app.js =====

/* ── Tab navigation ── */
const navBtns = document.querySelectorAll('.nav-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

function switchTab(tabId) {
  navBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  tabPanels.forEach(p => p.classList.toggle('active', p.id === tabId));
}

navBtns.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

/* ════════════════════════════════
   ANALYSE TAB
════════════════════════════════ */
const apiKeyInput   = document.getElementById('api-key-input');
const apiKeySaveBtn = document.getElementById('api-key-save');
const dropZone      = document.getElementById('drop-zone');
const fileInput     = document.getElementById('file-input');
const previewWrap   = document.getElementById('preview-wrap');
const previewImg    = document.getElementById('preview-img');
const analyseBtn    = document.getElementById('analyse-btn');
const resultCard    = document.getElementById('result-card');

// Load saved API key
if (localStorage.getItem('parkdk_api_key')) {
  apiKeyInput.value = localStorage.getItem('parkdk_api_key');
}

apiKeySaveBtn.addEventListener('click', () => {
  localStorage.setItem('parkdk_api_key', apiKeyInput.value.trim());
  showToast('API-nøgle gemt ✓');
});

// Drag & drop
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadImageFile(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadImageFile(fileInput.files[0]);
});

let currentImageBase64 = null;

function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    currentImageBase64 = e.target.result.split(',')[1];
    previewImg.src = e.target.result;
    previewWrap.style.display = 'block';
    analyseBtn.disabled = false;
  };
  reader.readAsDataURL(file);
}

analyseBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim() || localStorage.getItem('parkdk_api_key');
  if (!key) { showToast('⚠️ Indtast din OpenAI API-nøgle'); return; }
  if (!currentImageBase64) { showToast('⚠️ Vælg et billede først'); return; }

  analyseBtn.disabled = true;
  analyseBtn.innerHTML = '<span class="spinner" style="width:20px;height:20px;border-width:2px;margin:0"></span> Analyserer…';
  resultCard.innerHTML = '<div class="spinner"></div><p style="text-align:center;color:var(--grey-400)">Analyserer skiltet…</p>';
  resultCard.classList.remove('empty');

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 600,
        messages: [
          {
            role: 'system',
            content: 'You are a Danish parking expert. Analyze this parking sign photo and explain in clear Danish: 1) What the rules are, 2) Who can park (everyone, residents, EV cars, etc.), 3) Time restrictions, 4) Any EV/charging specific rules. Be concise and use bullet points.'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyser dette parkeringsskilt og forklar reglerne på dansk.' },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${currentImageBase64}` } }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const text = data.choices[0].message.content;
    renderResult(text);
  } catch (err) {
    resultCard.innerHTML = `
      <span class="result-label" style="background:#fde8e8;color:#cc0000">Fejl</span>
      <p style="color:#cc0000">${err.message}</p>`;
  } finally {
    analyseBtn.disabled = false;
    analyseBtn.innerHTML = '🔍 Analysér skilt';
  }
});

function renderResult(text) {
  // Convert markdown-ish bullet points to HTML
  const lines = text.split('\n');
  let html = '';
  let inUl = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { if (inUl) { html += '</ul>'; inUl = false; } html += '<br>'; continue; }
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || trimmed.startsWith('* ')) {
      if (!inUl) { html += '<ul>'; inUl = true; }
      html += `<li>${escHtml(trimmed.slice(2))}</li>`;
    } else if (/^\d+\)/.test(trimmed) || /^\*\*/.test(trimmed)) {
      if (inUl) { html += '</ul>'; inUl = false; }
      html += `<strong>${escHtml(trimmed.replace(/^\*\*|\*\*$/g,''))}</strong><br>`;
    } else {
      if (inUl) { html += '</ul>'; inUl = false; }
      html += escHtml(trimmed) + '<br>';
    }
  }
  if (inUl) html += '</ul>';

  resultCard.classList.remove('empty');
  resultCard.innerHTML = `
    <span class="result-label">Analyse</span>
    <h3>Parkeringsskilt – fortolkning</h3>
    <div class="result-body">${html}</div>`;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ════════════════════════════════
   BIBLIOTEK TAB
════════════════════════════════ */
let allSigns = [];
let activeFilters = new Set();

async function loadSigns() {
  try {
    const res = await fetch('data/signs.json');
    allSigns = await res.json();
    // Merge custom signs from localStorage
    const custom = JSON.parse(localStorage.getItem('parkdk_custom_signs') || '[]');
    allSigns = [...allSigns, ...custom];
    buildFilterChips();
    renderGrid(allSigns);
  } catch (e) {
    document.getElementById('signs-grid').innerHTML =
      '<p style="color:var(--grey-400)">Kunne ikke indlæse skilte.</p>';
  }
}

function buildFilterChips() {
  const tags = new Set();
  allSigns.forEach(s => s.tags.forEach(t => tags.add(t)));
  const bar = document.getElementById('filter-bar');
  bar.innerHTML = '<button class="filter-chip active" data-tag="alle">Alle</button>';
  tags.forEach(tag => {
    const btn = document.createElement('button');
    btn.className = 'filter-chip';
    btn.dataset.tag = tag;
    btn.textContent = tag;
    bar.appendChild(btn);
  });

  bar.addEventListener('click', e => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    const tag = chip.dataset.tag;
    if (tag === 'alle') {
      activeFilters.clear();
      bar.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    } else {
      bar.querySelector('[data-tag="alle"]').classList.remove('active');
      if (activeFilters.has(tag)) {
        activeFilters.delete(tag);
        chip.classList.remove('active');
      } else {
        activeFilters.add(tag);
        chip.classList.add('active');
      }
      if (activeFilters.size === 0) {
        bar.querySelector('[data-tag="alle"]').classList.add('active');
      }
    }
    const filtered = activeFilters.size === 0
      ? allSigns
      : allSigns.filter(s => s.tags.some(t => activeFilters.has(t)));
    renderGrid(filtered);
  });
}

function renderGrid(signs) {
  const grid = document.getElementById('signs-grid');
  if (!signs.length) {
    grid.innerHTML = '<p style="color:var(--grey-400);grid-column:1/-1">Ingen skilte matcher filteret.</p>';
    return;
  }
  grid.innerHTML = signs.map(sign => `
    <article class="sign-card" data-id="${sign.id}" tabindex="0" role="button" aria-label="${sign.title}">
      <div class="sign-card-preview">${sign.svgPreview}</div>
      <div class="sign-card-body">
        <h3>${escHtml(sign.title)}</h3>
        <p>${escHtml(sign.description)}</p>
        <div class="tag-list">
          ${sign.tags.map(t => `<span class="tag ${t.replace(/[^a-z-]/g,'')}">${escHtml(t)}</span>`).join('')}
        </div>
      </div>
    </article>
  `).join('');

  grid.querySelectorAll('.sign-card').forEach(card => {
    const open = () => {
      const sign = signs.find(s => s.id === card.dataset.id);
      if (sign) openModal(sign);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
  });
}

/* Modal */
const modalOverlay = document.getElementById('modal-overlay');
const modalClose   = document.getElementById('modal-close');

function openModal(sign) {
  document.getElementById('modal-title').textContent = sign.title;
  document.getElementById('modal-preview').innerHTML = sign.svgPreview;
  document.getElementById('modal-rules-list').innerHTML =
    sign.rules.map(r => `<li>${escHtml(r)}</li>`).join('');
  document.getElementById('modal-tags').innerHTML =
    sign.tags.map(t => `<span class="tag ${t.replace(/[^a-z-]/g,'')}">${escHtml(t)}</span>`).join('');
  modalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modalOverlay.classList.remove('open');
  document.body.style.overflow = '';
}

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ════════════════════════════════
   BYG TAB
════════════════════════════════ */
const bygForm = document.getElementById('byg-form');

// Listen to all form changes for live preview
bygForm.addEventListener('input', updateSignPreview);
bygForm.addEventListener('change', updateSignPreview);

function getFormData() {
  const type       = document.getElementById('sign-type').value;
  const timeFrom   = document.getElementById('time-from').value;
  const timeTo     = document.getElementById('time-to').value;
  const maxVal     = document.getElementById('max-tid').value;
  const maxUnit    = document.getElementById('max-unit').value;
  const forGroup   = [...document.querySelectorAll('input[name="kun-for"]:checked')].map(c => c.value);
  const exceptions = document.getElementById('undtagelser').value.trim();
  const weekdays   = [...document.querySelectorAll('input[name="weekday"]:checked')].map(c => c.value);

  return { type, timeFrom, timeTo, maxVal, maxUnit, forGroup, exceptions, weekdays };
}

function buildSVG(d) {
  const isForbudt   = d.type === 'forbudt';
  const isEV        = d.type === 'el-ladeplads';
  const isTid       = d.type === 'tidsbegrænset';

  const bgColor     = isForbudt ? '#CC0000' : isEV ? '#FF6B00' : '#003E8C';
  const timeStr     = (d.timeFrom && d.timeTo) ? `${d.timeFrom}–${d.timeTo}` : '';
  const maxStr      = d.maxVal ? `Maks. ${d.maxVal} ${d.maxUnit}` : '';
  const daysStr     = d.weekdays.length ? d.weekdays.join('–') : '';

  const forLabels   = { alle: 'Alle', 'el-biler': 'Elbiler', beboere: 'Beboere', handicap: 'Handicap' };
  const forStr      = d.forGroup.length ? d.forGroup.map(v => forLabels[v] || v).join(', ') : '';

  let mainSymbol = '';
  if (isForbudt) {
    mainSymbol = `
      <circle cx="100" cy="90" r="60" fill="none" stroke="white" stroke-width="8"/>
      <line x1="58" y1="48" x2="142" y2="132" stroke="white" stroke-width="8"/>`;
  } else if (isEV) {
    mainSymbol = `
      <text x="100" y="82" font-family="Arial,sans-serif" font-size="70" font-weight="900"
        fill="white" text-anchor="middle">P</text>
      <text x="100" y="120" font-family="Arial,sans-serif" font-size="28" fill="white" text-anchor="middle">⚡</text>`;
  } else {
    mainSymbol = `
      <text x="100" y="102" font-family="Arial,sans-serif" font-size="86" font-weight="900"
        fill="white" text-anchor="middle">P</text>`;
  }

  // Info lines below divider
  const infoLines = [maxStr, forStr, timeStr, daysStr].filter(Boolean);
  const dividerY  = isForbudt ? 155 : 130;
  const lineStart = dividerY + 22;

  let infoSVG = '';
  if (!isForbudt && infoLines.length) {
    infoSVG += `<line x1="16" y1="${dividerY}" x2="184" y2="${dividerY}" stroke="white" stroke-width="2" opacity="0.4"/>`;
    infoLines.forEach((line, i) => {
      infoSVG += `<text x="100" y="${lineStart + i * 18}" font-family="Arial,sans-serif" font-size="13" fill="white" text-anchor="middle">${escHtml(line)}</text>`;
    });
  }

  const svgHeight = isForbudt ? 200 : Math.max(200, lineStart + infoLines.length * 18 + 16);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 ${svgHeight}" id="sign-preview-svg">
  <rect width="200" height="${svgHeight}" rx="12" fill="${bgColor}"/>
  ${mainSymbol}
  ${infoSVG}
</svg>`;
}

function updateSignPreview() {
  const d = getFormData();
  const svg = buildSVG(d);
  document.getElementById('preview-container').innerHTML = svg;

  // Description text
  const typeLabels = { tilladt:'Parkering tilladt', forbudt:'Parkering forbudt', 'el-ladeplads':'El-ladeplads', tidsbegrænset:'Tidsbegrænset parkering' };
  const parts = [typeLabels[d.type] || d.type];
  if (d.maxVal) parts.push(`maks. ${d.maxVal} ${d.maxUnit}`);
  if (d.timeFrom && d.timeTo) parts.push(`kl. ${d.timeFrom}–${d.timeTo}`);
  document.getElementById('preview-desc').textContent = parts.join(' · ');
}

// Download SVG
document.getElementById('download-btn').addEventListener('click', () => {
  const svg = document.getElementById('preview-container').innerHTML;
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'parkdk-skilt.svg';
  a.click();
  URL.revokeObjectURL(url);
});

// Save to library
document.getElementById('gem-btn').addEventListener('click', () => {
  const d = getFormData();
  const svg = document.getElementById('preview-container').innerHTML;
  const typeLabels = { tilladt:'Parkering tilladt', forbudt:'Parkering forbudt', 'el-ladeplads':'El-ladeplads', tidsbegrænset:'Tidsbegrænset parkering' };
  const title = typeLabels[d.type] || d.type;

  const tags = [d.type];
  if (d.forGroup.includes('el-biler')) tags.push('el-bil');
  if (d.forGroup.includes('beboere')) tags.push('beboere');
  if (d.forGroup.includes('handicap')) tags.push('handicap');
  if (d.maxVal) tags.push('tidsbegrænset');

  const parts = [];
  if (d.maxVal) parts.push(`Maks. ${d.maxVal} ${d.maxUnit}`);
  if (d.timeFrom && d.timeTo) parts.push(`Kl. ${d.timeFrom}–${d.timeTo}`);
  if (d.forGroup.length) parts.push(`Kun: ${d.forGroup.join(', ')}`);
  if (d.exceptions) parts.push(`Undtagelse: ${d.exceptions}`);

  const newSign = {
    id: 'custom-' + Date.now(),
    title,
    description: parts.join('. ') || 'Brugerdefineret skilt',
    tags: [...new Set(tags)],
    rules: parts,
    svgPreview: svg
  };

  const customs = JSON.parse(localStorage.getItem('parkdk_custom_signs') || '[]');
  customs.push(newSign);
  localStorage.setItem('parkdk_custom_signs', JSON.stringify(customs));

  // Also push to in-memory allSigns and refresh grid
  allSigns.push(newSign);
  renderGrid(activeFilters.size === 0 ? allSigns : allSigns.filter(s => s.tags.some(t => activeFilters.has(t))));
  buildFilterChips();

  showToast('✓ Skilt gemt i biblioteket');
});

/* ── Toast utility ── */
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

/* ── Init ── */
loadSigns();
updateSignPreview();
