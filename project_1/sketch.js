// Scrollytelling sketch (p5.js, global mode).
//
// How the pieces fit together:
// - scroll.js (scrollama) records which .step is active in `scrollState`.
// - Every frame, draw() calls the scene function for that step (see SCENES below) and
//   tells it how far through the step the reader has scrolled (0 to 1).
// - A scene sets a target position, opacity and colour for each dot it wants to show.
//   Every other dot is hidden. Dots ease toward their targets, so changing steps animates.
// - A scene can return a function that draws on top of the dots, such as a header.
// - Scenes with a long timeline also pan the canvas vertically (see SCENE_PANS).
// The "revisions" scene lives in revisions.js, the "hook" scene in hook.js, and the "swarm"
// scene (a force-graph network drawn on its own canvas, over this one) in swarm.js.

// Which step is active; set from the page by scroll.js.
const scrollState = { stepName: null, stepIndex: 0 };

// layout
const MARGIN = 60;
const PLOT_LEFT = 110; // x where timelines start; time labels sit to the left of it

// animation
const EASING = 0.08; // fraction of the way dots move/fade toward their targets each frame
const EVENT_DOT_RADIUS = 3.75; // task event dots (the task families and family scenes)
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
const DEFAULT_FOCUS_FAMILY = "sector61_state5"; // shown unless the reader clicks another family in byType
const PAGE_HEADER_HEIGHT = 130; // space at the top for the rotated page names
const FOCUS_TIMELINE_TOP = PAGE_HEADER_HEIGHT + 20; // timeline y of the first moment
const FOCUS_TIMELINE_SCREENS = 4; // timeline length in screen heights (also sets the step's height)
// empty time before the first and after the last event: 10% of the family's time span, 5 minutes to 12 hours
const FOCUS_TIME_PADDING_SHARE = 0.1;
const FOCUS_TIME_PADDING_MAX = 12 * 3600;
const FOCUS_TIME_PADDING_MIN = 5 * 60; // so a family whose posts share one moment still has a timeline
// time ticks: the longest of these intervals (seconds) that still gives at least FOCUS_MIN_TICKS ticks
const FOCUS_TICK_CHOICES = [6 * 3600, 3 * 3600, 3600, 30 * 60, 15 * 60, 10 * 60, 5 * 60];
const FOCUS_MIN_TICKS = 8;

// pop-up callouts: revision moments (revisions.js) and family events (setFocusFamily); see drawCallout
const CALLOUT = {
    width: 280,
    padding: 10,
    textSize: 11,
    lineHeight: 15,
    gap: 16, // between a circled dot and its box, and between the plot and the pinned text cards
    stackGap: 6, // between stacked boxes (see the minTop argument of drawCallout)
    ringSize: 14, // diameter of the circle around a dot
};

// time axis: one tick line every 6 hours (also the size of the revisions reveal blocks)
const TICK_SECONDS = 6 * 3600;
const DAY_SECONDS = 24 * 3600;

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
let revisionMomentsData; // the revisions timeline's pop-ups (see revisions.js)
let familyNotes; // each task family's question and labelled posts (see setFocusFamily)
let swarmData;

// task events: one dot per event, plus the family rows and time range they're laid out on
let eventDots = [];
let familyNames = [];
let firstEventTime;
let lastEventTime;

// vertical pan of the whole canvas in px (see SCENE_PANS)
let panY = 0;

// the step drawn last frame, to notice when the step changes, and when (millis) it last did
let previousStepName = null;
let stepChangedAt = 0;

// the family the "family" scene zooms into (see setFocusFamily), its pages (in order of first
// use), their short labels, and its padded time range
let focusFamily;
let focusPageNames = [];
let focusPageLabels = [];
let focusTimelineStart;
let focusTimelineEnd;
let focusTickSeconds; // time between tick lines in the family scene
let focusMoments = []; // the focus family's labelled posts (from familyNotes), each with its dot

