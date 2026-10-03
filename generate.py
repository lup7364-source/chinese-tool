import json
import time
import requests

MODEL = "gemini-flash-latest"  # if you get a "model not found" error, pick a free Flash model name from AI Studio
BATCH = 5      # words per request
PAUSE = 6      # seconds to rest between requests
DAYS_FILE = "data/days.json"

with open("key.txt", encoding="utf-8") as f:
    API_KEY = f.read().strip()

with open("words.txt", encoding="utf-8") as f:
    words = [w.strip() for w in f if w.strip()]

try:
    with open(DAYS_FILE, encoding="utf-8") as f:
        days = json.load(f)
except FileNotFoundError:
    days = []

already = {d["character"] for d in days}
todo = [w for w in words if w not in already]
print(f"{len(todo)} new words to make.")

PROMPT = """You are a Chinese teacher. For EACH of these words, write one lesson object.
Use TRADITIONAL characters (convert if needed), pinyin with tone marks,
and simple natural language (HSK 1-3 level). Return ONLY a JSON array.

Each object must have exactly these keys:
"character": the word,
"pinyin": pinyin with tone marks,
"meaning": English meaning,
"usage": 1-2 sentences in English about how it is used,
"examples": 3 items, each {{"zh":"","pinyin":"","en":""}},
"expressions": 3 common expressions or words using it, each {{"zh":"","pinyin":"","en":""}},
"text": a 3-4 sentence daily text that uses the word, {{"zh":"","pinyin":"","en":""}},
"questions": 3 practice questions, each {{"question":"","options":["","","",""],"answer":"(must be exactly one of the options)","explanation":""}}

Words: {words}"""

URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"


def ask(batch):
    body = {
        "contents": [{"parts": [{"text": PROMPT.format(words=", ".join(batch))}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.4},
    }
    for attempt in range(8):
        try:
            r = requests.post(URL, headers={"x-goog-api-key": API_KEY}, json=body, timeout=120)
        except requests.exceptions.RequestException as e:
            print(f"  Internet hiccup ({e.__class__.__name__}), trying again...")
            time.sleep(15)
            continue

        # 429 = too many requests, 5xx = Google is busy: wait and knock again
        if r.status_code == 429 or r.status_code >= 500:
            wait = 20 * (attempt + 1)
            print(f"  Robot is busy (error {r.status_code}), waiting {wait}s...")
            time.sleep(wait)
            continue

        r.raise_for_status()
        try:
            text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text)
        except (KeyError, IndexError, json.JSONDecodeError):
            print("  Messy answer, trying again...")
            time.sleep(5)
    raise RuntimeError("The robot failed 8 times. Try again in a few minutes.")


for i in range(0, len(todo), BATCH):
    batch = todo[i:i + BATCH]
    print(f"Making: {' '.join(batch)}")
    lessons = ask(batch)
    for lesson in lessons:
        lesson["day"] = len(days) + 1
        days.append(lesson)
    # save after every batch so nothing is lost
    with open(DAYS_FILE, "w", encoding="utf-8") as f:
        json.dump(days, f, ensure_ascii=False, indent=2)
    time.sleep(PAUSE)

print("Done! Check data/days.json")