const { createClient } = supabase;

const config = window.APP_CONFIG || {};
const supabaseUrl = config.SUPABASE_URL;
const supabaseKey = config.SUPABASE_PUBLISHABLE_KEY || config.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey || supabaseUrl.includes("PASTE_YOUR")) {
  alert("Please add your Supabase URL and publishable key in config.js before using the tool.");
}

const db = createClient(supabaseUrl, supabaseKey);

const els = {
  experienceSelect: document.getElementById("experienceSelect"),
  experienceMessage: document.getElementById("experienceMessage"),
  wordForm: document.getElementById("wordForm"),
  wordInput: document.getElementById("wordInput"),
  submitMessage: document.getElementById("submitMessage"),
  experienceName: document.getElementById("experienceName"),
  responseCount: document.getElementById("responseCount"),
  experienceStatus: document.getElementById("experienceStatus"),
  revealPasscode: document.getElementById("revealPasscode"),
  revealBtn: document.getElementById("revealBtn"),
  hideBtn: document.getElementById("hideBtn"),
  downloadJpegBtn: document.getElementById("downloadJpegBtn"),
  cloudWrap: document.getElementById("cloudWrap"),
  cloudStage: document.getElementById("wordCloudStage"),
  cloudMessage: document.getElementById("cloudMessage"),
  refreshBtn: document.getElementById("refreshBtn"),
  toggleAdminBtn: document.getElementById("toggleAdminBtn"),
  adminPanel: document.getElementById("adminPanel"),
  adminPasscode: document.getElementById("adminPasscode"),
  newExperienceForm: document.getElementById("newExperienceForm"),
  experienceInput: document.getElementById("experienceInput"),
  adminExperienceSelect: document.getElementById("adminExperienceSelect"),
  activateExperienceBtn: document.getElementById("activateExperienceBtn"),
  clearCurrentBtn: document.getElementById("clearCurrentBtn"),
  deleteExperienceSelect: document.getElementById("deleteExperienceSelect"),
  deleteExperienceBtn: document.getElementById("deleteExperienceBtn"),
  adminMessage: document.getElementById("adminMessage"),
};

let allExperiences = [];
let selectedExperienceId = null;
let currentWordCounts = [];
let currentPlacedWords = [];

function cleanPhrase(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s'-]/gu, "")
    .trim();
}

function titleCasePhrase(phrase) {
  return phrase
    .split(" ")
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function looksLikeEmail(value) {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value);
}

function looksLikePhoneOrLongNumber(value) {
  return (value.match(/\d/g) || []).length >= 7;
}

function looksLikeUrl(value) {
  return /(https?:\/\/|www\.)/i.test(value);
}

