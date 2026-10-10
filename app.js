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
const MIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;

// The speaking practice must be passed (green microphone) before a word can be confirmed
const inPhrases = () => document.body.dataset.screen === "phrases";

// What the speaking practice and the confirmation refer to right now (a word or a phrase)
const currentTarget = () => inPhrases()
  ? (curPhrase ? { code: curPhrase.code, text: curPhrase.phrase } : null)
  : (word ? { code: word.code, text: word.character } : null);

const spokenOK = () => { const t = currentTarget(); return !!t && localStorage.getItem("spoken") === t.code; };

const finishHTML = (isPhrase = false) => `
  <div class="finish">
    <p>已經複習完這個${isPhrase ? "成語" : "單字"}了嗎？確認後，這個${isPhrase ? "成語" : "單字"}不會再出現。</p>
    ${spokenOK() ? "" : `<p class="warn">請先完成「口說」練習（麥克風變成綠色），才能確認複習。</p>
    <button class="btn ghost" ${isPhrase ? "data-pstep" : "data-step"}="1">前往口說練習</button>`}
    <button id="finishBtn" class="check" ${spokenOK() ? "" : "disabled"} aria-label="已複習完成">${CHECK}</button>
    <div id="pinBox" hidden>
      <input id="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="請輸入密碼">
      <button id="pinBtn" class="btn primary">確認</button>
    </div>
    <p id="pinMsg"></p>
  </div>`;

function speakSection(title, hanzi, pinyin, say, kind) {
  const ok = spokenOK();
  return `<h2>${title}</h2>
    <p class="body">按下麥克風，大聲唸出這個${kind}。</p>
    <div class="hero">
      <div class="hanzi" style="font-size:${hanzi.length > 2 ? 64 : 104}px">${escHTML(hanzi)}</div>
      <div class="py big">${escHTML(pinyin || "")}</div>
      <div class="listen">${speakBtn(escHTML(say))}<span>先聽一次</span></div>
    </div>
    <div class="finish">
      <button id="micBtn" class="mic ${ok ? "ok" : ""}" aria-label="麥克風">${MIC}</button>
      <p id="micMsg">${ok ? "答對了！發音正確。" : "按下麥克風開始"}</p>
      <p id="heard" class="py"></p>
    </div>`;
}

function speak(text) {
  speechSynthesis.cancel();
  const sentences = String(text).match(/[^。！？\n]+[。！？]?/g) || [String(text)];
  const parts = [];
  let buf = "";
  sentences.forEach(sn => {
    if (buf && (buf + sn).length > 100) { parts.push(buf); buf = sn; } else buf += sn;
  });
  if (buf) parts.push(buf);
  parts.forEach(part => {
    const voice = new SpeechSynthesisUtterance(part);
    voice.lang = "zh-TW";
    speechSynthesis.speak(voice);
  });
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
  const s = [{ id: "word", title: "單字" }, { id: "speak", title: "口說" }];
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
    case "speak": return speakSection(title, d.character, d.pinyin, d.pronunciation, "單字");
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
  if (!e.target.closest("#lookup") && !e.target.closest("[data-w]")) hideLookup();
  if (e.target.closest("[data-lk-close]")) { hideLookup(); return; }
  const wd = e.target.closest("[data-w]");
  if (wd) { showLookup(wd.dataset.w); return; }
  const mode = e.target.closest("[data-mode]");
  if (mode) { setView(mode.dataset.mode); return; }
  if (e.target.closest("#micBtn")) { startListening(); return; }
  if (e.target.closest("#finishBtn")) { openPin(); return; }
  if (e.target.closest("#pinBtn")) { submitPin(); return; }
  const say = e.target.closest("[data-say]");
  if (say) { speak(say.dataset.say); return; }
  const opt = e.target.closest(".option");
  if (opt) { checkAnswer(opt); return; }
  const tab = e.target.closest("[data-step]");
  if (tab) { step = Number(tab.dataset.step); render(); return; }

  // Home page, phrases list and tabs, flip cards
  const go = e.target.closest("[data-go]");
  if (go) { setScreen(go.dataset.go); return; }
  if (e.target.closest("#homeBtn")) { setScreen("home"); return; }
  const ps = e.target.closest("[data-pstep]");
  if (ps) { pStep = Number(ps.dataset.pstep); renderPhrases(); return; }

  const atab = e.target.closest("[data-atab]");
  if (atab) { articleTab = atab.dataset.atab; renderArticles(); return; }
  if (e.target.closest("[data-aread]")) { setArticleRead(true); return; }
  if (e.target.closest("[data-aunread]")) { setArticleRead(false); return; }
  if (e.target.closest("[data-aedit]")) { startEditArticle(); return; }
  if (e.target.closest("[data-vadd]")) { addVocabRow(); return; }
  const art = e.target.closest("[data-article]");
  if (art) { curArticle = articles.find(a => a.code === art.dataset.article); renderArticles(); window.scrollTo(0, 0); return; }
  if (e.target.closest("[data-aback]")) { curArticle = null; renderArticles(); window.scrollTo(0, 0); return; }

  // Flashcards: "I know" opens a box to type the word; the rest of the card flips it
  const know = e.target.closest("[data-know]");
  if (know) { openKnow(know.closest(".fc")); return; }
  const knowOk = e.target.closest(".know-ok");
  if (knowOk) { checkKnow(knowOk.closest(".fc")); return; }
  if (e.target.closest(".know-in")) return;
  const fc = e.target.closest(".fc");
  if (fc) fc.classList.toggle("flipped");
});

$("nextStep").onclick = () => {
  if (step < stepsFor(word).length - 1) { step++; render(); }
};

function showDone() {
  $("tabs").hidden = true;
  $("stepbar").hidden = true;
  stageMsg = "所有單字都學完了！請新增新的單字。";
  $("stage").textContent = stageMsg;
}

// Big check: first ask for the PIN
function openPin() {
  $("pinBox").hidden = false;
  $("pin").focus();
}

// The PIN is checked by the database. If correct, the word is marked as reviewed
// and the next random unreviewed word is loaded.
async function submitPin() {
  if (!spokenOK()) { $("pinMsg").textContent = "請先完成「口說」練習。"; return; }
  const pin = $("pin").value.trim();
  if (!pin) { $("pinMsg").textContent = "請輸入密碼。"; return; }

  const phr = inPhrases();
  const code = phr ? curPhrase.code : word.code;
  $("pinBtn").disabled = true;
  const { data, error } = await sb.rpc(phr ? "complete_phrase" : "complete_word", { p_code: code, p_pin: pin });
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
  localStorage.removeItem("spoken");
  if (phr) {
    localStorage.removeItem("known:" + code);
    if (!data.next) { showPhraseDone(); window.scrollTo(0, 0); return; }
    curPhrase = await fetchPhrase(data.next);
    pStep = 0;
    renderPhrases();
    return;
  }
  if (!data.next) { showDone(); window.scrollTo(0, 0); return; }
  word = await fetchWord(data.next);
  step = 0;
  render();
}

document.addEventListener("keydown", e => {
  if (e.key !== "Enter" || e.isComposing) return;
  if (e.target.id === "pin") submitPin();
  if (e.target.classList && e.target.classList.contains("know-in")) checkKnow(e.target.closest(".fc"));
});

// A red "try again" mark disappears when you type again in a flashcard
document.addEventListener("input", e => {
  if (e.target.classList && e.target.classList.contains("know-in")) e.target.classList.remove("bad");
});

