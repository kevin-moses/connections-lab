// Pure breath detector. Shared by the desktop page and scripts/check-detector.js.
// Input: phone samples [tMs, ax, ay, az] (accelerationIncludingGravity, m/s²).
// Output: a reading with a normalized breath value in -1..1 and a phase.

const AXES = ["x", "y", "z"];
const GAP_MS = 1000;
const CALM_MS = 1000;
const AXIS_SWITCH_RATIO = 1.5;

const alpha = (dt, tau) => 1 - Math.exp(-dt / Math.max(tau, 1e-3));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function fresh(t, v) {
    return {
        start: t, last: t,
        lp: v.slice(), base: v.slice(), variance: [0, 0, 0],
        axis: 2, value: 0, slope: 0,
        phase: "calibrating", phaseSince: t, quietSince: null, calmSince: null,
        lastActive: null, inhales: [], breaths: 0,
    };
}

// Each phase names where it can go next. Hysteresis lives in minPhase and holdTime.
const TRANSITIONS = {
    calibrating: (s, t, p) => (t - s.start) / 1000 >= p.warmup ? "hold" : "calibrating",
    moving: (s, t) => s.calmSince !== null && t - s.calmSince >= CALM_MS ? "hold" : "moving",
    hold: (s, t, p, rising, falling) => rising ? "inhale" : falling ? "exhale" : "hold",
    inhale: (s, t, p, rising, falling) => {
        if (falling && (t - s.phaseSince) / 1000 >= p.minPhase) return "exhale";
        if (s.quietSince !== null && (t - s.quietSince) / 1000 >= p.holdTime) return "hold";
        return "inhale";
    },
    exhale: (s, t, p, rising, falling) => {
        if (rising && (t - s.phaseSince) / 1000 >= p.minPhase) return "inhale";
        if (s.quietSince !== null && (t - s.quietSince) / 1000 >= p.holdTime) return "hold";
        return "exhale";
    },
};

export function createDetector() {
    let s = null;

    function push([t, x, y, z], p) {
        const v = [x, y, z];
        if (s === null || t < s.last || t - s.last > GAP_MS) s = fresh(t, v);
        const dt = (t - s.last) / 1000;
        s.last = t;

        const aSmooth = alpha(dt, p.smoothing);
        const aBase = alpha(dt, p.baseline);
        const aEnv = alpha(dt, p.envelope);
        const d = [0, 0, 0];
        for (let i = 0; i < 3; i++) {
            s.lp[i] += (v[i] - s.lp[i]) * aSmooth;
            s.base[i] += (s.lp[i] - s.base[i]) * aBase;
            d[i] = s.lp[i] - s.base[i];
            s.variance[i] += (d[i] * d[i] - s.variance[i]) * aEnv;
        }

        if (p.axis === "auto") {
            const best = s.variance.indexOf(Math.max(...s.variance));
            if (s.variance[best] > s.variance[s.axis] * AXIS_SWITCH_RATIO) s.axis = best;
        } else {
            s.axis = AXES.indexOf(p.axis);
        }

        const amplitude = Math.sqrt(s.variance[s.axis]);
        const signal = d[s.axis] * (p.invert ? -1 : 1);
        const value = clamp((signal * p.gain) / (1.5 * Math.max(amplitude, p.noiseFloor)), -1, 1);
        const rawSlope = dt > 0 ? (value - s.value) / dt : 0;
        s.slope += (rawSlope - s.slope) * aSmooth;
        s.value = value;

        const motion = Math.hypot(x - s.base[0], y - s.base[1], z - s.base[2]);
        step(t, p, motion);

        return {
            t, value, slope: s.slope, phase: s.phase,
            axis: AXES[s.axis], amplitude, motion,
            breaths: s.breaths, bpm: bpm(s.inhales),
        };
    }

    function step(t, p, motion) {
        const rising = s.slope > p.threshold;
        const falling = s.slope < -p.threshold;
        s.quietSince = rising || falling ? null : s.quietSince ?? t;

        let next;
        if (motion > p.motionLimit) {
            next = "moving";
            s.calmSince = null;
        } else {
            if (s.phase === "moving") s.calmSince ??= t;
            next = TRANSITIONS[s.phase](s, t, p, rising, falling);
        }
        if (next === s.phase) return;

        if (s.phase === "moving") s.base = s.lp.slice();
        if (next === "inhale" && s.lastActive !== "inhale") {
            s.breaths++;
            s.inhales.push(t);
            if (s.inhales.length > 6) s.inhales.shift();
        }
        if (next === "inhale" || next === "exhale") s.lastActive = next;
        s.phase = next;
        s.phaseSince = t;
        s.quietSince = null;
    }

    return { push, reset: () => { s = null; } };
}

function bpm(inhales) {
    if (inhales.length < 2) return null;
    const span = inhales[inhales.length - 1] - inhales[0];
    return span > 0 ? (60000 * (inhales.length - 1)) / span : null;
}
