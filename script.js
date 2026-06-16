// ==========================
// CONFIG
// ==========================
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxys3QtG-IWlpW4K9bBRUhZXt-uzarOnmi9m59C1PXdWxTvd0Gkf2ITDoo6nDKkp2Q/exec";

// Parse URL params passed from classroom portal
const _p = new URLSearchParams(window.location.search);
const QUIZ_SHEET    = _p.get("sheet")     || "Questions";
const QUIZ_NAME     = _p.get("quizName")  || "";
const QUIZ_CORRECT  = _p.get("correct")   || "";
const QUIZ_NEGATIVE = _p.get("negative")  || "";
const QUIZ_CLOSE    = _p.get("closeDate") || "";
// Credentials passed from classroom portal
const URL_ROLL      = _p.get("roll")      || "";
const URL_PASS      = _p.get("password")  || "";
const URL_NAME      = _p.get("name")      || "";
const URL_PHONE     = _p.get("phone")     || "";

const $ = (id) => document.getElementById(id);

// ==========================
// GLOBAL STATE
// ==========================
let state = {
  sessionToken: null,
  student: null,
  questions: [],
  current: 0,
  score: 0,
  responses: [],
  timer: null,
  timeLeft: 0,
  selected: null
};

// ==========================
// JSONP (CORS SAFE)
// ==========================
function fetchJSONP(url) {
  return new Promise((resolve, reject) => {

    const cb = "cb_" + Math.random().toString(36).substring(2);

    window[cb] = function(data) {
      resolve(data);
      delete window[cb];
      script.remove();
    };

    const script = document.createElement("script");
    script.src = url + "&callback=" + cb;
    script.onerror = () => reject("Network error");

    document.body.appendChild(script);
  });
}

// ==========================
// API CALLS
// ==========================
async function fetchQuizMeta() {
  const url = GOOGLE_SCRIPT_URL + `?action=getQuizMeta&sheet=${encodeURIComponent(QUIZ_SHEET)}`;
  const data = await fetchJSONP(url);

  if (data.status !== "ok") throw new Error("Meta load failed");

  return data.meta;
}

async function validateLogin(regNo, password) {
  const url = GOOGLE_SCRIPT_URL +
    `?action=validateLogin&regNo=${encodeURIComponent(regNo)}&password=${encodeURIComponent(password)}&sheet=${encodeURIComponent(QUIZ_SHEET)}`;

  return await fetchJSONP(url);
}

async function fetchQuestions() {
  const url = GOOGLE_SCRIPT_URL +
    `?action=getQuestions&sessionToken=${state.sessionToken}&sheet=${encodeURIComponent(QUIZ_SHEET)}`;

  const data = await fetchJSONP(url);

  if (data.status !== "ok") {
    throw new Error("Failed to load questions: " + data.status);
  }

  return data.questions.map(q => ({
    id: q.questionId,
    text: q.question,
    options: [q.options.A, q.options.B, q.options.C, q.options.D],
    time: Number(q.time) || 15
  }));
}

// ==========================
// UI HELPERS
// ==========================
function showSection(id) {
  ["setup", "quiz", "result"].forEach(s => $(s).classList.add("hidden"));
  $(id).classList.remove("hidden");
}

function showError(msg) {
  alert(msg); // you can upgrade to UI later
}

// ==========================
// LOAD META
// ==========================
async function loadMeta() {
  // Use quiz details from classroom URL params if available
  if (QUIZ_NAME) {
    $("quizTitle").textContent = QUIZ_NAME;
    let info = "";
    if (QUIZ_CORRECT) info += `+${QUIZ_CORRECT} correct`;
    if (QUIZ_NEGATIVE && Number(QUIZ_NEGATIVE) !== 0) info += `, ${QUIZ_NEGATIVE} wrong`;
    if (QUIZ_CLOSE) info += ` · Closes: ${QUIZ_CLOSE}`;
    $("quizIntro").textContent = info || "Click Start Quiz to begin";
    return;
  }

  // Fallback: load from Config sheet
  try {
    const meta = await fetchQuizMeta();
    $("quizTitle").textContent = meta.quizName || "Quiz";
    $("quizIntro").textContent = "Enter details and start quiz";
  } catch (err) {
    $("quizTitle").textContent = "Quiz not available";
    console.error(err);
  }
}