/* ---------- Speaking practice (browser speech recognition) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const zhOnly = s => String(s).replace(/[^\u4e00-\u9fff]/g, "");
const hasPy = typeof pinyinPro !== "undefined";
const toPy = s => pinyinPro.pinyin(s, { toneType: "num", type: "array" });
let listening = false;

function seqIncludes(hay, needle) {
  if (!needle.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((p, j) => hay[i + j] === p)) return true;
  }
  return false;
}

// Correct if any recognized alternative contains the same characters,
// or the same syllables WITH the same tones (so homophone characters still count)
function isMatch(alts, target) {
  const t = zhOnly(target);
  const tp = hasPy ? toPy(t) : null;
  return alts.some(a => {
    const s = zhOnly(a);
    if (s.includes(t)) return true;
    return tp ? seqIncludes(toPy(s), tp) : false;
  });
}

function setMic(state, msg, heard) {
  const b = $("micBtn");
  if (!b) return;   // the user left this section
  b.className = "mic " + state;
  $("micMsg").textContent = msg;
  if (heard !== undefined) $("heard").textContent = heard;
}

function startListening() {
  if (listening) return;
  const t = currentTarget();
  if (!t) return;
  if (!SR) {
    setMic("bad", "這個瀏覽器不支援語音辨識。請改用 Chrome（Android）或 Safari（iPhone）。");
    return;
  }
  const rec = new SR();
  rec.lang = "zh-TW";
  rec.interimResults = false;
  rec.continuous = false;
  rec.maxAlternatives = 5;

  let gotResult = false;
  listening = true;
  speechSynthesis.cancel();
  setMic("listening", "請說話…", "");

  rec.onresult = e => {
    gotResult = true;
    const alts = Array.from(e.results[0]).map(r => r.transcript);
    if (isMatch(alts, t.text)) {
      localStorage.setItem("spoken", t.code);
      setMic("ok", "答對了！發音正確。", "聽到：" + alts[0]);
    } else {
      setMic("bad", "再試一次", "聽到：" + alts[0]);
    }
  };
  rec.onerror = e => {
    gotResult = true;
    setMic("bad",
      e.error === "not-allowed" || e.error === "service-not-allowed" ? "請允許使用麥克風，然後再試一次。" :
      e.error === "no-speech" ? "沒有聽到聲音，再試一次。" :
      "辨識失敗（" + e.error + "），再試一次。");
  };
  rec.onend = () => {
    listening = false;
    if (!gotResult) setMic("bad", "沒有聽到聲音，再試一次。");
  };

  try { rec.start(); }
  catch (err) { listening = false; setMic("bad", "無法啟動麥克風，再試一次。"); }
}
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
  $("phraseBox").hidden = !data.session;
  $("articleBox").hidden = !data.session;
  $("logoutBtn").hidden = !data.session;
  document.body.classList.toggle("admin", !!data.session);
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

// Several words can be pasted at once: every "Character" title starts a new word
function splitWords(raw) {
  const chunks = [];
  let cur = null;
  raw.replace(/\r/g, "").split("\n").forEach(l => {
    const t = l.trim();
    if (HEADERS.character.test(t.replace(/[:：]\s*$/, ""))) { cur = []; chunks.push(cur); }
    else if (/^-{3,}$/.test(t)) return;                    // optional separator line
    if (cur) cur.push(l);
  });
  return chunks.map(c => c.join("\n"));
}

let parsedList = [];

$("analyzeBtn").onclick = () => {
  const chunks = splitWords($("raw").value);
  if (!chunks.length) {
    parsedList = [];
    $("preview").innerHTML = "";
    $("saveBtn").hidden = true;
    $("adminStatus").textContent = "❌ 找不到 Character（單字）區塊。每個單字都要從 Character 這一行開始。";
    return;
  }
  const seen = new Set();
  parsedList = chunks.map(chunk => {
    try {
      const w = parseWord(chunk);
      if (seen.has(w.character)) throw new Error("這次貼上的內容裡重複了");
      seen.add(w.character);
      return { w };
    } catch (err) {
      const label = chunk.split("\n").map(x => x.trim()).filter(Boolean).slice(0, 2).join(" ");
      return { error: err.message, label };
    }
  });
  const ok = parsedList.filter(x => x.w).length;
  $("preview").innerHTML = parsedList.map((x, i) => x.w
    ? `<details><summary>✅ ${escHTML(x.w.character)} · ${escHTML(x.w.pinyin)}</summary>${previewHTML(x.w)}</details>`
    : `<p class="pv-bad">❌ 第 ${i + 1} 個（${escHTML(x.label)}）：${escHTML(x.error)}</p>`).join("");
  $("saveBtn").textContent = `儲存 ${ok} 個單字`;
  $("saveBtn").hidden = ok === 0;
  $("adminStatus").textContent = `找到 ${parsedList.length} 個單字，${ok} 個可以儲存` +
    (ok < parsedList.length ? "；有問題的會被略過（見紅字）。" : "。");
};

$("saveBtn").onclick = async () => {
  const todo = parsedList.filter(x => x.w);
  if (!todo.length) return;
  $("saveBtn").disabled = true;
  const lines = [];
  let saved = 0;
  for (let i = 0; i < todo.length; i++) {
    $("adminStatus").textContent = `儲存中 ${i + 1} / ${todo.length}…`;
    const w = todo[i].w;
    const { data, error } = await sb.rpc("add_word", { p: w });
    if (error) {
      lines.push(`❌ ${w.character}：` + (/duplicate key/i.test(error.message) ? "已經在資料庫裡了"
        : /not allowed/i.test(error.message) ? "沒有權限儲存" : error.message));
    } else {
      saved++;
      lines.push(`✅ ${w.character} → ${data}`);
    }
  }
  $("saveBtn").disabled = false;
  $("saveBtn").hidden = true;
  $("preview").innerHTML = lines.map(l => `<p>${escHTML(l)}</p>`).join("");
  // The current word stays on screen; new words join the pool of unreviewed words
  $("adminStatus").textContent = `完成：已儲存 ${saved} 個，${todo.length - saved} 個沒有儲存。`;
  parsedList = [];
  lexPromise = null;   // the colored words will include the new words
  if (saved === todo.length) $("raw").value = "";
};

/* ---------- Daily read (Chinese Reading Practice) ---------- */
const CRP_API = "https://chinesereadingpractice.com/wp-json/wp/v2/posts";
let readLoaded = false;

// Simplified -> Traditional (Taiwan wording). If the library failed to load, text stays as is.
const toTw = typeof OpenCC !== "undefined" ? OpenCC.Converter({ from: "cn", to: "twp" }) : null;
const tw = s => (toTw ? toTw(s) : s);

// External text is never inserted as raw HTML
const escHTML = s => String(s ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const decodeHTML = s => new DOMParser().parseFromString(s, "text/html").body.textContent;

const taipeiDate = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
const dayHash = s => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };

