// ===== 1. API KEY & MODELS =====
let API_KEY = localStorage.getItem('jarvis_key');
function askForKey() {
  const k = prompt('Enter your Gemini API Key:');
  if (k) { API_KEY = k.trim(); localStorage.setItem('jarvis_key', API_KEY); }
}
if (!API_KEY) askForKey();

const MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"];
const RETRYABLE = /high demand|temporar|quota|rate|unavailable|deprecated|not found|overloaded/i;
const MAX_MEMORY = 100; // messages kept in storage
const CONTEXT_MSGS = 12; // messages sent to the model

// ===== 2. MEMORY =====
let MEMORY = [];
try { MEMORY = JSON.parse(localStorage.getItem('jarvis_memory') || '[]'); } catch (e) { MEMORY = []; }

function saveMemory() {
  if (MEMORY.length > MAX_MEMORY) MEMORY = MEMORY.slice(-MAX_MEMORY);
  try { localStorage.setItem('jarvis_memory', JSON.stringify(MEMORY)); } catch (e) {}
  updateStatus();
}

const chat = document.getElementById('chat');
const input = document.getElementById('msg');
const sendBtn = document.getElementById('send');
const micBtn = document.getElementById('mic-btn');
const clearBtn = document.getElementById('clear-btn');
const camBtn = document.getElementById('cam-btn');
const imgInput = document.getElementById('img-input');

function add(text, who) {
  const d = document.createElement('div');
  d.className = 'msg ' + who;
  d.innerText = text;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
  return d; // so callers can update this exact bubble
}

MEMORY.forEach(m =>
  add((m.role === 'user' ? 'YOU: ' : 'J.A.R.V.I.S: ') + m.text, m.role === 'user' ? 'user' : 'ai'));

// ===== 3. TOOLS (handled before Gemini) =====
// Returns a reply string if a tool handled the request, otherwise null.
async function tryTools(text) {
  const t = text.toLowerCase();
  // 1. Time
  if (/\b(what('?s| is) the time|current time|time now)\b|సమయం ఎంత/.test(t)) {
    return 'It is ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) + ', Boss.';
  }
  // 2. Date
  if (/\b(today'?s date|what('?s| is) the date|what day)\b|తేదీ ఎంత/.test(t)) {
    return 'Today is ' + new Date().toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }) + '.';
  }
  // 3. Timer
  const m = t.match(/(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)/i);
  if ((t.includes('timer') || t.includes('టైమర్')) && m) {
    const amount = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    const factor = /^(hours?|hrs?)/.test(unit) ? 3600000
                 : /^(seconds?|secs?)/.test(unit) ? 1000
                 : 60000;
    setTimeout(() => {
      const msg = `టైమర్ పూర్తైంది! ${amount} ${unit} అయ్యాయి.`;
      add('J.A.R.V.I.S: ' + msg, 'ai');
      speak(msg);
    }, amount * factor);
    return `Timer set for ${amount} ${unit}.`;
  }
  // 4. Translate
  if (t.includes('translate')) {
    const q = text.replace(/translate (this )?/i, '').trim() || 'hello';
    try {
      const r = await fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(q) + '&langpair=en|te');
      const d = await r.json();
      if (!d.responseData || !d.responseData.translatedText) throw new Error('empty');
      return 'In Telugu: ' + d.responseData.translatedText;
    } catch (e) { return 'Translate error, Boss.'; }
  }

  // 5. YouTube Play (only when the message STARTS with play / youtube)
  if (/^\s*(play|youtube)\b/i.test(text)) {
    const q = text.replace(/^\s*(play|youtube)\s+(search\s+)?/i, '').trim();
    if (q) {
      const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
      const w = window.open(url, '_blank');
      return w ? 'Searching YouTube for ' + q + ', Boss.'
               : 'Popup blocked. Open this link: ' + url;
    }
  }

  return null; // no tool matched, so go to the Gemini brain
}
// ===== 4. GEMINI CALLS =====
async function requestGemini(contents) {
  if (!API_KEY) { askForKey(); if (!API_KEY) throw new Error('No API key set.'); }
  let lastErr;
  for (const m of MODELS) {
    let data;
    try {
      const res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
          body: JSON.stringify({ contents })
        });
      data = await res.json();
    } catch (netErr) {
      lastErr = new Error('Network error. Check your connection.');
      continue; // try next model
    }

    if (data.error) {
      lastErr = new Error(data.error.message);
      if (/api key/i.test(data.error.message)) {
        localStorage.removeItem('jarvis_key'); API_KEY = null;
        throw new Error('Invalid API key. Reload and enter it again.');
      }
      if (RETRYABLE.test(data.error.message)) continue; // try next model
      throw lastErr; // real error: stop here
    }

    const cand = data.candidates && data.candidates[0];
    const part = cand && cand.content && cand.content.parts && cand.content.parts[0];
    if (part && part.text) return part.text;

    lastErr = new Error(
      (data.promptFeedback && data.promptFeedback.blockReason)
        ? 'Request blocked: ' + data.promptFeedback.blockReason
        : 'Empty response from model.');
  }
  throw lastErr || new Error('All models failed.');
}

