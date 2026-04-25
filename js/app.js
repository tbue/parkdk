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

/* ════════════════════════════════
   24-TIMERS TIMELINE
════════════════════════════════ */

/**
 * Structured sign time rules (sign.timeRules[]).
 * Each rule: { type, windows: [{from,to}], days, maxHours, note }
 *
 * type:  'forbidden'   – standsning og parkering forbudt
 *        'no-parking'  – parkering forbudt (standsning OK)
 *        'limited'     – tilladt med max-tid / p-skive
 *        'ev-only'     – kun elbiler / opladning
 *        'paid'        – betaling påkrævet
 *        'free'        – fri parkering
 *
 * days:  'weekday'     – mandag–fredag (sort tekst på dansk skilt)
 *        'saturday'    – lørdag        (parentes på dansk skilt)
 *        'sunday'      – søndag+hellig (rød tekst på dansk skilt)
 *        'all'         – hele ugen
 *
 * windows: [{from: 7, to: 9}]  — gælder i disse timer
 *          empty/null           — gælder hele dagen
 *
 * Priority (højest vinder): forbidden > no-parking > ev-only > paid > limited > free
 */

const PRIORITY = ['forbidden','no-parking','ev-only','paid','limited','free'];

const STATUS_LABEL = {
  'free':       'Fri parkering',
  'limited':    'Tidsbegrænset',
  'paid':       'Betaling kræves',
  'ev-only':    'Kun elbiler',
  'no-parking': 'Parkering forbudt',
  'forbidden':  'Standsning forbudt'
};

// Map JS getDay() (0=Sun) to day-type strings
function getDayType(date) {
  const d = date.getDay();
  if (d === 0) return 'sunday';
  if (d === 6) return 'saturday';
  return 'weekday';
}

function ruleApplies(rule, hour, dayType) {
  // Day match
  const ruleDays = rule.days || 'all';
  if (ruleDays !== 'all' && ruleDays !== dayType) return false;

  // Window match
  const windows = rule.windows;
  if (!windows || windows.length === 0) return true; // no window = all day
  return windows.some(w => hour >= w.from && hour < w.to);
}

/**
 * Classify a single hour for a sign using timeRules if available,
 * otherwise fall back to tag/text heuristics.
 */
function classifyHour(sign, hour, dayType) {
  // ── Structured path ──
  if (sign.timeRules && sign.timeRules.length) {
    let best = 'free';
    let bestNote = '';
    for (const rule of sign.timeRules) {
      if (ruleApplies(rule, hour, dayType)) {
        if (PRIORITY.indexOf(rule.type) < PRIORITY.indexOf(best)) {
          best = rule.type;
          bestNote = rule.note || '';
        }
      }
    }
    return { status: best, note: bestNote };
  }

  // ── Fallback: heuristic from tags + rules text ──
  const tags  = sign.tags || [];
  const rules = (sign.rules || []).join(' ').toLowerCase();

  let restrictFrom = null, restrictTo = null;
  const timeMatch = rules.match(/(\d{1,2})(?::00)?[–\-](\d{1,2})(?::00)?/);
  if (timeMatch) {
    restrictFrom = parseInt(timeMatch[1]);
    restrictTo   = parseInt(timeMatch[2]);
  }
  const inWindow = restrictFrom !== null
    ? (hour >= restrictFrom && hour < restrictTo)
    : true;

  // Weekday check from rules text (e.g. "mandag–fredag")
  let dayRestricted = true;
  const dayRangeMatch = rules.match(/(man|tir|ons|tor|fre|lør|søn)[a-z]*[–\-](man|tir|ons|tor|fre|lør|søn)/i);
  if (dayRangeMatch) {
    const ORDER = ['Man','Tir','Ons','Tor','Fre','Lør','Søn'];
    const dayShortMap = { weekday:'Man', saturday:'Lør', sunday:'Søn' };
    const todayShort  = dayShortMap[dayType] || 'Man';
    const fromIdx = ORDER.findIndex(d => d.toLowerCase().startsWith(dayRangeMatch[1].toLowerCase()));
    const toIdx   = ORDER.findIndex(d => d.toLowerCase().startsWith(dayRangeMatch[2].toLowerCase()));
    const todayIdx = ORDER.indexOf(todayShort);
    if (todayIdx !== -1 && fromIdx !== -1 && toIdx !== -1)
      dayRestricted = todayIdx >= fromIdx && todayIdx <= toIdx;
  }

  const active = inWindow && dayRestricted;

  if (tags.includes('forbudt') && active)       return { status: 'forbidden' };
  if (tags.includes('el-bil') && active)        return { status: 'ev-only' };
  if (rules.includes('betaling') && active)     return { status: 'paid' };
  if (tags.includes('tidsbegrænset') && active) return { status: 'limited' };
  if (tags.includes('beboere') && active)       return { status: 'limited', note: 'Kun beboere' };
  if (tags.includes('handicap'))                return { status: 'free', note: 'Kræver handicapkort' };
  return { status: 'free' };
}