// p5: load the data files before setup() runs.
function preload() {
    taskData = loadJSON("data/task_timelines.json");
    revisionData = loadJSON("data/revision_timeline.json");
    revisionMomentsData = loadJSON("data/revision_moments.json");
    familyNotes = loadJSON("data/family_notes.json");
    swarmData = loadJSON("data/swarm_graph.json");
}

// Whether setup() has run (nav.js waits for it before resizing the canvas).
let isSketchSetUp = false;

// p5: create the canvas, below the nav bar if it's showing (nav.js), and set up every scene's data.
function setup() {
    const canvas = createCanvas(windowWidth, windowHeight - navHeight());
    canvasWindowSize = { width: windowWidth, height: windowHeight };
    canvas.parent("sticky");
    textFont("monospace");

    tagRevisionActions(revisionData.revisions, taskData.events); // before the charts coloured by it
    setupRevisions(revisionData, revisionMomentsData); // revisions.js
    setupHook(revisionData); // hook.js
    setupSwarm(swarmData); // swarm.js
    setupEventDots(taskData);
    setupFamilyStep();
    isSketchSetUp = true;
}

// Give each wiki revision the task action it was (its event type in task_timelines.json: post,
// confirm, …), or null if it wasn't one, so the scale and timeline charts can colour actions as the
// task families chart does (see revisionColor in revisions.js). Every event is exactly one revision,
// matched by time, agent and page.
function tagRevisionActions(revisions, events) {
    const key = (record) => `${record.t}|${record.label}|${record.page}`;
    const actionByKey = new Map(events.map((event) => [key(event), event.event]));
    for (const revision of revisions) revision.action = actionByKey.get(key(revision)) ?? null;
}

// One dot per task event, plus the family rows and the time range they're laid out on.
function setupEventDots(json) {
    // family rows, in the order the data lists them
    familyNames = json.families.map((family) => family.family);

    // time range of all events
    const times = json.events.map((event) => event.t);
    firstEventTime = Math.min(...times);
    lastEventTime = Math.max(...times);

    eventDots = json.events.map((event) => {
        const hex = EVENT_COLORS[event.event] || "#ffffff";
        return {
            data: event, // the original record (shown in the tooltip)
            type: event.event,
            familyIndex: familyNames.indexOf(event.family),
            pageIndex: 0, // column in the family scene; set for the focus family by setFocusFamily
            color: hex,
            colorRgb: hexToRgb(hex), // for blending toward grey
            x: width / 2,
            y: height / 2,
            targetX: 0,
            targetY: 0,
            alpha: 0,
            targetAlpha: 0,
            isLeaving: false, // fading out in place after a step change (see drawEventDots)
            isGrey: true, // target: should the dot be grey?
            greyAmount: 1, // current blend: 0 = event colour, 1 = grey (eased so colour changes fade)
        };
    });
}

// The family step: its height, its pinned cards just below the page-name header (where its
// timeline starts), where its page columns end, and the family it starts on.
function setupFamilyStep() {
    setStepHeight("family", FOCUS_TIMELINE_SCREENS);
    pinnedCards("family").style.setProperty("--pinned-top", `${FOCUS_TIMELINE_TOP}px`); // see .step-pinned
    updateFocusPlotRight();
    setFocusFamily(DEFAULT_FOCUS_FAMILY);
}

// "#6c8ebf" → [108, 142, 191]
function hexToRgb(hex) {
    return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
}

