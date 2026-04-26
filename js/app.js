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

/**
 * Translate a raw status/note pair based on the viewer's car type.
 * - 'ev-only' zone + normal car → no-parking (forbudt for alm. bil)
 * - 'ev-only' zone + ev car     → free/limited (elbiler må lade)
 * - All other statuses are unchanged regardless of car type.
 */
function applyCarType({ status, note }, carType) {
  if (status === 'ev-only') {
    if (carType === 'ev') {
      return { status: 'free', note: note || 'Kun elbiler under opladning' };
    } else {
      return { status: 'no-parking', note: 'Kun elbiler – forbudt for alm. biler' };
    }
  }
  return { status, note };
}

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

// Map JS getDay() (0=Sun) to lowercase day name
const DAY_INDEX_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
function getDayName(date) {
  return DAY_INDEX_NAMES[date.getDay()];
}

// All 5 weekday names
const ALL_WEEKDAYS = ['monday','tuesday','wednesday','thursday','friday'];

/**
 * Format a `days` value (string or array) into a display label for a sign undertavle.
 * Returns:
 *   null                    → gælder alle hverdage, skriv ikke dage på skiltet
 *   { text, color, parens } → tekst der skal vises, evt. i parentes (lørdag) eller rød (søndag)
 */
const DAY_SHORT_DA = { monday:'Man', tuesday:'Tir', wednesday:'Ons', thursday:'Tor', friday:'Fre', saturday:'Lør', sunday:'Søn' };

function formatDaysLabel(days) {
  if (!days || days === 'all') return null;
  // Normalize to array
  const arr = Array.isArray(days) ? days : [days];
  const sorted = arr.slice().sort((a,b) => DAY_INDEX_NAMES.indexOf(a) - DAY_INDEX_NAMES.indexOf(b));

  // All 5 weekdays → ingen dag-tekst
  const isAllWeekdays = ALL_WEEKDAYS.every(d => sorted.includes(d)) && !sorted.includes('saturday') && !sorted.includes('sunday');
  if (isAllWeekdays) return null;

  // Only saturday
  if (sorted.length === 1 && sorted[0] === 'saturday') return { text: null, parens: true, color: null };
  // Only sunday
  if (sorted.length === 1 && sorted[0] === 'sunday') return { text: null, parens: false, color: 'red' };

  // Mixed specific days
  const text = sorted.map(d => DAY_SHORT_DA[d] || d).join(', ');
  // Determine color: red if any sunday, normal if only weekdays, parens if contains saturday but no sunday
  const hasSunday = sorted.includes('sunday');
  const hasSaturday = sorted.includes('saturday');
  if (hasSunday) return { text, parens: false, color: 'red' };
  if (hasSaturday) return { text, parens: true, color: null };
  return { text, parens: false, color: null };
}

function ruleApplies(rule, hour, dayType, dayName) {
  // Day match — supports string ('weekday','saturday','sunday','all') or array of day names
  const ruleDays = rule.days || 'all';
  if (Array.isArray(ruleDays)) {
    // Specific days array: check if today's dayName is in the list
    // Also treat Saturday/Sunday membership correctly
    const matchesByName = ruleDays.includes(dayName);
    if (!matchesByName) return false;
  } else {
    if (ruleDays !== 'all' && ruleDays !== dayType) return false;
  }

  // Window match
  const windows = rule.windows;
  if (!windows || windows.length === 0) return true; // no window = all day
  return windows.some(w => hour >= w.from && hour < w.to);
}

/**
 * Classify a single hour for a sign using timeRules if available,
 * otherwise fall back to tag/text heuristics.
 * carType: 'normal' | 'ev'
 */
