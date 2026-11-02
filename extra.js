// Dashboard + exam. Loaded AFTER app.js (it reuses sb, $, escHTML, fetchAll, isMatch, SR, ...).
(() => {
  const TZ = "Asia/Taipei";
  const EXAM_SIZE = 25;
  const SQL_HINT = "（如果是新功能，請先在 Supabase 執行 exam.sql）";

  /* ---------- Hook the two new screens into setScreen ---------- */
  const baseSetScreen = setScreen;
  setScreen = function (name) {
    stopExam();
    baseSetScreen(name);
    if (name === "dashboard") openDashboard();
    if (name === "exam") openExam();
  };

  /* =====================================================================
     DASHBOARD
     ===================================================================== */
  const dkey = v => new Date(v).toLocaleDateString("sv-SE", { timeZone: TZ });   // YYYY-MM-DD in Taipei
  const addDays = (key, n) => {
    const d = new Date(key + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const weekStart = key => addDays(key, -((new Date(key + "T00:00:00Z").getUTCDay() + 6) % 7));   // Monday
  const monthKey = key => key.slice(0, 7);
  const prevMonth = (mk, n) => {
    let [y, m] = mk.split("-").map(Number);
    m -= n;
    while (m < 1) { m += 12; y--; }
    return y + "-" + String(m).padStart(2, "0");
  };
  const md = key => key.slice(5).replace("-", "/");
  const WD = "日一二三四五六";

  function buckets(view, today) {
    if (view === "day") {
      return Array.from({ length: 7 }, (_, i) => {
        const k = addDays(today, i - 6);
        return { id: k, label: md(k) + "\n(" + WD[new Date(k + "T00:00:00Z").getUTCDay()] + ")" };
      });
    }
    if (view === "week") {
      const ws = weekStart(today);
      return Array.from({ length: 8 }, (_, i) => {
        const k = addDays(ws, (i - 7) * 7);
        return { id: k, label: md(k) };
      });
    }
    const mk = monthKey(today);
    return Array.from({ length: 6 }, (_, i) => {
      const k = prevMonth(mk, 5 - i);
      return { id: k, label: Number(k.slice(5)) + "月" };
    });
  }
  const bucketId = (view, k) => view === "day" ? k : view === "week" ? weekStart(k) : monthKey(k);

  async function countRows(table, filter) {
    const { count, error } = await filter(sb.from(table).select("code", { count: "exact", head: true }));
    if (error) throw error;
    return count || 0;
  }

  let dash = null;
  let dashView = "day";

  async function openDashboard() {
    const box = $("dashboard");
    box.textContent = "載入中…";
    try {
      const [log, exams, wDone, wTodo, pDone] = await Promise.all([
        fetchAll("review_log", "kind,reviewed_at"),
        sb.from("exam_results").select("taken_at,total,passed").order("taken_at", { ascending: false }).limit(5),
        countRows("words", q => q.not("reviewed_at", "is", null)),
        countRows("words", q => q.is("reviewed_at", null)),
        countRows("phrases", q => q.not("reviewed_at", "is", null))
      ]);
      if (exams.error) throw exams.error;
      dash = { log: log.map(r => ({ kind: r.kind, k: dkey(r.reviewed_at) })), exams: exams.data, wDone, wTodo, pDone };
    } catch (err) {
      box.innerHTML = `<h2>儀表板</h2><p class="body">無法載入：${escHTML(err.message)}</p><p class="py">${SQL_HINT}</p>`;
      return;
    }
    drawDashboard();
  }

  function drawDashboard() {
    const today = taipeiDate();
    const { log, exams, wDone, wTodo, pDone } = dash;
    const inRange = pick => log.filter(r => pick(r.k)).length;
    const nToday = inRange(k => k === today);
    const nWeek = inRange(k => weekStart(k) === weekStart(today));
    const nMonth = inRange(k => monthKey(k) === monthKey(today));

    const bks = buckets(dashView, today);
    const data = new Map(bks.map(b => [b.id, { word: 0, phrase: 0 }]));
    log.forEach(r => { const b = data.get(bucketId(dashView, r.k)); if (b) b[r.kind]++; });
    const max = Math.max(1, ...[...data.values()].map(v => v.word + v.phrase));

    const bars = bks.map(b => {
      const v = data.get(b.id), tot = v.word + v.phrase;
      const h = tot ? Math.max(6, Math.round(130 * tot / max)) : 3;
      return `<div class="bar-col">
        <div class="bar-num">${tot || ""}</div>
        <div class="bar-stack" style="height:${h}px">
          ${v.word ? `<div class="seg-w" style="flex:${v.word}"></div>` : ""}
          ${v.phrase ? `<div class="seg-p" style="flex:${v.phrase}"></div>` : ""}
        </div>
        <div class="bar-lbl">${escHTML(b.label)}</div>
      </div>`;
    }).join("");

    const exRows = exams.length ? exams.map(e => `
      <div class="rs-row"><span>${escHTML(dkey(e.taken_at))}</span><strong>${e.passed} / ${e.total}</strong></div>`).join("")
      : `<p class="py">還沒有考試紀錄。</p>`;

    $("dashboard").innerHTML = `
      <h2>儀表板</h2>
      <div class="stats">
        <div class="stat"><b>${nToday}</b><small>今天</small></div>
        <div class="stat"><b>${nWeek}</b><small>本週</small></div>
        <div class="stat"><b>${nMonth}</b><small>本月</small></div>
      </div>
      <p class="py">這裡計算的是你「確認複習完成」的單字和成語。</p>

      <div class="subtabs">
        <button class="subtab ${dashView === "day" ? "active" : ""}" data-dv="day">每日</button>
        <button class="subtab ${dashView === "week" ? "active" : ""}" data-dv="week">每週</button>
        <button class="subtab ${dashView === "month" ? "active" : ""}" data-dv="month">每月</button>
      </div>
      <div class="bars">${bars}</div>
      <p class="legend2"><i class="dot-w"></i>單字　<i class="dot-p"></i>成語</p>

      <div class="stats">
        <div class="stat"><b>${wDone}</b><small>已學單字</small></div>
        <div class="stat"><b>${pDone}</b><small>已學成語</small></div>
        <div class="stat"><b>${wTodo}</b><small>待複習單字</small></div>
      </div>

      <section class="blk"><h3>最近的考試</h3>${exRows}</section>`;
  }

  /* =====================================================================
     EXAM
     ===================================================================== */
  let pool = [];
  let ex = null;            // { items, i, res, spoke }
  let exRec = null;
  let exListening = false;

  function stopExam() {
    if (exRec) { try { exRec.abort(); } catch (e) { /* ignore */ } }
    exRec = null;
    exListening = false;
  }

  const shuffle = arr => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  async function openExam() {
    ex = null;
    const box = $("exam");
    box.textContent = "載入中…";
    try {
      const { data, error } = await sb.from("words").select("code,hanzi,pinyin,meaning").not("reviewed_at", "is", null);
      if (error) throw error;
      pool = data;
    } catch (err) {
      box.textContent = "無法載入考試：" + err.message;
      return;
    }
    drawExamStart();
  }

  function drawExamStart() {
    const n = Math.min(EXAM_SIZE, pool.length);
    $("exam").innerHTML = pool.length
      ? `<h2>考試</h2>
         <p class="body">從你學過的單字裡隨機抽 ${n} 題${pool.length < EXAM_SIZE ? `（目前只學過 ${pool.length} 個）` : ""}。</p>
         <p class="py">每一題會出現一個字：請在輸入欄打出這個字，並按麥克風唸出來。兩項都對才算通過；沒通過的字會放回「待複習」。</p>
         <div class="finish"><button class="btn primary" data-ex-start="1">開始考試</button></div>`
      : `<h2>考試</h2><p class="body">你還沒有學過的單字。先去「單字」複習並確認幾個字，再回來考試。</p>`;
  }

  function startExam() {
    ex = { items: shuffle(pool).slice(0, EXAM_SIZE), i: 0, res: [], spoke: false };
    drawQuestion();
  }

  function drawQuestion() {
    const q = ex.items[ex.i];
    const last = ex.i === ex.items.length - 1;
    $("exam").innerHTML = `
      <h2>考試</h2>
      <p class="py">第 ${ex.i + 1} / ${ex.items.length} 題</p>
      <div class="exbar"><i style="width:${Math.round(100 * ex.i / ex.items.length)}%"></i></div>
      <div class="hero">
        <div class="hanzi" style="font-size:${q.hanzi.length > 2 ? 64 : 104}px">${escHTML(q.hanzi)}</div>
      </div>
      <input id="exInput" lang="zh-TW" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="在這裡輸入這個字">
      <div class="finish">
        <button id="exMic" class="mic" aria-label="麥克風">${MIC}</button>
        <p id="exMsg">按下麥克風，唸出這個字</p>
      </div>
      <div class="finish"><button class="btn primary" data-ex-next="1">${last ? "完成考試" : "下一題"}</button></div>`;
    $("exInput").focus();
  }

  function setExMic(state, msg) {
    const b = $("exMic");
    if (!b) return;
    b.className = "mic " + state;
    $("exMsg").textContent = msg;
  }

  function exListen() {
    if (exListening || !ex) return;
    if (!SR) { setExMic("bad", "這個瀏覽器不支援語音辨識。請改用 Chrome（Android）或 Safari（iPhone）。"); return; }
    const q = ex.items[ex.i];
    const myIndex = ex.i;
    const rec = new SR();
    exRec = rec;
    rec.lang = "zh-TW";
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 5;
    let got = false;
    exListening = true;
    setExMic("listening", "請說話…");

    rec.onresult = e => {
      got = true;
      if (!ex || ex.i !== myIndex) return;
      const alts = Array.from(e.results[0]).map(r => r.transcript);
      if (isMatch(alts, q.hanzi)) { ex.spoke = true; setExMic("ok", "發音通過"); }
      else setExMic("bad", "再試一次");
    };
    rec.onerror = e => {
      got = true;
      setExMic("bad",
        e.error === "not-allowed" || e.error === "service-not-allowed" ? "請允許使用麥克風，然後再試一次。" :
        e.error === "no-speech" ? "沒有聽到聲音，再試一次。" :
        "辨識失敗（" + e.error + "），再試一次。");
    };
    rec.onend = () => {
      exListening = false;
      if (!got) setExMic("bad", "沒有聽到聲音，再試一次。");
    };
    try { rec.start(); }
    catch (err) { exListening = false; setExMic("bad", "無法啟動麥克風，再試一次。"); }
  }

  const clean = s => String(s || "").normalize("NFC").replace(/\s/g, "");

  function exNext() {
    if (!ex) return;
    stopExam();
    const q = ex.items[ex.i];
    const typedOK = clean($("exInput").value) === clean(q.hanzi);
    ex.res.push({ q, typedOK, spokeOK: ex.spoke });
    ex.i++;
    ex.spoke = false;
    if (ex.i < ex.items.length) drawQuestion(); else finishExam();
  }

  async function finishExam() {
    const res = ex.res;
    const passed = res.filter(r => r.typedOK && r.spokeOK);
    const failed = res.filter(r => !(r.typedOK && r.spokeOK));

    const failedRows = failed.map(r => `
      <div class="item">
        <div class="row"><div class="zh">${escHTML(r.q.hanzi)}</div>${speakBtn(escHTML(r.q.hanzi))}</div>
        <div class="py">${escHTML(r.q.pinyin || "")}</div>
        <div>${escHTML(r.q.meaning || "")}</div>
        <div class="py">${r.typedOK ? "" : "✗ 書寫　"}${r.spokeOK ? "" : "✗ 發音"}</div>
      </div>`).join("");

    $("exam").innerHTML = `
      <h2>考試結果</h2>
      <div class="rs-score">${passed.length} / ${res.length}</div>
      <p class="py" id="exSave" style="text-align:center">儲存中…</p>
      ${failed.length ? `<section class="blk"><h3>沒通過的字（已放回「待複習」）</h3>${failedRows}</section>`
                      : `<p class="body" style="text-align:center">全部通過！</p>`}
      <div class="finish"><button class="btn primary" data-ex-again="1">再考一次</button></div>`;

    try {
      const { error } = await sb.rpc("save_exam", {
        p_total: res.length,
        p_passed: passed.length,
        p_failed: failed.map(r => r.q.code)
      });
      if (error) throw error;
      $("exSave").textContent = failed.length ? "結果已儲存。" : "結果已儲存。";
      // If every word had been finished before, the vocabulary screen was empty: load the returned words
      if (failed.length && !word) {
        try {
          const w = await loadCurrent();
          if (w) { word = w; step = 0; stageMsg = ""; $("tabs").hidden = false; $("stepbar").hidden = false; }
        } catch (e) { /* the vocabulary screen will retry on reload */ }
      }
    } catch (err) {
      const el = $("exSave");
      if (el) el.textContent = "❌ 無法儲存：" + err.message + SQL_HINT;
    }
  }

  /* ---------- Events ---------- */
  document.addEventListener("click", e => {
    const dv = e.target.closest("[data-dv]");
    if (dv) { dashView = dv.dataset.dv; drawDashboard(); return; }
    if (e.target.closest("[data-ex-start]")) { startExam(); return; }
    if (e.target.closest("[data-ex-next]")) { exNext(); return; }
    if (e.target.closest("[data-ex-again]")) { openExam(); return; }
    if (e.target.closest("#exMic")) { exListen(); return; }
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.isComposing && e.target.id === "exInput") exNext();
  });
})();