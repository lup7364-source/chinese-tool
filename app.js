let days = [];
let index = 0;
let correctCount = 0;
let answeredCount = 0;

// Say a Chinese sentence out loud
function speak(text) {
  speechSynthesis.cancel();
  const voice = new SpeechSynthesisUtterance(text);
  voice.lang = "zh-TW";
  speechSynthesis.speak(voice);
}

// One line: Chinese + pinyin + English + a listen button
function line(item) {
  return `
    <div class="item">
      <div class="zh">${item.zh} <button data-say="${item.zh}">🔊</button></div>
      <div class="pinyin">${item.pinyin}</div>
      <div>${item.en}</div>
    </div>`;
}

// The practice card (only if this day has questions)
function practiceHTML(d) {
  if (!d.questions || d.questions.length === 0) return "";
  const qs = d.questions.map((q, qi) => `
    <div class="question" id="q${qi}">
      <p><strong>${qi + 1}. ${q.question}</strong></p>
      ${q.options.map((opt, oi) =>
        `<button class="option" data-q="${qi}" data-o="${oi}">${opt}</button>`).join("")}
      <p class="feedback" id="fb${qi}"></p>
    </div>`).join("");
  return `<div class="card"><h2>Practice</h2>${qs}<p id="score"></p></div>`;
}

// Draw the lesson for the current day
function show() {
  const d = days[index];
  correctCount = 0;
  answeredCount = 0;

  document.getElementById("dayLabel").textContent = `Day ${index + 1} of ${days.length}`;
  document.getElementById("prev").disabled = index === 0;
  document.getElementById("next").disabled = index === days.length - 1;

  document.getElementById("lesson").innerHTML = `
    <div class="card center">
      <div class="big">${d.character}</div>
      <div class="pinyin" style="font-size:24px">${d.pinyin}</div>
      <div><strong>${d.meaning}</strong></div>
      <button data-say="${d.character}">🔊 Listen</button>
    </div>

    <div class="card">
      <h2>How to use it</h2>
      <p>${d.usage}</p>
    </div>

    <div class="card">
      <h2>Examples</h2>
      ${d.examples.map(line).join("")}
    </div>

    <div class="card">
      <h2>Common expressions</h2>
      ${d.expressions.map(line).join("")}
    </div>

    <div class="card">
      <h2>Daily text</h2>
      <div class="zh">${d.text.zh} <button data-say="${d.text.zh}">🔊</button></div>
      <p class="pinyin">${d.text.pinyin}</p>
      <p>${d.text.en}</p>
    </div>

    ${practiceHTML(d)}
  `;
  window.scrollTo(0, 0);
  localStorage.setItem("lastDay", index);
}

// Check one answer
function checkAnswer(btn) {
  const qi = Number(btn.dataset.q);
  const oi = Number(btn.dataset.o);
  const q = days[index].questions[qi];
  const box = document.getElementById("q" + qi);
  if (box.dataset.done) return;          // already answered
  box.dataset.done = "1";

  const correct = q.options[oi] === q.answer;
  btn.classList.add(correct ? "right" : "wrong");
  if (!correct) {
    box.querySelectorAll(".option").forEach(b => {
      if (q.options[Number(b.dataset.o)] === q.answer) b.classList.add("right");
    });
  }
  document.getElementById("fb" + qi).textContent =
    (correct ? "✅ Correct! " : "❌ Not quite. ") + q.explanation;

  answeredCount++;
  if (correct) correctCount++;
  document.getElementById("score").textContent =
    `Score: ${correctCount} / ${days[index].questions.length}`;
}

// Clicks: listen buttons and answer buttons
document.addEventListener("click", (e) => {
  const say = e.target.dataset.say;
  if (say) { speak(say); return; }
  if (e.target.classList.contains("option")) checkAnswer(e.target);
});

document.getElementById("prev").onclick = () => { index--; show(); };
document.getElementById("next").onclick = () => { index++; show(); };

// Start: fetch the notebook, then show the remembered day
fetch("data/days.json")
  .then(r => r.json())
  .then(data => {
    days = data;
    index = Math.min(Number(localStorage.getItem("lastDay")) || 0, days.length - 1);
    show();
  })
  .catch(err => {
    document.getElementById("lesson").textContent =
      "Could not read data/days.json. Check for a missing comma. " + err;
  });