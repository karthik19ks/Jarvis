// Voice wake-word module (browser, Web Speech API). Works in Chrome / Android Chrome.
// Usage:
//   const wake = new WakeWord({ onCommand: (text) => askAI(text) });
//   wake.start();   // must be called from a user click/tap the first time (mic permission)

class WakeWord {
  constructor({
    wakeWords = ["jarvis", "hey jarvis", "jarvish", "javis", "service"], // common mis-hearings
    lang = "en-IN",            // use "te-IN" for Telugu
    commandTimeout = 8000,     // ms to wait for command after wake word
    onWake = () => {},
    onCommand = (text) => console.log("Command:", text),
    onStatus = (s) => console.log("Status:", s),
  } = {}) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) throw new Error("Speech recognition not supported in this browser");

    this.wakeWords = wakeWords.map((w) => w.toLowerCase());
    this.onWake = onWake;
    this.onCommand = onCommand;
    this.onStatus = onStatus;
    this.commandTimeout = commandTimeout;

    this.running = false;
    this.awake = false;
    this.timer = null;

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    this.rec = rec;

    rec.onresult = (e) => {
      const result = e.results[e.results.length - 1];
      const text = result[0].transcript.toLowerCase().trim();

      if (!this.awake) {
        const hit = this.wakeWords.find((w) => text.includes(w));
        if (hit) {
          this.awake = true;
          this.onStatus("awake");
          this.onWake();
          this._beep();
          // Command said in the same breath: "jarvis what is the time"
          const after = text.split(hit).pop().trim();
          if (result.isFinal && after.length > 2) this._finish(after);
          else this._armTimeout();
        }
      } else if (result.isFinal) {
        const hit = this.wakeWords.find((w) => text.startsWith(w));
        const cmd = hit ? text.slice(hit.length).trim() : text;
        if (cmd) this._finish(cmd);
      }
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.running = false;
        this.onStatus("mic-denied");
      }
    };

    // Browser stops recognition every so often; restart to keep listening.
    rec.onend = () => {
      if (this.running) setTimeout(() => { try { rec.start(); } catch (_) {} }, 300);
    };
  }

  start() {
    this.running = true;
    try { this.rec.start(); } catch (_) {}
    this.onStatus("listening");
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.rec.stop();
    this.onStatus("stopped");
  }

  _armTimeout() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.awake = false;
      this.onStatus("listening");
    }, this.commandTimeout);
  }

  _finish(cmd) {
    clearTimeout(this.timer);
    this.awake = false;
    this.onStatus("listening");
    this.onCommand(cmd);
  }

  _beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      o.frequency.value = 880;
      o.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.12);
    } catch (_) {}
  }
}
