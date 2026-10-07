// Scrollama setup: keeps `scrollState` (in sketch.js) pointing at the step that has reached
// the middle of the screen, highlights that step's text card and its link in the nav bar, and
// shows the nav bar once the swarm step is reached (nav.js).

const TRIGGER_POSITION = 0.5; // a step becomes active when its top reaches the middle of the screen
const stepElements = document.querySelectorAll("#scrolly .step");

const scroller = scrollama();
scroller.setup({
    step: "#scrolly .step",
    offset: TRIGGER_POSITION,
});

// Make a step the active one: highlight its card and tell the sketch.
function activateStep(stepElement, index) {
    for (const element of stepElements) {
        element.classList.remove("is-active");
    }
    stepElement.classList.add("is-active");
    scrollState.stepName = stepElement.dataset.step;
    scrollState.stepIndex = index;
    highlightNav(scrollState.stepName);
    if (scrollState.stepName === "swarm") showNav();
}

// When a step reaches the trigger line, it becomes active.
scroller.onStepEnter((response) => activateStep(response.element, response.index));

// The first step starts exactly on the trigger line, so scrollama doesn't report entering it
// until the reader scrolls; start on it.
activateStep(stepElements[0], 0);

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

// Scroll (smoothly, unless behavior says otherwise) until the named step's first card's top is just
// past the trigger line, making it active.
function scrollToStep(stepName, behavior = "smooth") {
    const step = document.querySelector(`#scrolly .step[data-step="${stepName}"]`);
    const triggerY = window.innerHeight * TRIGGER_POSITION;
    const top = step.getBoundingClientRect().top + window.scrollY - triggerY + 1;
    window.scrollTo({ top, behavior });
}

// Recalculate scrollama's trigger positions when the window changes size.
window.addEventListener("resize", () => scroller.resize());
