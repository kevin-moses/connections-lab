// The "revisions" step: every revision to the wiki (data/revision_timeline.json) on one timeline.
// x = page (sorted by name, no labels), y = time. A revision that was a task action (post, confirm, …)
// is coloured as on the task families chart; the rest by their kind of edit (see revisionColor). The timeline pans as you scroll. Time is
// split into 6-hour blocks (TICK_SECONDS); when a block crosses the reveal line its dots fade
// in one by one in random order, and they fade out again if you scroll back up past it.
// The story's big moments (data/revision_moments.json) pop up beside their time as the reveal line
// reaches them. Each has an ISO time, the revisions to circle (`revs`, ids from
// revision_timeline.json; the box sits beside the first), and its `text`. A moment without
// revisions gets a line across the timeline instead. `source` is shown under the text, for claims
// that come from outside these logs; those moments only have a date, so they sit at midnight.
//
// Loaded before sketch.js so SCENES can use revisionsScene. Uses these from sketch.js:
// TICK_SECONDS, PLOT_LEFT, MARGIN, EASING, EVENT_COLORS, panY, formatUTC, setStepHeight, drawTimeTicks,
// drawCallout, CALLOUT, parseUTC, DAY_SECONDS.

const REVISIONS = {
    screensPerDay: 0.5, // timeline length per day, in screen heights (also sets the step's height)
    blockRevealMs: 500, // every dot in a block is fully visible this long after the block is reached
    dotFadeMs: 150, // how long one dot takes to fade in or out
    dotSize: 4.5, // diameter in px
    revealLinePosition: 0.8, // reveal line (and current date/time), as a fraction of the canvas height
    // the step's .timeline-card paragraphs are spread evenly over this stretch of the timeline,
    // before the agents start coordinating on June 16
    cardsFrom: "2026-05-26T00:00:00Z",
    cardsUntil: "2026-06-15T12:00:00Z",
};

// Revisions that weren't a task action (see tagRevisionActions in sketch.js), by kind of edit. These
// share hues with some actions (creation and answer are both green, for example); the tooltip names
// which it is.
const KIND_COLORS = {
    creation: "#5fb49c",
    edit: "#6c8ebf",
    append: "#f2c14e",
    prune: "#ff3b3b",
    noop: "#666666",
    history_truncated: "#c3a1ff",
};

// A revision's colour on the scale and timeline charts: its task action's colour, the same as on the
// task families chart (EVENT_COLORS in sketch.js), or else its kind of edit's.
function revisionColor(revision) {
    return EVENT_COLORS[revision.action] || KIND_COLORS[revision.kind] || "#ffffff";
}

// What a revision was, for its tooltip: its task action if it was one, else its kind of edit.
function revisionType(revision) {
    return revision.action || revision.kind;
}

let revisionDots = [];
let revisionMoments = []; // the moments, with their time, dots and pop-up opacity
let timeBlocks = []; // one per 6 hours: { isShown, changedAt }
let revisionPageCount = 0;
let revisionsStart; // unix seconds, rounded down to a 6-hour boundary
let revisionsEnd;
let revisionTimelineScreens; // timeline length in screen heights

// Timeline y of the reveal line. Set every frame by revisionsScene; outside the revisions step it's
// -Infinity (see drawRevisionDots), which means no block is revealed.
let revealLineY = -Infinity;

// Whether any revision dot was visible or still fading last frame.
let anyRevisionVisible = false;

// The pan used to place revision dots. Follows panY during the revisions step and stays put
// after it, so the dots fade out where they are instead of jumping with the next step's pan.
let revisionPanY = 0;

