// Scrollytelling sketch (p5.js, global mode).
//
// How the pieces fit together:
// - scroll.js (scrollama) records which .step is active in `scrollState`.
// - Every frame, draw() calls the scene function for that step (see SCENES below) and
//   tells it how far through the step the reader has scrolled (0 to 1).
// - A scene sets a target position, opacity and colour for each dot it wants to show.
//   Every other dot is hidden. Dots ease toward their targets, so changing steps animates.
// - A scene can also pan the canvas vertically (targetPanY) and return a function that
//   draws on top of the dots, such as a header.
// The "revisions" scene lives in revisions.js.

// Which step is active; updated by scroll.js.
const scrollState = { stepName: "revisions", stepIndex: 0 };

// layout
const MARGIN = 60;
const PLOT_LEFT = 110; // x where timelines start; time labels sit to the left of it

// animation
const EASING = 0.08; // fraction of the way dots move/fade toward their targets each frame
const PAN_EASING = 0.2; // the same, for the vertical pan
const GREY = "rgb(160, 160, 160)";

// tooltip layout: tweak these to trade legibility against how much text fits
const TOOLTIP = {
    width: 360, // box width in px; all text wraps to fit inside it
    textSize: 12,
    lineHeight: 16,
    padding: 10,
    offset: 12, // gap between cursor and box
    maxChars: 300, // message cutoff (task_timelines.json already caps text at 300)
};

// the zoomed-in "family" scene
const FOCUS_FAMILY = "sector61_state5";
const PAGE_HEADER_HEIGHT = 130; // space at the top for the rotated page names
const FOCUS_TIMELINE_TOP = PAGE_HEADER_HEIGHT + 20; // timeline y of the first moment
const FOCUS_TIMELINE_SCREENS = 4; // timeline length in screen heights (also sets the step's height)
const FOCUS_TIME_PADDING = 12 * 3600; // seconds of empty time before the first and after the last event

// time axis: one tick line every 6 hours (also the size of the revisions reveal blocks)
const TICK_SECONDS = 6 * 3600;

const EVENT_COLORS = {
    open: "#6c8ebf",
    ask: "#f2c14e",
    answer: "#5fb49c",
    confirm: "#9bc53d",
    verify: "#c3a1ff",
    contradict: "#ff3b3b",
    ack: "#aaaaaa",
    post: "#f78154",
};

// loaded data
let taskData;
let revisionData;

// task events: one dot per event, plus the family rows and time range they're laid out on
let eventDots = [];
let familyNames = [];
let firstEventTime;
let lastEventTime;

// vertical pan of the whole canvas in px; eased toward targetPanY each frame
let panY = 0;
let targetPanY = 0;

// the focus family's pages (in order of first use), their short labels, and its padded time range
let focusPageNames = [];
let focusPageLabels = [];
let focusTimelineStart;
let focusTimelineEnd;

// p5: load both data files before setup() runs.
function preload() {
    taskData = loadJSON("data/task_timelines.json");
    revisionData = loadJSON("data/revision_timeline.json");
}

