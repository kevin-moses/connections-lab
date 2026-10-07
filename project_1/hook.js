// The "hook" steps: the very first revision on its own, then every revision in a chart of
// revisions per day. While the "hook" steps are active, one square sits in the middle of the
// screen: the first revision in the logs (2026-05-24 06:02 UTC, a page of US federal spending API
// links on the DSE wiki). Once the first "hookScatter" step becomes active, that square drops into
// a full-width chart of revisions per day (UTC): each dot sits at its own time, at a random height
// under that day's total, so together the revisions fill in the area under the (undrawn) per-day
// curve. The rest of the revisions then fade in left to right.
//
// Drawn whenever a "hook" or "hookScatter" step is active (scrollState), with no scene in
// sketch.js. Uses these from sketch.js and revisions.js: MARGIN, PLOT_LEFT, EASING,
// revisionColor, revisionType, formatUTC, stepChangedAt, DAY_SECONDS.

const HOOK = {
    pointSize: 10, // the first revision, alone in the middle of the screen
    firstDotSize: 5, // the first revision once it is in the scatterplot
    dotSize: 2, // every other revision
    landingMs: 600, // the other dots wait this long for the first one to land...
    sweepMs: 1500, // ...then fade in left to right (in time order) over this long
    dotFadeMs: 150, // how long one dot takes to fade in or out
    labelDays: 7, // one date label on the time axis every this many days
    countTicks: [2000, 4000, 6000], // labelled lines on the per-day axis
    countStep: 1000, // the per-day axis runs up to the busiest day, rounded up to this
};


let hookDots = []; // one per revision, in time order; hookDots[0] is the first revision
let hookStart; // unix seconds, rounded down to midnight UTC
let hookEnd; // midnight UTC at the end of the last revision's day

// revisions per day: the curve's points ({ t, count }, one per day at noon plus one at each end),
// the busiest day, and the top of the per-day axis
let dayCurve = [];
let busiestDay;
let hookCountMax;

// how far (0 to 1, left to right) the dots' fade-in has got; the busiest day's label waits for it
let sweepProgress = 0;

// what each hook step shows; every other step fades the hook out ("hidden")
const HOOK_MODE_BY_STEP = { hook: "point", hookScatter: "scatter" };

// eased opacities (0 to 1) of the first revision's caption and of the scatterplot's axes
let captionAlpha = 0;
let axesAlpha = 0;

// Whether any hook dot was visible or still fading last frame.
let anyHookVisible = false;

// Build one dot per revision. Called once from setup() in sketch.js.
function setupHook(json) {
    const revisions = json.revisions.slice().sort((a, b) => a.t - b.t);
    hookStart = Math.floor(revisions[0].t / DAY_SECONDS) * DAY_SECONDS;
    hookEnd = (Math.floor(revisions[revisions.length - 1].t / DAY_SECONDS) + 1) * DAY_SECONDS;

    // count the revisions on each day
    const dayCount = Math.round((hookEnd - hookStart) / DAY_SECONDS);
    const counts = new Array(dayCount).fill(0);
    for (const revision of revisions) {
        counts[Math.floor((revision.t - hookStart) / DAY_SECONDS)]++;
    }

    // the curve: each day's total at noon, held flat out to both ends of the plot
    dayCurve = [{ t: hookStart, count: counts[0] }];
    busiestDay = { t: 0, count: 0 };
    for (let day = 0; day < dayCount; day++) {
        const point = { t: hookStart + (day + 0.5) * DAY_SECONDS, count: counts[day] };
        dayCurve.push(point);
        if (point.count > busiestDay.count) busiestDay = point;
    }
    dayCurve.push({ t: hookEnd, count: counts[dayCount - 1] });
    hookCountMax = Math.ceil(busiestDay.count / HOOK.countStep) * HOOK.countStep;

    hookDots = [];
    for (let i = 0; i < revisions.length; i++) {
        const revision = revisions[i];
        const timeFraction = (revision.t - hookStart) / (hookEnd - hookStart);
        hookDots.push({
            data: revision, // the original record (shown in the tooltip)
            type: revisionType(revision),
            color: revisionColor(revision), // same colours as the revisions timeline and task families chart
            // 0 = bottom of the plot, 1 = top: a random height under the curve, so the dots fill it
            countFraction: (random() * curveCountAt(revision.t)) / hookCountMax,
            fadeDelay: HOOK.landingMs + timeFraction * HOOK.sweepMs,
            alpha: 0, // 0 = hidden, 1 = fully visible
        });
    }
    // the first revision also moves and resizes (x, y, size); drawHookDots sets those when it appears
}