// Build the revision dots, the 6-hour blocks and the moments, and size the step to fit the
// timeline. Called once from setup() in sketch.js.
function setupRevisions(json, momentsJson) {
    const revisions = json.revisions;

    // time range; the start is rounded down so blocks line up with the tick labels
    let earliest = Infinity;
    let latest = -Infinity;
    for (const revision of revisions) {
        earliest = Math.min(earliest, revision.t);
        latest = Math.max(latest, revision.t);
    }
    revisionsStart = Math.floor(earliest / TICK_SECONDS) * TICK_SECONDS;
    revisionsEnd = latest;

    // the step is exactly as tall as the timeline, so the timeline scrolls along with the page
    const days = (revisionsEnd - revisionsStart) / (DAY_SECONDS);
    revisionTimelineScreens = days * REVISIONS.screensPerDay;
    setStepHeight("revisions", revisionTimelineScreens);

    // Place the text cards: a card with a data-time sits at that moment; the rest are spread evenly
    // between cardsFrom and cardsUntil. The step is as tall as the timeline, so a card this far down
    // the step reaches the middle of the screen when the reveal line reaches its time.
    const cards = [...document.querySelectorAll('[data-step="revisions"] p.timeline-card')];
    const spreadCards = cards.filter((card) => !card.dataset.time);
    const cardsFrom = parseUTC(REVISIONS.cardsFrom);
    const cardsUntil = parseUTC(REVISIONS.cardsUntil);
    for (const card of cards) {
        const spreadIndex = spreadCards.indexOf(card);
        const time = card.dataset.time
            ? parseUTC(card.dataset.time)
            : lerp(cardsFrom, cardsUntil, spreadIndex / Math.max(1, spreadCards.length - 1));
        // in vh, so it holds when the window resizes
        card.style.top = `${(revisionTimeY(time) / height) * 100}vh`;
    }

    // one column per page, sorted by name
    const pageSet = new Set();
    for (const revision of revisions) pageSet.add(revision.page);
    const pageNames = Array.from(pageSet).sort();
    const pageIndexByName = new Map();
    for (let i = 0; i < pageNames.length; i++) pageIndexByName.set(pageNames[i], i);
    revisionPageCount = pageNames.length;

    revisionDots = [];
    for (const revision of revisions) {
        revisionDots.push({
            data: revision, // the original record (shown in the tooltip)
            type: revisionType(revision),
            pageIndex: pageIndexByName.get(revision.page),
            blockIndex: Math.floor((revision.t - revisionsStart) / TICK_SECONDS),
            // random wait before fading in, so a block's dots appear in random order
            fadeDelay: random(REVISIONS.blockRevealMs - REVISIONS.dotFadeMs),
            color: revisionColor(revision),
            alpha: 0, // 0 = hidden, 1 = fully visible
        });
    }

    // each moment's time and circled dots
    const dotsByRev = new Map();
    for (const dot of revisionDots) dotsByRev.set(dot.data.rev, dot);
    revisionMoments = [];
    for (const moment of momentsJson.moments) {
        revisionMoments.push({
            ...moment,
            t: parseUTC(moment.iso),
            dots: moment.revs.map((rev) => dotsByRev.get(rev)).filter((dot) => dot),
            alpha: 0, // eased toward 1 once the reveal line reaches the moment
        });
    }

    const blockCount = Math.floor((revisionsEnd - revisionsStart) / TICK_SECONDS) + 1;
    timeBlocks = [];
    for (let i = 0; i < blockCount; i++) {
        timeBlocks.push({ isShown: false, changedAt: 0 });
    }
}

// Timeline y of a moment (subtract panY to get screen y).
function revisionTimeY(time) {
    return map(time, revisionsStart, revisionsEnd, 0, revisionTimelineScreens * height);
}

// Screen x of a page's column (pages sorted by name, left to right).
function revisionPageX(pageIndex) {
    return map(pageIndex, 0, revisionPageCount - 1, PLOT_LEFT, width - MARGIN);
}

// Pan for the "revisions" step (used by SCENE_PANS in sketch.js): progress 0 puts the start of
// the timeline on the reveal line, progress 1 puts the end there.
function revisionsPan(progress) {
    const timelineHeight = revisionTimelineScreens * height;
    const lineScreenY = height * REVISIONS.revealLinePosition;
    return progress * timelineHeight - lineScreenY;
}

// Scene for the "revisions" step: place the reveal line on the panned timeline.
// Returns a function that draws the reveal line and the current date/time on top of the dots.
function revisionsScene(progress) {
    const timelineHeight = revisionTimelineScreens * height;
    const lineScreenY = height * REVISIONS.revealLinePosition;

    // use the current (eased) pan, so blocks appear as they visibly cross the line
    revisionPanY = panY;
    revealLineY = panY + lineScreenY;

    drawTimeTicks(revisionsStart, revisionsEnd, revisionTimeY, 0);

    return () => {
        drawRevisionMoments();

        stroke(255, 70);
        line(PLOT_LEFT - 10, lineScreenY, width - MARGIN, lineScreenY);

        // the date/time at the reveal line, once it's inside the timeline
        const time = map(revealLineY, 0, timelineHeight, revisionsStart, revisionsEnd);
        if (time < revisionsStart || time > revisionsEnd) return;
        noStroke();
        fill(255);
        textSize(11);
        textAlign(RIGHT, BOTTOM);
        text(formatUTC(time) + " UTC", width - MARGIN, lineScreenY - 4);
    };
}