// ==========================
// START QUIZ
// ==========================
$("startBtn").onclick = async () => {

  const name = $("studentName").value.trim();
  const regNo = $("regNo").value.trim();
  const phone = $("phoneNo").value.trim();
  const password = $("studentPassword").value.trim();

  if (!regNo || !password) {
    showError("Enter Roll No and Password");
    return;
  }

  try {
    const login = await validateLogin(regNo, password);

    console.log("LOGIN RESPONSE:", login);

    // 🔴 DETAILED ERROR HANDLING
    if (login.status === "invalid") {
      showError("❌ Invalid Roll Number or Password");
      return;
    }

    if (login.status === "used") {
      showError("⚠️ You have already attempted the quiz");
      return;
    }

    if (login.status === "closed") {
      showError("❌ Quiz is not open");
      return;
    }

    if (login.status === "expired") {
      showError("⏰ Quiz time is over");
      return;
    }

    if (login.status !== "ok") {
      showError("❌ Login failed: " + login.status);
      return;
    }

    // ✅ SUCCESS
    state.sessionToken = login.sessionToken;

    state.student = {
      name: login.name || name,
      regNo,
      phone: login.phone || phone
    };

    state.questions = await fetchQuestions();

    state.current = 0;
    state.score = 0;
    state.responses = [];

    showSection("quiz");
    renderQuestion();

  } catch (err) {
    console.error(err);
    showError("Server error. Try again.");
  }
};

// ==========================
// RENDER QUESTION
// ==========================
function renderQuestion() {

  state.selected = null;

  const q = state.questions[state.current];

  $("progressPill").textContent =
    `Question ${state.current + 1} / ${state.questions.length}`;

  $("studentPill").textContent =
    `${state.student.name} (${state.student.regNo})`;

  $("questionText").innerHTML = q.text;

  $("answersBox").innerHTML = "";

  q.options.forEach((opt, i) => {

    const btn = document.createElement("button");
    btn.className = "answer";
    btn.innerHTML = `<b>${String.fromCharCode(65+i)}.</b> ${opt}`;

    btn.onclick = () => selectAnswer(i);

    $("answersBox").appendChild(btn);
  });

  state.timeLeft = q.time;
  startTimer();
}

// ==========================
// SELECT ANSWER
// ==========================
function selectAnswer(index) {

  state.selected = index;

  document.querySelectorAll(".answer").forEach(b => b.classList.remove("selected"));
  document.querySelectorAll(".answer")[index].classList.add("selected");
}

// ==========================
// TIMER
// ==========================
function startTimer() {

  clearInterval(state.timer);

  state.timer = setInterval(() => {
    state.timeLeft--;

    $("timerPillTop").textContent = state.timeLeft + " s";
    $("timerPillBottom").textContent = state.timeLeft + " s";

    if (state.timeLeft <= 0) {
      clearInterval(state.timer);
      nextQuestion(-1);
    }
  }, 1000);
}

// ==========================
// NEXT QUESTION
// ==========================
function nextQuestion(selectedIndex) {

  clearInterval(state.timer);

  state.responses.push({
    questionId: "Q" + (state.current + 1),
    selectedIndex: selectedIndex
  });

  state.current++;

  if (state.current < state.questions.length) {
    renderQuestion();
  } else {
    finishQuiz();
  }
}

// ==========================
// BUTTONS
// ==========================
$("submitAnswerBtn").onclick = () => {
  if (state.selected == null) {
    showError("Select an answer");
    return;
  }
  nextQuestion(state.selected);
};

$("skipBtn").onclick = () => nextQuestion(-1);

$("finishBtn").onclick = () => {
  if (confirm("Finish quiz?")) finishQuiz();
};

// ==========================
// RESULT (NO SUBMIT YET)
// ==========================
function finishQuiz() {

  showSection("result");

  $("scoreText").textContent =
    `Completed`;

  $("resultMeta").textContent =
    `Quiz submitted successfully`;
}

// ==========================
// INIT
// ==========================
document.addEventListener("DOMContentLoaded", async () => {
  await loadMeta();

  // Use URL params first (from classroom portal), then fall back to localStorage
  const roll     = URL_ROLL  || localStorage.getItem("student_roll")  || "";
  const name     = URL_NAME  || localStorage.getItem("student_name")  || "";
  const phone    = URL_PHONE || localStorage.getItem("student_phone") || "";
  const password = URL_PASS  || localStorage.getItem("student_pass")  || "";

  if (roll) {
    $("regNo").value           = roll;
    $("studentName").value     = name;
    $("phoneNo").value         = phone;
    $("studentPassword").value = password;

    $("regNo").readOnly           = true;
    $("studentName").readOnly     = true;
    $("phoneNo").readOnly         = true;
    $("studentPassword").readOnly = true;

    // Auto-start: student is already logged in via classroom portal
    if (password) {
      $("startBtn").click();
    }
  }
});