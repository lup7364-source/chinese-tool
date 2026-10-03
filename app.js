// SUPABASE_URL and SUPABASE_KEY come from config.js
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let days = [];
let index = 0;
let correctCount = 0;
let parsed = null;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/"/g, "&quot;");
const hasZh = s => /[\u4e00-\u9fff]/.test(s);

/* ---------- Load words ---------- */
async function loadDays() {
  const { data, error } = await sb
    .from("words")
    .select("*, examples(*), expressions(*), questions(*)")
    .order("study_order");
  if (error) throw error;
  const bySort = (a, b) => a.sort - b.sort;
  return data.map(w => ({
    code: w.code,
    character: w.hanzi,
    pinyin: w.pinyin,
    pronunciation: w.pronunciation || w.hanzi,
    meaning: w.meaning,
    usage: w.usage || "",
    examples: w.examples.sort(bySort),
    expressions: w.expressions.sort(bySort),
    text: { zh: w.text_zh, pinyin: w.text_pinyin, en: w.text_en },
    questions: w.questions.sort(bySort)
  }));
}

/* ---------- Audio ---------- */
function speak(text) {
  speechSynthesis.cancel();
  const voice = new SpeechSynthesisUtterance(text);
  voice.lang = "zh-TW";
  speechSynthesis.speak(voice);
}

/* ---------- Lesson display ---------- */
function line(item) {
  return `
    <div class="item">
      <div class="zh">${item.zh} <button data-say="${esc(item.zh)}">🔊</button></div>
      ${item.pinyin ? `<div class="pinyin">${item.pinyin}</div>` : ""}
      <div>${item.en || ""}</div>
    </div>`;
}

function listCard(title, items) {
  if (!items || items.length === 0) return "";
  return `<div class="card"><h2>${title}</h2>${items.map(line).join("")}</div>`;
}

function textCard(t) {
  if (!t || !t.zh) return "";
  return `
    <div class="card">
      <h2>Daily text</h2>
      <div class="zh">${t.zh} <button data-say="${esc(t.zh)}">🔊</button></div>
      <p class="pinyin">${t.pinyin || ""}</p>
      <p>${t.en || ""}</p>
    </div>`;
}

const isChoice = q => q.options && q.options.length > 0;

function practiceHTML(d) {
  if (!d.questions || d.questions.length === 0) return "";
  const qs = d.questions.map((q, qi) => isChoice(q)
    ? `<div class="question" id="q${qi}">
         <p><strong>${qi + 1}. ${q.question}</strong></p>
         ${q.options.map((opt, oi) =>
           `<button class="option" data-q="${qi}" data-o="${oi}">${opt}</button>`).join("")}
         <p class="feedback" id="fb${qi}"></p>
       </div>`
    : `<div class="question">
         <p><strong>${qi + 1}. ${q.question}</strong> <button data-say="${esc(q.question)}">🔊</button></p>
         ${q.question_en ? `<p class="pinyin">${q.question_en}</p>` : ""}
         <textarea rows="3" placeholder="Write your answer in Chinese..."></textarea>
       </div>`).join("");
  const hasChoice = d.questions.some(isChoice);
  return `<div class="card"><h2>Practice</h2>${qs}${hasChoice ? '<p id="score"></p>' : ""}</div>`;
}

function show() {
  const d = days[index];
  correctCount = 0;
  $("dayLabel").textContent = `Day ${index + 1} of ${days.length} · ${d.code}`;
  $("prev").disabled = index === 0;
  $("next").disabled = index === days.length - 1;

  $("lesson").innerHTML = `
    <div class="card center">
      <div class="big">${d.character}</div>
      <div class="pinyin" style="font-size:24px">${d.pinyin}</div>
      <div><strong>${d.meaning}</strong></div>
      <button data-say="${esc(d.pronunciation)}">🔊 Listen</button>
    </div>
    ${d.usage ? `<div class="card"><h2>How to use it</h2><p>${d.usage}</p></div>` : ""}
    ${listCard("Examples", d.examples)}
    ${listCard("Common expressions", d.expressions)}
    ${textCard(d.text)}
    ${practiceHTML(d)}
  `;
  window.scrollTo(0, 0);
  localStorage.setItem("lastDay", index);
}

function checkAnswer(btn) {
  const qi = Number(btn.dataset.q);
  const oi = Number(btn.dataset.o);
  const q = days[index].questions[qi];
  const box = $("q" + qi);
  if (box.dataset.done) return;
  box.dataset.done = "1";

  const correct = q.options[oi] === q.answer;
  btn.classList.add(correct ? "right" : "wrong");
  if (!correct) {
    box.querySelectorAll(".option").forEach(b => {
      if (q.options[Number(b.dataset.o)] === q.answer) b.classList.add("right");
    });
  }
  $("fb" + qi).textContent = (correct ? "✅ Correct! " : "❌ Not quite. ") + (q.explanation || "");
  if (correct) correctCount++;
  const total = days[index].questions.filter(isChoice).length;
  $("score").textContent = `Score: ${correctCount} / ${total}`;
}

document.addEventListener("click", (e) => {
  const say = e.target.dataset.say;
  if (say) { speak(say); return; }
  if (e.target.classList.contains("option")) checkAnswer(e.target);
});
$("prev").onclick = () => { index--; show(); };
$("next").onclick = () => { index++; show(); };

