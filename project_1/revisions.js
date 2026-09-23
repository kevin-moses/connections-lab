// The "revisions" step: every revision to the wiki (data/revision_timeline.json) on one timeline.
// x = page (sorted by name, no labels), y = time. The timeline pans as you scroll. Time is
// split into 6-hour blocks (TICK_SECONDS); when a block crosses the reveal line its dots fade
// in one by one in random order, and they fade out again if you scroll back up past it.
//
// Loaded before sketch.js so SCENES can use revisionsScene. Uses these from sketch.js:
// TICK_SECONDS, PLOT_LEFT, MARGIN, panY, targetPanY, formatUTC, setStepHeight, drawTimeTicks.

const REVISIONS = {
    screensPerDay: 0.5, // timeline length per day, in screen heights (also sets the step's height)
    blockRevealMs: 500, // every dot in a block is fully visible this long after the block is reached
    dotFadeMs: 150, // how long one dot takes to fade in or out
    dotSize: 3,
    revealLinePosition: 0.8, // reveal line (and current date/time), as a fraction of the canvas height
};

const REVISION_COLORS = {
    creation: "#5fb49c",
    edit: "#6c8ebf",
    append: "#f2c14e",
    prune: "#ff3b3b",
    noop: "#666666",
    history_truncated: "#c3a1ff",
};

let revisionDots = [];
let timeBlocks = []; // one per 6 hours: { isShown, changedAt }
let revisionPageCount = 0;
let revisionsStart; // unix seconds, rounded down to a 6-hour boundary
let revisionsEnd;
let revisionTimelineScreens; // timeline length in screen heights

// Timeline y of the reveal line. Set every frame by revisionsScene; -Infinity (the default
// set in draw()) means no block is revealed.
let revealLineY = -Infinity;

// Whether any revision dot was visible or still fading last frame.
let anyRevisionVisible = false;

// Build the revision dots and 6-hour blocks, and size the step to fit the timeline.
// Called once from setup() in sketch.js.
function setupRevisions(json) {
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
    const days = (revisionsEnd - revisionsStart) / (24 * 3600);
    revisionTimelineScreens = days * REVISIONS.screensPerDay;
    setStepHeight("revisions", revisionTimelineScreens);

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
            type: revision.kind,
            pageIndex: pageIndexByName.get(revision.page),
            blockIndex: Math.floor((revision.t - revisionsStart) / TICK_SECONDS),
            // random wait before fading in, so a block's dots appear in random order
            fadeDelay: random(REVISIONS.blockRevealMs - REVISIONS.dotFadeMs),
            color: REVISION_COLORS[revision.kind] || "#ffffff",
            alpha: 0, // 0 = hidden, 1 = fully visible
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

// Scene for the "revisions" step: pan the timeline with the scroll and place the reveal line.
// Returns a function that draws the reveal line and the current date/time on top of the dots.
function revisionsScene(progress) {
    const timelineHeight = revisionTimelineScreens * height;
    const lineScreenY = height * REVISIONS.revealLinePosition;

    // progress 0 puts the start of the timeline on the reveal line, progress 1 puts the end there
    targetPanY = progress * timelineHeight - lineScreenY;

    // use the current (eased) pan, so blocks appear as they visibly cross the line
    revealLineY = panY + lineScreenY;

    drawTimeTicks(revisionsStart, revisionsEnd, revisionTimeY, 0);

    return () => {
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
        const y = (dot.data.t - revisionsStart) * pixelsPerSecond - panY;
        const isOffScreen = y < -size || y > height + size;
        if (isOffScreen) continue;

        canvas.globalAlpha = dot.alpha;
        canvas.fillStyle = dot.color;
        canvas.fillRect(x - size / 2, y - size / 2, size, size);

        const mouseIsOver = Math.abs(mouseX - x) < size && Math.abs(mouseY - y) < size;
        if (dot.alpha === 1 && mouseIsOver) hovered = dot;
    }
    canvas.restore();
    return hovered;
}