// The curve's height (revisions per day) at a moment, between the points either side of it.
function curveCountAt(time) {
    for (let i = 1; i < dayCurve.length; i++) {
        const before = dayCurve[i - 1];
        const after = dayCurve[i];
        if (time <= after.t) return map(time, before.t, after.t, before.count, after.count);
    }
    return dayCurve[dayCurve.length - 1].count;
}

// Screen x of a moment, and screen y of a height (0 to 1), in the scatterplot.
function hookTimeX(time) {
    return map(time, hookStart, hookEnd, PLOT_LEFT, width - MARGIN);
}
function hookScatterY(countFraction) {
    return lerp(height - MARGIN, MARGIN, countFraction);
}

// Fade the axes, the caption and every hook dot in or out, move the first revision to its
// place, and draw them. Returns the dot under the mouse, or null.
// Called every frame from draw() in sketch.js.
function drawHookDots() {
    // "point" (the lone first revision), "scatter" (every revision) or "hidden"; the mode only
    // changes with the step, so stepChangedAt (sketch.js) is when it last changed
    const hookMode = HOOK_MODE_BY_STEP[scrollState.stepName] || "hidden";
    const isScatter = hookMode === "scatter";
    axesAlpha = lerp(axesAlpha, isScatter ? 1 : 0, EASING);
    captionAlpha = lerp(captionAlpha, hookMode === "point" ? 1 : 0, EASING);

    // outside the hook steps, with everything already faded out: nothing to draw
    if (hookMode === "hidden" && !anyHookVisible && axesAlpha < 0.01) return null;

    if (axesAlpha > 0.01) drawHookAxes(axesAlpha);
    anyHookVisible = false; // set again by whichever of these draws something
    const hoveredDot = drawHookScatterDots(isScatter);
    const hoveredFirst = drawFirstRevision(hookMode);
    drawHookLabels(isScatter);
    return hoveredFirst || hoveredDot;
}

// Every revision after the first: in the scatterplot, each fades in once its delay (left to right)
// has passed; otherwise it fades out. Returns the dot under the mouse, or null. Uses the canvas API
// directly for speed, since there are ~14,000.
function drawHookScatterDots(isScatter) {
    const timeInStep = millis() - stepChangedAt;
    const fadePerFrame = deltaTime / HOOK.dotFadeMs;
    const size = HOOK.dotSize;
    const canvas = drawingContext;
    canvas.save(); // restored below so p5's own drawing isn't affected
    let hovered = null;
    for (let i = 1; i < hookDots.length; i++) {
        const dot = hookDots[i];
        const shouldBeVisible = isScatter && timeInStep >= dot.fadeDelay;
        dot.alpha = constrain(dot.alpha + (shouldBeVisible ? fadePerFrame : -fadePerFrame), 0, 1);
        if (dot.alpha === 0) continue;
        anyHookVisible = true;

        const x = hookTimeX(dot.data.t);
        const y = hookScatterY(dot.countFraction);
        canvas.globalAlpha = dot.alpha;
        canvas.fillStyle = dot.color;
        canvas.fillRect(x - size / 2, y - size / 2, size, size);

        const mouseIsOver = Math.abs(mouseX - x) < 3 && Math.abs(mouseY - y) < 3;
        if (dot.alpha === 1 && mouseIsOver) hovered = dot;
    }
    canvas.restore();
    return hovered;
}