// One article per day: chosen by a number derived from the date, so every device
// picks the same one. It is kept in this browser only, so the site is asked once a day.
async function fetchDailyPost() {
  const today = taipeiDate();
  try {
    const cached = JSON.parse(localStorage.getItem("dailyRead") || "null");
    if (cached && cached.date === today) return cached.post;
  } catch (e) { /* ignore a broken cache */ }

  const fields = "id,link,title,content";
  const head = await fetch(`${CRP_API}?per_page=1&_fields=id`);
  if (!head.ok) throw new Error("HTTP " + head.status);
  const total = Number(head.headers.get("X-WP-Total"));

  let res;
  if (total > 0) {
    const idx = dayHash(today) % total;
    res = await fetch(`${CRP_API}?per_page=1&page=${idx + 1}&orderby=date&order=asc&_fields=${fields}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    var post = (await res.json())[0];
  } else {
    // The site did not tell us how many articles exist: choose among the latest 100
    const list = await (await fetch(`${CRP_API}?per_page=100&_fields=id`)).json();
    const id = list[dayHash(today) % list.length].id;
    res = await fetch(`${CRP_API}/${id}?_fields=${fields}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    post = await res.json();
  }
  localStorage.setItem("dailyRead", JSON.stringify({ date: today, post }));
  return post;
}

// Turns the article HTML into: vocabulary lines, Chinese paragraphs, English paragraphs
function parseLesson(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const sections = [];
  let cur = { heading: "", lines: [] };
  doc.body.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li").forEach(n => {
    if (/^H[1-6]$/.test(n.tagName)) {
      if (cur.lines.length) sections.push(cur);
      cur = { heading: n.textContent.trim(), lines: [] };
      return;
    }
    const clone = n.cloneNode(true);
    clone.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
    clone.textContent.split("\n").map(t => t.trim()).filter(Boolean)
      .filter(t => !/show english translation/i.test(t))
      .forEach(t => cur.lines.push(t));
  });
  if (cur.lines.length) sections.push(cur);

  const vocab = [], zh = [], en = [];
  sections.forEach(sec => {
    if (/vocab/i.test(sec.heading)) {
      sec.lines.forEach(l => {
        const p = l.split(/\s+[–—-]\s+/);        // 从来 – cóng lái – always
        vocab.push({ zh: p[0], py: p.length > 2 ? p[1] : "", en: p.length > 2 ? p.slice(2).join(" – ") : (p[1] || "") });
      });
    } else {
      sec.lines.forEach(l => (hasZh(l) ? zh : en).push(l));
    }
  });
  return { vocab, zh, en };
}

function readHTML(post) {
  const title = tw(decodeHTML(post.title.rendered));
  const { vocab, zh, en } = parseLesson(post.content.rendered);
  const link = String(post.link).startsWith("https://chinesereadingpractice.com/") ? post.link : "https://chinesereadingpractice.com/";
  const row = (text, pinyin, trans, ann) => {
    const t = tw(text);
    return `<div class="item">
      <div class="row"><div class="zh">${ann ? annotate(t) : escHTML(t)}</div>${speakBtn(escHTML(t))}</div>
      ${pinyin ? `<div class="py">${escHTML(pinyin)}</div>` : ""}
      ${trans ? `<div>${escHTML(trans)}</div>` : ""}
    </div>`;
  };
  return `
    <h2>每日閱讀</h2>
    <h3 class="read-title">${escHTML(title)}</h3>
    ${vocab.length ? `<section class="blk"><h3>重點詞彙</h3>${vocab.map(v => row(v.zh, v.py, v.en)).join("")}</section>` : ""}
    ${zh.length ? `<section class="blk"><h3>課文</h3>${legendHTML()}${zh.map(p => row(p, "", "", true)).join("")}</section>` : ""}
    ${en.length ? `<details class="blk"><summary>顯示英文翻譯</summary>${en.map(p => `<p class="body">${escHTML(p)}</p>`).join("")}</details>` : ""}
    <p class="source">來源：<a href="${escHTML(link)}" target="_blank" rel="noopener">Chinese Reading Practice</a>（作者 Kendra）。原文為簡體字，此處自動轉為繁體${toTw ? "" : "（轉換工具載入失敗，目前顯示簡體）"}。</p>`;
}

async function loadRead() {
  const box = $("reader");
  box.textContent = "載入中…";
  try {
    const post = await fetchDailyPost();
    await loadLexicon();
    box.innerHTML = readHTML(post);
    readLoaded = true;
  } catch (err) {
    box.innerHTML = `<h2>每日閱讀</h2>
      <p class="body">今天的文章暫時無法載入（${escHTML(err.message)}）。</p>
      <p class="source"><a href="https://chinesereadingpractice.com/" target="_blank" rel="noopener">直接前往 Chinese Reading Practice</a></p>`;
  }
}

function setView(v) {
  document.body.classList.toggle("reading", v === "read");
  document.querySelectorAll(".mode").forEach(b => b.classList.toggle("active", b.dataset.mode === v));
  if (v === "read" && !readLoaded) loadRead();
  window.scrollTo(0, 0);
}

/* ---------- Phrase parser (pasted textbook page -> phrase object) ---------- */
const LATIN_JUNK = /[\p{Script=Latin}\p{M}\d]+/gu;
const stripBase = t => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
// Counts syllables: every run of vowels is split into valid pinyin finals (hei+an -> 2)
const FINALS = /iao|uai|ai|ei|ao|ou|ia|ie|ua|uo|ui|iu|ue|a|o|e|i|u/g;
const syllables = t => (stripBase(t).toLowerCase().match(/[aeiou]+/g) || [])
  .reduce((n, run) => n + (run.match(FINALS) || []).length, 0);
const isPinyinToken = t => /^[a-z]+$/i.test(stripBase(t));
// Keeps only the Chinese: drops pinyin letters, digits and tone marks
const cleanZh = s => s.replace(LATIN_JUNK, " ").replace(/,/g, "，").replace(/\s+/g, " ").trim();

// "1. 膽小 dănxião timid; fearful"  ->  { num, word, pinyin, meaning }
function parseVocabEntry(num, body) {
  body = body.trim();
  const wm = body.match(/^[\u4e00-\u9fff]+/);
  const word = wm ? wm[0] : "";
  const rest = body.slice(word.length).split(/[\u4e00-\u9fff]/)[0].trim();   // stop at stray page footers
  const tokens = rest ? rest.split(/\s+/) : [];
  const need = word ? word.length : 1;       // one syllable per Chinese character
  let i = 0, syl = 0;
  while (i < tokens.length && syl < need && isPinyinToken(tokens[i])) {
    syl += Math.max(1, syllables(tokens[i]));
    i++;
  }
  return { num: Number(num), word, pinyin: tokens.slice(0, i).join(" "), meaning: tokens.slice(i).join(" ") };
}