// Make `familyName` the family the "family" scene zooms into: work out its pages (in the order
// they were first used), their labels and its time range, give its dots their page columns, and
// show its name in the family step's text.
function setFocusFamily(familyName) {
    focusFamily = familyName;
    const focusDots = eventDots.filter((dot) => dot.data.family === familyName);
    focusDots.sort((a, b) => a.data.t - b.data.t);

    focusPageNames = [];
    focusPageLabels = [];
    const focusPageIndexByName = new Map();
    for (const dot of focusDots) {
        const page = dot.data.page;
        if (!focusPageIndexByName.has(page)) {
            focusPageIndexByName.set(page, focusPageNames.length);
            focusPageNames.push(page);
            // short label: drop the "dse/" prefix and cut to 20 characters
            focusPageLabels.push(page.replace("dse/", "").slice(0, 20));
        }
        dot.pageIndex = focusPageIndexByName.get(page);
    }
    const firstTime = focusDots[0].data.t;
    const lastTime = focusDots[focusDots.length - 1].data.t;
    const share = (lastTime - firstTime) * FOCUS_TIME_PADDING_SHARE;
    const padding = constrain(share, FOCUS_TIME_PADDING_MIN, FOCUS_TIME_PADDING_MAX);
    focusTimelineStart = firstTime - padding;
    focusTimelineEnd = lastTime + padding;
    const timelineSeconds = focusTimelineEnd - focusTimelineStart;
    const givesEnoughTicks = (seconds) => timelineSeconds / seconds >= FOCUS_MIN_TICKS;
    focusTickSeconds = FOCUS_TICK_CHOICES.find(givesEnoughTicks) ?? FOCUS_TICK_CHOICES.at(-1);

    // its question and labelled posts (data/family_notes.json), each matched to its dot by time and
    // agent name: `moments` (at most five) point at posts by `iso` time and agent `label`, exactly
    // as they appear in task_timelines.json
    const notes = familyNotes[familyName] || { question: "", moments: [] };
    focusMoments = [];
    for (const moment of notes.moments) {
        const time = parseUTC(moment.iso);
        const dot = focusDots.find((d) => d.data.t === time && d.data.label === moment.label);
        if (dot) focusMoments.push({ text: moment.text, dot });
        else console.warn(`family_notes.json: no ${familyName} post at ${moment.iso} by ${moment.label}`);
    }
    focusMoments.sort((a, b) => a.dot.data.t - b.dot.data.t);

    document.getElementById("focus-family-name").textContent = familyName;
    document.getElementById("focus-family-question").textContent = notes.question;
}

// Make a step `screens` screen-heights tall, so scrolling through it takes that long.
function setStepHeight(stepName, screens) {
    const step = document.querySelector(`#scrolly .step[data-step="${stepName}"]`);
    step.style.height = `${screens * 100}vh`;
}

// The window size the canvas was last fitted to (see windowResized).
let canvasWindowSize;

// A phone's browser resizes the window as its toolbars slide in and out while scrolling. Resizing
// the canvas then would clear it and refit the swarm graph mid-scroll, so on a touch screen a change
// in height alone, smaller than this (px), is ignored.
const TOOLBAR_RESIZE_MAX = 160;

// p5: keep the canvas the size of the window.
function windowResized() {
    const isToolbarResize = window.matchMedia("(pointer: coarse)").matches &&
        windowWidth === canvasWindowSize.width &&
        Math.abs(windowHeight - canvasWindowSize.height) < TOOLBAR_RESIZE_MAX;
    if (!isToolbarResize) fitCanvas();
}

// Size the canvas to the window, less the nav bar above it (nav.js), and everything laid out from it.
function fitCanvas() {
    canvasWindowSize = { width: windowWidth, height: windowHeight };
    resizeCanvas(windowWidth, windowHeight - navHeight());
    updateFocusPlotRight();
    resizeSwarm(); // swarm.js
}

// p5: in the byType scene, clicking a family's row zooms in on that family by scrolling to the
// family step.
function mousePressed() {
    if (scrollState.stepName !== "byType") return;
    const familyIndex = familyRowUnderMouse();
    if (familyIndex === -1) return;
    setFocusFamily(familyNames[familyIndex]);
    scrollToStep("family"); // scroll.js
}

// helpers ------------------------------------------------------------------

// Word-wrap each paragraph to fit within maxLineWidth px at the current text size. Returns the
// lines; every paragraph starts on a new line.
function wrapParagraphs(paragraphs, maxLineWidth) {
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
    return lines;
}

// Parse an ISO date string (e.g. "2026-06-16T09:33:05Z") into unix time in seconds.
function parseUTC(iso) {
    return Date.parse(iso) / 1000;
}

