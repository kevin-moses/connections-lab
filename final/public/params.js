// Every tweakable knob lives in this table. The settings panel is generated from it,
// so adding a row here is all it takes to expose a new slider.
export const PARAMS = [
    { group: "Signal", key: "axis", label: "Axis", kind: "select", options: ["auto", "x", "y", "z"], value: "z",
        hint: "Phone axis to read. Auto picks the one moving most." },
    { group: "Signal", key: "invert", label: "Invert", kind: "toggle", value: true,
        hint: "Flip if inhale shows as exhale." },
    { group: "Signal", key: "smoothing", label: "Smoothing", kind: "range", min: 0.05, max: 2, step: 0.05, value: 0.6, unit: "s",
        hint: "Low-pass time constant. Higher is calmer but laggier." },
    { group: "Signal", key: "baseline", label: "Drift removal", kind: "range", min: 2, max: 30, step: 0.5, value: 8, unit: "s",
        hint: "How fast slow posture drift is subtracted." },
    { group: "Signal", key: "envelope", label: "Amplitude window", kind: "range", min: 3, max: 30, step: 1, value: 9, unit: "s",
        hint: "How long the auto-scaling remembers breath size." },
    { group: "Signal", key: "gain", label: "Gain", kind: "range", min: 0.2, max: 4, step: 0.05, value: 1.4 },
    { group: "Signal", key: "noiseFloor", label: "Noise floor", kind: "range", min: 0.001, max: 0.2, step: 0.001, value: 0.073, unit: "m/s²",
        hint: "Signals smaller than this are not scaled up." },

    { group: "Phases", key: "threshold", label: "Slope threshold", kind: "range", min: 0.01, max: 1.5, step: 0.01, value: 0.14,
        hint: "How steep the signal must move to count as inhale or exhale." },
    { group: "Phases", key: "minPhase", label: "Min phase length", kind: "range", min: 0.2, max: 4, step: 0.1, value: 2.7, unit: "s",
        hint: "Ignore reversals faster than this." },
    { group: "Phases", key: "holdTime", label: "Hold after", kind: "range", min: 0.2, max: 5, step: 0.1, value: 1.2, unit: "s",
        hint: "Flat this long becomes a hold." },
    { group: "Phases", key: "motionLimit", label: "Motion reject", kind: "range", min: 0.2, max: 5, step: 0.1, value: 1.5, unit: "m/s²",
        hint: "Bigger jolts pause detection." },
    { group: "Phases", key: "warmup", label: "Warm-up", kind: "range", min: 0, max: 10, step: 0.5, value: 8.5, unit: "s" },

    { group: "Display", key: "orbMin", label: "Orb min", kind: "range", min: 0.1, max: 1, step: 0.01, value: 0.35 },
    { group: "Display", key: "orbMax", label: "Orb max", kind: "range", min: 0.2, max: 1, step: 0.01, value: 0.8 },
    { group: "Display", key: "orbEase", label: "Orb easing", kind: "range", min: 0.01, max: 1, step: 0.01, value: 0.12 },
    { group: "Display", key: "graphWindow", label: "Graph window", kind: "range", min: 5, max: 120, step: 1, value: 30, unit: "s" },
];

const STORAGE_KEY = "breath.params.v1";
const defaults = () => Object.fromEntries(PARAMS.map((d) => [d.key, d.value]));

export function loadParams() {
    try {
        return { ...defaults(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
    } catch {
        return defaults();
    }
}

export function saveParams(params) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
}

export function resetParams(params) {
    Object.assign(params, defaults());
    saveParams(params);
}

const CONTROLS = {
    range: (def, params, onInput) => {
        const input = el("input", { type: "range", min: def.min, max: def.max, step: def.step, value: params[def.key] });
        const out = el("output");
        const show = () => { out.textContent = `${params[def.key]}${def.unit ? " " + def.unit : ""}`; };
        input.addEventListener("input", () => { params[def.key] = Number(input.value); show(); onInput(); });
        show();
        return [input, out];
    },
    select: (def, params, onInput) => {
        const select = el("select");
        for (const option of def.options) select.append(el("option", { value: option, textContent: option }));
        select.value = params[def.key];
        select.addEventListener("change", () => { params[def.key] = select.value; onInput(); });
        return [select];
    },
    toggle: (def, params, onInput) => {
        const box = el("input", { type: "checkbox", checked: params[def.key] });
        box.addEventListener("change", () => { params[def.key] = box.checked; onInput(); });
        return [box];
    },
};

export function renderControls(container, params, onChange) {
    container.replaceChildren();
    const onInput = () => { saveParams(params); onChange?.(); };
    let group = null;
    for (const def of PARAMS) {
        if (def.group !== group) {
            group = def.group;
            container.append(el("h3", { textContent: group }));
        }
        const row = el("label", { className: `row ${def.kind}`, title: def.hint ?? "" });
        row.append(el("span", { textContent: def.label }), ...CONTROLS[def.kind](def, params, onInput));
        container.append(row);
    }
}

function el(tag, props = {}) {
    return Object.assign(document.createElement(tag), props);
}
