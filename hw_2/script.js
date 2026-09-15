// Security cam viewer: a 3x2 grid of screens (assets/screens/0.png ... 5.png).
// Click a feed to view it full size, then use the arrow buttons (or arrow keys) to cycle through feeds. 
// On the SCARY_AT-th prev/next press, the feed shows scary.png instead of its screen.
const COLS = 3;
const ROWS = 2;
const NUM_SCREENS = COLS * ROWS;
const SCARY_AT = 5;

const MARGIN = 20;
const GAP = 12;
const REC_RED = "#ff3b3b";

let screens = [];
let scary;
let current = -1; // -1 = grid view, otherwise the index of the screen in full view
let navClicks = 0; // number of prev/next presses in full view

// load audio
let staticSound = new Audio("assets/sounds/static.mp3");
staticSound.loop = true;
let scarySound = new Audio("assets/sounds/scary.mp3");

// ensure everything loads before running
function preload() {
    for (let i = 0; i < NUM_SCREENS; i++) {
        screens.push(loadImage("assets/screens/" + i + ".png"));
    }
    scary = loadImage("assets/screens/scary.png");
}

function setup() {
    createCanvas(windowWidth, windowHeight);
    textFont("monospace");
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}

// state dependent view
function draw() {
    background(0);

    let clickable; // boxes that get a hand cursor on hover
    if (current === -1) {
        // Grid view: all six feeds.
        let cells = gridCells();
        for (let i = 0; i < NUM_SCREENS; i++) {
            drawFeed(i, cells[i], screens[i]);
        }
        clickable = cells;
    } else {
        // Full view: one feed filling the screen, plus the prev/next buttons.
        let area = { x: MARGIN, y: MARGIN, w: width - 2 * MARGIN, h: height - 2 * MARGIN };
        drawFeed(current, area, showingScary() ? scary : screens[current]);

        let buttons = fullViewButtons();
        drawButton(buttons.prev, -1);
        drawButton(buttons.next, 1);
        clickable = [buttons.prev, buttons.next];
    }

    // Hand cursor while the mouse is over anything clickable.
    let hovering = clickable.some((box) => isInside(mouseX, mouseY, box));
    cursor(hovering ? HAND : ARROW);
}

// Data structure for the 3x2 grid of pngs: the on-screen rectangle { x, y, w, h } of each
// feed, numbered left to right, top to bottom:
//   0 1 2
//   3 4 5
function gridCells() {
    // Split the canvas (minus the outer margin and the gaps between cells) evenly.
    let cellW = (width - 2 * MARGIN - (COLS - 1) * GAP) / COLS;
    let cellH = (height - 2 * MARGIN - (ROWS - 1) * GAP) / ROWS;

    let cells = [];
    for (let i = 0; i < NUM_SCREENS; i++) {
        let col = i % COLS;             // 0, 1, 2, 0, 1, 2
        let row = Math.floor(i / COLS); // 0, 0, 0, 1, 1, 1
        cells.push({
            x: MARGIN + col * (cellW + GAP),
            y: MARGIN + row * (cellH + GAP),
            w: cellW,
            h: cellH,
        });
    }
    return cells;
}

// True if the point (x, y) is inside the rectangle: right of its left edge, left of its
// right edge, below its top edge, and above its bottom edge.
function isInside(x, y, box) {
    return x >= box.x && x <= box.x + box.w &&
        y >= box.y && y <= box.y + box.h;
}

function mousePressed() {
    if (current === -1) {
        // top level view: find which camera the mouse click corresponds to and open that 
        
        // Browsers block audio until the user interacts, so static starts on the first click.
        playStatic();

        // Check each feed's rectangle; open the one the mouse is inside.
        // cells[i] is where screens[i] is drawn, so i is also the screen to show.
        let cells = gridCells();
        for (let i = 0; i < cells.length; i++) {
            if (isInside(mouseX, mouseY, cells[i])) {
                current = i;
            }
        }
        return;
    }

    let buttons = fullViewButtons();
    if (isInside(mouseX, mouseY, buttons.prev)) step(-1);
    else if (isInside(mouseX, mouseY, buttons.next)) step(1);
}