// Format a unix time (in seconds) as "YYYY-MM-DD HH:MM" in UTC.
function formatUTC(seconds) {
    const iso = new Date(seconds * 1000).toISOString(); // e.g. "2026-06-16T12:00:00.000Z"
    return iso.slice(0, 10) + " " + iso.slice(11, 16);
}

// Draw a callout for screen y: a circle around each point in `rings` ({ x, y }), and a box of
// `paragraphs` ({ text, grey }, each word-wrapped) beside the first ring, right of it if there's
// room and otherwise left, moved clear of the text cards on screen if it would cover them, and
// joined to each ring by a line. With no rings, the box sits at the
// plot's right edge with a line across the plot to it. The box's top lines up with y unless that
// is above minTop (to keep clear of a box above). `alpha` (0 to 1) fades it all in, and the box
// rises into place as it does. Returns the box's bottom edge (or minTop if it's off screen).
function drawCallout(rings, y, paragraphs, alpha, minTop = -Infinity) {
    const boxWidth = CALLOUT.width;
    const plotRight = width - MARGIN;
    textSize(CALLOUT.textSize);
    const lines = [];
    for (const paragraph of paragraphs) {
        for (const line of calloutLines(paragraph.text)) lines.push({ text: line, grey: paragraph.grey });
    }
    const boxHeight = lines.length * CALLOUT.lineHeight + 2 * CALLOUT.padding;
    const settledY = Math.max(y - CALLOUT.lineHeight, minTop);
    if (settledY > height || settledY + boxHeight < 0) return minTop; // off screen

    let boxX = plotRight - boxWidth;
    if (rings.length > 0) {
        // try beside the ring (right, then left), then either side of the text cards; take the
        // first spot that doesn't cover the cards
        const firstX = rings[0].x;
        const cards = visibleCardsBox();
        const candidates = [firstX + CALLOUT.gap, firstX - CALLOUT.gap - boxWidth];
        if (cards) candidates.push(cards.right + CALLOUT.gap, cards.left - CALLOUT.gap - boxWidth);
        const spots = candidates.map((x) => constrain(x, PLOT_LEFT, plotRight - boxWidth));
        const coversCards = (x) => {
            if (!cards) return false;
            const overlapsAcross = x < cards.right && x + boxWidth > cards.left;
            const overlapsDown = settledY < cards.bottom && settledY + boxHeight > cards.top;
            return overlapsAcross && overlapsDown;
        };
        boxX = spots.find((x) => !coversCards(x)) ?? spots[0];
    }
    const boxY = settledY + (1 - alpha) * 10;

    // circle each point and join it to the nearest side of the box, level with it if it can be
    noFill();
    const ringEdge = CALLOUT.ringSize / 2;
    for (const ring of rings) {
        stroke(255, 255 * alpha);
        circle(ring.x, ring.y, CALLOUT.ringSize);
        stroke(255, 90 * alpha);
        const joinY = constrain(ring.y, boxY + CALLOUT.padding, boxY + boxHeight - CALLOUT.padding);
        if (ring.x < boxX) line(ring.x + ringEdge, ring.y, boxX, joinY);
        else if (ring.x > boxX + boxWidth) line(ring.x - ringEdge, ring.y, boxX + boxWidth, joinY);
    }
    if (rings.length === 0) {
        stroke(255, 90 * alpha);
        line(PLOT_LEFT - 10, y, boxX, y);
    }

    fill(0, 220 * alpha);
    stroke(80, 255 * alpha);
    rect(boxX, boxY, boxWidth, boxHeight);

    noStroke();
    textAlign(LEFT, TOP);
    for (let i = 0; i < lines.length; i++) {
        fill(lines[i].grey, 255 * alpha);
        text(lines[i].text, boxX + CALLOUT.padding, boxY + CALLOUT.padding + i * CALLOUT.lineHeight);
    }
    return settledY + boxHeight;
}

