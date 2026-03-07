const { createClient } = supabase;

const config = window.APP_CONFIG || {};
const supabaseUrl = config.SUPABASE_URL;
const supabaseAnonKey = config.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes("PASTE_YOUR")) {
  alert("Please add your Supabase URL and anon key in config.js before using the tool.");
}

const db = createClient(supabaseUrl, supabaseAnonKey);

const els = {
  wordForm: document.getElementById("wordForm"),
  wordInput: document.getElementById("wordInput"),
  submitMessage: document.getElementById("submitMessage"),
  experienceName: document.getElementById("experienceName"),
  responseCount: document.getElementById("responseCount"),
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
  clearCurrentBtn: document.getElementById("clearCurrentBtn"),
  adminMessage: document.getElementById("adminMessage"),
};

let currentExperience = null;
let currentWordCounts = [];

function cleanWord(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-zA-ZÀ-ÿ'-]/g, "");
}

function titleCaseWord(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

async function loadActiveExperience() {
  const { data, error } = await db
    .from("experiences")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(error);
    els.experienceName.textContent = "Could not load";
    return null;
  }

  currentExperience = data || null;
  els.experienceName.textContent = currentExperience?.name || "No active experience";
  return currentExperience;
}

async function loadWords() {
  if (!currentExperience) return [];

  const { data, error } = await db
    .from("words")
    .select("word")
    .eq("experience_id", currentExperience.id);

  if (error) {
    console.error(error);
    els.cloudMessage.textContent = "Could not load responses.";
    return [];
  }

  const countsMap = new Map();
  for (const row of data) {
    const cleaned = cleanWord(row.word);
    if (!cleaned) continue;
    countsMap.set(cleaned, (countsMap.get(cleaned) || 0) + 1);
  }

  currentWordCounts = [...countsMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word, count]) => [titleCaseWord(word), count]);

  const totalResponses = data.length;
  els.responseCount.textContent = String(totalResponses);

  return currentWordCounts;
}

function drawCloud() {
  if (!currentWordCounts.length) {
    els.cloudMessage.textContent = "No words yet for this experience.";
    return;
  }

  els.cloudMessage.textContent = "";

  WordCloud(els.cloudCanvas, {
    list: currentWordCounts,
    gridSize: Math.round(16 * (els.cloudCanvas.width / 1024)),
    weightFactor(size) {
      return Math.max(20, size * 18);
    },
    fontFamily: "Arial, Helvetica, sans-serif",
    color: "random-dark",
    rotateRatio: 0.2,
    rotationSteps: 2,
    backgroundColor: "#fcfcfb",
    drawOutOfBound: false,
    shrinkToFit: true,
  });
}

async function refreshAll(renderCloud = false) {
  await loadActiveExperience();
  await loadWords();
  if (renderCloud && !els.cloudWrap.classList.contains("is-hidden")) {
    drawCloud();
  }
}

async function submitWord(event) {
  event.preventDefault();

  if (!currentExperience) {
    els.submitMessage.textContent = "There is no active experience yet.";
    return;
  }

  const cleaned = cleanWord(els.wordInput.value);

  if (!cleaned || cleaned.includes(" ")) {
    els.submitMessage.textContent = "Please enter a single word only.";
    return;
  }

  const payload = {
    experience_id: currentExperience.id,
    word: cleaned,
  };

  const { error } = await db.from("words").insert(payload);

  if (error) {
    console.error(error);
    els.submitMessage.textContent = "Could not save your word. Please try again.";
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
    els.adminMessage.textContent = "Could not start a new experience. Check the passcode.";
    return;
  }

  if (!data) {
    els.adminMessage.textContent = "Passcode not accepted.";
    return;
  }

  els.experienceInput.value = "";
  els.adminMessage.textContent = "New experience started.";
  els.cloudWrap.classList.add("is-hidden");
  await refreshAll(false);
}

async function clearCurrentExperience() {
  const passcode = els.adminPasscode.value.trim();

  if (!passcode) {
    els.adminMessage.textContent = "Enter the admin passcode.";
    return;
  }

  const confirmed = window.confirm("Clear all responses for the current experience?");
  if (!confirmed) return;

  const { data, error } = await db.rpc("clear_current_experience", {
    passcode_input: passcode,
  });

  if (error) {
    console.error(error);
    els.adminMessage.textContent = "Could not clear the current experience.";
    return;
  }

  if (!data) {
    els.adminMessage.textContent = "Passcode not accepted.";
    return;
  }

  els.adminMessage.textContent = "Current experience cleared.";
  await refreshAll(!els.cloudWrap.classList.contains("is-hidden"));
}

function toggleAdmin() {
  els.adminPanel.classList.toggle("is-hidden");
  els.toggleAdminBtn.textContent = els.adminPanel.classList.contains("is-hidden")
    ? "Show admin"
    : "Hide admin";
}

function revealCloud() {
  els.cloudWrap.classList.remove("is-hidden");
  drawCloud();
}

function hideCloud() {
  els.cloudWrap.classList.add("is-hidden");
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const wrapWidth = els.cloudWrap.clientWidth || 1200;
  const width = Math.max(600, Math.floor(wrapWidth - 24));
  const height = Math.max(380, Math.floor(width * 0.56));
  els.cloudCanvas.width = width * dpr;
  els.cloudCanvas.height = height * dpr;
  const ctx = els.cloudCanvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!els.cloudWrap.classList.contains("is-hidden") && currentWordCounts.length) {
    drawCloud();
  }
}

async function init() {
  await refreshAll(false);

  els.wordForm.addEventListener("submit", submitWord);
  els.newExperienceForm.addEventListener("submit", startNewExperience);
  els.clearCurrentBtn.addEventListener("click", clearCurrentExperience);
  els.toggleAdminBtn.addEventListener("click", toggleAdmin);
  els.revealBtn.addEventListener("click", revealCloud);
  els.hideBtn.addEventListener("click", hideCloud);
  els.refreshBtn.addEventListener("click", () => refreshAll(!els.cloudWrap.classList.contains("is-hidden")));
  window.addEventListener("resize", resizeCanvas);

  resizeCanvas();

  db.channel("realtime-words")
    .on("postgres_changes", { event: "*", schema: "public", table: "words" }, async () => {
      await refreshAll(!els.cloudWrap.classList.contains("is-hidden"));
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "experiences" }, async () => {
      await refreshAll(!els.cloudWrap.classList.contains("is-hidden"));
    })
    .subscribe();
}

init();