// iterate through state of clicks
function keyPressed() {
    if (current === -1) {
        playStatic();
        return;
    }
    if (keyCode === LEFT_ARROW) step(-1);
    else if (keyCode === RIGHT_ARROW) step(1);
}

// Move to the previous (dir = -1) or next (dir = 1) feed, wrapping around.
// scary.mp3 plays once when scary.png appears; otherwise the static loop runs.
function step(dir) {
    // any press to prev/next adds to the counter
    navClicks++;
    current = (current + dir + NUM_SCREENS) % NUM_SCREENS;

    if (showingScary()) {
        // start scary sound
        staticSound.pause();
        scarySound.currentTime = 0;
        scarySound.play();
    } else {
        scarySound.pause();
        playStatic();
    }
}

// navClicks only goes up in full view, so this is never true on the grid.
function showingScary() {
    return navClicks === SCARY_AT; // after 5 clicks
}

function playStatic() {
    if (staticSound.paused) staticSound.play();
}

function fullViewButtons() {
    let inset = MARGIN + 12;
    let arrowW = 56;
    let arrowH = 96;
    let y = height / 2 - arrowH / 2;
    return {
        prev: { x: inset, y: y, w: arrowW, h: arrowH },
        next: { x: width - inset - arrowW, y: y, w: arrowW, h: arrowH },
    };
}


// One camera feed: the image letterboxed into `box`, with scanlines and overlay text.
function drawFeed(index, box, img) {

    let fit = Math.min(box.w / img.width, box.h / img.height);
    let imgW = img.width * fit;
    let imgH = img.height * fit;
    let imgX = box.x + (box.w - imgW) / 2;
    let imgY = box.y + (box.h - imgH) / 2;
    image(img, imgX, imgY, imgW, imgH);

    // draw a thin dark line every 3px across the image.
    stroke(0);
    fill(255)
    strokeWeight(1.5);
    for (let lineY = imgY; lineY < imgY + imgH; lineY += 3) {
        line(imgX, lineY, imgX + imgW, lineY);
    }
    let size = constrain(box.h, 10, 18);
    let pad = size * 0.8;
    textSize(size);

    // use YYYY-MM-DD HH:MM:SS format
    let time = year() + "-" + nf(month(), 2) + "-" + nf(day(), 2) + " " +
        nf(hour(), 2) + ":" + nf(minute(), 2) + ":" + nf(second(), 2);
    drawLabel("CAMERA " + nf(index + 1, 2), box.x + pad, box.y + pad, LEFT, TOP);
    drawLabel(time, box.x + pad, box.y + box.h - pad, LEFT, BOTTOM);

    // "REC" top-right, with a solid red dot to its left.
    let recX = box.x + box.w - pad;
    let recY = box.y + pad;
    drawLabel("REC", recX, recY, RIGHT, TOP);
    noStroke();
    fill(REC_RED);
    circle(recX - textWidth("REC") - size * 0.9, recY + size * 0.55, size * 0.6);

}

// Text with a dark backing box so it stays readable over any screenshot.
function drawLabel(str, x, y, alignX, alignY) {
    let w = textWidth(str);
    let h = textSize();
    let boxX = alignX === LEFT ? x : x - w;
    let boxY = alignY === TOP ? y : y - h;
    noStroke();
    fill(0, 170);
    rect(boxX - 4, boxY - 4, w + 8, h + 8);
    fill(235);
    textAlign(alignX, alignY);
    text(str, x, y);
}

// Arrow button; dir = -1 points left, dir = 1 points right.
function drawButton(btn, dir) {
    stroke(180);
    strokeWeight(2);
    fill(0, 150);
    rect(btn.x, btn.y, btn.w, btn.h);

    let cx = btn.x + btn.w / 2;
    let cy = btn.y + btn.h / 2;
    let s = 10;
    noStroke();
    fill(235);
    triangle(cx - dir * s * 0.6, cy - s, cx - dir * s * 0.6, cy + s, cx + dir * s * 0.8, cy);
}
