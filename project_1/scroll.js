// Scrollama setup: keeps `scrollState` (in sketch.js) pointing at the step that has reached
// the middle of the screen, and highlights that step's text card.

const TRIGGER_POSITION = 0.5; // a step becomes active when its top reaches the middle of the screen
const stepElements = document.querySelectorAll("#scrolly .step");

const scroller = scrollama();
scroller.setup({
    step: "#scrolly .step",
    offset: TRIGGER_POSITION,
});

// When a step reaches the trigger line: highlight its card and tell the sketch.
scroller.onStepEnter((response) => {
    for (const element of stepElements) {
        element.classList.remove("is-active");
    }
    response.element.classList.add("is-active");
    scrollState.stepName = response.element.dataset.step;
    scrollState.stepIndex = response.index;
});

// How far the reader has scrolled through the active step: 0 when its top is at the trigger
// line, 1 when its bottom is. Called every frame by draw() in sketch.js. Measured from the page
// layout rather than taken from scrollama's progress events, which can arrive late or out of
// order at step edges.
function activeStepProgress() {
    const box = stepElements[scrollState.stepIndex].getBoundingClientRect();
    const triggerY = window.innerHeight * TRIGGER_POSITION;
    const progress = (triggerY - box.top) / box.height;
    return Math.min(1, Math.max(0, progress));
}

// Recalculate scrollama's trigger positions when the window changes size.
window.addEventListener("resize", () => scroller.resize());
