import assert from "node:assert/strict";
import { createDetector } from "../public/breath.js";
import { PARAMS } from "../public/params.js";

const params = Object.fromEntries(PARAMS.map((d) => [d.key, d.value]));
const G = 9.81;
const HZ = 60;

function rng(seed) {
    return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5;
}

// Phone flat on the sternum, portrait, upright: breathing pitches the chest a degree or so,
// which swings gravity between the y and z axes.
function run({ seconds, bpm, tiltDeg, noise, drift = 0, p = params }) {
    const detector = createDetector();
    const rand = rng(7);
    const phases = [];
    let reading;
    for (let i = 0; i < seconds * HZ; i++) {
        const t = (i / HZ) * 1000;
        const angle = ((tiltDeg * Math.sin((2 * Math.PI * bpm * t) / 60000) + drift * (t / 1000)) * Math.PI) / 180;
        reading = detector.push([t, rand() * noise, -G * Math.cos(angle) + rand() * noise, G * Math.sin(angle) + rand() * noise], p);
        phases.push(reading.phase);
    }
    return { reading, phases };
}

const breathing = run({ seconds: 60, bpm: 12, tiltDeg: 0.8, noise: 0.03, drift: 0.02 });
assert.ok(Math.abs(breathing.reading.bpm - 12) < 1, `bpm ${breathing.reading.bpm?.toFixed(2)} should be near 12`);
assert.ok(Math.abs(breathing.reading.breaths - 12) <= 1, `counted ${breathing.reading.breaths} breaths in 60s at 12 bpm`);
assert.equal(breathing.reading.axis, "z", "auto axis picks z for an upright phone on the chest");

const fast = run({ seconds: 60, bpm: 20, tiltDeg: 0.6, noise: 0.03 });
assert.ok(Math.abs(fast.reading.bpm - 20) < 1.5, `bpm ${fast.reading.bpm?.toFixed(2)} should be near 20`);

const still = run({ seconds: 60, bpm: 12, tiltDeg: 0, noise: 0.03 });
assert.ok(still.reading.breaths <= 2, `noise alone produced ${still.reading.breaths} breaths`);

const inverted = run({ seconds: 20, bpm: 12, tiltDeg: 0.8, noise: 0.01, p: { ...params, invert: true } });
const plain = run({ seconds: 20, bpm: 12, tiltDeg: 0.8, noise: 0.01 });
const at = HZ * 16;
assert.notEqual(inverted.phases[at], plain.phases[at], "invert flips the phase");

console.log("detector ok", {
    bpm12: breathing.reading.bpm.toFixed(2), breaths12: breathing.reading.breaths,
    bpm20: fast.reading.bpm.toFixed(2), noiseBreaths: still.reading.breaths,
});