/* ---------- Text parser (pasted block -> word object) ---------- */
const HEADERS = {
  character: /^character$/i,
  pinyin: /^pinyin$/i,
  pronunciation: /^pronunciation$/i,
  meaning: /^meaning$/i,
  usage: /^usage$/i,
  examples: /^examples?$/i,
  expressions: /^(common )?expressions?( related)?$/i,
  questions: /^questions?( to practice)?$/i
};

// Chinese line starts a new item; following non-Chinese lines are its English
function pairLines(lines) {
  const out = [];
  lines.filter(Boolean).forEach(l => {
    if (hasZh(l)) out.push({ zh: l, en: "" });
    else if (out.length) {
      const last = out[out.length - 1];
      last.en += (last.en ? " " : "") + l;
    }
  });
  return out;
}

// "進入聊天室 — enter a chat room"  or  "進入聊天室 — jìnrù liáotiānshì — enter a chat room"
function parseExpression(l) {
  let parts = l.split(/\s*[—–]\s*/);
  if (parts.length < 2) parts = l.split(/\s+-\s+/);
  if (parts.length < 2) parts = l.split(/\s*[:：]\s*/);
  if (parts.length < 2) return { zh: l, pinyin: "", en: "" };
  if (parts.length === 2) return { zh: parts[0], pinyin: "", en: parts[1] };
  return { zh: parts[0], pinyin: parts[1], en: parts.slice(2).join(" — ") };
}

function parseWord(raw) {
  const sec = {};
  let cur = null;
  raw.split(/\r?\n/).forEach(l => {
    const line = l.trim();
    const head = line.replace(/[:：]\s*$/, "");
    const key = Object.keys(HEADERS).find(k => HEADERS[k].test(head));
    if (key) { cur = key; sec[cur] = []; }
    else if (cur) sec[cur].push(line);
  });
  const text = k => (sec[k] || []).filter(Boolean).join(" ");

  const w = {
    character: text("character"),
    pinyin: text("pinyin"),
    pronunciation: text("pronunciation") || null,
    meaning: text("meaning"),
    usage: text("usage"),
    examples: pairLines(sec.examples || []).map(p => ({ zh: p.zh, pinyin: "", en: p.en })),
    expressions: (sec.expressions || []).filter(Boolean).map(parseExpression),
    questions: pairLines(sec.questions || []).map(p => ({ question: p.zh, question_en: p.en }))
  };
  if (!w.character) throw new Error("Missing the Character section.");
  if (!w.pinyin) throw new Error("Missing the Pinyin section.");
  if (!w.meaning) throw new Error("Missing the Meaning section.");
  return w;
}

function previewHTML(w) {
  return `
    <p><strong>${w.character}</strong> · ${w.pinyin}</p>
    <p><em>${w.meaning}</em></p>
    <p>${w.usage}</p>
    <p><strong>Examples (${w.examples.length})</strong></p>
    <ul>${w.examples.map(e => `<li>${e.zh} → ${e.en}</li>`).join("")}</ul>
    <p><strong>Expressions (${w.expressions.length})</strong></p>
    <ul>${w.expressions.map(e => `<li>${e.zh}${e.pinyin ? " (" + e.pinyin + ")" : ""} → ${e.en}</li>`).join("")}</ul>
    <p><strong>Questions (${w.questions.length})</strong></p>
    <ul>${w.questions.map(q => `<li>${q.question} → ${q.question_en}</li>`).join("")}</ul>`;
}

/* ---------- Admin ---------- */
async function initAdmin() {
  const on = location.hash === "#admin";
  $("admin").hidden = !on;
  if (!on) return;
  const { data } = await sb.auth.getSession();
  $("loginBox").hidden = !!data.session;
  $("addBox").hidden = !data.session;
}
window.addEventListener("hashchange", initAdmin);

$("loginBtn").onclick = async () => {
  const { error } = await sb.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value
  });
  if (error) { alert("Login failed: " + error.message); return; }
  $("password").value = "";
  initAdmin();
};

$("logoutBtn").onclick = async () => { await sb.auth.signOut(); initAdmin(); };

$("analyzeBtn").onclick = () => {
  $("adminStatus").textContent = "";
  try {
    parsed = parseWord($("raw").value);
    $("preview").innerHTML = previewHTML(parsed);
    $("saveBtn").hidden = false;
  } catch (err) {
    parsed = null;
    $("preview").innerHTML = "";
    $("saveBtn").hidden = true;
    $("adminStatus").textContent = "❌ " + err.message;
  }
};

$("saveBtn").onclick = async () => {
  if (!parsed) return;
  $("saveBtn").disabled = true;
  const { data, error } = await sb.rpc("add_word", { p: parsed });
  $("saveBtn").disabled = false;
  if (error) {
    $("adminStatus").textContent = /duplicate key/i.test(error.message)
      ? "❌ This word already exists in the database."
      : "❌ " + error.message;
    return;
  }
  $("adminStatus").textContent = "✅ Saved as " + data;
  $("raw").value = "";
  $("preview").innerHTML = "";
  $("saveBtn").hidden = true;
  parsed = null;
  days = await loadDays();
  index = Math.max(0, days.findIndex(d => d.code === data));
  show();
};

/* ---------- Start ---------- */
loadDays()
  .then(data => {
    if (data.length === 0) {
      $("lesson").textContent = "No words in the database yet.";
      return;
    }
    days = data;
    index = Math.min(Number(localStorage.getItem("lastDay")) || 0, days.length - 1);
    show();
  })
  .catch(err => {
    $("lesson").textContent = "Could not load words: " + err.message;
  })
  .finally(initAdmin);