const WEEKDAY_NAMES = ['søndag','mandag','tirsdag','onsdag','torsdag','fredag','lørdag'];

function buildTimeline(sign) {
  const now  = new Date();
  const nowH = now.getHours();
  let html = '<div class="timeline">';

  for (let i = 0; i < 24; i++) {
    const absHour = (nowH + i) % 24;
    const slotDate = new Date(now);
    slotDate.setHours(absHour, 0, 0, 0);
    if (i > 0 && absHour <= nowH) slotDate.setDate(slotDate.getDate() + 1);
    const dayType = getDayType(slotDate);
    const dayName = WEEKDAY_NAMES[slotDate.getDay()];

    const { status, note } = classifyHour(sign, absHour, dayType);
    const isNow   = i === 0;
    const label   = isNow ? 'Nu' : (absHour === 0 ? '0' : String(absHour));
    const dayIndicator = (absHour === 0 && i > 0) ? `<div class="tl-midnight">${dayName.slice(0,3)}</div>` : '';
    const tooltipDayLabel = { weekday: 'Hverdag', saturday: 'Lørdag', sunday: 'Søndag' }[dayType];
    const tooltip = `${absHour}:00 (${tooltipDayLabel}) – ${STATUS_LABEL[status]}${note ? ': ' + note : ''}`;

    html += `<div class="tl-slot ${status}${isNow ? ' now' : ''}" title="${tooltip}">
      ${dayIndicator}
      <div class="tl-bar"></div>
      <div class="tl-label">${label}</div>
    </div>`;
  }
  html += '</div>';
  return html;
}

