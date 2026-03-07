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
// Uses a canvas-based size measurement + spiral placement so word positions
// are always in the same pixel space as the SVG — no scaling involved.

const PALETTES = {
  echo:    ["#5b6ee1", "#7c72ff", "#b05fd3", "#2e86ab"],
  harsh:   ["#c44536", "#d66a2f", "#6c5b7b", "#4a4e69"],
  deep:    ["#264653", "#355070", "#3d405b", "#2b2d42"],
  bright:  ["#0a9396", "#3a86ff", "#e07a00", "#8ecae6"],
  neutral: ["#355070", "#6d597a", "#2a9d8f", "#bc6c25", "#8d99ae"],
};

function classifyWord(text) {
  const t = text.toLowerCase();
  if (/(echo|reverb|resonan|ring|shimmer|halo|float|airy|lush|warm|soft|bloom|wash|tail)/.test(t)) return "echo";
  if (/(metal|sharp|harsh|crack|click|dry|glitch|buzz|noise|hard|abrasive|spiky|brittle)/.test(t)) return "harsh";
  if (/(deep|dark|bass|drone|dense|thick|heavy|rumble|grounded|boomy|sub|cavern)/.test(t)) return "deep";
  if (/(bright|spark|clear|light|open|crisp|clean|fresh|shiny|silvery|radiant)/.test(t)) return "bright";
  return "neutral";
}

function fontForCategory(category, isPhrase) {
  if (category === "echo")  return "italic 600 {S}px Georgia,serif";
  if (category === "harsh") return "700 {S}px 'Courier New',monospace";
  if (isPhrase)             return "600 {S}px 'Trebuchet MS',Arial,sans-serif";
  return "800 {S}px 'Arial Black',Arial,sans-serif";
}

// Measure a word's pixel dimensions using an off-screen canvas.
// This is the only reliable way to know exactly how much space a word needs
// before we commit to placing it in the SVG.
const _measureCanvas = document.createElement("canvas");
const _measureCtx    = _measureCanvas.getContext("2d");

function measureWord(text, fontTemplate, size) {
  const font = fontTemplate.replace("{S}", size);
  _measureCtx.font = font;
  const m = _measureCtx.measureText(text);
  const w = Math.ceil(m.width) + 4;
  const h = Math.ceil(size * 1.25) + 4;
  return { w, h };
}

// Archimedean spiral outward from the centre.
function* spiral(cx, cy) {
  const step = 0.15;
  let angle = 0;
  while (true) {
    const r = step * angle;
    yield { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    angle += 0.18;
  }
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
    const { w, h } = measureWord(word.text, word.fontTemplate, word.size);
    word.w = w;
    word.h = h;

    let found = false;
    for (const { x, y } of spiral(cx, cy)) {
      // Keep fully inside bounds with a small margin
      if (x - w / 2 < 4 || x + w / 2 > stageWidth  - 4) continue;
      if (y - h / 2 < 4 || y + h / 2 > stageHeight - 4) continue;

      const candidate = { x, y, w, h };
      const collision = placed.some(p => rectsOverlap(candidate, { x: p.x, y: p.y, w: p.w + 8, h: p.h + 6 }));
      if (!collision) {
        word.x = x;
        word.y = y;
        placed.push(word);
        found = true;
        break;
      }
    }

    // Safety: spiral iterated too long without finding a slot — skip this word
    if (!found) {
      console.warn("Could not place:", word.text);
    }
  }

  return placed;
}

