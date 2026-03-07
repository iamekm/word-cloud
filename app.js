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
  revealBtn: document.getElementById("revealBtn"),
  hideBtn: document.getElementById("hideBtn"),
  cloudWrap: document.getElementById("cloudWrap"),
  cloudCanvas: document.getElementById("wordCloudCanvas"),
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
  return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function renderExperienceOptions() {
  const optionsHtml = allExperiences.length
    ? allExperiences.map(exp => `<option value="${escapeHtml(exp.id)}">${escapeHtml(exp.name)}${exp.is_active ? " (active)" : ""}</option>`).join("")
    : `<option value="">No experiences available</option>`;
  [els.experienceSelect, els.adminExperienceSelect, els.deleteExperienceSelect].forEach(select => select.innerHTML = optionsHtml);
  const stillExists = allExperiences.some(exp => exp.id === selectedExperienceId);
  if (!stillExists) selectedExperienceId = (allExperiences.find(exp => exp.is_active) || allExperiences[0] || {}).id || null;
  [els.experienceSelect, els.adminExperienceSelect, els.deleteExperienceSelect].forEach(select => { if (selectedExperienceId) select.value = selectedExperienceId; });
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
  if (error) { console.error(error); els.experienceMessage.textContent = "Could not load experiences."; return; }
  allExperiences = data || [];
  renderExperienceOptions();
}
function levenshtein(a, b) {
  const rows = a.length + 1, cols = b.length + 1;
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
  const longEnough = Math.max(a.length, b.length);
  const distance = levenshtein(a, b);
  if (longEnough <= 6) return distance <= 1;
  if (longEnough <= 12) return distance <= 2;
  return distance <= 2;
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
  return groups.map(group => {
    const bestLabel = [...group.members].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
    return [titleCasePhrase(bestLabel), group.count];
  }).sort((a, b) => b[1] - a[1]);
}
async function loadWords() {
  if (!selectedExperienceId) { currentWordCounts = []; els.responseCount.textContent = "0"; return []; }
  const { data, error } = await db.from("words").select("word").eq("experience_id", selectedExperienceId);
  if (error) { console.error(error); els.cloudMessage.textContent = "Could not load responses."; return []; }
  const cleaned = (data || []).map(row => cleanPhrase(row.word)).filter(Boolean);
  currentWordCounts = groupSimilarResponses(cleaned);
  els.responseCount.textContent = String(cleaned.length);
  return currentWordCounts;
}
function drawCloud() {
  if (!currentWordCounts.length) { els.cloudMessage.textContent = "No responses yet for this experience."; return; }
  els.cloudMessage.textContent = "";
  WordCloud(els.cloudCanvas, {
    list: currentWordCounts,
    gridSize: Math.round(16 * (els.cloudCanvas.width / 1024)),
    weightFactor(size) { return Math.max(18, size * 16); },
    fontFamily: "Arial, Helvetica, sans-serif",
    color: "random-dark",
    rotateRatio: 0.18,
    rotationSteps: 2,
    backgroundColor: "#fcfcfb",
    drawOutOfBound: false,
    shrinkToFit: true,
  });
}
async function refreshAll(renderCloud = false) {
  await loadExperiences();
  await loadWords();
  if (renderCloud && !els.cloudWrap.classList.contains("is-hidden")) drawCloud();
}
async function submitWord(event) {
  event.preventDefault();
  if (!selectedExperienceId) { els.submitMessage.textContent = "Please select an experience first."; return; }
  const cleaned = cleanPhrase(els.wordInput.value);
  if (!cleaned) { els.submitMessage.textContent = "Please enter a word or short phrase."; return; }
  const { error } = await db.from("words").insert({ experience_id: selectedExperienceId, word: cleaned });
  if (error) { console.error(error); els.submitMessage.textContent = "Could not save your response. Please try again."; return; }
  els.wordInput.value = "";
  els.submitMessage.textContent = "Saved.";
  await refreshAll(!els.cloudWrap.classList.contains("is-hidden"));
}
async function startNewExperience(event) {
  event.preventDefault();
  const passcode = els.adminPasscode.value.trim();
  const name = els.experienceInput.value.trim() || "Untitled experience";
  if (!passcode) { els.adminMessage.textContent = "Enter the admin passcode."; return; }
  const { data, error } = await db.rpc("start_new_experience", { passcode_input: passcode, experience_name_input: name });
  if (error) { console.error(error); els.adminMessage.textContent = "Could not start a new experience."; return; }
  if (!data) { els.adminMessage.textContent = "Passcode not accepted."; return; }
  els.experienceInput.value = "";
  selectedExperienceId = data;
  els.adminMessage.textContent = "New experience started.";
  els.cloudWrap.classList.add("is-hidden");
  await refreshAll(false);
}
async function activateSelectedExperience() {
  const passcode = els.adminPasscode.value.trim();
  const experienceId = els.adminExperienceSelect.value;
  if (!passcode) { els.adminMessage.textContent = "Enter the admin passcode."; return; }
  if (!experienceId) { els.adminMessage.textContent = "Select an experience first."; return; }
  const { data, error } = await db.rpc("set_active_experience", { passcode_input: passcode, experience_id_input: experienceId });
  if (error) { console.error(error); els.adminMessage.textContent = "Could not activate that experience."; return; }
  if (!data) { els.adminMessage.textContent = "Passcode not accepted or experience not found."; return; }
  selectedExperienceId = experienceId;
  els.adminMessage.textContent = "Experience made active.";
  await refreshAll(!els.cloudWrap.classList.contains("is-hidden"));
}
async function clearSelectedExperience() {
  const passcode = els.adminPasscode.value.trim();
  const experienceId = els.adminExperienceSelect.value;
  if (!passcode) { els.adminMessage.textContent = "Enter the admin passcode."; return; }
  if (!experienceId) { els.adminMessage.textContent = "Select an experience first."; return; }
  if (!window.confirm("Clear all responses for the selected experience?")) return;
  const { data, error } = await db.rpc("clear_experience_words", { passcode_input: passcode, experience_id_input: experienceId });
  if (error) { console.error(error); els.adminMessage.textContent = "Could not clear that experience."; return; }
  if (!data) { els.adminMessage.textContent = "Passcode not accepted or experience not found."; return; }
  els.adminMessage.textContent = "Selected experience cleared.";
  await refreshAll(!els.cloudWrap.classList.contains("is-hidden"));
}
async function deleteSelectedExperience() {
  const passcode = els.adminPasscode.value.trim();
  const experienceId = els.deleteExperienceSelect.value;
  const target = allExperiences.find(exp => exp.id === experienceId);
  if (!passcode) { els.adminMessage.textContent = "Enter the admin passcode."; return; }
  if (!experienceId) { els.adminMessage.textContent = "Select an experience to delete."; return; }
  if (!window.confirm(`Delete "${target?.name || "this experience"}" and all its responses?`)) return;
  const { data, error } = await db.rpc("delete_experience", { passcode_input: passcode, experience_id_input: experienceId });
  if (error) { console.error(error); els.adminMessage.textContent = "Could not delete that experience."; return; }
  if (!data) { els.adminMessage.textContent = "Passcode not accepted or experience not found."; return; }
  if (selectedExperienceId === experienceId) selectedExperienceId = null;
  els.adminMessage.textContent = "Experience deleted.";
  els.cloudWrap.classList.add("is-hidden");
  await refreshAll(false);
}
function toggleAdmin() {
  els.adminPanel.classList.toggle("is-hidden");
  els.toggleAdminBtn.textContent = els.adminPanel.classList.contains("is-hidden") ? "Show admin" : "Hide admin";
}
function revealCloud() { els.cloudWrap.classList.remove("is-hidden"); drawCloud(); }
function hideCloud() { els.cloudWrap.classList.add("is-hidden"); }
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const wrapWidth = els.cloudWrap.clientWidth || 1200;
  const width = Math.max(600, Math.floor(wrapWidth - 24));
  const height = Math.max(380, Math.floor(width * 0.56));
  els.cloudCanvas.width = width * dpr;
  els.cloudCanvas.height = height * dpr;
  const ctx = els.cloudCanvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!els.cloudWrap.classList.contains("is-hidden") && currentWordCounts.length) drawCloud();
}
function syncSelectedExperience(value) {
  selectedExperienceId = value || null;
  if (els.experienceSelect.querySelector(`option[value="${value}"]`)) els.experienceSelect.value = value;
  if (els.adminExperienceSelect.querySelector(`option[value="${value}"]`)) els.adminExperienceSelect.value = value;
  updateExperienceMeta();
  loadWords().then(() => { if (!els.cloudWrap.classList.contains("is-hidden")) drawCloud(); });
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
  els.revealBtn.addEventListener("click", revealCloud);
  els.hideBtn.addEventListener("click", hideCloud);
  els.refreshBtn.addEventListener("click", () => refreshAll(!els.cloudWrap.classList.contains("is-hidden")));
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
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
