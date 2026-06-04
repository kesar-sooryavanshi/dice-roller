/**
 * DICE FORGE — script.js
 * Premium Dice Roller Application
 * Features: Multi-dice, statistics, history, presets, keyboard shortcuts,
 *           sound effects, JSON export, smooth animations
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIG & STATE
   ═══════════════════════════════════════════════════════════════════════════ */

const CONFIG = {
  MIN_DICE: 1,
  MAX_DICE: 20,
  ROLL_ANIM_MS: 600,   // rolling animation duration
  TOAST_MS: 2400,      // toast display time
  MAX_HISTORY: 120,    // cap history entries
};

const PRESETS = {
  'dnd-attack':  { sides: 20, count: 1,  label: 'D&D Attack (1d20)'  },
  'dnd-damage':  { sides: 8,  count: 2,  label: 'D&D Damage (2d8)'   },
  'dice-poker':  { sides: 6,  count: 5,  label: 'Poker Dice (5d6)'   },
  'advantage':   { sides: 20, count: 2,  label: 'Advantage (2d20)'   },
  'initiative':  { sides: 20, count: 1,  label: 'Initiative (1d20)'  },
  'fate-dice':   { sides: 6,  count: 4,  label: 'Fate Dice (4d6)'    },
};

// Application state
const state = {
  sides:       6,      // current die type
  count:       1,      // number of dice
  history:     [],     // array of roll records
  allValues:   [],     // every individual die value for stats
  isRolling:   false,  // animation guard
  lastResults: [],     // results from most recent roll
};

/* ═══════════════════════════════════════════════════════════════════════════
   DOM REFERENCES
   ═══════════════════════════════════════════════════════════════════════════ */

const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

const dom = {
  // Left panel
  diceBtns:      $$('.dice-btn'),
  qtyValue:      $('qty-value'),
  qtyDec:        $('qty-dec'),
  qtyInc:        $('qty-inc'),
  qtySlider:     $('qty-slider'),
  presetBtns:    $$('.preset-btn'),
  // Stats
  statTotalRolls:$('stat-total-rolls'),
  statAverage:   $('stat-average'),
  statHighest:   $('stat-highest'),
  statLowest:    $('stat-lowest'),
  statCommon:    $('stat-common'),
  // Center panel
  configDisplay: $('config-display'),
  diceStage:     $('dice-stage'),
  stagePlaceholder: $('stage-placeholder'),
  diceResults:   $('dice-results'),
  summaryInner:  $('summary-inner'),
  summaryTotal:  $('summary-total'),
  summaryDetail: $('summary-detail'),
  btnRoll:       $('btn-roll'),
  btnRollAgain:  $('btn-roll-again'),
  btnExport:     $('btn-export'),
  // History
  historyList:   $('history-list'),
  historyEmpty:  $('history-empty'),
  btnClear:      $('btn-clear'),
  // Toast
  toast:         $('toast'),
};

/* ═══════════════════════════════════════════════════════════════════════════
   SECURE RANDOM
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Returns a cryptographically-random integer in [1, sides].
 * Falls back to Math.random() in environments without crypto.
 * @param {number} sides
 * @returns {number}
 */
function secureRandom(sides) {
  if (window.crypto && window.crypto.getRandomValues) {
    // Use rejection sampling to avoid modulo bias
    const max      = Math.floor(0xFFFFFFFF / sides) * sides;
    const buf      = new Uint32Array(1);
    let   val;
    do {
      window.crypto.getRandomValues(buf);
      val = buf[0];
    } while (val >= max);
    return (val % sides) + 1;
  }
  return Math.floor(Math.random() * sides) + 1;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SOUND ENGINE  (Web Audio API — no external files)
   ═══════════════════════════════════════════════════════════════════════════ */

let audioCtx = null;

/** Lazily creates the AudioContext (respects browser autoplay policy). */
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

/**
 * Plays a short percussive dice-roll sound using oscillators + noise.
 * Completely synthetic — no files needed.
 */
function playRollSound() {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    const t = ctx.currentTime;

    // White noise burst
    const bufLen = ctx.sampleRate * 0.08;
    const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buf;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.22, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 900;
    bandpass.Q.value = 0.8;

    noise.connect(bandpass);
    bandpass.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(t);
    noise.stop(t + 0.14);

    // Low thud
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.12);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.35, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.16);
  } catch (e) {
    // Silently ignore if audio is unavailable
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   UI HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Show a brief toast notification. */
let toastTimer = null;
function showToast(msg) {
  dom.toast.textContent = msg;
  dom.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('visible'), CONFIG.TOAST_MS);
}

/** Update the config label above the stage. */
function updateConfigLabel() {
  dom.configDisplay.textContent = `${state.count} × D${state.sides}`;
}