// p5: create the canvas and turn every task event into a dot.
function setup() {
    const canvas = createCanvas(windowWidth, windowHeight);
    canvas.parent("sticky");
    textFont("monospace");

    setupRevisions(revisionData);
    setStepHeight("family", FOCUS_TIMELINE_SCREENS);

    const events = taskData.events;

    // family rows, in the order the data lists them
    familyNames = [];
    const familyIndexByName = new Map();
    for (const family of taskData.families) {
        familyIndexByName.set(family.family, familyNames.length);
        familyNames.push(family.family);
    }

    // time range of all events
    firstEventTime = Infinity;
    lastEventTime = -Infinity;
    for (const event of events) {
        firstEventTime = Math.min(firstEventTime, event.t);
        lastEventTime = Math.max(lastEventTime, event.t);
    }

    // the focus family's pages, in the order they were first used
    const focusEvents = events.filter((event) => event.family === FOCUS_FAMILY);
    focusEvents.sort((a, b) => a.t - b.t);
    focusPageNames = [];
    focusPageLabels = [];
    const focusPageIndexByName = new Map();
    for (const event of focusEvents) {
        if (focusPageIndexByName.has(event.page)) continue;
        focusPageIndexByName.set(event.page, focusPageNames.length);
        focusPageNames.push(event.page);
        // short label: drop the "dse/" prefix and cut to 20 characters
        focusPageLabels.push(event.page.replace("dse/", "").slice(0, 20));
    }
    focusTimelineStart = focusEvents[0].t - FOCUS_TIME_PADDING;
    focusTimelineEnd = focusEvents[focusEvents.length - 1].t + FOCUS_TIME_PADDING;

    // one dot per event
    eventDots = [];
    for (const event of events) {
        const hex = EVENT_COLORS[event.event] || "#ffffff";
        eventDots.push({
            data: event, // the original record (shown in the tooltip)
            type: event.event,
            familyIndex: familyIndexByName.get(event.family),
            pageIndex: focusPageIndexByName.get(event.page), // only used for focus-family dots
            color: hex,
            // the same colour as [red, green, blue] numbers, for blending toward grey
            colorRgb: [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)],
            x: width / 2,
            y: height / 2,
            targetX: 0,
            targetY: 0,
            alpha: 0,
            targetAlpha: 0,
            isGrey: true, // target: should the dot be grey?
            greyAmount: 1, // current blend: 0 = event colour, 1 = grey (eased so colour changes fade)
        });
    }
}

// Make a step `screens` screen-heights tall, so scrolling through it takes that long.
function setStepHeight(stepName, screens) {
    const step = document.querySelector(`[data-step="${stepName}"]`);
    step.style.height = `${screens * 100}vh`;
}

// p5: keep the canvas the size of the window.
function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}

// helpers ------------------------------------------------------------------

// Format a unix time (in seconds) as "YYYY-MM-DD HH:MM" in UTC.
function formatUTC(seconds) {
    const iso = new Date(seconds * 1000).toISOString(); // e.g. "2026-06-16T12:00:00.000Z"
    return iso.slice(0, 10) + " " + iso.slice(11, 16);
}

// Screen y of a family's row in the family grid.
function familyRowY(familyIndex) {
    return map(familyIndex, 0, familyNames.length - 1, MARGIN, height - MARGIN);
}

// Screen x of a page column in the family scene.
function focusPageX(pageIndex) {
    return map(pageIndex, 0, focusPageNames.length - 1, PLOT_LEFT, width - MARGIN);
}

// Timeline y of a moment in the family scene (subtract panY to get screen y).
function focusTimeY(time) {
    const timelineHeight = height * FOCUS_TIMELINE_SCREENS;
    return map(time, focusTimelineStart, focusTimelineEnd, FOCUS_TIMELINE_TOP, FOCUS_TIMELINE_TOP + timelineHeight);
}

// Draw a horizontal line and a "MM-DD HH:MM" label every TICK_SECONDS from startTime to endTime.
// timeToY converts a time to timeline y. Ticks above screen y = minScreenY are skipped.
function drawTimeTicks(startTime, endTime, timeToY, minScreenY) {
    textSize(10);
    textAlign(LEFT, CENTER);
    const firstTick = Math.ceil(startTime / TICK_SECONDS) * TICK_SECONDS;
    for (let time = firstTick; time <= endTime; time += TICK_SECONDS) {
        const y = timeToY(time) - panY;
        if (y < minScreenY || y > height) continue;

        stroke(255, 25);
        line(PLOT_LEFT - 10, y, width - MARGIN, y);

        noStroke();
        fill(150);
        const label = formatUTC(time).slice(5); // drop the year, e.g. "06-16 12:00"
        text(label, 16, y);
    }
}

// Place every event dot on the time (x) by family (y) grid, and draw the family names.
// alphaFor(dot) and isGreyFor(dot) decide how each dot looks.
function showFamilyGrid(alphaFor, isGreyFor) {
    for (const dot of eventDots) {
        dot.targetX = map(dot.data.t, firstEventTime, lastEventTime, MARGIN + 160, width - MARGIN);
        dot.targetY = familyRowY(dot.familyIndex);
        dot.targetAlpha = alphaFor(dot);
        dot.isGrey = isGreyFor(dot);
    }

    // family names down the left side
    noStroke();
    fill(200, 150);
    textSize(10);
    textAlign(LEFT, CENTER);
    for (let i = 0; i < familyNames.length; i++) {
        text(familyNames[i], MARGIN, familyRowY(i));
    }
}

