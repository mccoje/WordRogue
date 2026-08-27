(function () {
  const banner = document.getElementById('errorBanner');
  function showError(msg) {
    banner.textContent += (banner.textContent ? '\n\n' : '') + msg;
    banner.classList.remove('hidden');
  }
  window.addEventListener('error', (e) => {
    showError(`${e.message}\n  at ${e.filename}:${e.lineno}:${e.colno}\n${e.error && e.error.stack ? e.error.stack : ''}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    showError(`Unhandled promise rejection: ${e.reason}`);
  });
})();

const VOWELS = new Set(['a','e','i','o','u']);

const BLOCKED_WORDS = new Set(['hae']);

// Game mode's "key phrase" mini-goal: a random one of these is shown above
// the rack as blank word-tiles, and fills in (word by word, in order) as
// the player casts spells or banks real words that match.
const KEY_PHRASES = [
  "Don't forget your sword",
  'Never adventure hungry',
  'Watch your step here',
  'Trust no goblin merchant',
  'Sharpen blades before battle',
  'Gold cannot buy courage',
  'Dragons hoard shiny things',
  'Always carry a torch',
  'Beware the silent forest',
  'Potions expire when opened',
  'Every hero needs rest',
  'Old maps hide secrets',
  'Wolves hunt in packs',
  'Magic has a price',
  'Trust your rusty compass',
  'Fear the sleeping dragon',
  'Count your arrows twice',
  'Every quest starts small',
  'Brave hearts win battles',
  'Keep your friends close',
  'The dungeon remembers everything',
  'Never trust a locked chest',
];

const WORDS = WORD_DATA.words
  .map(w => ({
    full: w.f.trim().toLowerCase(),
    cons: w.c.trim().toLowerCase(),
    consVowel: w.v.trim().toLowerCase(),
  }))
  .filter(w => !BLOCKED_WORDS.has(w.full));

// Derives the same three forms the source spreadsheet uses: the full word,
// consonants only, and the first vowel (if the word starts with one) plus
// all consonants.
function deriveForms(rawWord) {
  const full = rawWord.trim().toLowerCase();
  let cons = '';
  for (const ch of full) { if (/[a-z]/.test(ch) && !VOWELS.has(ch)) cons += ch; }
  const consVowel = (VOWELS.has(full[0]) ? full[0] : '') + cons;
  return { full, cons, consVowel };
}

const CUSTOM_WORDS_KEY = 'wordRoguelike.customWords';

function loadCustomWords() {
  try {
    const raw = localStorage.getItem(CUSTOM_WORDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCustomWords(list) {
  try { localStorage.setItem(CUSTOM_WORDS_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

function addWordToRuntime(w) {
  if (!BLOCKED_WORDS.has(w) && !WORDS.some(existing => existing.full === w)) {
    WORDS.push(deriveForms(w));
  }
}

for (const w of loadCustomWords()) addWordToRuntime(w);

// The server also keeps a permanent copy on disk (custom_words.json), so
// words survive even if this browser's local storage is ever cleared.
fetch('/custom_words.json')
  .then(r => (r.ok ? r.json() : []))
  .then(list => { for (const w of list) addWordToRuntime(String(w).toLowerCase()); })
  .catch(() => { /* served over file:// or offline - localStorage copy still applies */ });

function persistWordToServer(word) {
  fetch('/api/words', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word }),
  }).catch(() => { /* no server reachable - localStorage copy still applies */ });
}

// Adds a new legal word at runtime, storing all three forms and persisting
// it both in this browser (localStorage) and permanently on the server, so
// it survives a page reload, a cleared browser, or a different browser.
function addWord(rawWord) {
  const full = rawWord.trim().toLowerCase();
  if (!full) return { ok: false, msg: 'Type a word first.' };
  if (!/^[a-z]+$/.test(full)) return { ok: false, msg: 'Letters only, please.' };
  if (BLOCKED_WORDS.has(full)) return { ok: false, msg: `"${full}" isn't allowed.` };
  if (WORDS.some(w => w.full === full)) return { ok: false, msg: `"${full}" is already in the list.` };

  const forms = deriveForms(full);
  WORDS.push(forms);
  const custom = loadCustomWords();
  custom.push(full);
  saveCustomWords(custom);
  persistWordToServer(full);
  return { ok: true, msg: `Added "${full.toUpperCase()}" → ${forms.cons.toUpperCase()} / ${forms.consVowel.toUpperCase()}` };
}

// A large plain-English word list (not the curated verb list above), used
// only for the "real word but not a legal spell" bonus-banking feature in
// Game mode. Fetched from the local static file (dictionary.txt, derived
// once from a public word list) rather than embedded, since it's ~350k
// words - too big to belong in data.js.
let DICTIONARY = new Set();
fetch('/dictionary.txt')
  .then(r => (r.ok ? r.text() : ''))
  .then(text => { DICTIONARY = new Set(text.split('\n').map(w => w.trim()).filter(Boolean)); })
  .catch(() => { /* served over file:// or offline - dictionary banking just won't find anything */ });

const CANTRIPS_KEY = 'wordRoguelike.cantrips';
function loadCantrips() {
  try {
    const raw = localStorage.getItem(CANTRIPS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length === 10) return parsed;
  } catch { /* fall through to default */ }
  return new Array(10).fill(null);
}
function saveCantrips() {
  try { localStorage.setItem(CANTRIPS_KEY, JSON.stringify(state.cantrips)); } catch { /* storage unavailable */ }
}

const BIGRAMS = {
  full: WORD_DATA.bigrams.full.map(b => ({ bg: b.bg.trim().toLowerCase(), n: b.n })).filter(b => b.bg.length === 2),
  cons: WORD_DATA.bigrams.cons.map(b => ({ bg: b.bg.trim().toLowerCase(), n: b.n })).filter(b => b.bg.length === 2),
  consVowel: WORD_DATA.bigrams.consVowel.map(b => ({ bg: b.bg.trim().toLowerCase(), n: b.n })).filter(b => b.bg.length === 2),
};

function fieldForMode(word, mode) { return word[mode]; }

function computeLetterFreq(mode) {
  const consFreq = new Map();
  const vowelFreq = new Map();
  for (const w of WORDS) {
    const s = fieldForMode(w, mode);
    for (const ch of s) {
      if (VOWELS.has(ch)) vowelFreq.set(ch, (vowelFreq.get(ch) || 0) + 1);
      else if (/[a-z]/.test(ch)) consFreq.set(ch, (consFreq.get(ch) || 0) + 1);
    }
  }
  return { consFreq, vowelFreq };
}

const LETTER_FREQ = { full: computeLetterFreq('full'), cons: computeLetterFreq('cons'), consVowel: computeLetterFreq('consVowel') };

function computeBigramCoverage(mode) {
  const cov = new Map();
  for (const b of BIGRAMS[mode]) {
    for (const ch of b.bg) cov.set(ch, (cov.get(ch) || 0) + b.n);
  }
  return cov;
}
const BIGRAM_COVERAGE = { full: computeBigramCoverage('full'), cons: computeBigramCoverage('cons'), consVowel: computeBigramCoverage('consVowel') };

function weightedPick(entries, weightFn) {
  let total = 0;
  const cum = [];
  for (const e of entries) { total += Math.max(weightFn(e), 0.0001); cum.push(total); }
  const r = Math.random() * total;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
  return entries[lo];
}

const state = {
  pieceType: 'dice',
  mode: 'full',
  freqMode: 'weighted',
  bigramMix: 40,
  vowelWildPct: 10,
  consonantWildPct: 10,
  pieceCount: 6,
  pieceScale: 1.65,
  dominoView: 'isometric',
  closeEnough: true,
  pool: [],
  rack: [],
  gotten: [],

  // Game mode
  appMode: 'sandbox', // 'sandbox' | 'game'
  stoneDensity: 35,
  stones: [],
  goblin: { hp: 50, maxHp: 50, attackIntervalSec: 24 },
  player: { hp: 100, maxHp: 100 },
  basicDmgMin: 1,
  basicDmgMax: 4,
  cantrips: new Array(10).fill(null),
  keyPhrase: null, // { words: [raw...], norm: [normalized...], filled: [bool...] }
};

let pieceIdCounter = 1;

function pickBigram() {
  const pool = BIGRAMS[state.mode];
  if (!pool.length) return null;
  if (state.freqMode === 'uniform') return pool[Math.floor(Math.random() * pool.length)];
  return weightedPick(pool, b => b.n);
}

function pickSingle() {
  const { consFreq, vowelFreq } = LETTER_FREQ[state.mode];
  const consEntries = [...consFreq.entries()];
  const vowelEntries = [...vowelFreq.entries()];
  const consMass = consEntries.reduce((a, [, n]) => a + n, 0);
  const vowelMass = vowelEntries.reduce((a, [, n]) => a + n, 0);

  let useVowel = vowelMass > 0 && Math.random() < vowelMass / (consMass + vowelMass);
  let entries = useVowel ? vowelEntries : consEntries;
  if (!entries.length) { useVowel = !useVowel; entries = useVowel ? vowelEntries : consEntries; }
  if (!entries.length) return { text: 'x', vowel: false };

  let letter;
  if (state.freqMode === 'uniform') {
    letter = entries[Math.floor(Math.random() * entries.length)][0];
  } else if (state.freqMode === 'biased') {
    const cov = BIGRAM_COVERAGE[state.mode];
    letter = weightedPick(entries, ([ch, n]) => n / (1 + (cov.get(ch) || 0)))[0];
  } else {
    letter = weightedPick(entries, ([, n]) => n)[0];
  }
  const wildPct = useVowel ? state.vowelWildPct : state.consonantWildPct;
  const wild = Math.random() * 100 < wildPct;
  return { text: letter, vowel: useVowel, wild };
}

function makeSymbol() {
  const wantBigram = Math.random() * 100 < state.bigramMix && BIGRAMS[state.mode].length > 0;
  if (wantBigram) {
    const b = pickBigram();
    if (b) return { type: 'bigram', text: b.bg, wild: false };
  }
  const s = pickSingle();
  return { type: s.vowel ? 'vowel' : 'consonant', text: s.text, wild: s.wild };
}

const FACES_PER_TYPE = { dice: 6, domino: 4, tile: 2 };

function generatePool() {
  state.pool = [];
  const faces = FACES_PER_TYPE[state.pieceType];
  for (let i = 0; i < state.pieceCount; i++) {
    const symbols = Array.from({ length: faces }, makeSymbol);
    const piece = { id: pieceIdCounter++, type: state.pieceType, symbols };
    if (state.pieceType === 'dice') {
      piece.rx = [0, 90, 180, 270][Math.floor(Math.random() * 4)];
      piece.ry = [0, 90, 180, 270][Math.floor(Math.random() * 4)];
      piece.rz = [0, 90, 180, 270][Math.floor(Math.random() * 4)];
    } else if (state.pieceType === 'tile') {
      piece.side = 0;
    }
    state.pool.push(piece);
  }
}

function dieTransform(piece) {
  return `rotateX(-30deg) rotateY(-45deg) rotateX(${piece.rx}deg) rotateY(${piece.ry}deg) rotateZ(${piece.rz}deg)`;
}

// ---- active symbol per piece ----

function activeSymbolsOf(piece) {
  if (piece.type === 'diceFace' || piece.type === 'stone') {
    return [piece.symbol];
  }
  if (piece.type === 'tile') {
    return [piece.symbols[piece.side]];
  }
  if (piece.type === 'domino') {
    const face = piece.face || 0;
    const a = piece.symbols[face * 2];
    const b = piece.symbols[face * 2 + 1];
    switch (piece.useMode) {
      case 1: return [b];
      case 2: return [a, b];
      case 3: return [b, a];
      default: return [a];
    }
  }
  return [];
}

// ---- rendering: pool ----

const poolEl = document.getElementById('pool');
const rackEl = document.getElementById('rack');

function symbolClass(sym) {
  if (sym.type === 'bigram') return 'bigram';
  if (sym.type === 'vowel') return 'vowel';
  return 'consonant';
}

// Z and N can look alike at a glance on a die/tile, especially at odd
// rotations - display Z with a stroke through it ("Ƶ", U+01B5) to tell them
// apart. Display-only: the underlying sym.text/matching logic still uses a
// plain "z" throughout, this just swaps what gets shown.
function displayGlyph(text) {
  return text.toUpperCase().replace(/Z/g, 'Ƶ');
}

// Plain uppercase text for the symbol (used for drag-image clones etc).
function symbolText(sym) {
  if (sym.wild) return sym.type === 'vowel' ? 'V' : 'C';
  return displayGlyph(sym.text);
}

// HTML for the symbol's glyph: wild singles get their letter wrapped so only
// the glyph's color animates, not the whole tile/face background.
function symbolGlyphHTML(sym) {
  if (sym.wild) return `<span class="wild-text">${sym.type === 'vowel' ? 'V' : 'C'}</span>`;
  return displayGlyph(sym.text);
}

// Layout (screen position/rotation) is computed once per piece and cached on
// the piece object, so re-rendering the pool (e.g. after returning a piece)
// never disturbs pieces that are already placed.

function clearPoolLayouts() {
  state.pool.forEach(p => { delete p.layout; delete p.layoutIso; delete p.layoutTop; });
}

function computeTileLayout(zoneW, zoneH) {
  const size = 58 * state.pieceScale;
  const margin = 40;
  return {
    x: margin + Math.random() * Math.max(zoneW - margin * 2 - size, 10),
    y: margin + Math.random() * Math.max(zoneH - margin * 2 - size, 10),
    rot: (Math.random() * 50 - 25).toFixed(1),
    z: Math.floor(Math.random() * 20),
  };
}

function computeDiceLayout(zoneW, zoneH) {
  const size = 64 * state.pieceScale;
  const margin = 50;
  return {
    x: margin + Math.random() * Math.max(zoneW - margin * 2 - size, 10),
    y: margin + Math.random() * Math.max(zoneH - margin * 2 - size, 10),
    z: Math.floor(Math.random() * 20),
  };
}

// Splits pieces into 3-5 layers whose sizes generally shrink from base to
// top, but with enough noise that it isn't a perfectly smooth taper.
function splitIntoIrregularLayers(pieces) {
  const total = pieces.length;
  const numLayers = Math.min(total, 3 + Math.floor(Math.random() * 3));
  const weights = [];
  for (let i = 0; i < numLayers; i++) {
    weights.push(Math.max(0.25, (numLayers - i) + (Math.random() * 1.6 - 0.8)));
  }
  const wSum = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map(w => Math.max(1, Math.round((w / wSum) * total)));

  let drift = total - counts.reduce((a, b) => a + b, 0);
  let gi = 0;
  while (drift !== 0) {
    const idx = gi % numLayers;
    if (drift > 0) { counts[idx]++; drift--; }
    else if (counts[idx] > 1) { counts[idx]--; drift++; }
    gi++;
  }

  const remainingPieces = pieces.slice();
  const layers = counts.map(c => remainingPieces.splice(0, Math.min(c, remainingPieces.length)));
  if (remainingPieces.length) layers[0].push(...remainingPieces);
  return layers;
}

// Each layer is treated as an elliptical footprint (wide left-right, shallow
// front-to-back) that shrinks going up, like a long low mound rather than a
// symmetric pyramid. Every piece gets a random point inside its layer's
// ellipse - that (x, depth) position drives BOTH projections:
//
//  - layoutTop (bird's-eye): the footprint is drawn as-is, layer centered on
//    the same point, so a wider/deeper lower layer's ellipse shows all the
//    way around the smaller layer nested on top of it, on every side.
//
//  - layoutIso (hillside view): screen Y is pushed up per layer (taller =
//    higher) and nudged further by depth (pieces toward the "front" sit
//    lower on screen, pieces toward the "back" sit higher) - and z-index
//    follows that same front/back order within a layer, on top of layer
//    order. So a piece near the back of a low layer ends up both visually
//    behind AND underneath pieces from the layer above it: it reads as the
//    far side of the hill, hidden by the hill's own bulk - exactly like the
//    top-down view says it should be.
function computeDominoTowerLayout(pieces, zoneW, zoneH) {
  const dW = 100 * state.pieceScale, dH = 50 * state.pieceScale;
  const layers = splitIntoIrregularLayers(pieces);

  const cx = zoneW / 2;
  const cyTop = zoneH * 0.42;
  const baseY = Math.min(zoneH * 0.58, zoneH - dH * 1.8);
  const layerHeight = 30 * state.pieceScale;

  let rx = Math.min(zoneW * 0.42, Math.max(dW * 1.3, dW * 0.6 * Math.sqrt(pieces.length)));
  let ry = rx * 0.32; // elongated left-right: shallow front-to-back

  layers.forEach((layer, layerIdx) => {
    if (layerIdx > 0) {
      const shrink = 0.55 + Math.random() * 0.22; // irregular taper, not a smooth curve
      rx *= shrink;
      ry *= shrink;
    }
    const depthTilt = ry * 0.85;

    layer.forEach(piece => {
      // Random point inside the layer's ellipse, biased toward the center
      // so the pile reads as one cohesive mound rather than scattered
      // outliers near the rim.
      const ang = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 1.7);
      const fx = Math.cos(ang) * r;       // -1 (left) .. 1 (right)
      const fd = Math.sin(ang) * r;       // -1 (back)  .. 1 (front)

      const worldX = fx * rx;
      const rot = (Math.random() < 0.5 ? 0 : 90) + (Math.random() * 6 - 3);
      const depthRank = Math.round((fd + 1) * 400); // 0..800, front-most highest

      piece.layoutTop = {
        x: cx + worldX - dW / 2,
        y: cyTop + fd * ry - dH / 2,
        rot, scale: 1,
        z: 10 + layerIdx * 10,
        shadow: '0 2px 5px rgba(0,0,0,0.5)',
      };
      piece.layoutIso = {
        x: cx + worldX - dW / 2,
        y: baseY - layerIdx * layerHeight + fd * depthTilt - dH / 2,
        rot, scale: 1,
        z: layerIdx * 1000 + depthRank,
        shadow: `0 ${3 + layerIdx}px ${6 + layerIdx * 2}px rgba(0,0,0,0.5)`,
      };
    });
  });
}

function renderPool() {
  poolEl.innerHTML = '';
  const zoneW = poolEl.clientWidth || 900;
  const zoneH = poolEl.clientHeight || 500;

  if (state.pieceType === 'tile') {
    for (const piece of state.pool) {
      if (!piece.layout) piece.layout = computeTileLayout(zoneW, zoneH);
      renderOneTile(piece);
    }
  } else if (state.pieceType === 'domino') {
    if (state.pool.some(p => !p.layoutIso)) computeDominoTowerLayout(state.pool, zoneW, zoneH);
    for (const piece of state.pool) renderOneDomino(piece);
  } else {
    for (const piece of state.pool) {
      if (!piece.layout) piece.layout = computeDiceLayout(zoneW, zoneH);
      renderOneDie(piece);
    }
  }
}

function bgFor(sym) {
  if (sym.type === 'bigram') return 'linear-gradient(160deg, var(--bigram-face), var(--bigram))';
  if (sym.type === 'vowel') return 'linear-gradient(160deg, var(--vowel-face), var(--vowel))';
  return 'linear-gradient(160deg, var(--consonant-face), var(--consonant))';
}

function renderOneTile(piece) {
  const el = document.createElement('div');
  el.className = 'pool-piece';
  const { x, y, rot, z } = piece.layout;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.transform = `rotate(${rot}deg)`;
  el.style.zIndex = z;
  const sym = piece.symbols[piece.side];
  el.innerHTML = `<div class="tile-piece ${symbolClass(sym)}" style="background:${bgFor(sym)}">${symbolGlyphHTML(sym)}</div>`;
  el.dataset.pieceId = piece.id;
  el.addEventListener('click', () => selectPiece(piece.id, el));
  poolEl.appendChild(el);
}

function renderOneDomino(piece) {
  const el = document.createElement('div');
  el.className = 'pool-piece';
  const { x, y, rot, scale, z, shadow } = state.dominoView === 'topdown' ? piece.layoutTop : piece.layoutIso;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.transformOrigin = '50% 50%';
  el.style.transform = `rotate(${rot}deg) scale(${scale})`;
  el.style.zIndex = z;
  const dominoPiece = document.createElement('div');
  dominoPiece.className = 'domino-piece';
  dominoPiece.style.boxShadow = shadow;
  const face = piece.face || 0;
  [0, 1].forEach(endIdx => {
    const sym = piece.symbols[face * 2 + endIdx];
    const half = document.createElement('div');
    half.className = `domino-half ${symbolClass(sym)}`;
    half.style.background = bgFor(sym);
    half.innerHTML = symbolGlyphHTML(sym);
    half.addEventListener('click', (e) => {
      e.stopPropagation();
      piece.face = face;
      piece.useMode = endIdx;
      selectPiece(piece.id, el);
    });
    dominoPiece.appendChild(half);
  });
  el.appendChild(dominoPiece);
  el.dataset.pieceId = piece.id;
  poolEl.appendChild(el);
}

function renderOneDie(piece) {
  const el = document.createElement('div');
  el.className = 'pool-piece';
  const { x, y, z } = piece.layout;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.zIndex = z;

  const outer = document.createElement('div');
  outer.className = 'die-outer';
  const rotator = document.createElement('div');
  rotator.className = 'die-rotator';
  // Only play the tumble-in animation the first time this die is ever
  // rendered (its actual throw). Later re-renders - e.g. refreshing the
  // claimed-face styling after picking a face - just show it at rest.
  const freshThrow = !piece.settled;
  rotator.style.transform = freshThrow
    ? 'rotateX(-30deg) rotateY(-45deg) rotateX(720deg) rotateY(720deg)'
    : dieTransform(piece);
  piece.settled = true;

  const order = ['right', 'left', 'top', 'bottom', 'front', 'back'];
  order.forEach((name, idx) => {
    const f = document.createElement('div');
    const sym = piece.symbols[idx];
    const claimed = piece.claimedFaces && piece.claimedFaces.has(idx);
    f.className = `die-face die-face-${name} ${symbolClass(sym)}${claimed ? ' claimed' : ''}`;
    f.innerHTML = symbolGlyphHTML(sym);
    f.style.background = bgFor(sym);
    if (!claimed) {
      f.addEventListener('click', (e) => {
        e.stopPropagation();
        selectDieFace(piece, idx, el);
      });
    }
    rotator.appendChild(f);
  });
  outer.appendChild(rotator);
  el.appendChild(outer);
  el.dataset.pieceId = piece.id;
  poolEl.appendChild(el);

  if (freshThrow) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        rotator.style.transform = dieTransform(piece);
      });
    });
  }
}