// The first revision: alone in the middle of the screen ("point"), or dropped into its place in the
// scatterplot ("scatter"). When hidden it fades out where it is. Returns it if it's under the
// mouse, or null.
function drawFirstRevision(hookMode) {
    const first = hookDots[0];
    if (hookMode !== "hidden") {
        const isScatter = hookMode === "scatter";
        const targetX = isScatter ? hookTimeX(first.data.t) : width / 2;
        const targetY = isScatter ? hookScatterY(first.countFraction) : height / 2;
        const targetSize = isScatter ? HOOK.firstDotSize : HOOK.pointSize;
        // a hidden dot starts at its target, so it fades in there instead of flying in
        if (first.alpha < 0.01) {
            first.x = targetX;
            first.y = targetY;
            first.size = targetSize;
        }
        first.x = lerp(first.x, targetX, EASING);
        first.y = lerp(first.y, targetY, EASING);
        first.size = lerp(first.size, targetSize, EASING);
    }
    first.alpha = lerp(first.alpha, hookMode === "hidden" ? 0 : 1, EASING);
    if (first.alpha <= 0.01) return null;
    anyHookVisible = true;

    const canvas = drawingContext;
    canvas.save();
    canvas.globalAlpha = first.alpha;
    canvas.fillStyle = first.color;
    canvas.fillRect(first.x - first.size / 2, first.y - first.size / 2, first.size, first.size);
    canvas.restore();

    const reach = Math.max(first.size / 2, 4);
    const mouseIsOver = Math.abs(mouseX - first.x) < reach && Math.abs(mouseY - first.y) < reach;
    return first.alpha > 0.5 && mouseIsOver ? first : null;
}

// Text over the dots: the busiest day's total (once its dots have faded in; it stays while the
// chart fades out), the lone first revision's caption, and where it went in the scatterplot.
function drawHookLabels(isScatter) {
    if (isScatter) {
        const sweepTime = millis() - stepChangedAt - HOOK.landingMs;
        sweepProgress = constrain(sweepTime / HOOK.sweepMs, 0, 1);
    }
    const busiestDayReached = lerp(hookStart, hookEnd, sweepProgress) >= busiestDay.t;
    if (axesAlpha > 0.01 && busiestDayReached) drawBusiestDayLabel(axesAlpha);

    const first = hookDots[0];
    if (captionAlpha > 0.01) drawFirstCaption(first, captionAlpha);

    // to its left, clear of the revisions that follow it up and to the right
    if (axesAlpha > 0.01) {
        noStroke();
        fill(255, 255 * axesAlpha);
        textSize(10);
        textAlign(RIGHT, BOTTOM);
        text("first revision", first.x - 6, first.y - 6);
    }
}

// When, where and who, to the right of the lone first revision.
function drawFirstCaption(first, alpha) {
    const info = first.data;
    const x = first.x + first.size / 2 + 12;
    noStroke();
    textAlign(LEFT, CENTER);

    textSize(11);
    fill(255, 255 * alpha);
    text(formatUTC(info.t) + " UTC", x, first.y - 16);

    textSize(10);
    fill(150, 255 * alpha);
    text(info.page, x, first.y);
    text(`${info.label} · ${first.type}`, x, first.y + 14);
}

// "6,543 on 06-18": the busiest day's total, just right of the top of its peak.
function drawBusiestDayLabel(alpha) {
    const x = hookTimeX(busiestDay.t);
    const y = hookScatterY(busiestDay.count / hookCountMax);
    noStroke();
    fill(255, 255 * alpha);
    textSize(10);
    textAlign(LEFT, BOTTOM);
    const label = `${busiestDay.count.toLocaleString("en-US")} on ${formatUTC(busiestDay.t).slice(5, 10)}`;
    text(label, x + 8, y - 2);
}

// Chart axes: a faint vertical line and "MM-DD" label every HOOK.labelDays days, and a faint
// horizontal line at each of HOOK.countTicks, topped with the axis name.
function drawHookAxes(alpha) {
    const left = PLOT_LEFT;
    const right = width - MARGIN;
    const top = MARGIN;
    const bottom = height - MARGIN;
    textSize(10);

    // time
    textAlign(CENTER, TOP);
    for (let time = hookStart; time <= hookEnd; time += HOOK.labelDays * DAY_SECONDS) {
        const x = hookTimeX(time);
        stroke(255, 25 * alpha);
        line(x, top, x, bottom);

        noStroke();
        fill(150, 255 * alpha);
        text(formatUTC(time).slice(5, 10), x, bottom + 8); // e.g. "05-24"
    }

    // revisions per day
    textAlign(LEFT, CENTER);
    for (const count of HOOK.countTicks) {
        const y = hookScatterY(count / hookCountMax);
        stroke(255, 25 * alpha);
        line(left - 10, y, right, y);

        noStroke();
        fill(150, 255 * alpha);
        text(count.toLocaleString("en-US"), 16, y);
    }

    noStroke();
    fill(150, 255 * alpha);
    textAlign(LEFT, BOTTOM);
    text("revisions per day", 16, top - 8);

    // baseline
    stroke(255, 60 * alpha);
    line(left - 10, bottom, right, bottom);
}