/** Update the slider's CSS fill percentage. */
function updateSliderFill() {
  const pct = ((state.count - CONFIG.MIN_DICE) / (CONFIG.MAX_DICE - CONFIG.MIN_DICE)) * 100;
  dom.qtySlider.style.setProperty('--pct', `${pct}%`);
}

/** Set the number of dice, clamp to range. */
function setCount(n) {
  state.count = Math.max(CONFIG.MIN_DICE, Math.min(CONFIG.MAX_DICE, n));
  dom.qtyValue.textContent = state.count;
  dom.qtySlider.value      = state.count;
  updateSliderFill();
  updateConfigLabel();
}

/** Highlight the active die button. */
function setActiveDice(sides) {
  state.sides = sides;
  dom.diceBtns.forEach(btn => {
    btn.classList.toggle('active', +btn.dataset.sides === sides);
  });
  updateConfigLabel();
}

/* ═══════════════════════════════════════════════════════════════════════════
   STATISTICS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Recalculates all statistics from state.allValues and history,
 * then updates the DOM.
 */
function updateStats() {
  const vals = state.allValues;

  dom.statTotalRolls.textContent = state.history.length;

  if (vals.length === 0) {
    dom.statAverage.textContent = '—';
    dom.statHighest.textContent = '—';
    dom.statLowest.textContent  = '—';
    dom.statCommon.textContent  = '—';
    return;
  }

  const sum     = vals.reduce((a, b) => a + b, 0);
  const average = (sum / vals.length).toFixed(1);
  const highest = Math.max(...vals);
  const lowest  = Math.min(...vals);

  // Mode (most common)
  const freq = {};
  vals.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
  const maxFreq = Math.max(...Object.values(freq));
  const modes   = Object.keys(freq).filter(k => freq[k] === maxFreq).map(Number);
  const modeStr = modes.length <= 3 ? modes.join(', ') : `${modes.slice(0,3).join(', ')}…`;

  dom.statAverage.textContent = average;
  dom.statHighest.textContent = highest;
  dom.statLowest.textContent  = lowest;
  dom.statCommon.textContent  = modeStr;

  // Animate stat values on update
  [dom.statAverage, dom.statHighest, dom.statLowest, dom.statCommon].forEach(el => {
    el.style.transform = 'scale(1.2)';
    el.style.transition = 'transform 0.25s cubic-bezier(0.34,1.56,0.64,1)';
    setTimeout(() => { el.style.transform = ''; }, 260);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   HISTORY
   ═══════════════════════════════════════════════════════════════════════════ */

/** Formats a Date as HH:MM:SS. */
function fmtTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Adds a roll record to the history panel. */
function addToHistory(record) {
  // Prepend to state
  state.history.unshift(record);
  if (state.history.length > CONFIG.MAX_HISTORY) state.history.pop();

  // Hide empty state
  dom.historyEmpty.style.display = 'none';

  // Build DOM element
  const item = document.createElement('div');
  item.className = 'history-item';

  const diceStr = record.values.slice(0, 8).join(', ') + (record.values.length > 8 ? '…' : '');

  item.innerHTML = `
    <span class="hist-badge">D${record.sides}</span>
    <span class="hist-dice">[${diceStr}]</span>
    <span class="hist-total">${record.total}</span>
    <span class="hist-time" style="grid-column:1/-1">${record.count}d${record.sides} · ${fmtTime(record.date)}</span>
  `;

  // Prepend (newest on top)
  dom.historyList.insertBefore(item, dom.historyList.firstChild);

  // Cap DOM entries to 40 visible
  const items = dom.historyList.querySelectorAll('.history-item');
  if (items.length > 40) items[items.length - 1].remove();
}

/** Clears all history state and DOM. */
function clearHistory() {
  state.history   = [];
  state.allValues = [];
  dom.historyList.querySelectorAll('.history-item').forEach(el => el.remove());
  dom.historyEmpty.style.display = '';
  updateStats();
  showToast('History cleared');
}

/* ═══════════════════════════════════════════════════════════════════════════
   ROLLING
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Main roll function.
 * Generates results, plays animation and sound, updates all UI.
 */
function roll() {
  if (state.isRolling) return;
  state.isRolling = true;

  playRollSound();

  // Generate results immediately (shown after animation)
  const results = Array.from({ length: state.count }, () => secureRandom(state.sides));
  const total   = results.reduce((a, b) => a + b, 0);
  const maxVal  = state.sides;   // theoretical max per die
  const minVal  = 1;             // theoretical min per die

  // Disable buttons during animation
  dom.btnRoll.classList.add('rolling');
  dom.btnRoll.disabled = true;

  // Show rolling placeholders on stage
  showRollingAnimation();

  // After animation, reveal real results
  setTimeout(() => {
    showResults(results, total, maxVal, minVal);
    state.isRolling  = false;
    state.lastResults = results;

    dom.btnRoll.classList.remove('rolling');
    dom.btnRoll.disabled     = false;
    dom.btnRollAgain.disabled = false;

    // Record in history & stats
    const record = { sides: state.sides, count: state.count, values: results, total, date: new Date() };
    addToHistory(record);
    state.allValues.push(...results);
    updateStats();

  }, CONFIG.ROLL_ANIM_MS);
}

/** Shows animated placeholder dice on the stage while rolling. */
function showRollingAnimation() {
  dom.stagePlaceholder.style.display = 'none';
  dom.diceResults.innerHTML = '';

  for (let i = 0; i < state.count; i++) {
    const item = document.createElement('div');
    item.className = 'die-item';

    const face = document.createElement('div');
    face.className = 'die-face rolling';

    const val = document.createElement('span');
    val.className = 'die-value';
    val.textContent = '?';

    face.appendChild(val);

    const label = document.createElement('span');
    label.className = 'die-type-label';
    label.textContent = `D${state.sides}`;

    item.appendChild(face);
    item.appendChild(label);
    dom.diceResults.appendChild(item);

    // Stagger animation start
    face.style.animationDelay = `${i * 30}ms`;
  }
}

/**
 * Reveals final dice values on the stage.
 * @param {number[]} results
 * @param {number}   total
 * @param {number}   maxVal
 * @param {number}   minVal
 */
function showResults(results, total, maxVal, minVal) {
  dom.diceResults.innerHTML = '';

  const maxResult  = Math.max(...results);
  const minResult  = Math.min(...results);

  results.forEach((value, i) => {
    const item = document.createElement('div');
    item.className = 'die-item';

    const face = document.createElement('div');
    face.className = 'die-face';
    if (value === maxVal)    face.classList.add('is-max');
    else if (value === minVal) face.classList.add('is-min');

    // Stagger entrance animations
    face.style.animationDelay = `${i * 55}ms`;

    const val = document.createElement('span');
    val.className = 'die-value';
    val.textContent = value;

    face.appendChild(val);

    const label = document.createElement('span');
    label.className = 'die-type-label';
    label.textContent = `D${state.sides}`;

    item.appendChild(face);
    item.appendChild(label);
    dom.diceResults.appendChild(item);
  });

  // Update summary
  dom.summaryInner.classList.add('has-result');
  dom.summaryTotal.textContent = total;
  dom.summaryTotal.classList.remove('pop');
  // Force reflow to restart animation
  void dom.summaryTotal.offsetWidth;
  dom.summaryTotal.classList.add('pop');

  // Detail line
  if (results.length > 1) {
    dom.summaryDetail.textContent =
      `${results.length} dice · Max: ${maxResult} · Min: ${minResult}`;
  } else {
    dom.summaryDetail.textContent = `D${state.sides} · Single roll`;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXPORT
   ═══════════════════════════════════════════════════════════════════════════ */

/** Downloads roll history as a timestamped JSON file. */
function exportHistory() {
  if (state.history.length === 0) {
    showToast('No rolls to export yet!');
    return;
  }

  const payload = {
    exported: new Date().toISOString(),
    totalRolls: state.history.length,
    rolls: state.history.map(r => ({
      dice:  `${r.count}d${r.sides}`,
      values: r.values,
      total: r.total,
      timestamp: r.date.toISOString(),
    })),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `diceforge-history-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);

  showToast(`Exported ${state.history.length} roll${state.history.length > 1 ? 's' : ''}`);
}

/* ═══════════════════════════════════════════════════════════════════════════
   EVENT LISTENERS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Dice type buttons */
dom.diceBtns.forEach(btn => {
  btn.addEventListener('click', () => setActiveDice(+btn.dataset.sides));
});

/** Quantity controls */
dom.qtyDec.addEventListener('click', () => setCount(state.count - 1));
dom.qtyInc.addEventListener('click', () => setCount(state.count + 1));
dom.qtySlider.addEventListener('input', () => setCount(+dom.qtySlider.value));

/** Preset buttons */
dom.presetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = PRESETS[btn.dataset.preset];
    if (!preset) return;
    setActiveDice(preset.sides);
    setCount(preset.count);
    showToast(`Preset: ${preset.label}`);
  });
});

/** Roll / Roll Again / Clear / Export */
dom.btnRoll.addEventListener('click',      roll);
dom.btnRollAgain.addEventListener('click', roll);
dom.btnClear.addEventListener('click',     clearHistory);
dom.btnExport.addEventListener('click',    exportHistory);

/** Keyboard shortcuts */
document.addEventListener('keydown', e => {
  // Ignore if user is typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  const key = e.key.toLowerCase();

  if (key === ' ' || e.code === 'Space') {
    e.preventDefault();
    roll();
  } else if (key === 'r') {
    roll();
  } else if (key === 'c') {
    clearHistory();
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════════════════════ */

(function init() {
  setCount(1);
  setActiveDice(6);
  updateStats();
  updateConfigLabel();
})();