// A callout paragraph word-wrapped to the box's width. The texts never change and the box is a
// fixed size, so each is wrapped once and remembered.
const calloutLineCache = new Map();
function calloutLines(text) {
    if (!calloutLineCache.has(text)) {
        calloutLineCache.set(text, wrapParagraphs([text], CALLOUT.width - 2 * CALLOUT.padding));
    }
    return calloutLineCache.get(text);
}

// The box ({ left, right, top, bottom }, in canvas px) around the active step's text cards that are
// on screen, or null if none are. Measured once per frame, however many callouts ask.
let cardsBoxFrame = -1;
let cardsBox = null;
function visibleCardsBox() {
    if (cardsBoxFrame === frameCount) return cardsBox;
    cardsBoxFrame = frameCount;
    let box = null;
    const canvasTop = navHeight(); // the canvas sits below the nav bar
    for (const card of stepElements[scrollState.stepIndex].querySelectorAll("p")) {
        const rect = card.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
        const top = rect.top - canvasTop;
        const bottom = rect.bottom - canvasTop;
        if (!box) box = { left: rect.left, right: rect.right, top, bottom };
        box.left = Math.min(box.left, rect.left);
        box.right = Math.max(box.right, rect.right);
        box.top = Math.min(box.top, top);
        box.bottom = Math.max(box.bottom, bottom);
    }
    cardsBox = box;
    return box;
}

// Screen y of a family's row in the family grid.
function familyRowY(familyIndex) {
    return map(familyIndex, 0, familyNames.length - 1, MARGIN, height - MARGIN);
}

// Screen x of a page column in the family scene. A family with one page gets one centred column.
function focusPageX(pageIndex) {
    if (focusPageNames.length === 1) return (PLOT_LEFT + focusPlotRight) / 2;
    return map(pageIndex, 0, focusPageNames.length - 1, PLOT_LEFT, focusPlotRight);
}

// Where the family scene's page columns end: left of the step's pinned cards (which sit on the
// right), unless that would leave the columns less than half the screen.
let focusPlotRight;
function updateFocusPlotRight() {
    focusPlotRight = Math.min(spaceLeftOfPinnedCards("family") - CALLOUT.gap, width - MARGIN);
}

// A step's pinned text cards (the .step-pinned block), and the screen x where they start if they sit
// on the right half of the screen (on a narrow screen they span it, so this is the full width).
function pinnedCards(stepName) {
    return document.querySelector(`#scrolly .step[data-step="${stepName}"] .step-pinned`);
}
function spaceLeftOfPinnedCards(stepName) {
    const cardsLeft = pinnedCards(stepName).getBoundingClientRect().left;
    return cardsLeft > window.innerWidth / 2 ? cardsLeft : window.innerWidth;
}

// Timeline y of a moment in the family scene (subtract panY to get screen y).
function focusTimeY(time) {
    const timelineHeight = height * FOCUS_TIMELINE_SCREENS;
    const timelineBottom = FOCUS_TIMELINE_TOP + timelineHeight;
    return map(time, focusTimelineStart, focusTimelineEnd, FOCUS_TIMELINE_TOP, timelineBottom);
}