// scenes -------------------------------------------------------------------
// One function per step, named after the step's data-step attribute in index.html.
// Each receives `progress` (0 at the top of the step, 1 at the bottom) and sets targets for
// the dots it shows; all other dots stay hidden. To add a scene, add a function here and a
// matching <div class="step" data-step="name"> in index.html.

const SCENES = {
    // Every revision to the wiki over time (see revisions.js).
    revisions: revisionsScene,

    // All task events in grey, revealed in time order (left to right) as you scroll.
    overview(progress) {
        const revealUntil = lerp(firstEventTime, lastEventTime, constrain(progress * 1.5, 0, 1));
        showFamilyGrid(
            (dot) => (dot.data.t <= revealUntil ? 200 : 0),
            (dot) => true
        );
    },

    // All task events, coloured by event type.
    byType(progress) {
        showFamilyGrid(
            (dot) => 220,
            (dot) => false
        );
    },

    // Zoom into one family: x = page, y = time. Scrolling through the step pans down the timeline.
    family(progress) {
        const visibleHeight = height - FOCUS_TIMELINE_TOP - MARGIN;
        targetPanY = progress * (height * FOCUS_TIMELINE_SCREENS - visibleHeight);

        for (const dot of eventDots) {
            if (dot.data.family !== FOCUS_FAMILY) continue;
            dot.targetX = focusPageX(dot.pageIndex);
            dot.targetY = focusTimeY(dot.data.t);
            dot.targetAlpha = 255;
            dot.isGrey = false;
        }

        // which page column the mouse is over (-1 for none)
        let hoveredPage = -1;
        if (mouseY >= PAGE_HEADER_HEIGHT) {
            const columnSpacing = (width - MARGIN - PLOT_LEFT) / (focusPageNames.length - 1);
            const nearestColumn = Math.round((mouseX - PLOT_LEFT) / columnSpacing);
            if (nearestColumn >= 0 && nearestColumn < focusPageNames.length) {
                hoveredPage = nearestColumn;
            }
        }

        // a faint vertical line per page, brighter under the mouse
        for (let i = 0; i < focusPageNames.length; i++) {
            stroke(255, i === hoveredPage ? 60 : 12);
            const x = focusPageX(i);
            line(x, PAGE_HEADER_HEIGHT, x, height);
        }

        drawTimeTicks(focusTimelineStart, focusTimelineEnd, focusTimeY, PAGE_HEADER_HEIGHT);

        // drawn on top of the dots: a solid header band with the page names, reading upward
        return () => {
            noStroke();
            fill(17);
            rect(0, 0, width, PAGE_HEADER_HEIGHT);
            stroke(60);
            line(0, PAGE_HEADER_HEIGHT, width, PAGE_HEADER_HEIGHT);

            noStroke();
            textSize(9);
            textAlign(LEFT, CENTER);
            for (let i = 0; i < focusPageLabels.length; i++) {
                push();
                translate(focusPageX(i), PAGE_HEADER_HEIGHT - 8);
                rotate(-HALF_PI);
                fill(i === hoveredPage ? 255 : 140);
                text(focusPageLabels[i], 0, 0);
                pop();
            }
        };
    },

    // Highlight the few events where one agent contradicts another; everything else fades to grey.
    contradict(progress) {
        showFamilyGrid(
            (dot) => (dot.type === "contradict" ? 255 : 20),
            (dot) => dot.type !== "contradict"
        );
    },
};

// draw ---------------------------------------------------------------------

