// SUPABASE_URL and SUPABASE_KEY come from config.js
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let word = null;      // today's word
let step = 0;         // current section
let correctCount = 0;
let parsed = null;
let adminOpen = false;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/"/g, "&quot;");
const hasZh = s => /[\u4e00-\u9fff]/.test(s);
const isChoice = q => q.options && q.options.length > 0;

const SPK = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>`;
const speakBtn = t => `<button class="speak" data-say="${esc(t)}" aria-label="發音">${SPK}</button>`;

/* ---------- Today's word ---------- */
function mapWord(w) {
  const bySort = (a, b) => a.sort - b.sort;
  return {
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
  };
}

async function fetchWord(code) {
  const { data, error } = await sb
    .from("words")
    .select("*, examples(*), expressions(*), questions(*)")
    .eq("code", code)
    .single();
  if (error) throw error;
  return mapWord(data);
}

// The database keeps the same word until it is reviewed, then picks a random unreviewed one
async function loadCurrent() {
  const { data: code, error } = await sb.rpc("get_current_word");
  if (error) throw error;
  return code ? fetchWord(code) : null;
}

const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const finishHTML = () => `
  <div class="finish">
    <p>已經複習完這個單字了嗎？確認後，這個單字不會再出現。</p>
    <button id="finishBtn" class="check" aria-label="已複習完成">${CHECK}</button>
    <div id="pinBox" hidden>
      <input id="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="請輸入密碼">
      <button id="pinBtn" class="btn primary">確認</button>
    </div>
    <p id="pinMsg"></p>
  </div>`;

function speak(text) {
  speechSynthesis.cancel();
  const voice = new SpeechSynthesisUtterance(text);
  voice.lang = "zh-TW";
  speechSynthesis.speak(voice);
}

/* ---------- Section builders ---------- */
const item = it => `
  <div class="item">
    <div class="row"><div class="zh">${it.zh}</div>${speakBtn(it.zh)}</div>
    ${it.pinyin ? `<div class="py">${it.pinyin}</div>` : ""}
    ${it.en ? `<div>${it.en}</div>` : ""}
  </div>`;

function textBody(t) {
  if (!t || !t.zh) return "";
  return `
    <div class="item">
      <div class="row"><div class="zh">${t.zh}</div>${speakBtn(t.zh)}</div>
      <div class="py">${t.pinyin || ""}</div>
      <div>${t.en || ""}</div>
    </div>`;
}

function practiceBody(d) {
  const qs = d.questions.map((q, qi) => isChoice(q)
    ? `<div class="question" id="q${qi}">
         <p><strong>${qi + 1}. ${q.question}</strong></p>
         ${q.options.map((opt, oi) =>
           `<button class="option" data-q="${qi}" data-o="${oi}">${opt}</button>`).join("")}
         <p class="feedback" id="fb${qi}"></p>
       </div>`
    : `<div class="question">
         <div class="row"><p><strong>${qi + 1}. ${q.question}</strong></p>${speakBtn(q.question)}</div>
         ${q.question_en ? `<p class="py">${q.question_en}</p>` : ""}
         <textarea rows="3" placeholder="寫下你的答案…"></textarea>
       </div>`).join("");
  return qs + (d.questions.some(isChoice) ? '<p id="score"></p>' : "");
}

function summaryQuestions(d) {
  return d.questions.map((q, i) => isChoice(q)
    ? `<p><strong>${i + 1}. ${q.question}</strong><br>答案：${q.answer}</p>`
    : `<p><strong>${i + 1}. ${q.question}</strong><br><span class="py">${q.question_en || ""}</span></p>`
  ).join("");
}

function summaryHTML(d) {
  const block = (t, html) => html ? `<section class="blk"><h3>${t}</h3>${html}</section>` : "";
  return `
    <h2>總結</h2>
    <div class="hero small">
      <div class="hanzi">${d.character}</div>
      <div class="py big">${d.pinyin}</div>
      ${speakBtn(d.pronunciation)}
    </div>
    ${block("意思", `<p class="body">${d.meaning}</p>`)}
    ${block("用法", d.usage && `<p class="body">${d.usage}</p>`)}
    ${block("例句", d.examples.map(item).join(""))}
    ${block("常用表達", d.expressions.map(item).join(""))}
    ${block("短文", textBody(d.text))}
    ${block("練習題", summaryQuestions(d))}`;
}

function stepsFor(d) {
  const s = [{ id: "word", title: "單字" }];
  if (d.usage) s.push({ id: "usage", title: "用法" });
  if (d.examples.length) s.push({ id: "examples", title: "例句" });
  if (d.expressions.length) s.push({ id: "expressions", title: "常用表達" });
  if (d.text && d.text.zh) s.push({ id: "text", title: "短文" });
  if (d.questions.length) s.push({ id: "practice", title: "練習題" });
  s.push({ id: "summary", title: "總結" });
  s.push({ id: "confirm", title: "確認" });
  return s;
}

function sectionHTML(id, d, title) {
  switch (id) {
    case "word":
      return `<h2>${title}</h2>
        <div class="hero">
          <div class="hanzi">${d.character}</div>
          <div class="py big">${d.pinyin}</div>
          <div class="listen">${speakBtn(d.pronunciation)}<span>發音</span></div>
        </div>
        <div class="note"><small>意思</small><p>${d.meaning}</p></div>`;
    case "usage":       return `<h2>${title}</h2><p class="body">${d.usage}</p>`;
    case "examples":    return `<h2>${title}</h2>${d.examples.map(item).join("")}`;
    case "expressions": return `<h2>${title}</h2>${d.expressions.map(item).join("")}`;
    case "text":        return `<h2>${title}</h2>${textBody(d.text)}`;
    case "practice":    return `<h2>${title}</h2>${practiceBody(d)}`;
    case "confirm":     return `<h2>${title}</h2>${finishHTML()}`;
    default:            return summaryHTML(d);
  }
}

/* ---------- Render ---------- */
function render() {
  const steps = stepsFor(word);
  step = Math.min(step, steps.length - 1);
  correctCount = 0;

  $("tabs").innerHTML = steps.map((s, i) =>
    `<button class="tab ${i === step ? "active" : ""}" data-step="${i}">${s.title}</button>`).join("");
  $("stage").innerHTML = sectionHTML(steps[step].id, word, steps[step].title);

  const last = step === steps.length - 1;
  $("prevStep").disabled = step === 0;
  $("nextStep").hidden = last;   // on the summary the big check button takes over

  window.scrollTo(0, 0);
}

function checkAnswer(btn) {
  const qi = Number(btn.dataset.q);
  const oi = Number(btn.dataset.o);
  const q = word.questions[qi];
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
  $("fb" + qi).textContent = (correct ? "答對了！ " : "再試試。 ") + (q.explanation || "");
  if (correct) correctCount++;
  $("score").textContent = `得分：${correctCount} / ${word.questions.filter(isChoice).length}`;
}

/* ---------- Events ---------- */
document.addEventListener("click", e => {
  if (e.target.closest("#finishBtn")) { openPin(); return; }
  if (e.target.closest("#pinBtn")) { submitPin(); return; }
  const say = e.target.closest("[data-say]");
  if (say) { speak(say.dataset.say); return; }
  const opt = e.target.closest(".option");
  if (opt) { checkAnswer(opt); return; }
  const tab = e.target.closest("[data-step]");
  if (tab) { step = Number(tab.dataset.step); render(); }
});

$("nextStep").onclick = () => {
  if (step < stepsFor(word).length - 1) { step++; render(); }
};

function showDone() {
  $("tabs").hidden = true;
  $("stepbar").hidden = true;
  $("stage").textContent = "所有單字都學完了！請新增新的單字。";
}

// Big check: first ask for the PIN
function openPin() {
  $("pinBox").hidden = false;
  $("pin").focus();
}

// The PIN is checked by the database. If correct, the word is marked as reviewed
// and the next random unreviewed word is loaded.
async function submitPin() {
  const pin = $("pin").value.trim();
  if (!pin) { $("pinMsg").textContent = "請輸入密碼。"; return; }

  $("pinBtn").disabled = true;
  const { data, error } = await sb.rpc("complete_word", { p_code: word.code, p_pin: pin });
  $("pinBtn").disabled = false;

  if (error) { $("pinMsg").textContent = "無法儲存：" + error.message; return; }
  if (!data.ok) {
    $("pin").value = "";
    $("pinMsg").textContent =
      data.reason === "locked" ? `嘗試次數過多，請 ${data.minutes} 分鐘後再試。` :
      data.reason === "wrong_pin" ? `密碼錯誤，還可以再試 ${data.left} 次。` :
      "尚未設定密碼，請先在 Supabase 執行 set-pin.sql。";
    return;
  }
  if (!data.next) { showDone(); window.scrollTo(0, 0); return; }
  word = await fetchWord(data.next);
  step = 0;
  render();
}

document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.id === "pin") submitPin();
});
$("prevStep").onclick = () => { if (step > 0) { step--; render(); } };

/* ---------- Text parser (pasted block -> word object) ---------- */
const HEADERS = {
  character: /^(character|單字|漢字)$/i,
  pinyin: /^(pinyin|拼音)$/i,
  pronunciation: /^(pronunciation|發音)$/i,
  meaning: /^(meaning|意思)$/i,
  usage: /^(usage|用法)$/i,
  examples: /^(examples?|例句)$/i,
  expressions: /^((common )?expressions?( related)?|常用表達)$/i,
  questions: /^(questions?( to practice)?|練習題?)$/i
};

// A Chinese line starts a new item; the non-Chinese lines after it are its English
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
  if (!w.character) throw new Error("缺少 Character（單字）區塊。");
  if (!w.pinyin) throw new Error("缺少 Pinyin（拼音）區塊。");
  if (!w.meaning) throw new Error("缺少 Meaning（意思）區塊。");
  return w;
}

function previewHTML(w) {
  return `
    <p><strong>${w.character}</strong> · ${w.pinyin}</p>
    <p><em>${w.meaning}</em></p>
    <p>${w.usage}</p>
    <p><strong>例句（${w.examples.length}）</strong></p>
    <ul>${w.examples.map(e => `<li>${e.zh} → ${e.en}</li>`).join("")}</ul>
    <p><strong>常用表達（${w.expressions.length}）</strong></p>
    <ul>${w.expressions.map(e => `<li>${e.zh}${e.pinyin ? "（" + e.pinyin + "）" : ""} → ${e.en}</li>`).join("")}</ul>
    <p><strong>練習題（${w.questions.length}）</strong></p>
    <ul>${w.questions.map(q => `<li>${q.question} → ${q.question_en}</li>`).join("")}</ul>`;
}

/* ---------- Admin (add words) ---------- */
async function refreshAdmin() {
  const { data } = await sb.auth.getSession();
  $("loginBox").hidden = !!data.session;
  $("addBox").hidden = !data.session;
}

// The same button opens and closes the admin area
function setAdmin(open) {
  adminOpen = open;
  $("admin").hidden = !open;
  $("adminToggle").textContent = open ? "隱藏管理" : "管理";
  if (open) {
    refreshAdmin();
    $("admin").scrollIntoView({ behavior: "smooth" });
  }
}
$("adminToggle").onclick = e => { e.preventDefault(); setAdmin(!adminOpen); };

$("loginBtn").onclick = async () => {
  const { error } = await sb.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value
  });
  if (error) { alert("登入失敗：" + error.message); return; }
  $("password").value = "";
  refreshAdmin();
};

$("logoutBtn").onclick = async () => { await sb.auth.signOut(); refreshAdmin(); };

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
      ? "❌ 這個單字已經在資料庫裡了。"
      : "❌ " + error.message;
    return;
  }
  // The current word stays on screen; the new word joins the pool of unreviewed words
  $("adminStatus").textContent = "✅ 已儲存，編號 " + data + "。它會在之後隨機出現。";
  $("raw").value = "";
  $("preview").innerHTML = "";
  $("saveBtn").hidden = true;
  parsed = null;
};

/* ---------- Start ---------- */
$("dateLabel").textContent = new Date().toLocaleDateString("zh-TW", {
  month: "long", day: "numeric", weekday: "long"
});

loadCurrent()
  .then(w => {
    if (!w) { showDone(); return; }
    word = w;
    render();
  })
  .catch(err => {
    $("tabs").hidden = true;
    $("stepbar").hidden = true;
    $("stage").textContent = "無法載入單字：" + err.message;
  })
  .finally(() => { if (location.hash === "#admin") setAdmin(true); });