// Draw a horizontal line and a "MM-DD HH:MM" label every tickSeconds (default TICK_SECONDS) from
// startTime to endTime. timeToY converts a time to timeline y. Ticks above screen y = minScreenY
// are skipped.
function drawTimeTicks(startTime, endTime, timeToY, minScreenY, tickSeconds = TICK_SECONDS) {
    textSize(10);
    textAlign(LEFT, CENTER);
    const firstTick = Math.ceil(startTime / tickSeconds) * tickSeconds;
    for (let time = firstTick; time <= endTime; time += tickSeconds) {
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
// alphaFor(dot) and isGreyFor(dot) decide how each dot looks. The name of the family at
// highlightedIndex (if any) is drawn brighter.
function showFamilyGrid(alphaFor, isGreyFor, highlightedIndex = -1) {
    for (const dot of eventDots) {
        dot.targetX = map(dot.data.t, firstEventTime, lastEventTime, MARGIN + 160, width - MARGIN);
        dot.targetY = familyRowY(dot.familyIndex);
        dot.targetAlpha = alphaFor(dot);
        dot.isGrey = isGreyFor(dot);
    }

    // family names down the left side
    noStroke();
    textSize(10);
    textAlign(LEFT, CENTER);
    for (let i = 0; i < familyNames.length; i++) {
        fill(i === highlightedIndex ? 255 : 200, i === highlightedIndex ? 255 : 150);
        text(familyNames[i], MARGIN, familyRowY(i));
    }
}

// The family row under the mouse in the family grid, or -1. Only counts the mouse when it is
// over the canvas itself (not over a text card) and inside the grid.
function familyRowUnderMouse() {
    const elementUnderMouse = document.elementFromPoint(winMouseX, winMouseY); // in window px
    if (!elementUnderMouse || elementUnderMouse.tagName !== "CANVAS") return -1;
    if (mouseX < MARGIN || mouseX > width - MARGIN) return -1;
    const rowSpacing = (height - 2 * MARGIN) / (familyNames.length - 1);
    const nearestRow = Math.round((mouseY - MARGIN) / rowSpacing);
    if (nearestRow < 0 || nearestRow >= familyNames.length) return -1;
    return nearestRow;
}

// scenes -------------------------------------------------------------------
// How far down (in px) each long-timeline scene pans the canvas, given the scroll progress
// through its step. Scenes not listed here don't pan.

const SCENE_PANS = {
    // progress 0 puts the start of the timeline on the reveal line, 1 puts the end there
    revisions: revisionsPan, // revisions.js

    // progress 0 shows the top of the timeline, 1 shows the bottom
    family(progress) {
        const visibleHeight = height - FOCUS_TIMELINE_TOP - MARGIN;
        return progress * (height * FOCUS_TIMELINE_SCREENS - visibleHeight);
    },
};

// One function per step, named after the step's data-step attribute in index.html.
// Each receives `progress` (0 at the top of the step, 1 at the bottom) and sets targets for
// the dots it shows; all other dots stay hidden. To add a scene, add a function here and a
// matching <div class="step" data-step="name"> in index.html. The hook steps (hook.js) and the
// swarm step (swarm.js) have no scene here: those modules check scrollState themselves.

const SCENES = {
    // Every revision to the wiki over time (see revisions.js).
    revisions: revisionsScene,

    // All task events, coloured by event type. Hovering a family's row highlights it; clicking it
    // zooms in on that family (see mousePressed).
    byType(progress) {
        const hoveredFamily = familyRowUnderMouse();
        const isHovering = hoveredFamily !== -1;
        showFamilyGrid(
            (dot) => (!isHovering || dot.familyIndex === hoveredFamily ? 220 : 60),
            (dot) => false,
            hoveredFamily
        );
        if (isHovering) cursor(HAND);
    },

    // Zoom into one family (focusFamily): x = page, y = time. Scrolling through the step pans
    // down the timeline.
    family(progress) {
        for (const dot of eventDots) {
            if (dot.data.family !== focusFamily) continue;
            dot.targetX = focusPageX(dot.pageIndex);
            dot.targetY = focusTimeY(dot.data.t);
            dot.targetAlpha = 255;
            dot.isGrey = false;
        }

        // a faint vertical line per page, brighter under the mouse
        const hoveredPage = focusPageUnderMouse();
        for (let i = 0; i < focusPageNames.length; i++) {
            stroke(255, i === hoveredPage ? 60 : 12);
            const x = focusPageX(i);
            line(x, PAGE_HEADER_HEIGHT, x, height);
        }

        drawTimeTicks(focusTimelineStart, focusTimelineEnd, focusTimeY, PAGE_HEADER_HEIGHT, focusTickSeconds);

        // drawn on top of the dots: the labelled posts, then the page-name header they scroll under
        return () => {
            drawFocusMoments();
            drawFocusPageHeader(hoveredPage);
        };
    },
};

// The family scene's page column under the mouse: the nearest, if it's within half a column's
// width (40px for a family with one page), or -1.
function focusPageUnderMouse() {
    if (mouseY < PAGE_HEADER_HEIGHT) return -1;
    const pageCount = focusPageNames.length;
    let nearest = -1;
    let nearestDistance = pageCount > 1 ? (focusPageX(1) - focusPageX(0)) / 2 : 40;
    for (let i = 0; i < pageCount; i++) {
        const distance = Math.abs(mouseX - focusPageX(i));
        if (distance <= nearestDistance) {
            nearestDistance = distance;
            nearest = i;
        }
    }
    return nearest;
}

// A solid header band across the top of the family scene, with each page's name reading upward
// above its column (the hovered one brighter).
function drawFocusPageHeader(hoveredPage) {
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
}

// Label the focus family's key posts (focusMoments) as callouts on their dots, following the dots
// as they move and fade. Each box is kept clear of the one above it, since posts can be minutes apart.
function drawFocusMoments() {
    let previousBottom = -Infinity;
    for (const moment of focusMoments) {
        const dot = moment.dot;
        const alpha = dot.alpha / 255;
        if (alpha < 0.01) continue;
        const y = dot.y - panY;
        const paragraphs = [
            { text: formatUTC(dot.data.t) + " UTC", grey: 150 },
            { text: moment.text, grey: 240 },
        ];
        const minTop = previousBottom + CALLOUT.stackGap;
        previousBottom = drawCallout([{ x: dot.x, y }], y, paragraphs, alpha, minTop);
    }
}

// draw ---------------------------------------------------------------------

// p5: runs every frame. Updates the pan, runs the active scene, then draws the hook dots, the
// revision dots, the event dots, the scene's overlay and the tooltip.
function draw() {
    background(17);

    const stepName = scrollState.stepName;
    const progress = activeStepProgress();
    const stepChanged = updatePan(stepName, progress);

    // defaults for this frame: nothing shown and an ordinary cursor; the scene overrides what it needs
    cursor(ARROW);
    for (const dot of eventDots) dot.targetAlpha = 0;

    const scene = SCENES[stepName];
    const drawOverlay = scene ? scene(progress) : null;
    updateSwarm(); // shows or hides the swarm graph and advances its playback (swarm.js)

    const hoveredHook = drawHookDots(); // hook.js
    const hoveredRevision = drawRevisionDots(); // revisions.js
    const hoveredEvent = drawEventDots(stepChanged);
    if (drawOverlay) drawOverlay();
    drawTooltip(hoveredEvent || hoveredRevision || hoveredHook);
}

// Vertical pan. Within a step it eases toward its target, so scrolling feels smooth. When the step
// changes it jumps straight there instead: easing across a big pan change would drag every dot
// across the screen. Event dots are shifted by the same jump so they stay where they are on
// screen, then ease from there to their new places. Returns whether the step changed.
function updatePan(stepName, progress) {
    const panFor = SCENE_PANS[stepName];
    const targetPanY = panFor ? panFor(progress) : 0;
    const stepChanged = stepName !== previousStepName;
    if (!stepChanged) {
        panY = lerp(panY, targetPanY, PAN_EASING);
        return false;
    }

    const jump = targetPanY - panY;
    for (const dot of eventDots) {
        dot.y += jump;
        // A dot that's off screen would fly in from the edge. Hide it instead, so it fades in at
        // its new place (hidden dots start at their target; see drawEventDots).
        const screenY = dot.y - targetPanY;
        if (screenY < 0 || screenY > height) dot.alpha = 0;
    }
    panY = targetPanY;
    previousStepName = stepName;
    stepChangedAt = millis();
    return true;
}

// Ease every event dot toward the target the scene gave it, and draw the visible ones. Returns the
// dot under the mouse, or null.
// These use the canvas API directly: p5's fill() creates a new colour object on every call, which
// made frames stutter with 2,000 dots. save() and restore() put the canvas settings back afterwards
// so p5's own drawing isn't affected.
function drawEventDots(stepChanged) {
    const canvas = drawingContext;
    canvas.save();
    let hovered = null;
    for (const dot of eventDots) {
        // skip dots that are hidden and meant to stay hidden
        if (dot.targetAlpha === 0 && dot.alpha < 1) continue;

        // On a step change, a visible dot whose new place is off screen would streak off the
        // edge. Mark it as leaving: it fades out where it is, then reappears at its target.
        if (stepChanged && dot.alpha >= 1) {
            const targetScreenY = dot.targetY - panY;
            if (targetScreenY < 0 || targetScreenY > height) dot.isLeaving = true;
        }

        if (dot.isLeaving) {
            // fade out without moving
            dot.alpha = lerp(dot.alpha, 0, EASING);
            if (dot.alpha < 1) dot.isLeaving = false;
        } else {
            // a hidden dot starts at its target, so it fades in there instead of flying in
            if (dot.alpha < 1) {
                dot.x = dot.targetX;
                dot.y = dot.targetY;
            }
            // ease toward the targets
            dot.x = lerp(dot.x, dot.targetX, EASING);
            dot.y = lerp(dot.y, dot.targetY, EASING);
            dot.alpha = lerp(dot.alpha, dot.targetAlpha, EASING);
        }
        dot.greyAmount = lerp(dot.greyAmount, dot.isGrey ? 1 : 0, EASING);
        if (dot.alpha < 1) continue;

        const screenY = dot.y - panY;
        canvas.globalAlpha = dot.alpha / 255;
        canvas.fillStyle = eventDotColor(dot);
        canvas.beginPath();
        canvas.arc(dot.x, screenY, EVENT_DOT_RADIUS, 0, TWO_PI);
        canvas.fill();

        const mouseIsOver = dist(mouseX, mouseY, dot.x, screenY) < EVENT_DOT_RADIUS + 2;
        if (dot.alpha > 100 && mouseIsOver) hovered = dot;
    }
    canvas.restore();
    return hovered;
}

// An event dot's colour: its event colour, grey, or a blend while it switches between them.
function eventDotColor(dot) {
    if (dot.greyAmount < 0.01) return dot.color;
    if (dot.greyAmount > 0.99) return GREY;
    const [red, green, blue] = dot.colorRgb.map((channel) => lerp(channel, 160, dot.greyAmount));
    return `rgb(${red}, ${green}, ${blue})`;
}

// Tooltip for the dot under the mouse (an event, revision or hook dot), if any: who and what (in the
// dot's colour), where, when, and the start of the message, in a box beside the cursor.
function drawTooltip(hovered) {
    if (!hovered) return;
    const info = hovered.data;
    let message = info.text || "";
    if (message.length > TOOLTIP.maxChars) {
        message = message.slice(0, TOOLTIP.maxChars) + "…";
    }
    const details = [info.page, info.iso, "", ...message.split("\n")];

    // word-wrap each paragraph to fit inside the box
    textSize(TOOLTIP.textSize);
    const wrapWidth = TOOLTIP.width - 2 * TOOLTIP.padding;
    const titleLines = wrapParagraphs([`${info.label} · ${hovered.type}`], wrapWidth);
    const lines = [...titleLines, ...wrapParagraphs(details, wrapWidth)];

    // box beside the cursor, kept inside the canvas
    const boxHeight = lines.length * TOOLTIP.lineHeight + 2 * TOOLTIP.padding;
    const boxX = constrain(mouseX + TOOLTIP.offset, 0, width - TOOLTIP.width);
    const boxY = constrain(mouseY + TOOLTIP.offset, 0, height - boxHeight);
    fill(0, 220);
    stroke(80);
    rect(boxX, boxY, TOOLTIP.width, boxHeight);

    noStroke();
    textAlign(LEFT, TOP);
    for (let i = 0; i < lines.length; i++) {
        fill(i < titleLines.length ? hovered.color : 240);
        const lineY = boxY + TOOLTIP.padding + i * TOOLTIP.lineHeight;
        text(lines[i], boxX + TOOLTIP.padding, lineY);
    }
}