// Clean markdown format:  # 【成語】, **拼音：**, **詞性：**, **解釋：**,
// **Explanation / Definition:**, **例句：**, ## 例文, ## 生詞 Vocabulary + a table
const MD_LABELS = [
  [/^\*{0,2}\s*拼音\s*\*{0,2}\s*[：:]\s*\*{0,2}\s*(.*)$/, "pinyin"],
  [/^\*{0,2}\s*詞性\s*\*{0,2}\s*[：:]\s*\*{0,2}\s*(.*)$/, "pos"],
  [/^\*{0,2}\s*解釋\s*\*{0,2}\s*[：:]\s*\*{0,2}\s*(.*)$/, "zh"],
  [/^\*{0,2}\s*Explanation\s*\/\s*Definition\s*\*{0,2}\s*[：:]\s*\*{0,2}\s*(.*)$/i, "en"],
  [/^\*{0,2}\s*例句\s*\*{0,2}\s*[：:]\s*\*{0,2}\s*(.*)$/, "example"],
  [/^#{1,6}\s*例文\s*(.*)$/, "story"],
  [/^#{1,6}\s*生詞.*$/, "vocab"]
];

function parsePhraseMd(raw) {
  const m = raw.match(/[【\[]\s*([^】\]]+?)\s*[】\]]/);
  if (!m) throw new Error("找不到【成語】，請確認貼上的內容有標題【成語】。");

  const sec = { pinyin: [], pos: [], zh: [], en: [], example: [], story: [], vocab: [] };
  let key = null;
  raw.replace(/\r/g, "").split("\n").forEach(line => {
    const l = line.trim();
    if (/^-{3,}$/.test(l)) { key = null; return; }
    const hit = MD_LABELS.find(([re]) => re.test(l));
    if (hit) {
      key = hit[1];
      const v = (l.match(hit[0]) || [])[1];
      if (v && key !== "vocab") sec[key].push(v.trim());
      return;
    }
    if (key && l) sec[key].push(l);
  });

  const clean = s => s.replace(/\*\*/g, "").trim();
  const vocab = sec.vocab
    .filter(l => l.startsWith("|"))
    .map(l => l.replace(/^\||\|$/g, "").split("|").map(c => c.trim()))
    .filter(c => c.length >= 4 && /^\d+$/.test(c[0]))
    .map(c => ({ num: Number(c[0]), word: c[1], pinyin: c[2], meaning: c.slice(3).join(" | ") }));

  return {
    phrase: m[1].replace(/\s/g, ""),
    pinyin: clean(sec.pinyin.join(" ")),
    pos: clean(sec.pos.join(" ")),
    example: clean(sec.example.join(" ")),
    explanation_zh: clean(sec.zh.join("")),
    explanation_en: clean(sec.en.join(" ")),
    story: sec.story.map(clean).join("\n"),     // one line per paragraph
    vocab
  };
}

// Picks the right parser for what was pasted
function parsePhrase(raw) {
  return /\*\*\s*拼音|\n\s*\|\s*\d+\s*\|/.test(raw) ? parsePhraseMd(raw) : parsePhraseScan(raw);
}

// Old format: text copied from a scanned book page
function parsePhraseScan(raw) {
  const t = raw.replace(/\s+/g, " ").trim();
  const m = t.match(/[【\[]\s*([^】\]]+?)\s*[】\]]/);
  if (!m) throw new Error("找不到【成語】，請確認貼上的內容從【成語】開始。");
  const after = t.slice(m.index + m[0].length);

  const posAt = after.search(/Part of Speech/i);
  const pinyin = posAt > 0 ? after.slice(0, posAt).trim() : "";
  const pos = (after.match(/Part of Speech\s*(.+?)\s*(?:Connotation|解釋|$)/i) || [])[1] || "";

  // Example sentence + Chinese explanation sit between "Example" and "Explanation/Definition"
  const exAt = after.search(/Example/i);
  const defAt = after.search(/Explanation\s*\/\s*Definition/i);
  let example = "", explanation_zh = "";
  if (exAt >= 0 && defAt > exAt) {
    const segs = cleanZh(after.slice(exAt + 7, defAt)).split(" ").filter(Boolean);
    example = segs[0] || "";
    explanation_zh = segs.slice(1).join("");
  }
  const en = after.match(/Explanation\s*\/\s*Definition\s*:?\s*(.+?)\s*(?:例文|$)/i);

  // Story: between "例文" and the vocabulary list (the pinyin lines mixed in are removed)
  const stAt = after.indexOf("例文");
  const vAt = after.search(/生詞|Vocabulary/i);
  let story = "";
  if (stAt >= 0) {
    story = cleanZh(after.slice(stAt + 2, vAt > stAt ? vAt : undefined))
      .replace(/\s+/g, "").replace(/^[:：]+/, "").replace(/[“”]/g, "");   // stray scan marks
  }

  // Vocabulary: numbered entries after the word "Vocabulary"
  const vocab = [];
  const vm = after.search(/Vocabulary/i);
  if (vm >= 0) {
    const parts = after.slice(vm + 10).split(/(?:^|\s)(\d{1,3})\.\s+/);
    for (let i = 1; i < parts.length; i += 2) vocab.push(parseVocabEntry(parts[i], parts[i + 1] || ""));
  }

  return {
    phrase: m[1].replace(/\s/g, ""), pinyin, pos, example,
    explanation_zh, explanation_en: en ? en[1] : "", story, vocab
  };
}

/* ---------- Admin: editable form for a parsed phrase ---------- */
const fld = (id, label, val, area) => `<label class="lbl">${label}</label>` +
  (area ? `<textarea id="${id}" rows="5">${escHTML(val)}</textarea>`
        : `<input id="${id}" value="${escHTML(val)}">`) +
  `<small class="err" data-err="${id}"></small>`;

function phraseFormHTML(p) {
  return fld("pf_phrase", "成語", p.phrase) + fld("pf_pinyin", "拼音", p.pinyin) + fld("pf_pos", "詞性", p.pos)
    + fld("pf_example", "例句", p.example) + fld("pf_zh", "解釋（中文）", p.explanation_zh, true)
    + fld("pf_en", "解釋（英文）", p.explanation_en, true) + fld("pf_story", "故事", p.story, true)
    + `<label class="lbl">生詞（共 ${p.vocab.length} 個）：請檢查每一列。缺少的內容請補上，不要的列把三格清空。</label>`
    + p.vocab.map(v => vrowHTML(v)).join("")
    + `<button class="btn ghost" data-vadd="1">＋ 新增一列生詞</button>`;
}

const vrowHTML = v => `<div class="vrow" data-num="${v.num}"><span class="vnum">${v.num}</span>
        <input class="v-word" value="${escHTML(v.word)}" placeholder="詞">
        <input class="v-py" value="${escHTML(v.pinyin)}" placeholder="拼音">
        <input class="v-mean" value="${escHTML(v.meaning)}" placeholder="意思">
        <small class="err vrow-err"></small></div>`;

function addVocabRow() {
  const btn = document.querySelector("#pForm [data-vadd]");
  if (!btn) return;
  const nums = [...document.querySelectorAll("#pForm .vrow")].map(r => Number(r.dataset.num));
  btn.insertAdjacentHTML("beforebegin", vrowHTML({ num: Math.max(0, ...nums) + 1, word: "", pinyin: "", meaning: "" }));
  const rows = document.querySelectorAll("#pForm .vrow");
  rows[rows.length - 1].querySelector(".v-word").focus();
}

function readPhraseForm() {
  const val = id => $(id).value.trim();
  const vocab = [...document.querySelectorAll("#pForm .vrow")].map(r => ({
    num: Number(r.dataset.num),
    word: r.querySelector(".v-word").value.trim(),
    pinyin: r.querySelector(".v-py").value.trim(),
    meaning: r.querySelector(".v-mean").value.trim()
  })).filter(v => v.word || v.pinyin || v.meaning);
  return {
    phrase: val("pf_phrase"), pinyin: val("pf_pinyin"), pos: val("pf_pos"), example: val("pf_example"),
    explanation_zh: val("pf_zh"), explanation_en: val("pf_en"), story: val("pf_story"), vocab
  };
}

