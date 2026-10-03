// 1. Go and get the notebook (days.json)
fetch("data/days.json")
  .then(response => response.json())
  .then(days => {
    const today = days[0]; // for now, just the first day

    // 2. Put the information into the boxes
    document.getElementById("character").textContent = today.character;
    document.getElementById("pinyin").textContent = today.pinyin;

    // 3. When the Listen button is pressed, speak the character
    document.getElementById("listen").onclick = () => {
      const voice = new SpeechSynthesisUtterance(today.character);
      voice.lang = "zh-TW"; // Traditional Chinese (Taiwan)
      speechSynthesis.speak(voice);
    };
  });