async function askGemini(p) {
  const bubble = add('J.A.R.V.I.S: Thinking...', 'ai');
  try {
    // Try the built-in tools first
    const toolReply = await tryTools(p);
    if (toolReply !== null) {
      MEMORY.push({ role: 'user', text: p });
      MEMORY.push({ role: 'model', text: toolReply });
      saveMemory();
      bubble.innerText = 'J.A.R.V.I.S: ' + toolReply;
      speak(toolReply);
      return;
    }

    const contents = MEMORY.slice(-CONTEXT_MSGS).map(m => ({ role: m.role, parts: [{ text: m.text }] }));
    contents.push({ role: 'user', parts: [{ text: p }] });
    const reply = await requestGemini(contents);
    MEMORY.push({ role: 'user', text: p });
    MEMORY.push({ role: 'model', text: reply });
    saveMemory();
    bubble.innerText = 'J.A.R.V.I.S: ' + reply;
    speak(reply);
  } catch (e) {
    bubble.innerText = 'J.A.R.V.I.S: ERROR - ' + e.message;
  }
}

// ===== 5. VISION =====
if (camBtn && imgInput) {
  camBtn.onclick = () => imgInput.click();
  imgInput.onchange = () => {
    const file = imgInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      const q = input.value.trim() || 'What do you see? Describe briefly.';
      add('YOU: [IMAGE] ' + q, 'user');
      input.value = '';
      askVision(base64, file.type, q);
    };
    reader.readAsDataURL(file);
    imgInput.value = ''; // allow picking the same file again
  };
}

async function askVision(base64, mime, q) {
  const bubble = add('J.A.R.V.I.S: Analyzing image...', 'ai');
  try {
    const reply = await requestGemini([
      { role: 'user', parts: [{ text: q }, { inline_data: { mime_type: mime, data: base64 } }] }
    ]);
    // Remember the exchange as text so follow-up questions work
    MEMORY.push({ role: 'user', text: '[Image] ' + q });
    MEMORY.push({ role: 'model', text: reply });
    saveMemory();
    bubble.innerText = 'J.A.R.V.I.S: ' + reply;
    speak(reply);
  } catch (e) {
    bubble.innerText = 'J.A.R.V.I.S: ERROR - ' + e.message;
  }
}

// ===== 6. VOICE =====
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let listening = false;
if (SR && micBtn) {
  const rec = new SR();
  rec.lang = 'en-US';
  rec.onresult = e => {
    const t = e.results[0][0].transcript;
    add('YOU: ' + t, 'user');
    askGemini(t);
  };
  rec.onerror = e => {
    listening = false;
    micBtn.innerText = '🎙️';
    const hints = {
      'not-allowed': 'Microphone blocked. Open this page in Chrome over https:// or localhost and tap Allow.',
      'service-not-allowed': 'Speech service blocked here. Open this page in Chrome over https:// or localhost.',
      'no-speech': 'I heard nothing. Tap the mic and speak again.',
      'audio-capture': 'No microphone found.',
      'network': 'Voice needs an internet connection.'
    };
    add('SYSTEM: ' + (hints[e.error] || 'Voice error - ' + e.error), 'ai');
  };
  rec.onend = () => { listening = false; micBtn.innerText = '🎙️'; };
  micBtn.onclick = () => {
    if (listening) { rec.stop(); return; }
    try { rec.start(); listening = true; micBtn.innerText = 'LISTENING...'; } catch (e) {}
  };
}

// Some in-app browsers have no text-to-speech, so check before using it
const TTS = 'speechSynthesis' in window;
let voices = [];
function loadVoices() { if (TTS) voices = speechSynthesis.getVoices(); }
loadVoices();
if (TTS) speechSynthesis.onvoiceschanged = loadVoices;

function speak(text) {
  const clean = text.replace(/[*_`#>]/g, '').trim(); // don't read markdown symbols aloud
  if (!clean || !TTS) return; // no speech support: show text only
  const isTelugu = /[\u0C00-\u0C7F]/.test(clean);
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  u.rate = 1.05;
  u.pitch = 0.85;
  u.lang = isTelugu ? 'te-IN' : 'en-US';
  const voice = voices.find(x => x.lang.startsWith(isTelugu ? 'te' : 'en'));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

// ===== 7. INPUT & CONTROLS =====
function sendText() {
  const t = input.value.trim();
  if (!t) return;
  add('YOU: ' + t, 'user');
  input.value = '';
  askGemini(t);
}
sendBtn.onclick = sendText;
input.addEventListener('keydown', e => { if (e.key === 'Enter') sendText(); });

if (clearBtn) {
  clearBtn.onclick = () => {
    if (!confirm('Erase all saved memory?')) return;
    MEMORY = [];
    saveMemory();
    chat.innerHTML = '';
    add('SYSTEM: Memory cleared.', 'ai');
  };
}

// ===== 8. LIVE STATUS PANEL =====
function setStatus(id, ok, onText, offText) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = ok ? 'on' : 'off';
  el.textContent = '● ' + (ok ? onText : offText);
}
function updateStatus() {
  setStatus('st-net', navigator.onLine, 'ONLINE', 'OFFLINE');
  setStatus('st-ai', !!API_KEY, 'OPERATIONAL', 'NO API KEY');
  setStatus('st-voice', !!SR, 'READY', 'UNSUPPORTED');
  setStatus('st-mem', true, 'ACTIVE (' + MEMORY.length + ')', 'INACTIVE');
}
window.addEventListener('online', updateStatus);
window.addEventListener('offline', updateStatus);
updateStatus();