function classifyHour(sign, hour, dayType, carType = 'normal', dayName = null) {
  // ── Derive base status from tags (used when no rule matches) ──
  // This is the "always-on" restriction of the sign.
  // e.g. a beboer sign is always 'limited' even outside time windows.
  const tags = sign.tags || [];
  let baseStatus = sign.baseStatus || 'free';
  let baseNote   = sign.baseNote   || '';
  if (!sign.baseStatus) {
    if (tags.includes('beboere'))     { baseStatus = 'limited';    baseNote = 'Kun beboere'; }
    else if (tags.includes('handicap')) { baseStatus = 'limited';  baseNote = 'Kræver handicapkort'; }
    else if (tags.includes('el-bil')) { baseStatus = 'ev-only';    baseNote = 'Kun elbiler'; }
    else if (tags.includes('betaling')) { baseStatus = 'paid';     baseNote = 'Betaling kræves'; }
    else if (tags.includes('forbudt')) { baseStatus = 'no-parking'; baseNote = ''; }
  }

  // ── Structured path ──
  if (sign.timeRules && sign.timeRules.length) {
    let best     = baseStatus;
    let bestNote = baseNote;
    for (const rule of sign.timeRules) {
      if (ruleApplies(rule, hour, dayType, dayName)) {
        if (PRIORITY.indexOf(rule.type) < PRIORITY.indexOf(best)) {
          best     = rule.type;
          bestNote = rule.note || '';
        }
      }
    }
    return applyCarType({ status: best, note: bestNote }, carType);
  }

  // ── Fallback: heuristic from rules text ──
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

  // Weekday check from rules text
  let dayRestricted = true;
  const dayRangeMatch = rules.match(/(man|tir|ons|tor|fre|lør|søn)[a-z]*[–\-](man|tir|ons|tor|fre|lør|søn)/i);
  if (dayRangeMatch) {
    const ORDER = ['Man','Tir','Ons','Tor','Fre','Lør','Søn'];
    const dayShortMap = { weekday:'Man', saturday:'Lør', sunday:'Søn' };
    const todayShort  = dayShortMap[dayType] || 'Man';
    const fromIdx  = ORDER.findIndex(d => d.toLowerCase().startsWith(dayRangeMatch[1].toLowerCase()));
    const toIdx    = ORDER.findIndex(d => d.toLowerCase().startsWith(dayRangeMatch[2].toLowerCase()));
    const todayIdx = ORDER.indexOf(todayShort);
    if (todayIdx !== -1 && fromIdx !== -1 && toIdx !== -1)
      dayRestricted = todayIdx >= fromIdx && todayIdx <= toIdx;
  }

  const active = inWindow && dayRestricted;

  if (active) {
    if (tags.includes('forbudt'))       return { status: 'forbidden',  note: '' };
    if (tags.includes('el-bil'))        return { status: 'ev-only',    note: '' };
    if (rules.includes('betaling'))     return { status: 'paid',       note: '' };
    if (tags.includes('tidsbegrænset')) return { status: 'limited',    note: '' };
  }
  // Outside active window → fall back to base
  return { status: baseStatus, note: baseNote };
}

const WEEKDAY_NAMES = ['søndag','mandag','tirsdag','onsdag','torsdag','fredag','lørdag'];
const DAY_NAMES_DA  = ['Søndag','Mandag','Tirsdag','Onsdag','Torsdag','Fredag','Lørdag'];

