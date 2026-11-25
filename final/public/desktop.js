import { createDetector } from "/breath.js";
import { loadParams, renderControls, resetParams } from "/params.js";

const $ = (id) => document.getElementById(id);
const socket = io();
const params = loadParams();
const detector = createDetector();

const PHASE_COLOR = {
    calibrating: "--hold", hold: "--hold", moving: "--hold",
    inhale: "--inhale", exhale: "--exhale",
};
const PHASE_LABEL = {
    calibrating: "settling…", hold: "hold", moving: "moving, hold still",
    inhale: "inhale", exhale: "exhale",
};

// Connection status: no phone, paired but not streaming, or receiving samples.
const STATUS = {
    waiting: { text: "waiting for phone", live: false, pair: true },
    paired: { text: "phone paired, press Start on it", live: false, pair: true },
    live: { text: "live", live: true, pair: false },
};
const STALE_MS = 2000;

let status = "waiting";
let lastSampleAt = 0;
let reading = null;
let orbSize = params.orbMin;
let history = [];
let rate = { count: 0, since: performance.now(), hz: 0 };

function setStatus(next) {
    if (next === status) return;
    status = next;
    const s = STATUS[next];
    $("status").textContent = s.text;
    $("status").classList.toggle("live", s.live);
    $("pair").hidden = !s.pair;
    if (next !== "live") {
        detector.reset();
        history = [];
        reading = null;
    }
}

async function showPairing(code) {
    $("code").textContent = code;
    const info = await fetch(`/pair/${code}`).then((r) => r.json());
    $("qr").innerHTML = info.svg;
    $("pair-url").textContent = info.url;
    $("pair-warning").hidden = info.secure;
    $("pair-warning").textContent =
        "This link is plain HTTP, so the phone cannot read its motion sensor. Run `npm run cert` and restart, or open through an HTTPS tunnel.";
}

socket.on("connect", () => {
    socket.emit("desktop:hello", sessionStorage.getItem("breath.code"), ({ code, peerConnected }) => {
        sessionStorage.setItem("breath.code", code);
        showPairing(code);
        setStatus(peerConnected ? "paired" : "waiting");
    });
});

socket.on("peer", ({ connected }) => setStatus(connected ? "paired" : "waiting"));

socket.on("samples", (samples) => {
    lastSampleAt = performance.now();
    setStatus("live");
    for (const sample of samples) {
        reading = detector.push(sample, params);
        history.push(reading);
    }
    rate.count += samples.length;
});

renderControls($("controls"), params);
$("settings-toggle").onclick = () => { $("panel").hidden = !$("panel").hidden; };
$("reset").onclick = () => { resetParams(params); renderControls($("controls"), params); };
$("show-pair").onclick = () => { $("pair").hidden = !$("pair").hidden; };

function frame(now) {
    if (status === "live" && now - lastSampleAt > STALE_MS) setStatus("paired");
    if (now - rate.since >= 1000) {
        rate = { count: 0, since: now, hz: (rate.count * 1000) / (now - rate.since) };
    }

    const value = reading?.value ?? -1;
    const target = params.orbMin + ((value + 1) / 2) * (params.orbMax - params.orbMin);
    orbSize += (target - orbSize) * params.orbEase;
    const phase = reading?.phase ?? "hold";
    $("orb").style.setProperty("--size", orbSize.toFixed(4));
    $("orb").style.setProperty("--c", `var(${PHASE_COLOR[phase]})`);
    $("phase").textContent = reading ? PHASE_LABEL[phase] : " ";
    $("bpm").textContent = reading?.bpm ? `${reading.bpm.toFixed(1)} bpm` : "-- bpm";
    $("count").textContent = `${reading?.breaths ?? 0} breaths`;

    trimHistory();
    drawGraph();
    if (!$("panel").hidden) drawReadout();
    requestAnimationFrame(frame);
}

function trimHistory() {
    const newest = history.at(-1)?.t ?? 0;
    const cutoff = newest - params.graphWindow * 1000;
    const first = history.findIndex((r) => r.t >= cutoff);
    if (first > 0) history = history.slice(first);
}

function drawGraph() {
    const canvas = $("graph");
    const dpr = devicePixelRatio;
    const w = canvas.clientWidth * dpr;
    const h = canvas.clientHeight * dpr;
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    if (history.length < 2) return;

    const css = getComputedStyle(document.documentElement);
    const newest = history.at(-1).t;
    const span = params.graphWindow * 1000;
    const x = (t) => w - ((newest - t) / span) * w;
    const y = (v) => h / 2 - v * (h / 2 - 8 * dpr);

    ctx.lineWidth = 2 * dpr;
    for (let i = 1; i < history.length; i++) {
        const a = history[i - 1];
        const b = history[i];
        ctx.strokeStyle = css.getPropertyValue(PHASE_COLOR[b.phase]);
        ctx.beginPath();
        ctx.moveTo(x(a.t), y(a.value));
        ctx.lineTo(x(b.t), y(b.value));
        ctx.stroke();
    }
}

function drawReadout() {
    const r = reading;
    $("readout").textContent = r
        ? [
            `samples   ${rate.hz.toFixed(0)} Hz`,
            `axis      ${r.axis}`,
            `amplitude ${r.amplitude.toFixed(4)} m/s²`,
            `motion    ${r.motion.toFixed(3)} m/s²`,
            `value     ${r.value.toFixed(3)}`,
            `slope     ${r.slope.toFixed(3)} /s`,
            `phase     ${r.phase}`,
        ].join("\n")
        : "no samples yet";
}

requestAnimationFrame(frame);
