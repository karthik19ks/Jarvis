
/* ======================================
   JARVIS AUTOMATIC VOICE WAKE-UP ENGINE
   ====================================== */

const JarvisWakeWord = (() => {

    const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

    let recognition;
    let listening = false;
    let active = false;
    let speaking = false;
    let restartTimer;

    function speak(message) {

        speaking = true;

        window.speechSynthesis.cancel();

        const utterance =
            new SpeechSynthesisUtterance(message);

        utterance.lang = "en-US";
        utterance.rate = 0.95;
        utterance.pitch = 0.9;

        utterance.onend = () => {
            speaking = false;
            restart();
        };

        window.speechSynthesis.speak(utterance);
    }

    function status(message) {

        const element =
            document.getElementById("status");

        if (element) {
            element.textContent = message;
        }

        console.log("JARVIS:", message);
    }

    function init() {

        if (!SpeechRecognition) {
            status("VOICE RECOGNITION NOT SUPPORTED");
            return false;
        }

        recognition = new SpeechRecognition();

        recognition.lang = "en-US";
        recognition.continuous = false;
        recognition.interimResults = false;

        recognition.onstart = () => {
            status(active ? "JARVIS ACTIVE" : "STANDBY - LISTENING");
        };

        recognition.onresult = (event) => {

            const command =
                event.results[0][0].transcript
                .toLowerCase()
                .trim();

            console.log("VOICE INPUT:", command);

            if (!active) {

                if (
                    command === "jarvis" ||
                    command.includes("hey jarvis")
                ) {

                    active = true;

                    status("JARVIS ACTIVATED");

                    window.dispatchEvent(
                        new CustomEvent("jarvis:wakeup")
                    );

                    speak("Yes sir. I am listening.");
                }

            } else {

                if (
                    command === "stop" ||
                    command.includes("stop jarvis")
                ) {

                    active = false;

                    status("STANDBY MODE");

                    window.dispatchEvent(
                        new CustomEvent("jarvis:stop")
                    );

                    speak("Going to standby, sir.");
                }
                else {

                    window.dispatchEvent(
                        new CustomEvent("jarvis:command", {
                            detail: { command }
                        })
                    );

                }
            }
        };

        recognition.onerror = (event) => {

            console.log("Recognition error:", event.error);

            if (
                event.error === "not-allowed" ||
                event.error === "service-not-allowed"
            ) {
                listening = false;
                status("MICROPHONE PERMISSION REQUIRED");
            }
        };

        recognition.onend = () => {
            restart();
        };

        return true;
    }

    function restart() {

        clearTimeout(restartTimer);

        if (!listening || speaking) return;

        restartTimer = setTimeout(() => {

            if (!listening || speaking) return;

            try {
                recognition.start();
            } catch (error) {
                console.log("Restart:", error);
            }

        }, 700);
    }

    function start() {

        if (!recognition && !init()) return;

        if (listening) return;

        listening = true;
        active = false;

        restart();
    }

    function stop() {

        listening = false;
        active = false;

        clearTimeout(restartTimer);

        if (recognition) {
            recognition.stop();
        }

        window.speechSynthesis.cancel();

        status("SYSTEM OFFLINE");
    }

    return {
        start,
        stop,
        isActive: () => active
    };

})();

/* Automatic event responses */

window.addEventListener("jarvis:wakeup", () => {
    console.log("Wake-up event detected.");
});

window.addEventListener("jarvis:stop", () => {
    console.log("Standby event detected.");
});

window.addEventListener("jarvis:command", (event) => {
    console.log("User command:", event.detail.command);
});