// ---- cobblestone ground (Game mode) ----

const groundEl = document.getElementById('groundLayer');
const STONE_COUNT = 28;

function generateStones() {
  state.stones = [];
  for (let i = 0; i < STONE_COUNT; i++) {
    const hasSymbol = Math.random() * 100 < state.stoneDensity;
    state.stones.push({
      id: pieceIdCounter++,
      hasSymbol,
      symbol: hasSymbol ? makeSymbol() : null,
      claimed: false,
    });
  }
}

function renderGround() {
  groundEl.innerHTML = '';
  for (const stone of state.stones) {
    const el = document.createElement('div');
    el.className = 'stone';
    el.dataset.stoneId = stone.id;
    if (stone.hasSymbol && !stone.claimed) {
      const sym = stone.symbol;
      el.classList.add('has-symbol', symbolClass(sym));
      el.innerHTML = symbolGlyphHTML(sym);
      el.addEventListener('click', () => selectStone(stone.id, el));
    }
    groundEl.appendChild(el);
  }
}

// A claimed stone goes dark (its symbol leaves the ground) but isn't
// permanently gone until the word it's part of is actually banked - if the
// piece is returned from the rack instead, the stone's symbol reappears.
function selectStone(stoneId, stoneEl) {
  const stone = state.stones.find(s => s.id === stoneId);
  if (!stone || stone.claimed || !stone.hasSymbol) return;
  stone.claimed = true;

  const entry = { id: pieceIdCounter++, type: 'stone', stoneId: stone.id, symbol: stone.symbol };

  const startRect = stoneEl.getBoundingClientRect();
  const clone = stoneEl.cloneNode(true);
  clone.classList.add('swoop-clone');
  clone.style.left = startRect.left + 'px';
  clone.style.top = startRect.top + 'px';
  clone.style.width = startRect.width + 'px';
  clone.style.height = startRect.height + 'px';
  clone.style.transform = 'scale(1) rotate(0deg)';
  clone.style.opacity = '1';
  document.body.appendChild(clone);

  state.rack.push(entry);
  renderRack();
  renderGround();

  const targetSlot = rackEl.querySelector(`[data-piece-id="${entry.id}"]`);
  const cleanup = () => {
    clone.remove();
    if (targetSlot) targetSlot.style.visibility = 'visible';
  };
  if (!targetSlot) { cleanup(); evaluateMatch(); return; }
  targetSlot.style.visibility = 'hidden';
  const endRect = targetSlot.getBoundingClientRect();

  requestAnimationFrame(() => {
    const dx = endRect.left - startRect.left + (endRect.width - startRect.width) / 2;
    const dy = endRect.top - startRect.top + (endRect.height - startRect.height) / 2;
    clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.9) rotate(360deg)`;
    clone.style.opacity = '0.85';
  });
  clone.addEventListener('transitionend', cleanup, { once: true });
  setTimeout(cleanup, 700);

  evaluateMatch();
}

// ---- selection / swoop ----

function selectPiece(pieceId, poolElNode) {
  const idx = state.pool.findIndex(p => p.id === pieceId);
  if (idx === -1) return;
  const piece = state.pool[idx];
  state.pool.splice(idx, 1);

  const startRect = poolElNode.getBoundingClientRect();
  const clone = poolElNode.cloneNode(true);
  clone.classList.add('swoop-clone');
  clone.style.left = startRect.left + 'px';
  clone.style.top = startRect.top + 'px';
  clone.style.width = startRect.width + 'px';
  clone.style.height = startRect.height + 'px';
  clone.style.transform = 'scale(1) rotate(0deg)';
  clone.style.opacity = '1';
  document.body.appendChild(clone);
  poolElNode.remove();

  state.rack.push(piece);
  renderRack();

  const targetSlot = rackEl.querySelector(`[data-piece-id="${piece.id}"]`);
  const clonesRemoveAndShow = () => {
    clone.remove();
    if (targetSlot) targetSlot.style.visibility = 'visible';
  };

  if (!targetSlot) { clonesRemoveAndShow(); evaluateMatch(); return; }
  targetSlot.style.visibility = 'hidden';
  const endRect = targetSlot.getBoundingClientRect();

  requestAnimationFrame(() => {
    const dx = endRect.left - startRect.left + (endRect.width - startRect.width) / 2;
    const dy = endRect.top - startRect.top + (endRect.height - startRect.height) / 2;
    clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.9) rotate(360deg)`;
    clone.style.opacity = '0.85';
  });
  clone.addEventListener('transitionend', clonesRemoveAndShow, { once: true });
  setTimeout(clonesRemoveAndShow, 700);

  evaluateMatch();
}

