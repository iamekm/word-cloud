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

function cleanPhrase(raw) {
  return String(raw || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N}\s'-]/gu, "").trim();
}

function titleCasePhrase(phrase) {
  return phrase.split(" ").filter(Boolean).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function looksLikeEmail(value) { return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value); }
function looksLikePhoneOrLongNumber(value) { return (value.match(/\d/g) || []).length >= 7; }
function looksLikeUrl(value) { return /(https?:\/\/|www\.)/i.test(value); }
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
  if (looksLikeFullName(original)) return "Please avoid submitting names or personal information.";
  return "";
}

function renderExperienceOptions() {
  const optionsHtml = allExperiences.length
    ? allExperiences.map(exp => `<option value="${escapeHtml(exp.id)}">${escapeHtml(exp.name)}${exp.is_active ? " (active)" : ""}</option>`).join("")
    : `<option value="">No experiences available</option>`;

  [els.experienceSelect, els.adminExperienceSelect, els.deleteExperienceSelect].forEach(select => {
    select.innerHTML = optionsHtml;
  });

  const stillExists = allExperiences.some(exp => exp.id === selectedExperienceId);
  if (!stillExists) selectedExperienceId = (allExperiences.find(exp => exp.is_active) || allExperiences[0] || {}).id || null;

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
  const { data, error } = await db.from("experiences").select("id, name, is_active, created_at").order("created_at", { ascending: false });
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
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
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
  for (const member of members) counts.set(member, (counts.get(member) || 0) + 1);

  return [...counts.entries()].sort((a, b) => {
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
    if (!matched) groups.push({ key: phrase, count: 1, members: [phrase] });
  }

  return groups.map(group => [titleCasePhrase(chooseCanonicalLabel(group.members)), group.count]).sort((a, b) => b[1] - a[1]);
}

async function loadWords() {
  if (!selectedExperienceId) {
    currentWordCounts = [];
    els.responseCount.textContent = "0";
    return [];
  }

  const { data, error } = await db.from("words").select("word").eq("experience_id", selectedExperienceId);
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

function paletteForWord(word) {
  const lower = word.toLowerCase();
  if (/(echo|reverb|reverber|resonan|ring|shimmer|halo|float|airy|lush|warm|soft)/.test(lower)) {
    return ["#5b6ee1", "#7c72ff", "#b05fd3", "#2e86ab"];
  }
  if (/(metal|sharp|harsh|crack|click|dry|glitch|buzz|noise|hard|abrasive)/.test(lower)) {
    return ["#c44536", "#d66a2f", "#6c5b7b", "#4a4e69"];
  }
  if (/(deep|dark|bass|drone|dense|thick|heavy|rumble|grounded)/.test(lower)) {
    return ["#264653", "#355070", "#3d405b", "#2b2d42"];
  }
  if (/(bright|spark|clear|light|open|crisp|clean|fresh)/.test(lower)) {
    return ["#0a9396", "#3a86ff", "#ffb703", "#8ecae6"];
  }
  return ["#355070", "#6d597a", "#2a9d8f", "#bc6c25", "#8d99ae"];
}

function fontForWord(word) {
  const lower = word.toLowerCase();
  if (/(echo|reverb|reverber|float|airy|halo|soft|warm|lush|glow)/.test(lower)) {
    return "Georgia, Times New Roman, serif";
  }
  if (/(metal|sharp|click|glitch|buzz|dry|hard|crack)/.test(lower)) {
    return "Courier New, monospace";
  }
  if (word.includes(" ")) {
    return "Trebuchet MS, Arial, sans-serif";
  }
  return "Arial Black, Arial, sans-serif";
}

function styleWordsForCloud() {
  return currentWordCounts.map(([text, value], index) => {
    const palette = paletteForWord(text);
    const font = fontForWord(text);
    const rotation = text.length > 10 || text.includes(" ") ? 0 : (index % 4 === 0 ? 90 : 0);
    const emphasis = /really|very|extremely|super/i.test(text) ? 1.08 : 1;
    return {
      text,
      value,
      font,
      color: palette[index % palette.length],
      rotate: rotation,
      emphasis,
    };
  });
}

function drawCloud() {
  if (!currentWordCounts.length) {
    els.cloudMessage.textContent = "No responses yet for this experience.";
    els.cloudStage.innerHTML = "";
    return;
  }

  els.cloudMessage.textContent = "";
  els.cloudStage.innerHTML = "";

  const width = Math.max(600, Math.floor(els.cloudStage.clientWidth || 900));
  const height = Math.max(360, Math.floor(els.cloudStage.clientHeight || 430));
  const words = styleWordsForCloud();
  const maxCount = Math.max(...words.map(w => w.value));
  const minCount = Math.min(...words.map(w => w.value));
  const sizeScale = d3.scaleLinear().domain([minCount, maxCount || 1]).range([22, 88]);

  d3.layout.cloud()
    .size([width, height])
    .words(words.map(w => ({
      ...w,
      size: sizeScale(w.value) * w.emphasis
    })))
    .padding(4)
    .rotate(d => d.rotate)
    .font(d => d.font)
    .fontSize(d => d.size)
    .spiral("archimedean")
    .on("end", placedWords => {
      const svg = d3.select(els.cloudStage)
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("aria-label", "Word cloud");

      const group = svg.append("g")
        .attr("transform", `translate(${width / 2},${height / 2})`);

      group.selectAll("text")
        .data(placedWords)
        .enter()
        .append("text")
        .style("font-family", d => d.font)
        .style("font-size", d => `${d.size}px`)
        .style("font-weight", d => d.font.includes("Arial Black") ? "800" : d.font.includes("Courier") ? "700" : "600")
        .style("font-style", d => d.font.includes("Georgia") ? "italic" : "normal")
        .style("fill", d => d.color)
        .style("letter-spacing", d => d.text.length > 12 ? "0.01em" : "0")
        .attr("text-anchor", "middle")
        .attr("transform", d => `translate(${d.x},${d.y}) rotate(${d.rotate})`)
        .text(d => d.text);
    })
    .start();
}

async function refreshAll(renderCloud = false) {
  await loadExperiences();
  await loadWords();
  if (renderCloud && !els.cloudWrap.classList.contains("is-hidden")) drawCloud();
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
  drawCloud();
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
  loadWords().then(() => {
    if (!els.cloudWrap.classList.contains("is-hidden")) drawCloud();
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
  els.refreshBtn.addEventListener("click", () => refreshAll(!els.cloudWrap.classList.contains("is-hidden")));
  window.addEventListener("resize", () => {
    if (!els.cloudWrap.classList.contains("is-hidden")) drawCloud();
  });

  db.channel("realtime-word-cloud")
    .on("postgres_changes", { event: "*", schema: "public", table: "words" }, async () => {
      await loadWords();
      if (!els.cloudWrap.classList.contains("is-hidden")) drawCloud();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "experiences" }, async () => {
      await refreshAll(!els.cloudWrap.classList.contains("is-hidden"));
    })
    .subscribe();
}

init();