// p5: runs every frame. Resets the per-frame defaults, runs the active scene, then draws the
// revision dots, the event dots, the scene's overlay and the tooltip.
function draw() {
    background(17);

    // defaults for this frame: no pan and nothing shown; the scene overrides what it needs
    targetPanY = 0;
    revealLineY = -Infinity; // hides every revision block (see revisions.js)
    for (const dot of eventDots) dot.targetAlpha = 0;

    const scene = SCENES[scrollState.stepName] || SCENES.overview;
    const drawOverlay = scene(activeStepProgress());

    const hoveredRevision = drawRevisionDots();

    // Event dots. These use the canvas API directly: p5's fill() creates a new colour object
    // on every call, which made frames stutter with 2,000 dots. save() and restore() put the
    // canvas settings back afterwards so p5's own drawing isn't affected.
    const canvas = drawingContext;
    canvas.save();
    let hoveredEvent = null;
    for (const dot of eventDots) {
        // skip dots that are hidden and meant to stay hidden
        if (dot.targetAlpha === 0 && dot.alpha < 1) continue;

        // ease toward the targets
        dot.x = lerp(dot.x, dot.targetX, EASING);
        dot.y = lerp(dot.y, dot.targetY, EASING);
        dot.alpha = lerp(dot.alpha, dot.targetAlpha, EASING);
        const targetGrey = dot.isGrey ? 1 : 0;
        dot.greyAmount = lerp(dot.greyAmount, targetGrey, EASING);
        if (dot.alpha < 1) continue;

        // colour: the event colour, grey, or a blend while switching between them
        let fillColor;
        if (dot.greyAmount < 0.01) {
            fillColor = dot.color;
        } else if (dot.greyAmount > 0.99) {
            fillColor = GREY;
        } else {
            const [baseRed, baseGreen, baseBlue] = dot.colorRgb;
            const mixedRed = lerp(baseRed, 160, dot.greyAmount);
            const mixedGreen = lerp(baseGreen, 160, dot.greyAmount);
            const mixedBlue = lerp(baseBlue, 160, dot.greyAmount);
            fillColor = `rgb(${mixedRed}, ${mixedGreen}, ${mixedBlue})`;
        }

        const screenY = dot.y - panY;
        canvas.globalAlpha = dot.alpha / 255;
        canvas.fillStyle = fillColor;
        canvas.beginPath();
        canvas.arc(dot.x, screenY, 2.5, 0, TWO_PI);
        canvas.fill();

        const mouseIsOver = dist(mouseX, mouseY, dot.x, screenY) < 4;
        if (dot.alpha > 100 && mouseIsOver) hoveredEvent = dot;
    }
    canvas.restore();

    if (drawOverlay) drawOverlay();

    // tooltip for the dot under the mouse
    const hovered = hoveredEvent || hoveredRevision;
    if (hovered) {
        const info = hovered.data;
        let message = info.text || "";
        if (message.length > TOOLTIP.maxChars) {
            message = message.slice(0, TOOLTIP.maxChars) + "…";
        }
        const paragraphs = [`${info.label} · ${hovered.type}`, info.page, info.iso, ""];
        for (const part of message.split("\n")) paragraphs.push(part);

        // word-wrap each paragraph to fit inside the box
        textSize(TOOLTIP.textSize);
        const maxLineWidth = TOOLTIP.width - 2 * TOOLTIP.padding;
        const lines = [];
        for (const paragraph of paragraphs) {
            let currentLine = "";
            for (const word of paragraph.split(" ")) {
                const longerLine = currentLine === "" ? word : currentLine + " " + word;
                if (currentLine !== "" && textWidth(longerLine) > maxLineWidth) {
                    lines.push(currentLine);
                    currentLine = word;
                } else {
                    currentLine = longerLine;
                }
            }
            lines.push(currentLine);
        }

        // box beside the cursor, kept inside the canvas
        const boxHeight = lines.length * TOOLTIP.lineHeight + 2 * TOOLTIP.padding;
        const boxX = constrain(mouseX + TOOLTIP.offset, 0, width - TOOLTIP.width);
        const boxY = constrain(mouseY + TOOLTIP.offset, 0, height - boxHeight);
        fill(0, 220);
        stroke(80);
        rect(boxX, boxY, TOOLTIP.width, boxHeight);

        noStroke();
        fill(240);
        textAlign(LEFT, TOP);
        for (let i = 0; i < lines.length; i++) {
            const lineY = boxY + TOOLTIP.padding + i * TOOLTIP.lineHeight;
            text(lines[i], boxX + TOOLTIP.padding, lineY);
        }
    }

    panY = lerp(panY, targetPanY, PAN_EASING);
}