function openModal(sign) {
  document.getElementById('modal-title').textContent = sign.title;
  document.getElementById('modal-preview').innerHTML = sign.svgPreview;
  document.getElementById('modal-rules-list').innerHTML =
    sign.rules.map(r => `<li>${escHtml(r)}</li>`).join('');
  document.getElementById('modal-tags').innerHTML =
    sign.tags.map(t => `<span class="tag ${t.replace(/[^a-z-]/g,'')}">${escHtml(t)}</span>`).join('');
  document.getElementById('modal-timeline').innerHTML = buildTimeline(sign);
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

// ── EV plug icon (white, matches Danish road sign style) ──
function evPlugIcon(x, y, scale = 1) {
  const s = scale;
  return `<g transform="translate(${x},${y}) scale(${s})">
    <!-- plug body -->
    <rect x="-8" y="-14" width="16" height="20" rx="3" fill="white"/>
    <!-- prongs -->
    <rect x="-5" y="-20" width="4" height="8" rx="1" fill="white"/>
    <rect x="1" y="-20" width="4" height="8" rx="1" fill="white"/>
    <!-- cable coils -->
    <path d="M0,6 C0,12 8,12 8,18 C8,24 0,24 0,30 C0,36 8,36 8,42" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/>
  </g>`;
}

// ── Main sign builder ──
function buildSVG(d) {
  const isForbudt  = d.type === 'forbudt';
  const isEV       = d.type === 'el-ladeplads';
  const isBeboer   = d.forGroup.includes('beboere');
  const isHandicap = d.forGroup.includes('handicap');

  // Danish road sign blue: #1A3A8F (main P-sign blue from real signs)
  const BLUE   = '#1A3A8F';
  const DARK   = '#0D1F4E';
  const WHITE  = 'white';

  const timeStr = (d.timeFrom && d.timeTo) ? `${d.timeFrom}–${d.timeTo}` : '';
  const maxStr  = d.maxVal ? `${d.maxVal} ${d.maxUnit}` : '';
  const daysStr = d.weekdays.length && d.weekdays.length < 7 ? d.weekdays.join('–') : '';

  // ── Width fixed at 200, layout: main sign + undertavle ──
  const W = 200;
  const mainH = 200; // square-ish main sign

  // Build undertavle (sub-sign) rows
  const subRows = [];
  if (maxStr)   subRows.push(maxStr);
  if (timeStr)  subRows.push(timeStr);
  if (daysStr)  subRows.push(daysStr);
  if (d.exceptions) subRows.push(d.exceptions);

  const subH = subRows.length ? 18 + subRows.length * 22 + 14 : 0;
  const totalH = mainH + (subH > 0 ? 4 + subH : 0);

  // ── Main sign ──
  let mainContent = '';

  if (isForbudt) {
    // Parkering forbudt: blue circle with red border and single diagonal
    mainContent = `
      <!-- Blue circle, red ring, diagonal -->
      <circle cx="100" cy="100" r="72" fill="${BLUE}"/>
      <circle cx="100" cy="100" r="72" fill="none" stroke="#CC0000" stroke-width="12"/>
      <line x1="49" y1="49" x2="151" y2="151" stroke="#CC0000" stroke-width="12" stroke-linecap="round"/>
    `;
  } else if (isEV) {
    // EV sign: blue background, white P left + plug icon right
    mainContent = `
      <!-- P symbol, slightly left -->
      <text x="72" y="130" font-family="Arial Black,Arial,sans-serif" font-size="100" font-weight="900"
        fill="${WHITE}" text-anchor="middle" dominant-baseline="auto">P</text>
      <!-- EV plug icon, right side -->
      ${evPlugIcon(148, 72, 1.4)}
    `;
  } else if (isHandicap) {
    // Handicap: blue P + wheelchair symbol
    mainContent = `
      <text x="80" y="130" font-family="Arial Black,Arial,sans-serif" font-size="90" font-weight="900"
        fill="${WHITE}" text-anchor="middle">P</text>
      <!-- wheelchair simplified -->
      <circle cx="148" cy="65" r="10" fill="${WHITE}"/>
      <path d="M148,75 L148,105 L135,120 M148,105 L162,120 M138,90 L158,90" stroke="${WHITE}" stroke-width="5" fill="none" stroke-linecap="round"/>
    `;
  } else if (isBeboer) {
    // Beboer: blue P + "B" badge
    mainContent = `
      <text x="85" y="130" font-family="Arial Black,Arial,sans-serif" font-size="90" font-weight="900"
        fill="${WHITE}" text-anchor="middle">P</text>
      <rect x="130" y="50" width="46" height="46" rx="6" fill="${WHITE}"/>
      <text x="153" y="85" font-family="Arial Black,Arial,sans-serif" font-size="36" font-weight="900"
        fill="${BLUE}" text-anchor="middle">B</text>
    `;
  } else {
    // Standard P-skilt
    mainContent = `
      <text x="100" y="138" font-family="Arial Black,Arial,sans-serif" font-size="110" font-weight="900"
        fill="${WHITE}" text-anchor="middle">P</text>
    `;
  }

  // ── Main sign rect with white inner border (authentic Danish style) ──
  const mainSign = `
    <rect width="${W}" height="${mainH}" rx="10" fill="${BLUE}"/>
    <rect x="6" y="6" width="${W-12}" height="${mainH-12}" rx="7" fill="none" stroke="${WHITE}" stroke-width="3"/>
    ${mainContent}
  `;

  // ── Undertavle (sub-sign panels) ──
  let undertavle = '';
  if (subRows.length) {
    const subY = mainH + 4;
    undertavle = `
      <rect x="0" y="${subY}" width="${W}" height="${subH}" rx="6" fill="${WHITE}"/>
      <rect x="3" y="${subY+3}" width="${W-6}" height="${subH-6}" rx="4" fill="none" stroke="${BLUE}" stroke-width="3"/>
    `;
    subRows.forEach((row, i) => {
      const ty = subY + 18 + i * 22 + 8;
      undertavle += `<text x="100" y="${ty}" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="bold"
        fill="#111" text-anchor="middle">${escHtml(row)}</text>`;
    });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${totalH}" id="sign-preview-svg">
  ${mainSign}
  ${undertavle}
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