function buildWordData(stageWidth, stageHeight) {
  const maxCount = Math.max(...currentWordCounts.map(([, v]) => v));
  const minCount = Math.min(...currentWordCounts.map(([, v]) => v));
  const countRange = maxCount - minCount || 1;

  // Font size: sqrt-scaled between minPx and maxPx
  // Cap maxPx so the largest word can't take more than ~30% of stage width
  const maxPx = Math.min(72, Math.floor(stageWidth * 0.28));
  const minPx = Math.max(14, Math.floor(maxPx * 0.22));

  return currentWordCounts.map(([text, value], i) => {
    const category    = classifyWord(text);
    const isPhrase    = text.includes(" ");
    const palette     = PALETTES[category];
    const fontTemplate = fontForCategory(category, isPhrase);
    const t           = (value - minCount) / countRange;          // 0–1
    const size        = Math.round(minPx + Math.sqrt(t) * (maxPx - minPx));
    const emphasis    = /really|very|extremely|super/i.test(text) ? 1.08 : 1.0;

    return {
      text,
      value,
      category,
      fontTemplate,
      size: Math.round(size * emphasis),
      color: palette[i % palette.length],
      letterSpacing: category === "echo" ? "0.03em" : category === "harsh" ? "0.01em" : "0",
      stroke: category === "bright" ? "rgba(255,255,255,.52)" : category === "harsh" ? "rgba(24,24,24,.18)" : "none",
      strokeWidth: category === "bright" ? 1 : 0.6,
      shadowColor: category === "echo" ? "rgba(124,114,255,.24)"
                 : category === "deep"  ? "rgba(22,35,48,.2)"
                 : "rgba(58,134,255,.12)",
    };
  });
}

function renderSvg(placed, stageWidth, stageHeight) {
  const NS = "http://www.w3.org/2000/svg";

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width",  stageWidth);
  svg.setAttribute("height", stageHeight);
  svg.setAttribute("aria-label", "Word cloud");

  // SVG filter: subtle glow for echo + bright words
  const defs   = document.createElementNS(NS, "defs");
  const filter = document.createElementNS(NS, "filter");
  filter.setAttribute("id", "softGlow");
  const blur = document.createElementNS(NS, "feGaussianBlur");
  blur.setAttribute("stdDeviation", "1.2");
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
  svg.appendChild(defs);

  for (const w of placed) {
    const fontStr = w.fontTemplate.replace("{S}", w.size);
    // Echo / deep: faint trail clone behind the word
    if (w.category === "echo" || w.category === "deep") {
      const trail = document.createElementNS(NS, "text");
      const dy = w.category === "echo" ? 3 : 5;
      const dx = w.category === "echo" ? 4 : 0;
      trail.setAttribute("x", w.x + dx);
      trail.setAttribute("y", w.y + dy);
      trail.setAttribute("text-anchor", "middle");
      trail.setAttribute("dominant-baseline", "middle");
      trail.style.cssText = `font:${fontStr};fill:${w.shadowColor};opacity:0.18;pointer-events:none;`;
      trail.textContent = w.text;
      svg.appendChild(trail);
    }

    const el = document.createElementNS(NS, "text");
    el.setAttribute("x", w.x);
    el.setAttribute("y", w.y);
    el.setAttribute("text-anchor", "middle");
    el.setAttribute("dominant-baseline", "middle");

    let css = `font:${fontStr};fill:${w.color};letter-spacing:${w.letterSpacing};`;
    if (w.stroke !== "none") css += `stroke:${w.stroke};stroke-width:${w.strokeWidth}px;paint-order:stroke fill;`;
    if (w.category === "echo" || w.category === "bright") css += "filter:url(#softGlow);";
    el.style.cssText = css;
    el.setAttribute("class", `word word--${w.category}`);
    el.textContent = w.text;
    svg.appendChild(el);
  }

  return svg;
}

async function drawCloud() {
  if (!currentWordCounts.length) {
    els.cloudMessage.textContent = "No responses yet for this experience.";
    els.cloudStage.innerHTML = "";
    currentPlacedWords = [];
    return;
  }

  els.cloudMessage.textContent = "";
  // Build off-screen, then swap in — prevents the visible blink from innerHTML clear
  const stageWidth  = els.cloudStage.clientWidth  || 960;
  const stageHeight = els.cloudStage.clientHeight || 490;

  const wordData = buildWordData(stageWidth, stageHeight);
  const placed   = placeWords(stageWidth, stageHeight, wordData);
  currentPlacedWords = placed;

  const svg = renderSvg(placed, stageWidth, stageHeight);

  // Swap: remove old SVG (if any) then insert new one atomically
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