function looksLikeFullName(value) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.length === 2 && parts.every(part => /^[A-Z][a-z'-]{1,}$/.test(part));
}

function validateSubmission(rawValue) {
  const original = String(rawValue || "").trim();
  if (!original) return "Please enter a word or short phrase.";
  if (looksLikeEmail(original) || looksLikePhoneOrLongNumber(original) || looksLikeUrl(original)) {
    return "Please do not submit contact details, links, or other personal information.";
  }
  if (looksLikeFullName(original)) {
    return "Please avoid submitting names or personal information.";
  }
  return "";
}

function renderExperienceOptions() {
  const optionsHtml = allExperiences.length
    ? allExperiences
        .map(exp => `<option value="${escapeHtml(exp.id)}">${escapeHtml(exp.name)}${exp.is_active ? " (active)" : ""}</option>`)
        .join("")
    : `<option value="">No experiences available</option>`;

  [els.experienceSelect, els.adminExperienceSelect, els.deleteExperienceSelect].forEach(select => {
    select.innerHTML = optionsHtml;
  });

  const stillExists = allExperiences.some(exp => exp.id === selectedExperienceId);
  if (!stillExists) {
    selectedExperienceId = (allExperiences.find(exp => exp.is_active) || allExperiences[0] || {}).id || null;
  }

  [els.experienceSelect, els.adminExperienceSelect, els.deleteExperienceSelect].forEach(select => {
    if (selectedExperienceId) select.value = selectedExperienceId;
  });

  updateExperienceMeta();
}

function updateExperienceMeta() {
  const selected = allExperiences.find(exp => exp.id === selectedExperienceId);
  els.experienceName.textContent = selected?.name || "No experience selected";
  els.experienceStatus.textContent = selected ? (selected.is_active ? "Active" : "Available") : "—";
  els.experienceMessage.textContent = selected ? "" : "There are no available experiences yet.";
}

async function loadExperiences() {
  const { data, error } = await db
    .from("experiences")
    .select("id, name, is_active, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    els.experienceMessage.textContent = "Could not load experiences.";
    return;
  }

  allExperiences = data || [];
  renderExperienceOptions();
}

function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

function shouldGroupPhrases(a, b) {
  if (a === b) return true;
  const longest = Math.max(a.length, b.length);
  const distance = levenshtein(a, b);
  if (longest <= 6) return distance <= 1;
  if (longest <= 12) return distance <= 2;
  return distance <= 2;
}

function chooseCanonicalLabel(members) {
  const counts = new Map();
  for (const member of members) {
    counts.set(member, (counts.get(member) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => {
      const byCount = b[1] - a[1];
      if (byCount !== 0) return byCount;
      const byLength = b[0].length - a[0].length;
      if (byLength !== 0) return byLength;
      return a[0].localeCompare(b[0]);
    })[0][0];
}

function groupSimilarResponses(responses) {
  const sorted = [...responses].sort((a, b) => a.localeCompare(b));
  const groups = [];

  for (const phrase of sorted) {
    let matched = false;
    for (const group of groups) {
      if (shouldGroupPhrases(phrase, group.key)) {
        group.count += 1;
        group.members.push(phrase);
        matched = true;
        break;
      }
    }
    if (!matched) {
      groups.push({ key: phrase, count: 1, members: [phrase] });
    }
  }

  return groups
    .map(group => [titleCasePhrase(chooseCanonicalLabel(group.members)), group.count])
    .sort((a, b) => b[1] - a[1]);
}

async function loadWords() {
  if (!selectedExperienceId) {
    currentWordCounts = [];
    els.responseCount.textContent = "0";
    return [];
  }

  const { data, error } = await db
    .from("words")
    .select("word")
    .eq("experience_id", selectedExperienceId);

  if (error) {
    console.error(error);
    els.cloudMessage.textContent = "Could not load responses.";
    return [];
  }

  const cleaned = (data || []).map(row => cleanPhrase(row.word)).filter(Boolean);
  currentWordCounts = groupSimilarResponses(cleaned);
  els.responseCount.textContent = String(cleaned.length);
  return currentWordCounts;
}

// ─── Word cloud rendering ────────────────────────────────────────────────────
// Three modes:
//   "default" — muted tonal palette, opacity-as-distance, gentle tilts,
//                disciplined fonts, echo trails on dominant words only
//   "mono"     — clean black & white, single font, no rotation
//   "fun"      — wild colours, mixed fonts, steep tilts, big size swings

let cloudMode = "default"; // persists across redraws

// ── Palettes ──────────────────────────────────────────────────────────────────

const PALETTES = {
  // Acoustic: muted, tonal — dusty blues, warm ambers, soft purples, slate.
  // Colours you'd associate with acoustic spaces: wood, concrete, cloth, air.
  default: {
    echo:    ["#7b8cde", "#9d8ec4", "#6e9fc2", "#a98fc4"],  // airy purples/blues
    harsh:   ["#8c5a4a", "#7a6651", "#5c5470", "#6b4c3b"],  // dry browns/muted reds
    deep:    ["#3a4a5c", "#445566", "#384454", "#2e3d50"],   // dark slates
    bright:  ["#6aa3a8", "#7ab5a0", "#5e9ea8", "#89b0a8"],  // muted teals
    neutral: ["#6b7a8d", "#7d6e7a", "#5e7a72", "#8a7560", "#6e7e8a"],
  },
  fun: [
    "#ff006e","#fb5607","#ffbe0b","#8338ec","#3a86ff",
    "#06d6a0","#ef233c","#f72585","#4cc9f0","#7209b7",
    "#ffd60a","#e63946","#00f5d4","#ff4d6d","#4361ee",
    "#aaff00","#ff0054","#00b4d8","#ff6b35","#b5179e",
  ],
};

// ── Word classification (acoustic mode only) ──────────────────────────────────

function classifyWord(text) {
  const t = text.toLowerCase();
  if (/(echo|reverb|resonan|ring|shimmer|halo|float|airy|lush|warm|soft|bloom|wash|tail)/.test(t)) return "echo";
  if (/(metal|sharp|harsh|crack|click|dry|glitch|buzz|noise|hard|abrasive|spiky|brittle)/.test(t)) return "harsh";
  if (/(deep|dark|bass|drone|dense|thick|heavy|rumble|grounded|boomy|sub|cavern)/.test(t)) return "deep";
  if (/(bright|spark|clear|light|open|crisp|clean|fresh|shiny|silvery|radiant)/.test(t)) return "bright";
  return "neutral";
}

// ── Font selection ─────────────────────────────────────────────────────────────

const FUN_FONTS = [
  "900 {S}px Impact,Haettenschweiler,sans-serif",
  "800 {S}px 'Arial Black',Arial,sans-serif",
  "700 italic {S}px Georgia,serif",
  "900 italic {S}px Impact,sans-serif",
  "700 {S}px 'Courier New',monospace",
  "800 italic {S}px 'Arial Black',Arial,sans-serif",
  "700 {S}px 'Trebuchet MS',sans-serif",
  "900 {S}px 'Arial Black',Arial,sans-serif",
];

function fontForWord(mode, category, isPhrase, index) {
  if (mode === "mono") return "600 {S}px Arial,Helvetica,sans-serif";
  if (mode === "fun")  return FUN_FONTS[index % FUN_FONTS.length];
  // default: considered, calm typography
  // — lyrical/resonant words get a light-weight serif (feels like reverb tail)
  // — percussive/harsh words get compressed monospace (feels clipped, dry)
  // — everything else gets a clean light sans
  if (category === "echo")  return "300 italic {S}px Georgia,'Times New Roman',serif";
  if (category === "harsh") return "600 {S}px 'Courier New',monospace";
  return "300 {S}px 'Trebuchet MS',Arial,sans-serif";
}

// ── Rotation angles ────────────────────────────────────────────────────────────

function rotationForWord(mode, category, isPhrase, index) {
  if (isPhrase) return 0;
  if (mode === "mono") return 0;
  if (mode === "fun") {
    // Mix of 0°, ±45°, ±90° — chaotic but all produce manageable bounding boxes
    const angles = [90, -90, 45, -45, 90, 0, 45, -90, 0, 90, -45, 0, 45, -90, 90, -45, 0, 45];
    return angles[index % angles.length];
  }
  // default: only upright or 90° — clean, purposeful.
  // Roughly 1-in-5 single words rotates; harsh words rotate slightly more often.
  if (category === "harsh") {
    const harshAngles = [0, 90, 0, 0, -90, 0, 90, 0];
    return harshAngles[index % harshAngles.length];
  }
  const angles = [0, 0, 0, 0, 90, 0, 0, 0, 0, -90, 0, 0, 0, 0, 0, 90];
  return angles[index % angles.length];
}

// ── Canvas measurement ─────────────────────────────────────────────────────────

const _measureCanvas = document.createElement("canvas");
const _measureCtx    = _measureCanvas.getContext("2d");

function measureWord(text, fontTemplate, size) {
  const font = fontTemplate.replace("{S}", size);
  _measureCtx.font = font;
  const m = _measureCtx.measureText(text);
  const w = Math.ceil(m.width) + 4;
  const h = Math.ceil(size * 1.3) + 4;
  return { w, h };
}

// Compute the axis-aligned bounding box of a rotated rectangle.
// Used by the collision checker so rotated words don't overlap neighbours.
function rotatedBounds(w, h, angleDeg) {
  if (!angleDeg) return { w, h };
  const r  = (Math.abs(angleDeg) % 180) * Math.PI / 180;
  const bw = Math.ceil(Math.abs(w * Math.cos(r)) + Math.abs(h * Math.sin(r)));
  const bh = Math.ceil(Math.abs(w * Math.sin(r)) + Math.abs(h * Math.cos(r)));
  return { w: bw, h: bh };
}

// ── Spiral placement ───────────────────────────────────────────────────────────

function* spiral(cx, cy) {
  let angle = 0;
  while (true) {
    const r = 0.15 * angle;
    yield { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    angle += 0.18;
  }
}

// Max spiral steps before giving up on a word.
// Fun mode needs more room to find slots for oddly-rotated large words.
function maxSpiralSteps() {
  return cloudMode === "fun" ? 18000 : 12000;
}

function rectsOverlap(a, b) {
  return !(a.x + a.w / 2 < b.x - b.w / 2 ||
           a.x - a.w / 2 > b.x + b.w / 2 ||
           a.y + a.h / 2 < b.y - b.h / 2 ||
           a.y - a.h / 2 > b.y + b.h / 2);
}

function placeWords(stageWidth, stageHeight, wordData) {
  const cx = stageWidth  / 2;
  const cy = stageHeight / 2;
  const placed = [];

  for (const word of wordData) {
    const { w: rawW, h: rawH } = measureWord(word.text, word.fontTemplate, word.size);
    const { w, h } = rotatedBounds(rawW, rawH, word.rotate);
    word.w = w;
    word.h = h;

    let found = false;
    let steps = 0;
    const limit = maxSpiralSteps();
    for (const { x, y } of spiral(cx, cy)) {
      if (++steps > limit) break;
      if (x - w / 2 < 4 || x + w / 2 > stageWidth  - 4) continue;
      if (y - h / 2 < 4 || y + h / 2 > stageHeight - 4) continue;

      const candidate = { x, y, w, h };
      const collision = placed.some(p => rectsOverlap(candidate, { x: p.x, y: p.y, w: p.w + 10, h: p.h + 8 }));
      if (!collision) {
        word.x = x;
        word.y = y;
        placed.push(word);
        found = true;
        break;
      }
    }

    // If a word couldn't fit even after reducing size, skip it silently
    if (!found) console.warn("Could not place:", word.text);
  }

  return placed;
}

// ── Build word data ────────────────────────────────────────────────────────────

function buildWordData(stageWidth, stageHeight) {
  const maxCount = Math.max(...currentWordCounts.map(([, v]) => v));
  const minCount = Math.min(...currentWordCounts.map(([, v]) => v));
  const countRange = maxCount - minCount || 1;

  // Size range varies by mode.
  // Acoustic uses a narrower range — frequency still registers but doesn't
  // shout. A sinusoidal ripple is added so words at similar counts vary
  // slightly, like amplitude variation in a real signal.
  const maxPx = Math.min(
    cloudMode === "fun" ? 96 : cloudMode === "default" ? 62 : 72,
    Math.floor(stageWidth * (cloudMode === "fun" ? 0.36 : cloudMode === "default" ? 0.22 : 0.26))
  );
  const minPx = Math.max(
    cloudMode === "fun" ? 10 : cloudMode === "default" ? 15 : 14,
    Math.floor(maxPx * (cloudMode === "fun" ? 0.11 : cloudMode === "default" ? 0.30 : 0.22))
  );

  return currentWordCounts.map(([text, value], i) => {
    const category     = classifyWord(text);
    const isPhrase     = text.includes(" ");
    const fontTemplate = fontForWord(cloudMode, category, isPhrase, i);
    const rotate       = rotationForWord(cloudMode, category, isPhrase, i);
    const t            = (value - minCount) / countRange;  // 0–1 by frequency

    // Acoustic: add a subtle sine ripple so identically-frequent words still
    // differ slightly in size — mimics natural amplitude variation
    const ripple   = cloudMode === "default" ? Math.sin(i * 1.7) * 2 : 0;
    const baseSize = Math.round(minPx + Math.sqrt(t) * (maxPx - minPx) + ripple);
    const emphasis = /really|very|extremely|super/i.test(text) ? 1.08 : 1.0;

    // Colour
    let color;
    if (cloudMode === "mono") {
      const grey = Math.round(20 + (1 - t) * 160);
      color = `rgb(${grey},${grey},${grey})`;
    } else if (cloudMode === "fun") {
      color = PALETTES.fun[i % PALETTES.fun.length];
    } else {
      const palette = PALETTES.default[category];
      color = palette[i % palette.length];
    }

    // Acoustic: opacity as distance — frequent words feel close and present,
    // rare words feel distant, like sound decaying across a room.
    // Fun/mono: always fully opaque.
    const opacity = cloudMode === "default"
      ? Math.round((0.45 + t * 0.55) * 100) / 100   // 0.45 → 1.0
      : 1;

    // Letter-spacing as texture (acoustic only)
    const letterSpacing = cloudMode === "default" && category === "echo"  ? "0.06em"
                        : cloudMode === "default" && category === "harsh" ? "-0.02em"
                        : cloudMode === "default" && category === "deep"  ? "0.02em"
                        : "0";

    // Echo trails only on the top-half words by frequency (dominant frequencies)
    const isProminent  = t >= 0.5;
    const shadowColor  = category === "echo" ? "rgba(100,110,200,.20)"
                       : category === "deep" ? "rgba(20,32,48,.18)"
                       : "rgba(80,100,130,.12)";
    const glow  = cloudMode === "default" && category === "echo" && isProminent;
    const trail = cloudMode === "default" && (category === "echo" || category === "deep") && isProminent;

    return {
      text, value, category, fontTemplate,
      size: Math.round(baseSize * emphasis),
      rotate, color, opacity, letterSpacing,
      stroke: "none", strokeWidth: 0,
      shadowColor, glow, trail,
      animIndex: i,
    };
  });
}

// ── SVG render ─────────────────────────────────────────────────────────────────

function renderSvg(placed, stageWidth, stageHeight) {
  const NS = "http://www.w3.org/2000/svg";

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width",  stageWidth);
  svg.setAttribute("height", stageHeight);
  svg.setAttribute("aria-label", "Word cloud");

  // Glow filter (used by echo + bright in acoustic/fun modes)
  const defs   = document.createElementNS(NS, "defs");
  const filter = document.createElementNS(NS, "filter");
  filter.setAttribute("id", "softGlow");
  filter.setAttribute("x", "-20%"); filter.setAttribute("y", "-20%");
  filter.setAttribute("width", "140%"); filter.setAttribute("height", "140%");
  const blur = document.createElementNS(NS, "feGaussianBlur");
  blur.setAttribute("stdDeviation", "1.4");
  blur.setAttribute("result", "blur");
  const merge = document.createElementNS(NS, "feMerge");
  ["blur", "SourceGraphic"].forEach(inp => {
    const node = document.createElementNS(NS, "feMergeNode");
    node.setAttribute("in", inp);
    merge.appendChild(node);
  });
  filter.appendChild(blur);
  filter.appendChild(merge);
  defs.appendChild(filter);

  // Per-word animations (fun mode only)
  if (cloudMode === "fun") {
    const style = document.createElementNS(NS, "style");
    const FUN_ANIMATIONS = [
      // wobble: gentle side-to-side rock
      `@keyframes wc-wobble {
        0%,100% { transform-origin: center; transform: rotate(var(--base-rot,0deg)) scale(1); }
        25%      { transform: rotate(calc(var(--base-rot,0deg) + 6deg)) scale(1.04); }
        75%      { transform: rotate(calc(var(--base-rot,0deg) - 6deg)) scale(0.97); }
      }`,
      // bounce: vertical pulse
      `@keyframes wc-bounce {
        0%,100% { transform: translateY(0) rotate(var(--base-rot,0deg)); }
        40%      { transform: translateY(-7px) rotate(var(--base-rot,0deg)); }
        60%      { transform: translateY(-4px) rotate(var(--base-rot,0deg)); }
      }`,
      // spin: slow full rotation
      `@keyframes wc-spin {
        0%   { transform: rotate(var(--base-rot,0deg)); }
        100% { transform: rotate(calc(var(--base-rot,0deg) + 360deg)); }
      }`,
      // pulse: scale in and out
      `@keyframes wc-pulse {
        0%,100% { transform: rotate(var(--base-rot,0deg)) scale(1); }
        50%      { transform: rotate(var(--base-rot,0deg)) scale(1.18); }
      }`,
      // jitter: rapid small shakes
      `@keyframes wc-jitter {
        0%,100% { transform: rotate(var(--base-rot,0deg)) translate(0,0); }
        20%      { transform: rotate(calc(var(--base-rot,0deg)+3deg)) translate(-2px,1px); }
        40%      { transform: rotate(calc(var(--base-rot,0deg)-2deg)) translate(2px,-1px); }
        60%      { transform: rotate(calc(var(--base-rot,0deg)+1deg)) translate(-1px,2px); }
        80%      { transform: rotate(calc(var(--base-rot,0deg)-3deg)) translate(1px,-2px); }
      }`,
      // float: slow drift up and down
      `@keyframes wc-float {
        0%,100% { transform: rotate(var(--base-rot,0deg)) translateY(0); }
        50%      { transform: rotate(var(--base-rot,0deg)) translateY(-10px); }
      }`,
    ];
    style.textContent = FUN_ANIMATIONS.join("
");
    defs.appendChild(style);
  }

  svg.appendChild(defs);

  const FUN_ANIM_NAMES = ["wc-wobble","wc-bounce","wc-spin","wc-pulse","wc-jitter","wc-float"];
  const FUN_ANIM_DURATIONS = [2.8, 1.6, 8, 3.2, 0.5, 4.5];

  for (const w of placed) {
    const fontStr  = w.fontTemplate.replace("{S}", w.size);
    const transform = w.rotate ? `rotate(${w.rotate})` : "";

    // Faint trail behind echo / deep words
    if (w.trail) {
      const trail = document.createElementNS(NS, "text");
      const dy = w.category === "echo" ? 3 : 5;
      const dx = w.category === "echo" ? 4 : 0;
      trail.setAttribute("x", w.x + dx);
      trail.setAttribute("y", w.y + dy);
      trail.setAttribute("text-anchor", "middle");
      trail.setAttribute("dominant-baseline", "middle");
      if (transform) trail.setAttribute("transform", `translate(${w.x + dx},${w.y + dy}) ${transform} translate(${-(w.x + dx)},${-(w.y + dy)})`);
      trail.style.cssText = `font:${fontStr};fill:${w.shadowColor};opacity:0.18;pointer-events:none;`;
      trail.textContent = w.text;
      svg.appendChild(trail);
    }

    const el = document.createElementNS(NS, "text");
    el.setAttribute("x", w.x);
    el.setAttribute("y", w.y);
    el.setAttribute("text-anchor", "middle");
    el.setAttribute("dominant-baseline", "middle");
    if (transform) el.setAttribute("transform", `translate(${w.x},${w.y}) ${transform} translate(${-w.x},${-w.y})`);

    let css = `font:${fontStr};fill:${w.color};letter-spacing:${w.letterSpacing};`;
    if (w.opacity !== undefined && w.opacity < 1) css += `opacity:${w.opacity};`;
    if (w.stroke !== "none") css += `stroke:${w.stroke};stroke-width:${w.strokeWidth}px;paint-order:stroke fill;`;
    if (w.glow) css += "filter:url(#softGlow);";
    if (cloudMode === "fun") {
      const animIdx  = w.animIndex % FUN_ANIM_NAMES.length;
      const name     = FUN_ANIM_NAMES[animIdx];
      const dur      = FUN_ANIM_DURATIONS[animIdx];
      const delay    = (w.animIndex * 0.37) % 3;  // stagger so they don't all move together
      css += `--base-rot:${w.rotate}deg;animation:${name} ${dur}s ${delay}s ease-in-out infinite;transform-box:fill-box;transform-origin:center;`;
    }
    el.style.cssText = css;
    el.setAttribute("class", `word word--${w.category}`);
    el.textContent = w.text;
    svg.appendChild(el);
  }

  return svg;
}

// ── Draw ───────────────────────────────────────────────────────────────────────

async function drawCloud() {
  if (!currentWordCounts.length) {
    els.cloudMessage.textContent = "No responses yet for this experience.";
    els.cloudStage.innerHTML = "";
    currentPlacedWords = [];
    return;
  }

  els.cloudMessage.textContent = "";
  const stageWidth  = els.cloudStage.clientWidth  || 960;
  const stageHeight = els.cloudStage.clientHeight || 490;

  const wordData = buildWordData(stageWidth, stageHeight);
  const placed   = placeWords(stageWidth, stageHeight, wordData);
  currentPlacedWords = placed;

  const svg = renderSvg(placed, stageWidth, stageHeight);

  const existing = els.cloudStage.querySelector("svg");
  if (existing) existing.remove();
  els.cloudStage.appendChild(svg);
}

async function downloadCloudAsJpeg() {
  const svgEl = els.cloudStage.querySelector("svg");
  if (!svgEl) {
    els.cloudMessage.textContent = "Reveal the cloud first, then download it.";
    return;
  }

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgEl);
  const width  = els.cloudStage.clientWidth  || 960;
  const height = els.cloudStage.clientHeight || 490;

  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);

  const img = new Image();
  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  img.onload = () => {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#fbfbfa");
    gradient.addColorStop(0.55, "#f5f1ea");
    gradient.addColorStop(1, "#f0ece5");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(width * 0.15, height * 0.18, 110, 0, Math.PI * 2); ctx.fillStyle = "rgba(157,208,255,0.38)"; ctx.fill();
    ctx.beginPath(); ctx.arc(width * 0.8, height * 0.2, 120, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,190,222,0.32)"; ctx.fill();
    ctx.beginPath(); ctx.arc(width * 0.18, height * 0.8, 140, 0, Math.PI * 2); ctx.fillStyle = "rgba(186,231,194,0.35)"; ctx.fill();
    ctx.beginPath(); ctx.arc(width * 0.78, height * 0.75, 120, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,223,165,0.22)"; ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(255,255,255,0.32)";
    ctx.fillRect(14, 14, width - 28, height - 28);

    ctx.drawImage(img, 0, 0, width, height);

    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    link.href = canvas.toDataURL("image/jpeg", 0.94);
    link.download = `acoustic-word-cloud-${stamp}.jpg`;
    link.click();

    URL.revokeObjectURL(url);
    els.cloudMessage.textContent = "JPEG downloaded.";
  };

  img.onerror = () => {
    URL.revokeObjectURL(url);
    els.cloudMessage.textContent = "Could not generate JPEG.";
  };

  img.src = url;
}

async function unlockAndRevealCloud() {
  const passcode = els.revealPasscode.value.trim();
  if (!passcode) {
    els.cloudMessage.textContent = "Enter the reveal passcode.";
    return;
  }

  const { data, error } = await db.rpc("check_reveal_passcode", { passcode_input: passcode });
  if (error) {
    console.error(error);
    els.cloudMessage.textContent = "Could not check the reveal passcode.";
    return;
  }
  if (!data) {
    els.cloudMessage.textContent = "Reveal passcode not accepted.";
    return;
  }

  els.cloudWrap.classList.remove("is-hidden");
  await loadWords();
  await drawCloud();
}

async function refreshAll(renderCloud = false) {
  await loadExperiences();
  await loadWords();
  if (renderCloud && !els.cloudWrap.classList.contains("is-hidden")) {
    await drawCloud();
  }
}

async function submitWord(event) {
  event.preventDefault();

  if (!selectedExperienceId) {
    els.submitMessage.textContent = "Please select an experience first.";
    return;
  }

  const validationMessage = validateSubmission(els.wordInput.value);
  if (validationMessage) {
    els.submitMessage.textContent = validationMessage;
    return;
  }

  const cleaned = cleanPhrase(els.wordInput.value);
  const { error } = await db.from("words").insert({ experience_id: selectedExperienceId, word: cleaned });

  if (error) {
    console.error(error);
    els.submitMessage.textContent = "Could not save your response. Please try again.";
    return;
  }

  els.wordInput.value = "";
  els.submitMessage.textContent = "Saved.";
  await refreshAll(!els.cloudWrap.classList.contains("is-hidden"));
}

async function startNewExperience(event) {
  event.preventDefault();
  const passcode = els.adminPasscode.value.trim();
  const name = els.experienceInput.value.trim() || "Untitled experience";

  if (!passcode) {
    els.adminMessage.textContent = "Enter the admin passcode.";
    return;
  }

  const { data, error } = await db.rpc("start_new_experience", {
    passcode_input: passcode,
    experience_name_input: name,
  });

  if (error) {
    console.error(error);
    els.adminMessage.textContent = "Could not start a new experience.";
    return;
  }
  if (!data) {
    els.adminMessage.textContent = "Passcode not accepted.";
    return;
  }

  els.experienceInput.value = "";
  selectedExperienceId = data;
  els.adminMessage.textContent = "New experience started.";
  els.cloudWrap.classList.add("is-hidden");
  await refreshAll(false);
}

async function activateSelectedExperience() {
  const passcode = els.adminPasscode.value.trim();
  const experienceId = els.adminExperienceSelect.value;

  if (!passcode) {
    els.adminMessage.textContent = "Enter the admin passcode.";
    return;
  }
  if (!experienceId) {
    els.adminMessage.textContent = "Select an experience first.";
    return;
  }

  const { data, error } = await db.rpc("set_active_experience", {
    passcode_input: passcode,
    experience_id_input: experienceId,
  });

  if (error) {
    console.error(error);
    els.adminMessage.textContent = "Could not activate that experience.";
    return;
  }
  if (!data) {
    els.adminMessage.textContent = "Passcode not accepted or experience not found.";
    return;
  }

  selectedExperienceId = experienceId;
  els.adminMessage.textContent = "Experience made active.";
  await refreshAll(!els.cloudWrap.classList.contains("is-hidden"));
}

async function clearSelectedExperience() {
  const passcode = els.adminPasscode.value.trim();
  const experienceId = els.adminExperienceSelect.value;

  if (!passcode) {
    els.adminMessage.textContent = "Enter the admin passcode.";
    return;
  }
  if (!experienceId) {
    els.adminMessage.textContent = "Select an experience first.";
    return;
  }
  if (!window.confirm("Clear all responses for the selected experience?")) return;

  const { data, error } = await db.rpc("clear_experience_words", {
    passcode_input: passcode,
    experience_id_input: experienceId,
  });

  if (error) {
    console.error(error);
    els.adminMessage.textContent = "Could not clear that experience.";
    return;
  }
  if (!data) {
    els.adminMessage.textContent = "Passcode not accepted or experience not found.";
    return;
  }

  els.adminMessage.textContent = "Selected experience cleared.";
  await refreshAll(!els.cloudWrap.classList.contains("is-hidden"));
}

async function deleteSelectedExperience() {
  const passcode = els.adminPasscode.value.trim();
  const experienceId = els.deleteExperienceSelect.value;
  const target = allExperiences.find(exp => exp.id === experienceId);

  if (!passcode) {
    els.adminMessage.textContent = "Enter the admin passcode.";
    return;
  }
  if (!experienceId) {
    els.adminMessage.textContent = "Select an experience to delete.";
    return;
  }
  if (!window.confirm(`Delete "${target?.name || "this experience"}" and all its responses?`)) return;

  const { data, error } = await db.rpc("delete_experience", {
    passcode_input: passcode,
    experience_id_input: experienceId,
  });

  if (error) {
    console.error(error);
    els.adminMessage.textContent = "Could not delete that experience.";
    return;
  }
  if (!data) {
    els.adminMessage.textContent = "Passcode not accepted or experience not found.";
    return;
  }

  if (selectedExperienceId === experienceId) selectedExperienceId = null;
  els.adminMessage.textContent = "Experience deleted.";
  els.cloudWrap.classList.add("is-hidden");
  await refreshAll(false);
}

function toggleAdmin() {
  els.adminPanel.classList.toggle("is-hidden");
  els.toggleAdminBtn.textContent = els.adminPanel.classList.contains("is-hidden") ? "Show admin" : "Hide admin";
}

function hideCloud() {
  els.cloudWrap.classList.add("is-hidden");
}

function syncSelectedExperience(value) {
  selectedExperienceId = value || null;
  if (els.experienceSelect.querySelector(`option[value="${value}"]`)) els.experienceSelect.value = value;
  if (els.adminExperienceSelect.querySelector(`option[value="${value}"]`)) els.adminExperienceSelect.value = value;
  updateExperienceMeta();
  loadWords().then(async () => {
    if (!els.cloudWrap.classList.contains("is-hidden")) {
      await drawCloud();
    }
  });
}

async function init() {
  await refreshAll(false);

  els.experienceSelect.addEventListener("change", event => syncSelectedExperience(event.target.value));
  els.adminExperienceSelect.addEventListener("change", event => syncSelectedExperience(event.target.value));
  els.wordForm.addEventListener("submit", submitWord);
  els.newExperienceForm.addEventListener("submit", startNewExperience);
  els.activateExperienceBtn.addEventListener("click", activateSelectedExperience);
  els.clearCurrentBtn.addEventListener("click", clearSelectedExperience);
  els.deleteExperienceBtn.addEventListener("click", deleteSelectedExperience);
  els.toggleAdminBtn.addEventListener("click", toggleAdmin);
  els.revealBtn.addEventListener("click", unlockAndRevealCloud);
  els.hideBtn.addEventListener("click", hideCloud);
  els.downloadJpegBtn.addEventListener("click", downloadCloudAsJpeg);
  els.refreshBtn.addEventListener("click", () => refreshAll(!els.cloudWrap.classList.contains("is-hidden")));
  document.querySelectorAll(".cloud-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      cloudMode = btn.dataset.mode;
      document.querySelectorAll(".cloud-mode-btn").forEach(b => b.classList.toggle("is-active", b === btn));
      if (!els.cloudWrap.classList.contains("is-hidden")) drawCloud();
    });
  });
  window.addEventListener("resize", () => {
    if (!els.cloudWrap.classList.contains("is-hidden")) {
      drawCloud();
    }
  });

  db.channel("realtime-word-cloud")
    .on("postgres_changes", { event: "*", schema: "public", table: "words" }, async () => {
      await loadWords();
      if (!els.cloudWrap.classList.contains("is-hidden")) {
        await drawCloud();
      }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "experiences" }, async () => {
      await refreshAll(!els.cloudWrap.classList.contains("is-hidden"));
    })
    .subscribe();
}

init();
