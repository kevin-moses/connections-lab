const $ = (id) => document.getElementById(id);
const socket = io();
const query = new URLSearchParams(location.search);
const simulate = query.has("sim");

const SEND_EVERY_MS = 100;
const SIM_HZ = 60;
const LEVEL_RANGE = 0.2;

// One view per step of the phone's flow. render() is the only thing that touches the DOM layout.
const VIEWS = {
    code: { title: "Pair with the screen", message: "Type the 4-letter code shown on the screen.", show: ["code-form"] },
    joining: { title: "Pairing…", message: "", show: [] },
    ready: { title: "Paired", message: "Sit upright. Hold the phone flat against your chest, screen out, top pointing up. Then press Start.", show: ["start"] },
    streaming: { title: "Breathe normally", message: "Keep the phone still against your chest. The screen stays awake while this runs.", show: ["level", "stop"] },
    blocked: { title: "No motion sensor", message: "", show: ["start"] },
};

let code = (query.get("room") || localStorage.getItem("breath.room") || "").toUpperCase();
let view = null;
let batch = [];
let stopSensor = null;
let wakeLock = null;
let levelMean = null;

function render(next, message) {
    view = next;
    const v = VIEWS[next];
    $("title").textContent = v.title;
    $("message").textContent = message ?? v.message;
    for (const id of ["code-form", "start", "level", "stop"]) $(id).hidden = !v.show.includes(id);
}

function join(candidate) {
    render("joining");
    socket.emit("phone:join", candidate, (res) => {
        if (!res.ok) {
            $("code-input").value = candidate;
            return render("code", res.error);
        }
        code = res.code;
        localStorage.setItem("breath.room", code);
        setPeer(res.peerConnected);
        if (view !== "streaming") render(stopSensor ? "streaming" : "ready");
    });
}

function setPeer(connected) {
    $("peer").textContent = connected ? `Connected to screen ${code}` : `Screen ${code} is not open right now`;
}

socket.on("connect", () => (code ? join(code) : render("code")));
socket.on("peer", ({ connected }) => setPeer(connected));
socket.on("replaced", () => { stop(); render("code", "Another phone took over this screen."); });

$("code-form").onsubmit = (e) => {
    e.preventDefault();
    join($("code-input").value.trim().toUpperCase());
};

$("start").onclick = async () => {
    try {
        stopSensor = simulate ? startSimulator() : await startMotion();
    } catch (err) {
        return render("blocked", err.message);
    }
    render("streaming");
    keepAwake();
};

$("stop").onclick = () => { stop(); render("ready"); };

function stop() {
    stopSensor?.();
    stopSensor = null;
    wakeLock?.release();
    wakeLock = null;
}

function record(t, x, y, z) {
    batch.push([t, x, y, z]);
    levelMean = levelMean === null ? z : levelMean + (z - levelMean) * 0.01;
    const pct = 50 + ((z - levelMean) / LEVEL_RANGE) * 50;
    $("level").firstElementChild.style.width = `${Math.min(100, Math.max(0, pct))}%`;
}

setInterval(() => {
    if (batch.length === 0) return;
    socket.volatile.emit("samples", batch);
    batch = [];
}, SEND_EVERY_MS);

async function startMotion() {
    if (!window.isSecureContext) throw new Error("This page must be opened over HTTPS for the phone to share motion data.");
    if (typeof DeviceMotionEvent === "undefined") throw new Error("This browser does not expose the accelerometer.");
    if (typeof DeviceMotionEvent.requestPermission === "function") {
        const answer = await DeviceMotionEvent.requestPermission();
        if (answer !== "granted") throw new Error("Motion access was denied. Allow it in Safari settings and press Start again.");
    }
    const onMotion = (e) => {
        const a = e.accelerationIncludingGravity;
        if (a?.x == null) return;
        record(e.timeStamp, a.x, a.y, a.z);
    };
    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
}

// Fake sensor for testing without a phone: open /phone/?sim&room=CODE in any browser.
function startSimulator() {
    const bpm = Number(query.get("bpm")) || 12;
    const tilt = ((Number(query.get("tilt")) || 0.8) * Math.PI) / 180;
    const id = setInterval(() => {
        const t = performance.now();
        const angle = tilt * Math.sin((2 * Math.PI * bpm * t) / 60000);
        const noise = () => (Math.random() - 0.5) * 0.03;
        record(t, noise(), -9.81 * Math.cos(angle) + noise(), 9.81 * Math.sin(angle) + noise());
    }, 1000 / SIM_HZ);
    return () => clearInterval(id);
}

async function keepAwake() {
    try {
        wakeLock = await navigator.wakeLock?.request("screen");
    } catch {
        wakeLock = null;
    }
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && stopSensor) keepAwake();
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/phone/sw.js", { scope: "/phone/" });