// A die stays on the table when one of its faces is picked - only that face
// is claimed and swooped up as its own rack entry, so the same die can seed
// several rack letters (from whichever faces are currently showing).
function selectDieFace(die, faceIndex, dieOuterEl) {
  if (!die.claimedFaces) die.claimedFaces = new Set();
  if (die.claimedFaces.has(faceIndex)) return;
  die.claimedFaces.add(faceIndex);

  const entry = { id: pieceIdCounter++, type: 'diceFace', dieId: die.id, faceIndex, symbol: die.symbols[faceIndex] };

  const startRect = dieOuterEl.getBoundingClientRect();
  const clone = dieOuterEl.cloneNode(true);
  clone.classList.add('swoop-clone');
  clone.style.left = startRect.left + 'px';
  clone.style.top = startRect.top + 'px';
  clone.style.width = startRect.width + 'px';
  clone.style.height = startRect.height + 'px';
  clone.style.transform = 'scale(1) rotate(0deg)';
  clone.style.opacity = '1';
  document.body.appendChild(clone);

  state.rack.push(entry);
  renderRack();
  renderPool(); // reflects the claimed face on the die, which stays put

  const targetSlot = rackEl.querySelector(`[data-piece-id="${entry.id}"]`);
  const cleanup = () => {
    clone.remove();
    if (targetSlot) targetSlot.style.visibility = 'visible';
  };

  if (!targetSlot) { cleanup(); evaluateMatch(); return; }
  targetSlot.style.visibility = 'hidden';
  const endRect = targetSlot.getBoundingClientRect();

  requestAnimationFrame(() => {
    const dx = endRect.left - startRect.left + (endRect.width - startRect.width) / 2;
    const dy = endRect.top - startRect.top + (endRect.height - startRect.height) / 2;
    clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.9) rotate(360deg)`;
    clone.style.opacity = '0.85';
  });
  clone.addEventListener('transitionend', cleanup, { once: true });
  setTimeout(cleanup, 700);

  evaluateMatch();
}

function returnPieceToPool(pieceId) {
  const idx = state.rack.findIndex(p => p.id === pieceId);
  if (idx === -1) return;
  const [piece] = state.rack.splice(idx, 1);
  if (piece.type === 'diceFace') {
    const die = state.pool.find(p => p.id === piece.dieId);
    if (die && die.claimedFaces) die.claimedFaces.delete(piece.faceIndex);
  } else if (piece.type === 'stone') {
    const stone = state.stones.find(s => s.id === piece.stoneId);
    if (stone) stone.claimed = false;
  } else {
    state.pool.push(piece);
  }
  renderRack();
  renderPool();
  renderGround();
  evaluateMatch();
}

// ---- rack rendering ----

let dragState = null;

function renderRack() {
  rackEl.innerHTML = '';
  if (!state.rack.length) {
    const hint = document.createElement('div');
    hint.className = 'rack-empty-hint';
    hint.textContent = 'Rack is empty — select pieces from the table below.';
    rackEl.appendChild(hint);
    return;
  }

  state.rack.forEach((piece, index) => {
    const unit = document.createElement('div');
    unit.className = 'rack-unit';
    unit.dataset.pieceId = piece.id;
    unit.dataset.index = index;
    unit.draggable = false;

    const syms = activeSymbolsOf(piece);
    syms.forEach(sym => {
      const slot = document.createElement('div');
      slot.className = `rack-slot ${symbolClass(sym)}`;
      slot.innerHTML = symbolGlyphHTML(sym);
      unit.appendChild(slot);
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Return to table';
    removeBtn.addEventListener('click', (e) => { e.stopPropagation(); returnPieceToPool(piece.id); });
    unit.appendChild(removeBtn);

    const controls = document.createElement('div');
    controls.className = 'rack-controls';
    if (piece.type === 'tile') {
      const b = document.createElement('button');
      b.textContent = '⇅ flip';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        piece.side = piece.side === 0 ? 1 : 0;
        renderRack();
        evaluateMatch();
      });
      controls.appendChild(b);
    } else if (piece.type === 'domino') {
      const flipBtn = document.createElement('button');
      flipBtn.textContent = '⇅ face';
      flipBtn.title = 'Flip to this domino\'s other face';
      flipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        piece.face = piece.face ? 0 : 1;
        renderRack();
        evaluateMatch();
      });
      const turnBtn = document.createElement('button');
      const turnLabels = ['A only', 'B only', 'A+B', 'B+A'];
      turnBtn.textContent = `⟲ ${turnLabels[piece.useMode || 0]}`;
      turnBtn.title = 'Turn the domino: use one end, the other, or both in either order';
      turnBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        piece.useMode = ((piece.useMode || 0) + 1) % 4;
        renderRack();
        evaluateMatch();
      });
      controls.appendChild(flipBtn);
      controls.appendChild(turnBtn);
    }

    syms.forEach(sym => {
      if (sym.type !== 'bigram') return;
      const swapBtn = document.createElement('button');
      swapBtn.textContent = '⇄ swap';
      swapBtn.title = 'Swap this bigram\'s two letters';
      swapBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sym.text = sym.text[1] + sym.text[0];
        renderRack();
        evaluateMatch();
      });
      controls.appendChild(swapBtn);
    });

    unit.appendChild(controls);

    unit.addEventListener('pointerdown', (e) => startDrag(e, unit, index));

    rackEl.appendChild(unit);
  });
}

function startDrag(e, unit, index) {
  if (e.target.closest('button')) return;
  e.preventDefault();
  dragState = { index, startX: e.clientX, unit };
  unit.classList.add('dragging');
  unit.setPointerCapture(e.pointerId);

  const onMove = (ev) => {
    const els = [...rackEl.querySelectorAll('.rack-unit')];
    const overEl = els.find(el => {
      const r = el.getBoundingClientRect();
      return ev.clientX >= r.left && ev.clientX <= r.right;
    });
    if (overEl && overEl !== unit) {
      const overIndex = Number(overEl.dataset.index);
      const curIndex = state.rack.findIndex(p => String(p.id) === unit.dataset.pieceId);
      const [moved] = state.rack.splice(curIndex, 1);
      state.rack.splice(overIndex, 0, moved);
      renderRack();
      const newUnit = rackEl.querySelector(`[data-piece-id="${unit.dataset.pieceId}"]`);
      if (newUnit) { newUnit.classList.add('dragging'); dragState.unit = newUnit; }
    }
  };
  const onUp = () => {
    dragState?.unit.classList.remove('dragging');
    dragState = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    evaluateMatch();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// ---- word matching ----

// Returns the flat letter sequence for the current rack, plus a parallel
// array recording which piece each letter came from (so a matched word's
// pieces can later be identified and removed from the board).
function buildCandidateWithSource() {
  const chars = [];
  const pieceIds = [];
  for (const piece of state.rack) {
    for (const sym of activeSymbolsOf(piece)) {
      if (sym.wild) {
        chars.push({ ch: sym.text, wildKind: sym.type });
        pieceIds.push(piece.id);
      } else {
        for (const ch of sym.text) { chars.push({ ch, wildKind: null }); pieceIds.push(piece.id); }
      }
    }
  }
  return { chars, pieceIds };
}

function buildCandidate() {
  return buildCandidateWithSource().chars;
}

function charMatches(candidateChar, targetChar) {
  if (candidateChar.wildKind === 'vowel') return VOWELS.has(targetChar);
  if (candidateChar.wildKind === 'consonant') return /[a-z]/.test(targetChar) && !VOWELS.has(targetChar);
  return candidateChar.ch === targetChar;
}

function isVowelCandidateChar(c) {
  return c.wildKind === 'vowel' || (!c.wildKind && VOWELS.has(c.ch));
}

// Cost to skip (ignore) one candidate letter. Normally 1 everywhere except
// the very edges of the match. But in the Consonants / Vowel+Cons modes the
// target string was built by stripping internal vowels in the first place -
// so an extra vowel anywhere in the candidate (not just at the edges) is
// always meaningless filler there, and skipping it is free.
function skipCandidateCost(c) {
  if (state.mode !== 'full' && isVowelCandidateChar(c)) return 0;
  return 1;
}

// Minimum number of edits (substitution, or skipping a letter on either
// side) needed to line the target word up against some contiguous run of
// the candidate. Leading/trailing candidate letters are free to ignore (so
// unrelated pieces before/after the word don't count against you), but a
// letter stuck in the *middle* of the word still costs an edit - so an
// unrelated piece wedged between two pieces that do belong can't be skipped
// for free (except a stray vowel in Consonants/Vowel+Cons mode - see
// `skipCandidateCost`). 0 = exact, 1 = one letter off.
function deficit(candidateChars, targetStr) {
  const n = candidateChars.length, m = targetStr.length;
  let prev = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  let best = prev[m];
  for (let i = 1; i <= n; i++) {
    const cur = new Array(m + 1);
    cur[0] = 0; // free to (re)start the match at this candidate position
    const c = candidateChars[i - 1];
    const skipCost = skipCandidateCost(c);
    for (let j = 1; j <= m; j++) {
      const subCost = charMatches(c, targetStr[j - 1]) ? 0 : 1;
      cur[j] = Math.min(
        prev[j - 1] + subCost, // match or substitute
        prev[j] + skipCost,    // skip a candidate letter
        cur[j - 1] + 1          // skip a target letter (candidate is missing it)
      );
    }
    prev = cur;
    if (prev[m] < best) best = prev[m];
  }
  return best;
}

// Same alignment as `deficit`, but keeps the full table and backtracks to
// find exactly which candidate letters (start..end) the match used - so the
// pieces that spelled the word can be told apart from unused extras.
function alignMatchRange(candidateChars, targetStr) {
  const n = candidateChars.length, m = targetStr.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    dp[i][0] = 0;
    const c = candidateChars[i - 1];
    const skipCost = skipCandidateCost(c);
    for (let j = 1; j <= m; j++) {
      const subCost = charMatches(c, targetStr[j - 1]) ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j - 1] + subCost, dp[i - 1][j] + skipCost, dp[i][j - 1] + 1);
    }
  }
  let endIdx = 0, best = dp[0][m];
  for (let i = 1; i <= n; i++) { if (dp[i][m] < best) { best = dp[i][m]; endIdx = i; } }

  let i = endIdx, j = m;
  while (j > 0 && i > 0) {
    const subCost = charMatches(candidateChars[i - 1], targetStr[j - 1]) ? 0 : 1;
    if (dp[i][j] === dp[i - 1][j - 1] + subCost) { i--; j--; }
    else if (dp[i][j] === dp[i - 1][j] + skipCandidateCost(candidateChars[i - 1])) { i--; }
    else { j--; }
  }
  return { startIdx: i, endIdx, cost: best };
}

const rackStatusEl = document.getElementById('rackStatus');
const matchChoicesEl = document.getElementById('matchChoices');
const closeWordsReelEl = document.getElementById('closeWordsReel');
const closeWordsReelListEl = document.getElementById('closeWordsReelList');
const gottenListEl = document.getElementById('gottenList');
const gottenCountEl = document.getElementById('gottenCount');

function celebrate(word, type) {
  const banner = document.createElement('div');
  banner.className = `celebrate-banner ${type}`;
  const subText = type === 'exact' ? 'MATCH!' : type === 'dict' ? 'REAL WORD — BANKED' : 'SO CLOSE — 1 LETTER OFF';
  banner.innerHTML = `${word.toUpperCase()}<span class="sub">${subText}</span>`;
  document.body.appendChild(banner);
  banner.addEventListener('animationend', () => banner.remove(), { once: true });
}

function addGotten(word, type) {
  const existing = state.gotten.find(g => g.word === word);
  if (existing) {
    if (existing.type === 'close' && type === 'exact') { existing.type = 'exact'; renderGotten(); }
    return;
  }
  state.gotten.unshift({ word, type });
  renderGotten();
  autoFillCantripSlot(word);
}

// The first ten spells a player learns land straight in the cantrip slots,
// no dragging required - fills the first empty slot, if any. Once all ten
// are full (or a player has curated them), newly learned spells stop
// touching the slots; only clearing one (or a mode switch) frees it up
// again.
function autoFillCantripSlot(word) {
  if (state.cantrips.includes(word)) return;
  const emptyIdx = state.cantrips.findIndex(c => !c);
  if (emptyIdx === -1) return;
  state.cantrips[emptyIdx] = word;
  saveCantrips();
  renderCantrips();
}

// Padded out with empty dashed rows up to this minimum, so the spellbook
// reads as a bigger book gradually filling in rather than a tiny list that
// just grows - same idea as the cantrip slots' empty placeholders.
const GOTTEN_MIN_SLOTS = 8;

function renderGotten() {
  gottenCountEl.textContent = `(${state.gotten.length})`;
  gottenListEl.innerHTML = '';
  const sorted = [...state.gotten].sort((a, b) => a.word.localeCompare(b.word));
  for (const g of sorted) {
    const li = document.createElement('li');
    if (g.type === 'close') li.classList.add('close-tag');
    li.draggable = true;
    li.title = 'Drag into a cantrip slot';
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({ from: 'spellbook', word: g.word }));
    });
    li.innerHTML = `
      <div class="row">
        <span class="word">${g.word}</span>
        <span class="tag">${g.type === 'exact' ? 'exact' : '1 off'}</span>
      </div>
    `;
    gottenListEl.appendChild(li);
  }
  for (let i = sorted.length; i < GOTTEN_MIN_SLOTS; i++) {
    const li = document.createElement('li');
    li.className = 'gotten-empty-slot';
    gottenListEl.appendChild(li);
  }
}

// ---- cantrips ----

const cantripSlotsEl = document.getElementById('cantripSlots');

function isCantripReachable(wordObj, availableSymbols) {
  const target = fieldForMode(wordObj, state.mode);
  if (target.length > availableSymbols.length) return false;
  let budget = 4000;
  const budgetOk = () => budget-- > 0;
  return !!tileTarget(target, availableSymbols, budgetOk);
}

function renderCantrips() {
  cantripSlotsEl.innerHTML = '';
  const availableSymbols = (state.appMode === 'game') ? collectAvailableSymbols() : [];
  state.cantrips.forEach((word, i) => {
    const slot = document.createElement('div');
    slot.className = 'cantrip-slot';
    slot.dataset.index = i;

    if (word) {
      slot.classList.add('filled');
      slot.textContent = word;
      slot.draggable = true;
      slot.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ from: 'cantrip', index: i, word }));
      });
      const clearBtn = document.createElement('button');
      clearBtn.className = 'clear-cantrip';
      clearBtn.textContent = '✕';
      clearBtn.title = 'Remove from cantrips';
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.cantrips[i] = null;
        saveCantrips();
        renderCantrips();
      });
      slot.appendChild(clearBtn);

      if (state.appMode === 'game') {
        const wordObj = WORDS.find(w => w.full === word);
        if (wordObj && isCantripReachable(wordObj, availableSymbols)) slot.classList.add('reachable');
      }
    } else {
      slot.textContent = '+ drop word';
    }

    slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('dragover'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('dragover'));
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('dragover');
      let data;
      try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      if (!data || !data.word) return;
      if (data.from === 'cantrip') state.cantrips[data.index] = null;
      state.cantrips[i] = data.word;
      saveCantrips();
      renderCantrips();
    });

    cantripSlotsEl.appendChild(slot);
  });
}

// Learning a word never happens automatically: matches are found in real
// time, but the actual Learn buttons only appear after a short pause (and
// vanish/reset immediately if the rack changes again before then) so a word
// forming mid-shuffle can't get banked by accident.
let pendingLearnTimer = null;
const LEARN_DELAY_MS = 900;

function scheduleLearnUI(fn) {
  if (pendingLearnTimer) clearTimeout(pendingLearnTimer);
  pendingLearnTimer = setTimeout(() => { pendingLearnTimer = null; fn(); }, LEARN_DELAY_MS);
}

// Removes the pieces that actually spelled `m.w` from the rack (extras that
// were just along for the ride stay put), banks the word, and re-evaluates
// whatever's left in the rack.
function bankMatch(m) {
  const { chars, pieceIds } = buildCandidateWithSource();
  const target = fieldForMode(m.w, state.mode);
  const { startIdx, endIdx } = alignMatchRange(chars, target);
  const usedPieceIds = new Set(pieceIds.slice(startIdx, endIdx));

  // A die that contributed one of the learned letters is spent - it leaves
  // the table, even if other faces of it are still sitting unused in the
  // rack (those stay put as ordinary rack letters).
  const usedDieIds = new Set(
    state.rack.filter(p => usedPieceIds.has(p.id) && p.type === 'diceFace').map(p => p.dieId)
  );
  if (usedDieIds.size) state.pool = state.pool.filter(p => !usedDieIds.has(p.id));

  // A stone that spelled part of a banked word is spent for good, same as a
  // claimed die - it doesn't reappear on the ground.
  const usedStoneIds = new Set(
    state.rack.filter(p => usedPieceIds.has(p.id) && p.type === 'stone').map(p => p.stoneId)
  );
  if (usedStoneIds.size) state.stones = state.stones.filter(s => !usedStoneIds.has(s.id));

  celebrate(m.w.full, m.type);
  addGotten(m.w.full, m.type);
  checkKeyPhraseMatch(m.w.full);
  state.rack = state.rack.filter(p => !usedPieceIds.has(p.id));
  renderRack();
  renderPool();
  renderGround();
  if (state.appMode === 'game') {
    damageGoblin(spellDamageFor(m.w.full), true);
    resetGoblinClock(); // casting a spell resets the goblin's attack clock to full
    discardAndReroll(); // casting a spell rerolls the board, same as a basic attack
  } else if (state.pool.length === 0) {
    // Banking used up the last pieces on the table - an instant free
    // reroll rather than leaving Sandbox mode staring at an empty table
    // (Game mode already rerolls unconditionally above).
    generatePool();
    renderPool();
  }
  evaluateMatch();
}

// A real (dictionary) word that isn't one of our "legal" spells still gets
// removed from the board and banked as a bonus - it just doesn't teach a
// spell, and (in Game mode) buys time by resetting the goblin's clock
// instead of dealing damage.
function bankDictWord(m) {
  const { pieceIds } = buildCandidateWithSource();
  const usedPieceIds = new Set(pieceIds.slice(m.startIdx, m.endIdx));

  const usedDieIds = new Set(
    state.rack.filter(p => usedPieceIds.has(p.id) && p.type === 'diceFace').map(p => p.dieId)
  );
  if (usedDieIds.size) state.pool = state.pool.filter(p => !usedDieIds.has(p.id));

  const usedStoneIds = new Set(
    state.rack.filter(p => usedPieceIds.has(p.id) && p.type === 'stone').map(p => p.stoneId)
  );
  if (usedStoneIds.size) state.stones = state.stones.filter(s => !usedStoneIds.has(s.id));

  celebrate(m.word, 'dict');
  checkKeyPhraseMatch(m.word);
  state.rack = state.rack.filter(p => !usedPieceIds.has(p.id));
  renderRack();
  renderPool();
  renderGround();
  if (state.appMode === 'game') {
    resetGoblinClock(); // banking a real word resets the goblin's attack clock to full
  } else if (state.pool.length === 0) {
    // Same free reroll safety net as bankMatch, for Sandbox mode.
    generatePool();
    renderPool();
  }
  evaluateMatch();
}

// Finds real (dictionary) words hiding in the literal rack string that
// AREN'T already offered as a legal spell match or already learned - exact
// substrings only (no wildcard fuzziness), longest match per start
// position, so "unicorns" doesn't also separately offer "corn" and "corns".
function findDictionaryMatches(candidate, exactFullSet, learnedWords) {
  if (state.mode !== 'full' || !DICTIONARY.size) return [];
  const literal = candidate.map(c => c.ch).join('');
  const n = literal.length;
  const results = [];
  for (let i = 0; i < n; i++) {
    for (let j = Math.min(n, i + 15); j >= i + 3; j--) {
      const sub = literal.slice(i, j);
      if (exactFullSet.has(sub) || learnedWords.has(sub)) continue;
      if (DICTIONARY.has(sub)) {
        results.push({ word: sub, startIdx: i, endIdx: j });
        break; // longest hit starting at i is enough
      }
    }
  }
  results.sort((a, b) => (b.endIdx - b.startIdx) - (a.endIdx - a.startIdx));
  return results.slice(0, 10);
}

function renderMatchChoices(matches) {
  matchChoicesEl.innerHTML = '';
  for (const m of matches.slice(0, 24)) {
    const btn = document.createElement('button');
    btn.className = `match-pill ${m.type}`;
    btn.innerHTML = m.alreadyLearned ? `🔥 Cast: ${m.w.full}` : `🎓 Learn: ${m.w.full}`;
    btn.addEventListener('click', () => bankMatch(m));
    matchChoicesEl.appendChild(btn);
  }
}

const dictWordsReelEl = document.getElementById('dictWordsReel');
const dictWordsReelListEl = document.getElementById('dictWordsReelList');

function renderDictWordsReel(matches) {
  dictWordsReelListEl.innerHTML = '';
  if (!matches.length) { dictWordsReelEl.classList.add('hidden'); return; }
  dictWordsReelEl.classList.remove('hidden');
  for (const m of matches) {
    const row = document.createElement('div');
    row.className = 'reel-row';
    const span = document.createElement('span');
    span.textContent = m.word;
    const btn = document.createElement('button');
    btn.textContent = 'Bank';
    btn.addEventListener('click', () => bankDictWord(m));
    row.appendChild(span);
    row.appendChild(btn);
    dictWordsReelListEl.appendChild(row);
  }
}

function renderCloseWordsReel(closeMatches) {
  closeWordsReelListEl.innerHTML = '';
  if (!closeMatches.length) { closeWordsReelEl.classList.add('hidden'); return; }
  closeWordsReelEl.classList.remove('hidden');
  for (const m of closeMatches.slice(0, 30)) {
    const row = document.createElement('div');
    row.className = 'reel-row';
    const span = document.createElement('span');
    span.textContent = m.w.full;
    const btn = document.createElement('button');
    btn.textContent = m.alreadyLearned ? 'Cast' : 'Learn';
    btn.addEventListener('click', () => bankMatch(m));
    row.appendChild(span);
    row.appendChild(btn);
    closeWordsReelListEl.appendChild(row);
  }
}

// The currently-visible exact word match(es) sitting in the rack, if any -
// kept in sync with the (debounced) Learn/Cast pills so spacebar can act on
// whatever the player can actually see. See the spacebar handler below.
let currentExactMatches = [];

function evaluateMatch() {
  const candidate = buildCandidate();
  rackEl.classList.remove('match', 'close');
  rackStatusEl.classList.remove('match', 'close');
  matchChoicesEl.innerHTML = '';
  renderCloseWordsReel([]);
  renderDictWordsReel([]);
  if (pendingLearnTimer) { clearTimeout(pendingLearnTimer); pendingLearnTimer = null; }
  if (state.appMode === 'game') renderCantrips();
  // Not confirmed/visible yet (still debounced below) - spacebar shouldn't
  // act on a match the player can't even see a Learn/Cast button for.
  currentExactMatches = [];

  if (!candidate.length) {
    rackStatusEl.textContent = 'Click pieces below to send them up here, then drag to reorder.';
    return { candidate, matches: [] };
  }

  const word = candidate.map(c => c.wildKind ? '·' : c.ch).join('').toUpperCase();
  const learnedWords = new Set(state.gotten.map(g => g.word));

  const exactMatches = [];
  const closeMatches = [];
  for (const w of WORDS) {
    const target = fieldForMode(w, state.mode);
    const def = deficit(candidate, target);
    const isExact = def === 0;
    const isClose = state.closeEnough && target.length >= 5 && def === 1;
    if (!isExact && !isClose) continue;

    // A match built entirely from wild positions - no fixed letter pinning
    // it down - doesn't count.
    const { startIdx, endIdx } = alignMatchRange(candidate, target);
    const hasFixedTile = candidate.slice(startIdx, endIdx).some(c => !c.wildKind);
    if (!hasFixedTile) continue;

    // Already-known words stay fully castable - same piece consumption,
    // same damage, same everything - just labeled "Cast" instead of
    // "Learn" since there's nothing new to add to the spellbook.
    const entry = { w, type: isExact ? 'exact' : 'close', alreadyLearned: learnedWords.has(w.full) };
    if (isExact) exactMatches.push(entry);
    else closeMatches.push(entry);
  }
  exactMatches.sort((a, b) => a.w.full.localeCompare(b.w.full));
  closeMatches.sort((a, b) => a.w.full.localeCompare(b.w.full));

  const dictMatches = findDictionaryMatches(
    candidate,
    new Set(exactMatches.map(m => m.w.full)),
    learnedWords
  );

  if (exactMatches.length) {
    rackEl.classList.add('match');
    rackStatusEl.classList.add('match');
    rackStatusEl.textContent = exactMatches.length === 1
      ? `"${word}" → MATCH: ${exactMatches[0].w.full.toUpperCase()}`
      : `"${word}" → ${exactMatches.length} possible words`;
  } else if (closeMatches.length) {
    rackEl.classList.add('close');
    rackStatusEl.classList.add('close');
    rackStatusEl.textContent = `"${word}" (${candidate.length} letters) — close! Check the 1-off list.`;
  } else {
    rackStatusEl.textContent = `"${word}" (${candidate.length} letters) — no match yet`;
  }

  scheduleLearnUI(() => {
    renderMatchChoices(exactMatches);
    // Don't dangle "1-off" alternatives once a real exact match exists -
    // e.g. having spelled "raze" exactly, seeing "graze" offered right next
    // to it as a tempting "close" pick is confusing and easy to click by
    // mistake, costing pieces for no reason.
    renderCloseWordsReel(exactMatches.length ? [] : closeMatches);
    renderDictWordsReel(dictMatches);
    currentExactMatches = exactMatches; // now visible - spacebar can act on these
  });

  return { candidate, matches: exactMatches };
}

// ---- suggest ----

// Which of a die's 6 faces are currently front-facing (and so actually
// clickable), given its resting rotation. Mirrors the fixed isometric
// camera tilt baked into `.die-rotator`'s CSS transform.
function visibleDieFaces(piece) {
  const rad = d => d * Math.PI / 180;
  function axisMat(axis, deg) {
    // No rounding here: unlike the die's own 90deg-multiple spin, the fixed
    // isometric camera tilt (-30/-45deg) isn't a multiple of 90deg, so
    // rounding cos/sin to the nearest integer would zero it out.
    const t = rad(deg), c = Math.cos(t), s = Math.sin(t);
    if (axis === 'x') return [[1, 0, 0], [0, c, -s], [0, s, c]];
    if (axis === 'y') return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
  }
  function matMul(a, b) {
    const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
    return r;
  }
  function matVec(m, v) {
    return [
      m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
      m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
      m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ];
  }
  const iso = matMul(axisMat('x', -30), axisMat('y', -45));
  const spin = matMul(matMul(axisMat('x', piece.rx), axisMat('y', piece.ry)), axisMat('z', piece.rz));
  const total = matMul(iso, spin);
  // right,left,top,bottom,front,back - note CSS's Y axis points DOWN the
  // screen, so the "top" face (built via rotateX(90deg)) ends up with its
  // normal pointing along -Y, not +Y.
  const normals = [[1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]];
  const visible = [];
  normals.forEach((n, i) => { if (matVec(total, n)[2] > 0.1) visible.push(i); });
  return visible;
}

// For every die: its visible (front-facing), unclaimed face elements/rects,
// plus a "footprint" rect (their union) used below to test whether it could
// occlude ANOTHER die. The footprint is built from the actual face rects
// rather than the die's nominal 2D box (.die-outer), because the 3D content
// isn't clipped to that box (no overflow:hidden) and can visually project
// beyond it depending on rotation.
function computeDiceFaceGeometry() {
  const dice = [];
  state.pool.forEach((piece, idx) => {
    if (piece.type !== 'dice' || !piece.layout) return;
    const wrapper = poolEl.querySelector(`[data-piece-id="${piece.id}"]`);
    if (!wrapper) return;
    const faces = [];
    for (const faceIdx of visibleDieFaces(piece)) {
      if (piece.claimedFaces && piece.claimedFaces.has(faceIdx)) continue;
      const faceEl = wrapper.querySelector(`.die-face-${DIE_FACE_NAMES[faceIdx]}`);
      if (!faceEl) continue;
      faces.push({ faceIdx, rect: faceEl.getBoundingClientRect() });
    }
    if (!faces.length) return;
    const footprint = faces.reduce((acc, f) => ({
      left: Math.min(acc.left, f.rect.left), right: Math.max(acc.right, f.rect.right),
      top: Math.min(acc.top, f.rect.top), bottom: Math.max(acc.bottom, f.rect.bottom),
    }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
    dice.push({ piece, idx, z: piece.layout.z || 0, faces, footprint });
  });
  return dice;
}

// A face can be geometrically front-facing (visibleDieFaces is purely about
// the die's own 3D rotation) and STILL be hidden from a real player because
// a neighboring die happens to be scattered on top of it on screen - pieces
// often overlap. This finds, for every die, which OTHER dice paint on top
// of it (higher z-index, or same z-index and later in the pool array -
// matching real CSS paint order) and whose footprint actually overlaps its
// own. Pure rect geometry (no elementFromPoint hit-testing), so it stays
// fast even with a couple hundred dice on the board.
function computeDiceOccluderRects(dice) {
  const occludersById = new Map();
  for (let i = 0; i < dice.length; i++) {
    for (let j = i + 1; j < dice.length; j++) {
      const a = dice[i], b = dice[j];
      const fa = a.footprint, fb = b.footprint;
      const overlap = !(fa.right < fb.left || fa.left > fb.right || fa.bottom < fb.top || fa.top > fb.bottom);
      if (!overlap) continue;
      const aOnTop = a.z !== b.z ? a.z > b.z : a.idx > b.idx;
      const under = aOnTop ? b : a, over = aOnTop ? a : b;
      if (!occludersById.has(under.piece.id)) occludersById.set(under.piece.id, []);
      occludersById.get(under.piece.id).push(...over.faces.map(f => f.rect));
    }
  }
  return occludersById;
}

// A rotated face's true rendered shape is a skewed parallelogram inside its
// axis-aligned bounding box, not the whole box - so this only calls a face
// "covered" if EVERY sampled point across it falls inside some occluder's
// face rect; if even one sample point pokes out from under all of them,
// there's a real visible sliver of that face left to click.
function isDieFaceCoveredByOccluders(faceRect, occluderRects) {
  const points = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  return points.every(([fx, fy]) => {
    const x = faceRect.left + faceRect.width * fx, y = faceRect.top + faceRect.height * fy;
    return occluderRects.some(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
  });
}

// Every symbol on the board a player could click right now, tagged with
// enough info to find and highlight its DOM element afterward.
function collectAvailableSymbols() {
  const list = [];
  const dice = computeDiceFaceGeometry();
  const occludersById = computeDiceOccluderRects(dice);
  for (const d of dice) {
    const occluders = occludersById.get(d.piece.id);
    for (const { faceIdx, rect } of d.faces) {
      if (occluders && isDieFaceCoveredByOccluders(rect, occluders)) continue;
      list.push({ symbol: d.piece.symbols[faceIdx], pieceId: d.piece.id, pieceType: 'dice', faceIndex: faceIdx });
    }
  }
  for (const piece of state.pool) {
    if (piece.type === 'tile') {
      list.push({ symbol: piece.symbols[piece.side], pieceId: piece.id, pieceType: 'tile' });
    } else if (piece.type === 'domino') {
      list.push({ symbol: piece.symbols[0], pieceId: piece.id, pieceType: 'domino', end: 0 });
      list.push({ symbol: piece.symbols[1], pieceId: piece.id, pieceType: 'domino', end: 1 });
    }
  }
  if (state.appMode === 'game') {
    for (const stone of state.stones) {
      if (stone.hasSymbol && !stone.claimed) {
        list.push({ symbol: stone.symbol, pieceId: stone.id, pieceType: 'stone' });
      }
    }
  }
  return list;
}

// Tries to spell `target` end-to-end using distinct entries from
// `availableSymbols` (bigrams cover two consecutive letters, singles cover
// one, wilds match their category) - not "close enough" matching, an exact
// construction, since we're choosing which pieces to use from scratch.
function tileTarget(target, availableSymbols, budgetOk) {
  const n = availableSymbols.length;
  const used = new Array(n).fill(false);
  const chosen = [];
  function backtrack(pos) {
    if (!budgetOk()) return false;
    if (pos === target.length) return true;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const sym = availableSymbols[i].symbol;
      if (sym.type === 'bigram') {
        if (pos + 2 > target.length || sym.text[0] !== target[pos] || sym.text[1] !== target[pos + 1]) continue;
        used[i] = true; chosen.push(availableSymbols[i]);
        if (backtrack(pos + 2)) return true;
        chosen.pop(); used[i] = false;
      } else {
        const ok = sym.wild
          ? (sym.type === 'vowel' ? VOWELS.has(target[pos]) : !VOWELS.has(target[pos]))
          : sym.text === target[pos];
        if (!ok) continue;
        used[i] = true; chosen.push(availableSymbols[i]);
        if (backtrack(pos + 1)) return true;
        chosen.pop(); used[i] = false;
      }
    }
    return false;
  }
  return backtrack(0) ? chosen.slice() : null;
}

// Finds the longest word (in the current mode) buildable purely from
// symbols currently clickable on the board, longest-first so the first hit
// found is the best one within budget.
function suggestLongWord() {
  const availableSymbols = collectAvailableSymbols();
  if (!availableSymbols.length) return null;

  const candidates = WORDS
    .map(w => ({ w, target: fieldForMode(w, state.mode) }))
    .filter(x => x.target.length >= 2 && x.target.length <= availableSymbols.length)
    .sort((a, b) => b.target.length - a.target.length);

  let budget = 150000;
  const budgetOk = () => budget-- > 0;

  for (const { w, target } of candidates) {
    if (budget <= 0) break;
    const entries = tileTarget(target, availableSymbols, budgetOk);
    if (entries) return { word: w, entries };
  }
  return null;
}

function clearSuggestionHighlights() {
  document.querySelectorAll('.suggested').forEach(el => el.classList.remove('suggested'));
}

const DIE_FACE_NAMES = ['right', 'left', 'top', 'bottom', 'front', 'back'];

function highlightSuggestion(entries) {
  clearSuggestionHighlights();
  for (const entry of entries) {
    if (entry.pieceType === 'stone') {
      groundEl.querySelector(`[data-stone-id="${entry.pieceId}"]`)?.classList.add('suggested');
      continue;
    }
    const wrapper = poolEl.querySelector(`[data-piece-id="${entry.pieceId}"]`);
    if (!wrapper) continue;
    if (entry.pieceType === 'dice') {
      wrapper.querySelector(`.die-face-${DIE_FACE_NAMES[entry.faceIndex]}`)?.classList.add('suggested');
    } else if (entry.pieceType === 'tile') {
      wrapper.querySelector('.tile-piece')?.classList.add('suggested');
    } else if (entry.pieceType === 'domino') {
      wrapper.querySelectorAll('.domino-half')[entry.end]?.classList.add('suggested');
    }
  }
}

// ---- close words panel ----

const closeWordsPanel = document.getElementById('closeWordsPanel');
const closeWordsList = document.getElementById('closeWordsList');
const closeWordsMeta = document.getElementById('closeWordsMeta');

function showCloseWords() {
  const candidate = buildCandidate();
  closeWordsList.innerHTML = '';
  if (!candidate.length) {
    closeWordsMeta.textContent = 'Select some pieces first.';
    closeWordsPanel.classList.remove('hidden');
    return;
  }
  const ranked = WORDS.map(w => ({ w, m: deficit(candidate, fieldForMode(w, state.mode)) }));
  ranked.sort((a, b) => a.m - b.m || a.w.full.localeCompare(b.w.full));
  closeWordsMeta.textContent = `Ranked by letters still missing, in order (${state.mode}). Extra pieces are ignored.`;
  const top = ranked.slice(0, 15);
  for (const { w, m } of top) {
    const li = document.createElement('li');
    const distClass = m === 0 ? 'dist0' : m === 1 ? 'dist1' : 'distN';
    li.innerHTML = `<span>${w.full}</span><span class="${distClass}">${m === 0 ? 'exact' : m + ' missing'}</span>`;
    closeWordsList.appendChild(li);
  }
  closeWordsPanel.classList.remove('hidden');
}

// ---- game mode / combat ----

const goblinEl = document.getElementById('goblin');
const monsterBackdropEl = document.getElementById('monsterBackdrop');
const monsterNameEl = document.getElementById('monsterName');
const battlePanelEl = document.getElementById('battlePanel');
const goblinHpFillEl = document.getElementById('goblinHpFill');
const goblinHpTextEl = document.getElementById('goblinHpText');
const playerHpFillEl = document.getElementById('playerHpFill');
const playerHpTextEl = document.getElementById('playerHpText');
const goblinFxLayerEl = document.getElementById('goblinFxLayer');
const playerFxLayerEl = document.getElementById('playerFxLayer');
const goblinDefeatedMsgEl = document.getElementById('goblinDefeatedMsg');
const teaserLayerEl = document.getElementById('teaserLayer');
const bigTimerWrapEl = document.getElementById('bigTimerWrap');
const bigTimerTextEl = document.getElementById('bigTimerText');
const bigTimerFillEl = document.getElementById('bigTimerFill');

// Cycles on every respawn (see respawnGoblin). Same DOM/CSS anatomy for all
// nine, recolored/reshaped per type via [data-monster] rules in styles.css.
const MONSTER_TYPES = ['goblin', 'snake', 'rat', 'ogre', 'dragon', 'lion', 'griffon', 'panther', 'wolf'];
let monsterIndex = 0;
function applyMonsterVisual() {
  const type = MONSTER_TYPES[monsterIndex % MONSTER_TYPES.length];
  goblinEl.dataset.monster = type;
  monsterNameEl.textContent = type.charAt(0).toUpperCase() + type.slice(1);
}

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// 15 damage for a 5-letter word (measured by the word's full-word length,
// regardless of which mode - Consonants/Vowel+Cons - actually produced the
// match), +5 per letter beyond 5. Floored at 5 so short words still land a
// hit instead of fizzling to 0.
function spellDamageFor(fullWord) {
  return Math.max(5, 15 + 5 * (fullWord.length - 5));
}

function updateHpUI() {
  const gPct = Math.max(0, state.goblin.hp / state.goblin.maxHp * 100);
  goblinHpFillEl.style.width = gPct + '%';
  goblinHpTextEl.textContent = `${Math.max(0, state.goblin.hp)}/${state.goblin.maxHp}`;
  const pPct = Math.max(0, state.player.hp / state.player.maxHp * 100);
  playerHpFillEl.style.width = pPct + '%';
  playerHpTextEl.textContent = `${Math.max(0, state.player.hp)}/${state.player.maxHp}`;
}

// Big floating damage numbers over the game-piece area (roughly where the
// monster stands) rather than a small side panel - green ("to-goblin") for
// damage the player deals, red ("to-player") for damage dealt back.
function spawnFloatText(layerEl, text, cls) {
  const el = document.createElement('div');
  el.className = `dmg-float-big ${cls || ''}`;
  el.textContent = text;
  el.style.left = (12 + Math.random() * 34) + '%';
  el.style.top = (30 + Math.random() * 20) + '%';
  layerEl.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

let goblinTimerId = null;
let idleTimerId = null;
let goblinNextAttackAt = 0;   // Date.now()-based deadline, for the visible countdown
let goblinTimerSpanMs = 0;    // full duration of the current countdown, for the fill bar
let timerTickId = null;

// Green -> yellow -> orange -> red as the fraction remaining drops.
function timerColorFor(fraction) {
  const stops = [
    [1.0, [63, 174, 92]],   // green
    [0.6, [230, 200, 60]],  // yellow
    [0.3, [230, 140, 50]],  // orange
    [0.0, [214, 60, 50]],   // red
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [f1, c1] = stops[i], [f2, c2] = stops[i + 1];
    if (fraction <= f1 && fraction >= f2) {
      const t = (f1 - fraction) / (f1 - f2 || 1);
      const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
      const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
      const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
      return `rgb(${r},${g},${b})`;
    }
  }
  return 'rgb(214,60,50)';
}

function updateTimerDisplay() {
  if (state.appMode !== 'game' || state.goblin.hp <= 0 || state.player.hp <= 0 || !goblinNextAttackAt) {
    bigTimerTextEl.textContent = '—';
    bigTimerFillEl.style.width = '0%';
    bigTimerWrapEl.classList.remove('urgent');
    return;
  }
  const remainMs = Math.max(0, goblinNextAttackAt - Date.now());
  const remainSec = remainMs / 1000;
  const fraction = goblinTimerSpanMs ? remainMs / goblinTimerSpanMs : 0;
  bigTimerTextEl.textContent = Math.ceil(remainSec).toString();
  bigTimerFillEl.style.width = (fraction * 100) + '%';
  bigTimerFillEl.style.backgroundColor = timerColorFor(fraction);
  bigTimerWrapEl.classList.toggle('urgent', remainSec <= 5);
}

function startTimerTick() {
  clearInterval(timerTickId);
  timerTickId = setInterval(updateTimerDisplay, 150);
  updateTimerDisplay();
}

function stopTimerTick() {
  clearInterval(timerTickId);
  timerTickId = null;
  updateTimerDisplay();
}

function damageGoblin(dmg, isSpell) {
  if (state.goblin.hp <= 0) return;
  state.goblin.hp = Math.max(0, state.goblin.hp - dmg);
  updateHpUI();
  spawnFloatText(goblinFxLayerEl, '-' + dmg, isSpell ? 'to-goblin spell' : 'to-goblin');
  goblinEl.classList.remove('hit');
  void goblinEl.offsetWidth; // restart the animation even if it's already mid-play
  goblinEl.classList.add('hit');
  if (state.goblin.hp <= 0) onGoblinDefeated();
}

const GOBLIN_RESPAWN_DELAY_MS = 1500;

function onGoblinDefeated() {
  clearTimeout(goblinTimerId);
  goblinNextAttackAt = 0;
  updateTimerDisplay();
  goblinEl.classList.add('defeated');
  goblinDefeatedMsgEl.classList.remove('hidden');
  // A win brings a fresh goblin automatically after a beat - the player's
  // own HP, spellbook, and cantrips all carry over; only the goblin resets.
  setTimeout(() => {
    if (state.appMode === 'game' && state.goblin.hp <= 0) respawnGoblin();
  }, GOBLIN_RESPAWN_DELAY_MS);
}

function onPlayerDefeated() {
  clearTimeout(goblinTimerId);
  goblinNextAttackAt = 0;
  updateTimerDisplay();
  rackStatusEl.textContent = 'You were defeated! Recovering...';
  // No manual reset button anymore - the player gets back up automatically
  // after a beat, same as a defeated monster respawning.
  setTimeout(() => {
    if (state.appMode === 'game' && state.player.hp <= 0) newGoblin();
  }, GOBLIN_RESPAWN_DELAY_MS);
}

function clearCantrips() {
  state.cantrips = new Array(10).fill(null);
  saveCantrips();
  renderCantrips();
}

// ---- key phrase ----

const keyPhraseBarEl = document.getElementById('keyPhraseBar');
const keyPhraseTilesEl = document.getElementById('keyPhraseTiles');
const keyPhraseSolvedEl = document.getElementById('keyPhraseSolved');
let keyPhraseAdvanceTimer = null;

// Letter-level, not word-level: any letter used in a cast spell or banked
// real word fills the first still-blank matching letter ANYWHERE in the
// phrase (no need to spell one of the phrase's words exactly). Punctuation
// (apostrophes etc.) has nothing to match, so it's just always shown. The
// player can also just start typing (no need to click in first) - see the
// typing block below - which is tracked separately (filledByTyping) so a
// wrong keystroke only undoes typed progress, never letters already earned
// by casting.
function pickNewKeyPhrase() {
  clearTimeout(keyPhraseAdvanceTimer);
  keyPhraseSolvedEl.classList.add('hidden');
  const text = KEY_PHRASES[Math.floor(Math.random() * KEY_PHRASES.length)];
  const words = text.split(' ');
  const letterGrid = words.map(w => [...w].map(ch => {
    const isLetter = /[a-z]/i.test(ch);
    return { ch: ch.toLowerCase(), isLetter, filled: !isLetter, filledByTyping: false };
  }));
  state.keyPhrase = { words, letterGrid };
  renderKeyPhrase();
}

// Flat, reading-order list of every LETTER cell (skips punctuation, which
// has nothing to type) - used to find "the next blank" for the cursor.
function flatKeyPhraseLetters() {
  const kp = state.keyPhrase;
  if (!kp) return [];
  return kp.letterGrid.flat().filter(c => c.isLetter);
}

function firstUnfilledLetterIdx() {
  const flat = flatKeyPhraseLetters();
  return flat.findIndex(c => !c.filled);
}

function renderKeyPhrase() {
  keyPhraseTilesEl.innerHTML = '';
  const kp = state.keyPhrase;
  if (!kp) return;
  const cursorCell = state.appMode === 'game' ? flatKeyPhraseLetters()[firstUnfilledLetterIdx()] : null;
  kp.letterGrid.forEach((wordCells, wi) => {
    const wordEl = document.createElement('div');
    wordEl.className = 'key-phrase-word';
    wordCells.forEach((cell, ci) => {
      const tile = document.createElement('div');
      tile.className = 'key-phrase-tile' + (cell.filled ? ' filled' : '') + (cell === cursorCell ? ' cursor' : '');
      tile.textContent = cell.filled ? kp.words[wi][ci] : '';
      wordEl.appendChild(tile);
    });
    keyPhraseTilesEl.appendChild(wordEl);
  });
}

// Shared by both ways of completing the phrase (casting words into it, or
// typing it directly): a big hit on the current monster and a fresh phrase.
function onKeyPhraseSolved() {
  keyPhraseSolvedEl.classList.remove('hidden');
  void keyPhraseSolvedEl.offsetWidth;
  keyPhraseSolvedEl.classList.remove('hidden'); // restart the animation cleanly
  if (state.appMode === 'game') damageGoblin(50, true);
  clearTimeout(keyPhraseAdvanceTimer);
  keyPhraseAdvanceTimer = setTimeout(() => {
    if (state.appMode === 'game') pickNewKeyPhrase();
  }, 2600);
}

// Called whenever a spell is cast or a real word is banked - for EACH
// letter in that word (in order, duplicates included), fills the first
// still-blank matching letter cell in the phrase, reading left to right.
function checkKeyPhraseMatch(bankedWord) {
  const kp = state.keyPhrase;
  if (!kp) return;
  let anyFilled = false;
  for (const c of bankedWord.toLowerCase()) {
    for (const wordCells of kp.letterGrid) {
      const cell = wordCells.find(cc => cc.isLetter && !cc.filled && cc.ch === c);
      if (cell) { cell.filled = true; anyFilled = true; break; }
    }
  }
  if (!anyFilled) return;
  renderKeyPhrase();
  if (kp.letterGrid.every(wordCells => wordCells.every(cc => cc.filled))) onKeyPhraseSolved();
}

// ---- key phrase: just start typing, no click-to-activate needed ----

window.addEventListener('keydown', (e) => {
  if (!state.keyPhrase || state.appMode !== 'game') return;
  if (!/^[a-zA-Z]$/.test(e.key)) return;
  // Leave OS/browser shortcuts (Ctrl+C, Cmd+R, etc.) alone - only a bare
  // letter keystroke counts as phrase input, since typing is always-live
  // now (no click-to-activate step to scope it to).
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  e.preventDefault();

  const flat = flatKeyPhraseLetters();
  const idx = firstUnfilledLetterIdx();
  if (idx === -1) return; // already complete
  const cell = flat[idx];

  if (e.key.toLowerCase() === cell.ch) {
    cell.filled = true;
    cell.filledByTyping = true;
    renderKeyPhrase();
    if (flat.every(c => c.filled)) onKeyPhraseSolved();
  } else {
    // Wrong: undo only what was entered by typing this attempt, not
    // anything already earned by casting a spell/word.
    for (const c of flat) { if (c.filledByTyping) { c.filled = false; c.filledByTyping = false; } }
    keyPhraseTilesEl.classList.remove('wrong-flash');
    void keyPhraseTilesEl.offsetWidth;
    keyPhraseTilesEl.classList.add('wrong-flash');
    renderKeyPhrase();
  }
});

// Just the goblin himself coming back - used both by the automatic
// post-victory respawn and as part of the manual "New Goblin" reset below.
// Cycles to the next monster type in MONSTER_TYPES each time.
function flashBigTimer() {
  const el = document.getElementById('bigTimerWrap');
  el.classList.remove('flash');
  void el.offsetWidth; // restart the animation even if it's already mid-play
  el.classList.add('flash');
}

function respawnGoblin() {
  monsterIndex++;
  applyMonsterVisual();
  state.goblin.hp = state.goblin.maxHp;
  goblinEl.classList.remove('defeated');
  goblinDefeatedMsgEl.classList.add('hidden');
  updateHpUI();

  // Each new monster is a little more urgent than the last - keep the
  // slider UI honest about the new value.
  state.goblin.attackIntervalSec = Math.max(12, state.goblin.attackIntervalSec - 2);
  const intervalSliderEl = document.getElementById('goblinIntervalSlider');
  const intervalValEl = document.getElementById('goblinIntervalVal');
  intervalSliderEl.value = state.goblin.attackIntervalSec;
  intervalValEl.textContent = state.goblin.attackIntervalSec + 's';

  scheduleGoblinAttack();
  updateTimerDisplay();
  flashBigTimer();
}

// Full recovery after the player is defeated: refills their own HP and
// brings back a fresh monster. Leaves the spellbook and cantrip slots
// alone - only switching Sandbox/Game mode clears cantrips.
function newGoblin() {
  state.player.hp = state.player.maxHp;
  respawnGoblin();
}

const IDLE_CLASSES = ['idle-a', 'idle-b', 'idle-c'];
function setGoblinIdleClass() {
  if (state.goblin.hp <= 0) return;
  goblinEl.classList.remove(...IDLE_CLASSES, 'attack-1', 'attack-2', 'hit');
  goblinEl.classList.add(IDLE_CLASSES[Math.floor(Math.random() * IDLE_CLASSES.length)]);
}

// A small cycle of idle poses so the goblin keeps doing *something* even
// when nothing else is happening, instead of sitting frozen between attacks.
function startIdleCycle() {
  clearInterval(idleTimerId);
  idleTimerId = setInterval(setGoblinIdleClass, 3200);
}

function triggerGoblinAttack() {
  if (state.goblin.hp <= 0 || state.player.hp <= 0) return;
  const variant = Math.random() < 0.5 ? 'attack-1' : 'attack-2';
  goblinEl.classList.remove(...IDLE_CLASSES);
  goblinEl.classList.add(variant);
  setTimeout(() => {
    goblinEl.classList.remove(variant);
    setGoblinIdleClass();
  }, 650);

  const dmg = randInt(2, 5);
  state.player.hp = Math.max(0, state.player.hp - dmg);
  updateHpUI();
  spawnFloatText(playerFxLayerEl, '-' + dmg, 'to-player');
  if (state.player.hp <= 0) onPlayerDefeated();
  scheduleGoblinAttack();
}

function scheduleGoblinAttack() {
  clearTimeout(goblinTimerId);
  if (state.appMode !== 'game' || state.goblin.hp <= 0 || state.player.hp <= 0) { goblinNextAttackAt = 0; return; }
  const spanMs = state.goblin.attackIntervalSec * 1000;
  goblinTimerSpanMs = spanMs;
  goblinNextAttackAt = Date.now() + spanMs;
  goblinTimerId = setTimeout(triggerGoblinAttack, spanMs);
}

// Used when banking a real (non-spell) dictionary word: buys extra time by
// pushing the goblin's next attack further out, without an attack happening
// right now the way a basic attack's retaliation does.
function resetGoblinClock(multiplier) {
  clearTimeout(goblinTimerId);
  if (state.appMode !== 'game' || state.goblin.hp <= 0 || state.player.hp <= 0) { goblinNextAttackAt = 0; return; }
  const spanMs = state.goblin.attackIntervalSec * (multiplier || 1) * 1000;
  goblinTimerSpanMs = spanMs;
  goblinNextAttackAt = Date.now() + spanMs;
  goblinTimerId = setTimeout(triggerGoblinAttack, spanMs);
}

// Right before the board gets discarded/rerolled (a manual Throw, or the
// reroll that follows a basic attack), see if a long word (6+ letters, not
// already known) was sitting there unused - just a fleeting "you could have
// made this" flash, not something that gets learned or banked. Picked
// randomly among ALL buildable 6+ letter candidates (not sorted
// longest-first) so it's not always the single longest word every time.
function findTeaserWord(availableSymbols) {
  const learnedWords = new Set(state.gotten.map(g => g.word));
  const candidates = WORDS
    .map(w => ({ w, target: fieldForMode(w, state.mode) }))
    .filter(x => x.target.length >= 6 && x.target.length <= availableSymbols.length && !learnedWords.has(x.w.full));

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  let budget = 60000;
  const budgetOk = () => budget-- > 0;
  for (const { w, target } of candidates) {
    if (budget <= 0) break;
    if (tileTarget(target, availableSymbols, budgetOk)) return w;
  }
  return null;
}

function showTeaserWord(word) {
  const el = document.createElement('div');
  el.className = 'teaser-word';
  el.textContent = word.toUpperCase();
  teaserLayerEl.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

// The shared "discard the board and roll a fresh one" action - used by the
// manual Throw/Deal/Scatter button, a basic attack's reroll, and a spell
// cast. Outside Game mode this behaves exactly like the old plain
// generatePool+renderPool. The stones themselves are NOT regenerated here -
// they're set once per Game mode session (see applyAppMode) and only
// individual symbols disappear as they're used, so the ground stays put
// across rerolls instead of reshuffling every time the dice do.
function discardAndReroll() {
  generatePool();
  renderPool();
}

function doBasicAttack() {
  if (state.appMode !== 'game' || state.goblin.hp <= 0 || state.player.hp <= 0) return;
  const dmg = randInt(state.basicDmgMin, state.basicDmgMax);
  damageGoblin(dmg, false);
  if (state.goblin.hp > 0) triggerGoblinAttack(); // goblin retaliates and its clock resets
  // The "you could have made this" teaser only ever shows here - a basic
  // attack when there was no legal word to cast - never on a manual reroll
  // or when a spell was actually cast.
  const teaser = findTeaserWord(collectAvailableSymbols());
  if (teaser) showTeaserWord(teaser.full);
  discardAndReroll();
  evaluateMatch();
}

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  e.preventDefault();
  // A legal word already sitting in the rack takes priority over a basic
  // attack - spacebar learns/casts it instead, picking whichever currently
  // visible match would deal the most damage if several are possible.
  if (currentExactMatches.length) {
    const best = currentExactMatches.reduce((a, b) =>
      spellDamageFor(b.w.full) > spellDamageFor(a.w.full) ? b : a
    );
    bankMatch(best);
    return;
  }
  doBasicAttack();
});

const controlsEl = document.getElementById('controls');
const controlsToggleBtn = document.getElementById('controlsToggleBtn');
function setControlsMinimized(minimized) {
  controlsEl.classList.toggle('minimized', minimized);
  controlsToggleBtn.textContent = minimized ? '▸ Options' : '▾ Options';
}
controlsToggleBtn.addEventListener('click', () => {
  setControlsMinimized(!controlsEl.classList.contains('minimized'));
});

function applyAppMode() {
  const isGame = state.appMode === 'game';
  setControlsMinimized(isGame); // auto-collapse entering Game mode; still manually toggleable
  battlePanelEl.classList.toggle('hidden', !isGame);
  document.getElementById('forestBackdrop').classList.toggle('hidden', !isGame);
  monsterBackdropEl.classList.toggle('hidden', !isGame);
  bigTimerWrapEl.classList.toggle('hidden', !isGame);
  document.getElementById('keyPhraseTiles').classList.toggle('hidden', !isGame);
  // Stone symbols are disabled in the game space for now (ground stays
  // hidden and unpopulated either way) - the generateStones/renderGround/
  // selectStone code is all still here, just not invoked, so it's easy to
  // bring back later.
  groundEl.classList.add('hidden');
  document.getElementById('goblinIntervalGroup').style.display = isGame ? '' : 'none';
  document.getElementById('basicDmgGroup').style.display = isGame ? '' : 'none';

  if (isGame) {
    applyMonsterVisual();
    updateHpUI();
    setGoblinIdleClass();
    startIdleCycle();
    scheduleGoblinAttack();
    startTimerTick();
    pickNewKeyPhrase();
  } else {
    clearTimeout(goblinTimerId);
    clearInterval(idleTimerId);
    stopTimerTick();
    state.stones = [];
  }
  clearPoolLayouts();
  renderPool();
  clearCantrips();
  evaluateMatch();
}

// ---- controls wiring ----

function setSegmented(groupSelector, value, applyFn) {
  const group = document.querySelector(groupSelector);
  group.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.value === value));
}

document.querySelectorAll('.segmented').forEach(seg => {
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const target = seg.dataset.target;
    const value = btn.dataset.value;
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));

    if (target === 'dominoView') {
      state.dominoView = value;
      renderPool();
      return;
    }

    if (target === 'appMode') {
      state.appMode = value;
      applyAppMode();
      return;
    }

    if (target === 'pieceType') {
      state.pieceType = value;
      document.getElementById('dominoViewGroup').style.display = value === 'domino' ? '' : 'none';
      document.getElementById('throwBtn').textContent =
        value === 'dice' ? '🎲 Throw Dice' : value === 'domino' ? '🀰 Deal Dominoes' : '▦ Scatter Tiles';
      generatePool();
      renderPool();
    } else if (target === 'mode') {
      state.mode = value;
      generatePool();
      renderPool();
    } else if (target === 'freqMode') {
      state.freqMode = value;
      generatePool();
      renderPool();
    }
    state.rack = [];
    renderRack();
    evaluateMatch();
  });
});

const mixSlider = document.getElementById('mixSlider');
const mixVal = document.getElementById('mixVal');
mixSlider.addEventListener('input', () => {
  state.bigramMix = Number(mixSlider.value);
  mixVal.textContent = state.bigramMix + '%';
});
mixSlider.addEventListener('change', () => { generatePool(); renderPool(); });

const vowelWildSlider = document.getElementById('vowelWildSlider');
const vowelWildVal = document.getElementById('vowelWildVal');
vowelWildSlider.addEventListener('input', () => {
  state.vowelWildPct = Number(vowelWildSlider.value);
  vowelWildVal.textContent = state.vowelWildPct + '%';
});
vowelWildSlider.addEventListener('change', () => { generatePool(); renderPool(); });

const consWildSlider = document.getElementById('consWildSlider');
const consWildVal = document.getElementById('consWildVal');
consWildSlider.addEventListener('input', () => {
  state.consonantWildPct = Number(consWildSlider.value);
  consWildVal.textContent = state.consonantWildPct + '%';
});
consWildSlider.addEventListener('change', () => { generatePool(); renderPool(); });

const countSlider = document.getElementById('countSlider');
const countVal = document.getElementById('countVal');
countSlider.addEventListener('input', () => {
  state.pieceCount = Number(countSlider.value);
  countVal.textContent = state.pieceCount;
});
countSlider.addEventListener('change', () => { generatePool(); renderPool(); });

const sizeSlider = document.getElementById('sizeSlider');
const sizeVal = document.getElementById('sizeVal');
sizeSlider.addEventListener('input', () => {
  state.pieceScale = Number(sizeSlider.value) / 100;
  sizeVal.textContent = Math.round(state.pieceScale * 100) + '%';
  document.documentElement.style.setProperty('--piece-scale', state.pieceScale);
});
sizeSlider.addEventListener('change', () => {
  clearPoolLayouts();
  renderPool();
});

document.getElementById('closeEnoughToggle').addEventListener('change', (e) => {
  state.closeEnough = e.target.checked;
  evaluateMatch();
});

const stoneDensitySlider = document.getElementById('stoneDensitySlider');
const stoneDensityVal = document.getElementById('stoneDensityVal');
stoneDensitySlider.addEventListener('input', () => {
  state.stoneDensity = Number(stoneDensitySlider.value);
  stoneDensityVal.textContent = state.stoneDensity + '%';
});
stoneDensitySlider.addEventListener('change', () => {
  if (state.appMode === 'game') { generateStones(); renderGround(); evaluateMatch(); }
});

const goblinIntervalSlider = document.getElementById('goblinIntervalSlider');
const goblinIntervalVal = document.getElementById('goblinIntervalVal');
goblinIntervalSlider.addEventListener('input', () => {
  state.goblin.attackIntervalSec = Number(goblinIntervalSlider.value);
  goblinIntervalVal.textContent = state.goblin.attackIntervalSec + 's';
});
goblinIntervalSlider.addEventListener('change', () => {
  if (state.appMode === 'game') scheduleGoblinAttack();
});

const basicDmgMinSlider = document.getElementById('basicDmgMinSlider');
const basicDmgMaxSlider = document.getElementById('basicDmgMaxSlider');
const basicDmgVal = document.getElementById('basicDmgVal');
function syncBasicDmgSliders() {
  if (Number(basicDmgMinSlider.value) > Number(basicDmgMaxSlider.value)) {
    basicDmgMaxSlider.value = basicDmgMinSlider.value;
  }
  state.basicDmgMin = Number(basicDmgMinSlider.value);
  state.basicDmgMax = Number(basicDmgMaxSlider.value);
  basicDmgVal.textContent = `${state.basicDmgMin}–${state.basicDmgMax}`;
}
basicDmgMinSlider.addEventListener('input', syncBasicDmgSliders);
basicDmgMaxSlider.addEventListener('input', syncBasicDmgSliders);

document.getElementById('throwBtn').addEventListener('click', () => {
  discardAndReroll();
  evaluateMatch();
});

document.getElementById('clearRackBtn').addEventListener('click', () => {
  state.pool.push(...state.rack);
  state.rack = [];
  renderRack();
  renderPool();
  evaluateMatch();
});

document.getElementById('clearSpellbookBtn').addEventListener('click', () => {
  state.gotten = [];
  renderGotten();
});

document.getElementById('closeWordsBtn').addEventListener('click', showCloseWords);
document.getElementById('closePanelBtn').addEventListener('click', () => closeWordsPanel.classList.add('hidden'));

document.getElementById('suggestBtn').addEventListener('click', () => {
  const result = suggestLongWord();
  if (!result) {
    clearSuggestionHighlights();
    rackStatusEl.textContent = 'No buildable word found among the pieces on the board right now.';
    return;
  }
  highlightSuggestion(result.entries);
  rackStatusEl.textContent = `💡 "${result.word.full.toUpperCase()}" (${result.entries.length} letters) — highlighted below.`;
});

const addWordInput = document.getElementById('addWordInput');
const addWordMsg = document.getElementById('addWordMsg');
function submitAddWord() {
  const result = addWord(addWordInput.value);
  addWordMsg.textContent = result.msg;
  addWordMsg.className = result.ok ? 'ok' : 'err';
  if (result.ok) {
    addWordInput.value = '';
    evaluateMatch();
  }
}
document.getElementById('addWordBtn').addEventListener('click', submitAddWord);
addWordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitAddWord();
});

// The pool area's actual size can change for reasons other than the window
// resizing - e.g. the rack growing taller when match pills wrap to a second
// line, or the 1-off reel appearing next to it, both of which shrink the
// pool zone without ever firing a window resize event. Watching the zone
// itself (not just the window) is what keeps already-placed pieces (tiles
// especially) from ending up positioned below the now-shorter visible area.
// Only worth a full reshuffle if something would actually end up out of
// bounds at the new size - not on every tiny size change (e.g. the rack
// growing/shrinking by a few pixels when a piece is picked), which would
// otherwise re-randomize every remaining piece's position on each click.
function poolPieceOutOfBounds(zoneW, zoneH) {
  const dims = { dice: 64, domino: 100, tile: 58 };
  const dW = (dims[state.pieceType] || 58) * state.pieceScale;
  const dH = (state.pieceType === 'domino' ? 50 : dims[state.pieceType] || 58) * state.pieceScale;
  const pad = 5;
  return state.pool.some(p => {
    const layout = state.pieceType === 'domino'
      ? (state.dominoView === 'topdown' ? p.layoutTop : p.layoutIso)
      : p.layout;
    if (!layout) return false;
    return layout.x < -pad || layout.y < -pad || layout.x + dW > zoneW + pad || layout.y + dH > zoneH + pad;
  });
}

let poolResizeTimer = null;
new ResizeObserver(() => {
  clearTimeout(poolResizeTimer);
  poolResizeTimer = setTimeout(() => {
    // Dice never need this: their layout already keeps a comfortable margin,
    // and unlike tiles they should never re-roll just because the rack grew
    // a little (e.g. the moment the very first face is picked).
    if (state.pieceType === 'dice') return;
    const zoneW = poolEl.clientWidth, zoneH = poolEl.clientHeight;
    if (poolPieceOutOfBounds(zoneW, zoneH)) {
      clearPoolLayouts();
      renderPool();
    }
  }, 120);
}).observe(document.getElementById('poolZone'));

document.documentElement.style.setProperty('--piece-scale', state.pieceScale);
state.cantrips = loadCantrips();
applyMonsterVisual();
generatePool();
renderPool();
renderRack();
renderGotten();
renderCantrips();
evaluateMatch();


























