// Mark which 6-hour blocks are above the reveal line, fade each revision dot in or out, and
// draw the ones on screen. Returns the dot under the mouse, or null.
// Called every frame from draw() in sketch.js. Uses the canvas API directly for speed, since
// there can be ~14,000 dots.
function drawRevisionDots() {
    const now = millis();
    if (scrollState.stepName !== "revisions") revealLineY = -Infinity;

    // a block is shown once its start has scrolled above the reveal line
    for (let i = 0; i < timeBlocks.length; i++) {
        const block = timeBlocks[i];
        const blockStartY = revisionTimeY(revisionsStart + i * TICK_SECONDS);
        const shouldShow = blockStartY < revealLineY;
        if (shouldShow !== block.isShown) {
            block.isShown = shouldShow;
            block.changedAt = now;
        }
    }

    // outside the revisions step, with every dot already faded out: nothing to draw
    if (revealLineY === -Infinity && !anyRevisionVisible) return null;

    // positions are linear in time and page, so work out the spacing once
    const pixelsPerSecond = (revisionTimelineScreens * height) / (revisionsEnd - revisionsStart);
    const columnSpacing = (width - MARGIN - PLOT_LEFT) / (revisionPageCount - 1);
    const fadePerFrame = deltaTime / REVISIONS.dotFadeMs;
    const size = REVISIONS.dotSize;

    const canvas = drawingContext;
    canvas.save(); // restored below so p5's own drawing isn't affected
    let hovered = null;
    anyRevisionVisible = false;
    for (const dot of revisionDots) {
        // fade in once the block is shown and this dot's random delay has passed; otherwise fade out
        const block = timeBlocks[dot.blockIndex];
        const timeSinceChange = now - block.changedAt;
        const shouldBeVisible = block.isShown && timeSinceChange >= dot.fadeDelay;
        if (shouldBeVisible) {
            dot.alpha = Math.min(1, dot.alpha + fadePerFrame);
        } else {
            dot.alpha = Math.max(0, dot.alpha - fadePerFrame);
        }
        if (dot.alpha === 0) continue;
        anyRevisionVisible = true;

        const x = PLOT_LEFT + dot.pageIndex * columnSpacing;
        const y = (dot.data.t - revisionsStart) * pixelsPerSecond - revisionPanY;
        const isOffScreen = y < -size || y > height + size;
        if (isOffScreen) continue;

        canvas.globalAlpha = dot.alpha;
        canvas.fillStyle = dot.color;
        canvas.beginPath();
        canvas.arc(x, y, size / 2, 0, TWO_PI);
        canvas.fill();

        const mouseIsOver = Math.abs(mouseX - x) < size && Math.abs(mouseY - y) < size;
        if (dot.alpha === 1 && mouseIsOver) hovered = dot;
    }
    canvas.restore();
    return hovered;
}

// Pop up each moment the reveal line has reached, and fade out the ones it hasn't (after scrolling
// back up), as callouts (drawCallout in sketch.js). Called every frame by the revisions scene's
// overlay, so moments vanish with the step.
function drawRevisionMoments() {
    let previousBottom = -Infinity; // each box keeps clear of the one above it
    for (const moment of revisionMoments) {
        const isReached = revisionTimeY(moment.t) < revealLineY;
        moment.alpha = lerp(moment.alpha, isReached ? 1 : 0, EASING);
        if (moment.alpha < 0.01) continue;

        // date, text, and where the claim comes from
        const date = moment.source ? formatUTC(moment.t).slice(0, 10) : formatUTC(moment.t) + " UTC";
        const paragraphs = [
            { text: date, grey: 150 },
            { text: moment.text, grey: 240 },
        ];
        if (moment.source) paragraphs.push({ text: "Source: " + moment.source, grey: 150 });

        const rings = moment.dots.map((dot) => ({
            x: revisionPageX(dot.pageIndex),
            y: revisionTimeY(dot.data.t) - panY,
        }));
        const y = revisionTimeY(moment.t) - panY;
        previousBottom = drawCallout(rings, y, paragraphs, moment.alpha, previousBottom + CALLOUT.stackGap);
    }
}