function buildTimeline(sign, offsetDays = 0, carType = 'normal') {
  const base = new Date();
  base.setDate(base.getDate() + offsetDays);
  // If offsetDays > 0 start from 00:00 that day, else start from current hour
  const startHour = offsetDays === 0 ? base.getHours() : 0;

  let html = '<div class="timeline">';

  for (let i = 0; i < 24; i++) {
    const absHour = (startHour + i) % 24;
    const slotDate = new Date(base);
    slotDate.setHours(absHour, 0, 0, 0);
    if (offsetDays === 0 && i > 0 && absHour <= startHour) slotDate.setDate(slotDate.getDate() + 1);

    const dayType = getDayType(slotDate);
    const dayName = getDayName(slotDate);
    const dayShort = dayType === 'saturday' ? 'Lør' : dayType === 'sunday' ? 'Søn' : 'Hverdag';

    const { status, note } = classifyHour(sign, absHour, dayType, carType, dayName);
    const isNow   = offsetDays === 0 && i === 0;
    const label   = isNow ? 'Nu' : (absHour === 0 ? '0' : String(absHour));
    const dayIndicator = (absHour === 0 && (i > 0 || offsetDays > 0))
      ? `<div class="tl-midnight">${dayShort}</div>` : '';
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

let _modalSign = null;
let _timelineOffset = 0;
let _carType = 'normal'; // 'normal' | 'ev'

function renderTimelineSection() {
  const now = new Date();
  const target = new Date(now);
  target.setDate(target.getDate() + _timelineOffset);

  let dateLabel;
  if (_timelineOffset === 0)      dateLabel = 'I dag';
  else if (_timelineOffset === 1) dateLabel = 'I morgen';
  else {
    const dt = getDayType(target);
    const dtLabel = dt === 'saturday' ? 'Lørdag' : dt === 'sunday' ? 'Søndag' : 'Hverdag';
    dateLabel = `${dtLabel} d. ${target.getDate()}/${target.getMonth()+1}`;
  }

  document.getElementById('tl-date-label').textContent = dateLabel;
  document.getElementById('tl-prev').disabled = _timelineOffset <= 0;
  document.getElementById('modal-timeline').innerHTML = buildTimeline(_modalSign, _timelineOffset, _carType);
}

function openModal(sign) {
  _modalSign = sign;
  _timelineOffset = 0;
  _carType = 'normal';
  document.getElementById('car-normal').classList.add('active');
  document.getElementById('car-ev').classList.remove('active');
  document.getElementById('modal-title').textContent = sign.title;
  document.getElementById('modal-preview').innerHTML = sign.svgPreview;
  document.getElementById('modal-rules-list').innerHTML =
    sign.rules.map(r => `<li>${escHtml(r)}</li>`).join('');
  document.getElementById('modal-tags').innerHTML =
    sign.tags.map(t => `<span class="tag ${t.replace(/[^a-z-]/g,'')}">${escHtml(t)}</span>`).join('');
  renderTimelineSection();
  modalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

document.getElementById('tl-prev').addEventListener('click', () => {
  if (_timelineOffset > 0) { _timelineOffset--; renderTimelineSection(); }
});
document.getElementById('tl-next').addEventListener('click', () => {
  _timelineOffset++;
  renderTimelineSection();
});

document.getElementById('car-normal').addEventListener('click', () => {
  _carType = 'normal';
  document.getElementById('car-normal').classList.add('active');
  document.getElementById('car-ev').classList.remove('active');
  renderTimelineSection();
});
document.getElementById('car-ev').addEventListener('click', () => {
  _carType = 'ev';
  document.getElementById('car-ev').classList.add('active');
  document.getElementById('car-normal').classList.remove('active');
  renderTimelineSection();
});

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
  const isForbudt         = d.type === 'forbudt';
  const isStandsningForbudt = d.type === 'standsning-forbudt';
  const isEV              = d.type === 'el-ladeplads' || d.type === 'el-ladeplads-betaling';
  const isEVBetaling      = d.type === 'el-ladeplads-betaling';
  const isBeboer          = d.type === 'beboer' || d.forGroup.includes('beboere');
  const isHandicap        = d.type === 'handicap' || d.forGroup.includes('handicap');
  const isBetaling        = d.type === 'betaling';

  // Danish road sign blue: #1A3A8F (main P-sign blue from real signs)
  const BLUE   = '#1A3A8F';
  const DARK   = '#0D1F4E';
  const WHITE  = 'white';

  const timeStr = (d.timeFrom && d.timeTo) ? `${d.timeFrom}–${d.timeTo}` : '';
  const maxStr  = d.maxVal ? `${d.maxVal} ${d.maxUnit}` : '';
  // Use formatDaysLabel to decide if/how to show days
  const daysLabel = d.weekdays && d.weekdays.length ? formatDaysLabel(d.weekdays) : undefined;
  // daysLabel === null → alle hverdage, ingen tekst
  // daysLabel === undefined → ingen dage valgt
  // daysLabel.text / .parens / .color → specific days

  // ── Width fixed at 200, layout: main sign + undertavle ──
  const W = 200;
  const mainH = 200; // square-ish main sign

  // Build undertavle (sub-sign) rows — each row: { text, color }
  const subRows = [];
  if (maxStr)   subRows.push({ text: maxStr, color: null });
  if (timeStr) {
    // If we have a daysLabel, wrap time accordingly
    if (daysLabel && daysLabel !== null) {
      let t = timeStr;
      if (daysLabel.parens) t = `(${t})`;
      subRows.push({ text: t, color: daysLabel.color });
      if (daysLabel.text) subRows.push({ text: daysLabel.text, color: daysLabel.color });
    } else {
      subRows.push({ text: timeStr, color: null });
    }
  }
  if (d.exceptions) subRows.push({ text: d.exceptions, color: null });

  const subH = subRows.length ? 18 + subRows.length * 22 + 14 : 0;
  const totalH = mainH + (subH > 0 ? 4 + subH : 0);

  // ── Main sign ──
  let mainContent = '';

  if (isForbudt || isStandsningForbudt) {
    // Parkering forbudt: blue rect + red circle + diagonal(s)
    const diag2 = isStandsningForbudt
      ? `<line x1="149" y1="51" x2="51" y2="149" stroke="#CC0000" stroke-width="12" stroke-linecap="round"/>`
      : '';
    mainContent = `
      <circle cx="100" cy="100" r="72" fill="${BLUE}"/>
      <circle cx="100" cy="100" r="72" fill="none" stroke="#CC0000" stroke-width="12"/>
      <line x1="51" y1="51" x2="149" y2="149" stroke="#CC0000" stroke-width="12" stroke-linecap="round"/>
      ${diag2}
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
  } else if (isBetaling) {
    // Betalingsparkering: P + kr/DKK symbol
    mainContent = `
      <text x="75" y="130" font-family="Arial Black,Arial,sans-serif" font-size="90" font-weight="900"
        fill="${WHITE}" text-anchor="middle">P</text>
      <text x="158" y="85" font-family="Arial Black,Arial,sans-serif" font-size="44" font-weight="900"
        fill="${WHITE}" text-anchor="middle">kr</text>
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
      const fillColor = row.color || '#111';
      undertavle += `<text x="100" y="${ty}" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="bold"
        fill="${fillColor}" text-anchor="middle">${escHtml(row.text)}</text>`;
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
  const typeLabels = {
    'tilladt':              'Parkering tilladt',
    'tidsbegrænset':        'Tidsbegrænset parkering',
    'betaling':             'Betalingsparkering',
    'el-ladeplads':         'El-ladeplads',
    'el-ladeplads-betaling':'El-ladeplads + betalingszone',
    'beboer':               'Beboerparkering',
    'handicap':             'Handicapparkering',
    'forbudt':              'Parkering forbudt',
    'standsning-forbudt':   'Standsning og parkering forbudt'
  };
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