// Marks every problem field in red (with a short message) and returns how many there are
// A word or phrase only needs at least ONE Chinese character, so entries such as 照x光 or 把…給 are accepted
const hasZhChar = s => /[\u4e00-\u9fff]/.test(s);
const isPinyin = s => /^[\p{Script=Latin}\p{M}\s'’\-…·.,;\/()~、，]+$/u.test(s);

function validatePhraseForm() {
  let bad = 0;
  const flag = (el, msg) => { el.classList.toggle("bad", !!msg); if (msg) bad++; };

  [
    ["pf_phrase", v => !v ? "請填寫成語" : !hasZhChar(v) ? "成語裡至少要有一個中文字" : ""],
    ["pf_pinyin", v => !v ? "請填寫拼音" : !isPinyin(v) ? "拼音只能有英文字母和聲調符號" : ""],
    ["pf_example", v => v ? "" : "請填寫例句"],
    ["pf_zh", v => v ? "" : "請填寫中文解釋"],
    ["pf_en", v => v ? "" : "請填寫英文解釋"],
    ["pf_story", v => v ? "" : "請填寫故事"]
  ].forEach(([id, rule]) => {
    const el = $(id), msg = rule(el.value.trim());
    flag(el, msg);
    document.querySelector(`[data-err="${id}"]`).textContent = msg;
  });

  // A vocabulary row left completely empty is ignored; a half-filled row is an error
  document.querySelectorAll("#pForm .vrow").forEach(r => {
    const [w, p, m] = [".v-word", ".v-py", ".v-mean"].map(s => r.querySelector(s));
    const [vw, vp, vm] = [w, p, m].map(x => x.value.trim());
    const empty = !vw && !vp && !vm;
    const wm = empty ? "" : !vw ? "缺少詞" : !hasZhChar(vw) ? "詞裡至少要有一個中文字" : "";
    const pm = empty ? "" : !vp ? "缺少拼音" : !isPinyin(vp) ? "拼音格式不對" : "";
    const mm = empty ? "" : !vm ? "缺少意思" : !/[A-Za-z]/.test(vm) ? "意思裡沒有英文（可能放錯欄位）" : "";
    flag(w, wm); flag(p, pm); flag(m, mm);
    r.querySelector(".vrow-err").textContent = [wm, pm, mm].filter(Boolean).join("；");
  });

  $("pStatus").textContent = bad
    ? `❌ 有 ${bad} 個地方要修正（紅色欄位）。修好後紅色會自動消失。`
    : "✅ 沒有發現問題，可以按「儲存成語」。";
  return bad;
}

// Re-check while you type, so red marks disappear as soon as a field is fixed
$("pForm").addEventListener("input", () => validatePhraseForm());

$("pAnalyzeBtn").onclick = () => {
  try {
    $("pForm").innerHTML = phraseFormHTML(parsePhrase($("praw").value));
    $("pSaveBtn").hidden = false;
    validatePhraseForm();
  } catch (err) {
    $("pForm").innerHTML = "";
    $("pSaveBtn").hidden = true;
    $("pStatus").textContent = "❌ " + err.message;
  }
};

let editingPhrase = null;   // code of the phrase being edited (null = adding a new one)

function resetPhraseCard() {
  editingPhrase = null;
  $("pHead").textContent = "新增成語";
  $("pSaveBtn").textContent = "儲存成語";
  $("pSaveBtn").hidden = true;
  $("pCancelBtn").hidden = true;
  $("pForm").innerHTML = "";
  $("pStatus").textContent = "";
}

async function startEditPhrase() {
  const p = curPhrase;
  if (!p) return;
  editingPhrase = p.code;
  setAdmin(true);
  await refreshAdmin();
  $("pHead").textContent = "編輯成語";
  $("praw").value = "";
  $("pForm").innerHTML = phraseFormHTML({
    phrase: p.phrase, pinyin: p.pinyin || "", pos: p.pos || "", example: p.example || "",
    explanation_zh: p.explanation_zh || "", explanation_en: p.explanation_en || "", story: p.story || "",
    vocab: p.phrase_vocab.map(v => ({ num: v.num, word: v.word || "", pinyin: v.pinyin || "", meaning: v.meaning || "" }))
  });
  $("pSaveBtn").textContent = "儲存修改";
  $("pSaveBtn").hidden = false;
  $("pCancelBtn").hidden = false;
  validatePhraseForm();
  $("pStatus").textContent = `正在編輯「${p.phrase}」。` + $("pStatus").textContent;
  $("phraseBox").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("pEditBtn").onclick = () => startEditPhrase();
$("pCancelBtn").onclick = () => resetPhraseCard();

$("pSaveBtn").onclick = async () => {
  if (validatePhraseForm()) {
    const first = document.querySelector("#pForm .bad");
    if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const obj = readPhraseForm();
  $("pSaveBtn").disabled = true;
  const editing = editingPhrase;
  const { data, error } = editing
    ? await sb.rpc("update_phrase", { p_code: editing, p: obj })
    : await sb.rpc("add_phrase", { p: obj });
  $("pSaveBtn").disabled = false;
  if (error) {
    $("pStatus").textContent =
      /duplicate key/i.test(error.message) ? "❌ 這個成語已經存在。" :
      /not allowed/i.test(error.message) ? "❌ 沒有權限儲存：資料庫不認得這個登入帳號。請在 Supabase 執行 fix-phrases.sql。" :
      "❌ " + error.message;
    return;
  }
  lexPromise = null;
  if (editing) {
    resetPhraseCard();
    $("pStatus").textContent = "✅ 已儲存修改";
    try { curPhrase = await fetchPhrase(editing); renderPhrases(); }
    catch (err) { $("pStatus").textContent += "（但重新載入失敗：" + err.message + "）"; }
    return;
  }
  $("pStatus").textContent = "✅ 已儲存，編號 " + data;
  if (!curPhrase) openPhrases();
  $("praw").value = "";
  $("pForm").innerHTML = "";
  $("pSaveBtn").hidden = true;
};

/* ---------- Screens: home / vocabulary / phrases ---------- */
let curPhrase = null;   // the current phrase (stays until you confirm it with the PIN)
let pStep = 0;
let stageMsg = "";

function setScreen(name) {
  document.body.dataset.screen = name;
  if (name === "articles") openArticles();
  // Only one lesson at a time stays in the page (the microphone and PIN elements use
  // fixed ids), so the other one is emptied and drawn again when you come back
  if (name === "phrases") {
    $("stage").innerHTML = "";
    $("tabs").innerHTML = "";
    openPhrases();
  } else {
    $("pbody").innerHTML = "";
    $("ptabs").innerHTML = "";
    if (name === "vocab") {
      if (word) render();
      else if (stageMsg) $("stage").textContent = stageMsg;
    }
  }
  window.scrollTo(0, 0);
}

async function fetchPhrase(code) {
  const { data, error } = await sb.from("phrases").select("*, phrase_vocab(*)").eq("code", code).single();
  if (error) throw error;
  data.phrase_vocab.sort((a, b) => a.num - b.num);
  return data;
}

function showPhraseDone() {
  curPhrase = null;
  $("pEditBtn").hidden = true;
  $("ptabs").hidden = true;
  $("pstepbar").hidden = true;
  $("pbody").textContent = "目前沒有可學習的成語（還沒新增，或全部都學完了）。請到頁面最下方的「管理」新增。";
}

// Same method as vocabulary: the database keeps the same phrase until it is confirmed
async function openPhrases() {
  $("pEditBtn").hidden = true;
  $("ptabs").hidden = true;
  $("pstepbar").hidden = true;
  $("pbody").textContent = "載入中…";
  try {
    const { data: code, error } = await sb.rpc("get_current_phrase");
    if (error) throw error;
    if (!code) { showPhraseDone(); return; }
    curPhrase = await fetchPhrase(code);
    await loadLexicon();
  } catch (err) {
    $("pbody").textContent = "無法載入成語：" + err.message;
    return;
  }
  pStep = 0;
  renderPhrases();
}

const zhRow = t => `<div class="item"><div class="row"><div class="zh">${escHTML(t)}</div>${speakBtn(escHTML(t))}</div></div>`;
const storyParts = p => !p.story ? [] : p.story.includes("\n")
  ? p.story.split("\n").filter(Boolean)                    // paragraphs, as pasted
  : (p.story.match(/[^。]+。?/g) || [p.story]);             // old format: one row per sentence

function pSteps(p) {
  const s = [{ id: "info", title: "成語" }, { id: "speak", title: "口說" }];
  if (p.explanation_zh || p.explanation_en || p.example) s.push({ id: "explain", title: "解釋" });
  if (p.phrase_vocab.length) s.push({ id: "vocab", title: "生詞" });
  if (p.story) s.push({ id: "story", title: "故事" });
  s.push({ id: "summary", title: "總結" }, { id: "confirm", title: "確認" });
  return s;
}

function infoHTML(p) {
  return `<h2>成語</h2>
    <div class="hero">
      <div class="hanzi" style="font-size:64px">${escHTML(p.phrase)}</div>
      <div class="py big">${escHTML(p.pinyin || "")}</div>
      <div class="listen">${speakBtn(escHTML(p.phrase))}<span>發音</span></div>
    </div>
    ${p.pos ? `<div class="note"><small>詞性</small><p>${escHTML(p.pos)}</p></div>` : ""}`;
}

function explainHTML(p) {
  return `<h2>解釋</h2>
    ${legendHTML()}
    ${p.explanation_zh ? `<p class="body">${annotate(p.explanation_zh)}</p>` : ""}
    ${p.explanation_en ? `<p class="py">${escHTML(p.explanation_en)}</p>` : ""}
    ${p.example ? `<section class="blk"><h3>例句</h3>${zhRowA(p.example)}</section>` : ""}`;
}

/* Flashcards: tap to flip; "我會了" asks you to type the word, and a correct word turns the card green */
const knownKey = code => "known:" + code;
const knownSet = code => {
  try { return new Set(JSON.parse(localStorage.getItem(knownKey(code)) || "[]")); }
  catch (e) { return new Set(); }
};

function vocabHTML(p) {
  const list = [...p.phrase_vocab].sort((a, b) => a.num - b.num);
  if (!list.length) return `<h2>生詞</h2><p class="body">這個成語還沒有生詞。</p>`;
  const known = knownSet(p.code);
  const size = w => w.length <= 2 ? 40 : w.length <= 4 ? 32 : 24;
  return `<h2>生詞</h2><p class="py">點一下方塊翻面。按「我會了」並打出這個詞，打對了方塊就會變綠色。</p><div class="cards">` +
    list.map(v => {
      const w = v.word || "";
      const done = !!w && known.has(v.num);
      return `
    <div class="fc ${done ? "done" : ""}" data-num="${v.num}" data-word="${escHTML(w)}"><div class="fc-in">
      <div class="fc-front">
        <div class="fc-word" style="font-size:${size(w)}px">${escHTML(w || v.num)}</div>
        ${w ? `<div class="fc-ctl">${done ? "✓" : `<button class="know" data-know="1">我會了</button>`}</div>` : ""}
      </div>
      <div class="fc-back"><div class="fc-body">
        <div class="zh">${escHTML(w)}</div>
        <div class="py">${escHTML(v.pinyin || "")}</div>
        <div class="fc-mean">${escHTML(v.meaning || "")}</div>
        ${w ? speakBtn(escHTML(w)) : ""}
      </div></div>
    </div></div>`;
    }).join("") + `</div>`;
}

function openKnow(card) {
  const ctl = card.querySelector(".fc-ctl");
  ctl.innerHTML = `<input class="know-in" placeholder="輸入這個詞" autocomplete="off"><button class="know-ok">確認</button>`;
  ctl.querySelector(".know-in").focus();
}

function checkKnow(card) {
  const input = card.querySelector(".know-in");
  if (!input) return;
  if (input.value.trim().normalize("NFC") === card.dataset.word.normalize("NFC")) {
    card.classList.add("done");
    card.querySelector(".fc-ctl").textContent = "✓";
    const set = knownSet(curPhrase.code);
    set.add(Number(card.dataset.num));
    localStorage.setItem(knownKey(curPhrase.code), JSON.stringify([...set]));
  } else {
    input.classList.add("bad");
    input.value = "";
    input.placeholder = "再試一次";
  }
}

function storyHTML(p) {
  if (!p.story) return `<h2>故事</h2><p class="body">這個成語還沒有故事。</p>`;
  return `<h2>故事</h2>
    <button class="btn ghost" data-say="${escHTML(p.story)}">朗讀全文</button>
    ${legendHTML()}
    <div style="margin-top:14px">${storyParts(p).map(zhRowA).join("")}</div>`;
}

function phraseSummaryHTML(p) {
  const block = (t, h) => h ? `<section class="blk"><h3>${t}</h3>${h}</section>` : "";
  const words = p.phrase_vocab.map(v => `
    <div class="item">
      <div class="row"><div class="zh">${escHTML(v.word || "")}</div>${v.word ? speakBtn(escHTML(v.word)) : ""}</div>
      <div class="py">${escHTML(v.pinyin || "")}</div>
      <div>${escHTML(v.meaning || "")}</div>
    </div>`).join("");
  return `<h2>總結</h2>
    <div class="hero small">
      <div class="hanzi">${escHTML(p.phrase)}</div>
      <div class="py big">${escHTML(p.pinyin || "")}</div>
      ${speakBtn(escHTML(p.phrase))}
    </div>
    ${block("詞性", p.pos && `<p class="body">${escHTML(p.pos)}</p>`)}
    ${legendHTML()}
    ${block("解釋", (p.explanation_zh ? `<p class="body">${annotate(p.explanation_zh)}</p>` : "") +
                    (p.explanation_en ? `<p class="py">${escHTML(p.explanation_en)}</p>` : ""))}
    ${block("例句", p.example && zhRowA(p.example))}
    ${block("生詞", words)}
    ${block("故事", storyParts(p).map(zhRowA).join(""))}`;
}

function phraseSection(id, p, title) {
  switch (id) {
    case "info":    return infoHTML(p);
    case "speak":   return speakSection(title, p.phrase, p.pinyin, p.phrase, "成語");
    case "explain": return explainHTML(p);
    case "vocab":   return vocabHTML(p);
    case "story":   return storyHTML(p);
    case "confirm": return `<h2>${title}</h2>${finishHTML(true)}`;
    default:        return phraseSummaryHTML(p);
  }
}

function renderPhrases() {
  const steps = pSteps(curPhrase);
  pStep = Math.min(pStep, steps.length - 1);
  $("ptabs").hidden = false;
  $("pstepbar").hidden = false;
  $("pEditBtn").hidden = false;
  $("ptabs").innerHTML = steps.map((s, i) =>
    `<button class="tab ${i === pStep ? "active" : ""}" data-pstep="${i}">${s.title}</button>`).join("");
  $("pbody").innerHTML = phraseSection(steps[pStep].id, curPhrase, steps[pStep].title);
  $("pPrevStep").disabled = pStep === 0;
  $("pNextStep").hidden = pStep === steps.length - 1;   // on the last step the big check takes over
  window.scrollTo(0, 0);
}

$("pNextStep").onclick = () => {
  if (pStep < pSteps(curPhrase).length - 1) { pStep++; renderPhrases(); }
};
$("pPrevStep").onclick = () => { if (pStep > 0) { pStep--; renderPhrases(); } };

/* ---------- Word lookup: click a word for pinyin + meaning, unknown words in color ---------- */
let lex = new Map();     // every word, phrase and expression that is in your database
let lexMax = 1;
let lexOk = false;
let lexPromise = null;

async function fetchAll(table, cols) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

function loadLexicon() {
  if (lexPromise) return lexPromise;
  lexPromise = (async () => {
    try {
      const [w, pv, ph, ex] = await Promise.all([
        fetchAll("words", "hanzi,pinyin,meaning"),
        fetchAll("phrase_vocab", "word,pinyin,meaning"),
        fetchAll("phrases", "phrase,pinyin,explanation_en"),
        fetchAll("expressions", "zh,pinyin,en")
      ]);
      const m = new Map();
      const add = (k, pinyin, meaning) => {
        k = (k || "").trim();
        if (k && hasZh(k) && !m.has(k)) m.set(k, { pinyin: pinyin || "", meaning: meaning || "" });
      };
      w.forEach(r => add(r.hanzi, r.pinyin, r.meaning));
      pv.forEach(r => add(r.word, r.pinyin, r.meaning));
      ph.forEach(r => add(r.phrase, r.pinyin, r.explanation_en));
      ex.forEach(r => add(r.zh, r.pinyin, r.en));
      lex = m;
      lexMax = Math.max(1, ...[...m.keys()].map(k => k.length));
      lexOk = true;
    } catch (err) {
      lexOk = false;      // colors are switched off, clicking still works
    }
  })();
  return lexPromise;
}

// Very common words are never painted, so the color only points at words worth checking
const COMMON = new Set(("的 了 是 在 我 你 他 她 它 們 這 那 有 和 與 也 都 就 不 沒 很 會 能 可 以 為 而 但 及 或 把 被 對 從 到 說 要 嗎 呢 吧 啊 之 其 等 於 個 一 二 三 四 五 六 七 八 九 十 上 下 中 大 小 多 少 好 來 去 人 又 還 才 只 想 看 做 讓 給 跟 向 由 如 若 則 並 且 所 已 曾 將 著 過 地 得 " +
  "我們 你們 他們 她們 自己 因為 所以 但是 如果 可以 沒有 什麼 這個 那個 一個 已經 還是 或是 以及 以後 以前 因此 然而 不過 而且 雖然 可是 一些 這樣 那樣 這些 那些 怎麼 為什麼 時候 現在 今天 明天 昨天 知道 覺得 需要 應該 可能 不是 就是 也是 都是 一樣 一起 一定 非常 比較 每個").split(" "));

const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("zh", { granularity: "word" }) : null;

// Inside a chunk that is not a known word, still pick out your own multi-character words
function classify(t) {
  if (lex.has(t)) return [{ t, k: "known" }];
  if (COMMON.has(t)) return [{ t, k: "common" }];
  const res = [];
  let rest = "", i = 0;
  const flush = () => { if (rest) { res.push({ t: rest, k: COMMON.has(rest) ? "common" : "unk" }); rest = ""; } };
  while (i < t.length) {
    let hit = "";
    for (let L = Math.min(lexMax, t.length - i); L >= 2; L--) {
      const c = t.substr(i, L);
      if (lex.has(c)) { hit = c; break; }
    }
    if (hit) { flush(); res.push({ t: hit, k: "known" }); i += hit.length; }
    else { rest += t[i]; i++; }
  }
  flush();
  return res;
}

function tokens(text) {
  const pieces = segmenter
    ? [...segmenter.segment(text)].map(x => x.segment)
    : (text.match(/[\u4e00-\u9fff]+|[^\u4e00-\u9fff]+/g) || []);
  const out = [];
  pieces.forEach(t => {
    if (!hasZh(t)) out.push({ t, k: "x" });
    else out.push(...classify(t));
  });
  return out;
}

// Text with every word clickable; words that are NOT in your database get the color
function annotate(text) {
  return tokens(String(text ?? "")).map(x => x.k === "x" ? escHTML(x.t)
    : `<span class="w ${lexOk ? x.k : "common"}" data-w="${escHTML(x.t)}">${escHTML(x.t)}</span>`).join("");
}
const annotateBold = text => String(text).split("**")
  .map((seg, i) => i % 2 ? `<strong>${annotate(seg)}</strong>` : annotate(seg)).join("");
const zhRowA = t => `<div class="item"><div class="row"><div class="zh">${annotate(t)}</div>${speakBtn(escHTML(t))}</div></div>`;
const legendHTML = () => lexOk
  ? `<p class="legend"><span class="lg-unk">橘色</span> ＝ 資料庫裡沒有的詞。點一下任何詞，可以看拼音和意思。</p>`
  : `<p class="legend">點一下任何詞，可以看拼音和意思。</p>`;

async function translateWord(w) {
  const key = "lookup:" + w;
  const cached = localStorage.getItem(key);
  if (cached) return cached;
  try {
    const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(w)}&langpair=zh-TW|en`);
    const j = await r.json();
    const t = (j.responseData && j.responseData.translatedText) || "";
    if (!t || /MYMEMORY WARNING|INVALID|QUERY LENGTH/i.test(t)) return "";
    localStorage.setItem(key, t);
    return t;
  } catch (err) { return ""; }
}

let lookupWord = "";
function hideLookup() { lookupWord = ""; $("lookup").hidden = true; }

async function showLookup(w) {
  lookupWord = w;
  const info = lex.get(w);
  const py = (info && info.pinyin) || (typeof pinyinPro !== "undefined" ? pinyinPro.pinyin(w, { toneType: "symbol" }) : "");
  const gt = `https://translate.google.com/?sl=zh-TW&tl=en&text=${encodeURIComponent(w)}&op=translate`;
  const box = $("lookup");
  box.hidden = false;
  box.innerHTML = `
    <button class="lk-x" data-lk-close="1" aria-label="關閉">×</button>
    <div class="lk-row"><span class="lk-w">${escHTML(w)}</span>${speakBtn(escHTML(w))}</div>
    <div class="lk-py">${escHTML(py)}</div>
    <div class="lk-mean" id="lkMean">${info && info.meaning ? escHTML(info.meaning) : "查詢中…"}</div>
    <div class="lk-foot">${info ? "<span class='lk-tag'>資料庫裡有</span>" : "<span class='lk-tag unk'>資料庫裡沒有</span>"}
      <a href="${gt}" target="_blank" rel="noopener">在 Google 翻譯開啟</a></div>`;
  if (info && info.meaning) return;
  const m = await translateWord(w);
  const el = $("lkMean");
  if (lookupWord === w && el) el.textContent = m ? m + "（機器翻譯，僅供參考）" : "暫時查不到意思，可以用下面的連結查詢。";
}

/* ---------- Articles (readings you paste in yourself) ---------- */
let articles = [];
let curArticle = null;
let articleTab = "unread";   // which list is open: "unread" or "read"
let articleNote = "";        // one-time message shown at the top of the list

const plainText = t => String(t).replace(/\*\*/g, "");
// **text** becomes bold; everything else is shown as plain, safe text
const boldHTML = t => escHTML(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
const paragraphs = body => body.split("\n").map(x => x.trim()).filter(Boolean);

async function openArticles() {
  curArticle = null;
  $("abody").textContent = "載入中…";
  try {
    const { data, error } = await sb.from("articles").select("*").order("study_order", { ascending: false });
    if (error) throw error;
    articles = data;
    await loadLexicon();
  } catch (err) {
    $("abody").textContent = "無法載入文章：" + err.message;
    return;
  }
  renderArticles();
}

function renderArticles() {
  if (curArticle) {
    const paras = paragraphs(curArticle.body);
    $("abody").innerHTML = `
      <button class="btn ghost" data-aback="1">‹ 文章列表</button>
      <h2 style="margin-top:14px">${escHTML(curArticle.title)}</h2>
      <button class="btn ghost" data-say="${escHTML(plainText(paras.join("")))}">朗讀全文</button>
      <button class="btn ghost edit-btn" data-aedit="1">編輯這篇文章</button>
      ${legendHTML()}
      <div style="margin-top:14px">${paras.map(p => `
        <div class="item"><div class="row"><div class="zh article-p">${annotateBold(p)}</div>${speakBtn(escHTML(plainText(p)))}</div></div>`).join("")}</div>
      <div class="read-end">
        ${curArticle.read_at
          ? `<p class="py">這篇文章已經標記為「已複習」。</p><button class="btn ghost" data-aunread="1">標記為未複習</button>`
          : `<button class="btn primary big-read" data-aread="1">✓ 已複習</button>`}
        <p class="py" id="aReadMsg"></p>
      </div>`;
    return;
  }
  if (!articles.length) {
    $("abody").innerHTML = `<h2>文章</h2><p class="body">還沒有文章。請到頁面最下方的「管理」新增。</p>`;
    return;
  }
  const isRead = articleTab === "read";
  const shown = articles.filter(a => (isRead ? a.read_at : !a.read_at));
  if (isRead) shown.sort((x, y) => String(y.read_at).localeCompare(String(x.read_at)));   // newest reviewed first
  const note = articleNote;
  articleNote = "";
  $("abody").innerHTML = `<h2>文章</h2>
    <div class="subtabs">
      <button class="subtab ${isRead ? "" : "active"}" data-atab="unread">未複習</button>
      <button class="subtab ${isRead ? "active" : ""}" data-atab="read">已複習</button>
    </div>
    ${note ? `<p class="py">${escHTML(note)}</p>` : ""}` +
    (shown.length ? shown.map(a => `
    <button class="plist" data-article="${escHTML(a.code)}">
      <span class="zh" style="font-size:18px">${escHTML(a.title)}</span><span class="py">${paragraphs(a.body).length} 段</span>
    </button>`).join("")
      : `<p class="body">${isRead ? "還沒有已複習的文章。" : "沒有未複習的文章了。"}</p>`);
}

// Mark the open article as reviewed (or undo it); the list is saved in the database
async function setArticleRead(read) {
  const a = curArticle;
  if (!a) return;
  const btn = document.querySelector("[data-aread], [data-aunread]");
  if (btn) btn.disabled = true;
  const { error } = await sb.rpc(read ? "mark_article_read" : "mark_article_unread", { p_code: a.code });
  if (error) {
    if (btn) btn.disabled = false;
    const msg = $("aReadMsg");
    if (msg) msg.textContent = "❌ 無法儲存：" + error.message + "（如果是新功能，請先在 Supabase 執行 article-read.sql）";
    return;
  }
  a.read_at = read ? new Date().toISOString() : null;   // a is the same object as in `articles`
  articleNote = read ? `已把「${a.title}」移到「已複習」。` : `已把「${a.title}」放回「未複習」。`;
  curArticle = null;
  articleTab = "unread";
  renderArticles();
  window.scrollTo(0, 0);
}

// First line = title. If the title and the first paragraph arrived on the same line,
// the title is cut before the first opening quotation mark.
function parseArticle(raw) {
  const lines = raw.replace(/\r/g, "").split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error("沒有內容，請先貼上文章。");
  const first = lines[0];
  const clean = t => t.replace(/\*\*/g, "").trim();
  let title, rest, guessed = false;
  const tm = first.match(/^(?:#+\s*|(?:Title|標題)\s*[:：]\s*)(.+)$/i);
  if (tm) { title = clean(tm[1]); rest = lines.slice(1); }
  else if (first.length <= 40) { title = clean(first); rest = lines.slice(1); }
  else {
    guessed = true;
    const q = first.search(/[「『“（(]/);
    const cut = q > 0 && q <= 40 ? q : 20;
    title = clean(first.slice(0, cut));
    rest = [first.slice(cut).trim(), ...lines.slice(1)];
  }
  return { title, body: rest.join("\n"), guessed };
}

function articleFormHTML(a) {
  return `<label class="lbl">標題</label>
    <input id="af_title" value="${escHTML(a.title)}"><small class="err" data-err="af_title"></small>
    <label class="lbl">內文（每一段一行；用 **文字** 可以顯示成粗體）</label>
    <textarea id="af_body" rows="14">${escHTML(a.body)}</textarea><small class="err" data-err="af_body"></small>`;
}

function validateArticleForm() {
  let bad = 0;
  [
    ["af_title", v => !v ? "請填寫標題" : !hasZh(v) ? "標題裡至少要有一個中文字" : v.length > 60 ? "標題太長了，可能把第一段也包進來了" : ""],
    ["af_body", v => !v ? "請填寫內文" : !hasZh(v) ? "內文裡沒有中文字" : ""]
  ].forEach(([id, rule]) => {
    const el = $(id), msg = rule(el.value.trim());
    el.classList.toggle("bad", !!msg);
    if (msg) bad++;
    document.querySelector(`[data-err="${id}"]`).textContent = msg;
  });
  const n = paragraphs($("af_body").value).length;
  $("aStatus").textContent = bad
    ? `❌ 有 ${bad} 個地方要修正（紅色欄位）。`
    : `✅ 沒有發現問題（共 ${n} 段），可以按「儲存文章」。`;
  return bad;
}

$("aForm").addEventListener("input", () => validateArticleForm());

$("aAnalyzeBtn").onclick = () => {
  try {
    const a = parseArticle($("araw").value);
    $("aForm").innerHTML = articleFormHTML(a);
    $("aSaveBtn").hidden = false;
    const bad = validateArticleForm();
    if (a.guessed && !bad) $("aStatus").textContent += " 標題是自動判斷的，請確認標題是否正確。";
  } catch (err) {
    $("aForm").innerHTML = "";
    $("aSaveBtn").hidden = true;
    $("aStatus").textContent = "❌ " + err.message;
  }
};

let editingArticle = null;   // code of the article being edited (null = adding a new one)

function resetArticleCard() {
  editingArticle = null;
  $("aHead").textContent = "新增文章";
  $("aSaveBtn").textContent = "儲存文章";
  $("aSaveBtn").hidden = true;
  $("aCancelBtn").hidden = true;
  $("aForm").innerHTML = "";
  $("aStatus").textContent = "";
}

async function startEditArticle() {
  const a = curArticle;
  if (!a) return;
  editingArticle = a.code;
  setAdmin(true);
  await refreshAdmin();
  $("aHead").textContent = "編輯文章";
  $("araw").value = "";
  $("aForm").innerHTML = articleFormHTML({ title: a.title, body: a.body });
  $("aSaveBtn").textContent = "儲存修改";
  $("aSaveBtn").hidden = false;
  $("aCancelBtn").hidden = false;
  validateArticleForm();
  $("aStatus").textContent = `正在編輯「${a.title}」。` + $("aStatus").textContent;
  $("articleBox").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("aCancelBtn").onclick = () => resetArticleCard();

$("aSaveBtn").onclick = async () => {
  if (validateArticleForm()) {
    const first = document.querySelector("#aForm .bad");
    if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const article = { title: $("af_title").value.trim(), body: paragraphs($("af_body").value).join("\n") };
  $("aSaveBtn").disabled = true;
  const editing = editingArticle;
  const { data, error } = editing
    ? await sb.rpc("update_article", { p_code: editing, p: article })
    : await sb.rpc("add_article", { p: article });
  $("aSaveBtn").disabled = false;
  if (error) {
    $("aStatus").textContent =
      /duplicate key/i.test(error.message) ? "❌ 已經有同樣標題的文章了。" :
      /not allowed|permission/i.test(error.message) ? "❌ 沒有權限儲存，請確認你已經登入。" :
      "❌ " + error.message;
    return;
  }
  if (editing) {
    const a = articles.find(x => x.code === editing);
    if (a) { a.title = article.title; a.body = article.body; }   // curArticle is this same object
    resetArticleCard();
    $("aStatus").textContent = "✅ 已儲存修改";
    renderArticles();
    return;
  }
  $("aStatus").textContent = "✅ 已儲存，編號 " + data;
  $("araw").value = "";
  $("aForm").innerHTML = "";
  $("aSaveBtn").hidden = true;
  openArticles();   // refresh the list so the new article appears
};

/* ---------- Start ---------- */
// The edit buttons are only visible while you are logged in
sb.auth.onAuthStateChange((_event, session) => document.body.classList.toggle("admin", !!session));
sb.auth.getSession().then(({ data }) => document.body.classList.toggle("admin", !!data.session));

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
    stageMsg = "無法載入單字：" + err.message;
    $("stage").textContent = stageMsg;
  })
  .finally(() => { if (location.hash === "#admin") setAdmin(true); });