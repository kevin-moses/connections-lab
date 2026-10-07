// The navigation bar: a link to each section of the story, and one to the references at the end, with
// the one being read highlighted.
// It stays hidden until the reader has reached the swarm step, or straight away if the page was
// reloaded (they've been here before). Once shown it stays. While it's shown, the pinned canvas sits
// below it rather than under it (see --nav-height in style.css and fitCanvas in sketch.js).
//
// Loaded after sketch.js, before scroll.js. Uses fitCanvas from sketch.js and scrollToStep from
// scroll.js; scroll.js calls showNav and highlightNav.

const nav = document.getElementById("site-nav");
const navLinks = nav.querySelectorAll("a");
const references = document.getElementById("references");

// The bar's height in px, or 0 while it's hidden.
function navHeight() {
    return nav.offsetHeight;
}

// Show the bar, and fit the canvas into the space below it. (Before p5's setup there's no canvas
// yet; setup sizes it below the bar itself.)
function showNav() {
    if (document.body.classList.contains("has-nav")) return;
    document.body.classList.add("has-nav");
    if (isSketchSetUp) fitCanvas(); // sketch.js
    const current = nav.querySelector("[aria-current]");
    if (current) centreNavLink(current);
}

// Where the bar is too narrow for every link and scrolls sideways, bring this one to its middle.
function centreNavLink(link) {
    nav.scrollTo({ left: link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2, behavior: "smooth" });
}

// Whether the references (not a step, so scroll.js doesn't track them) cross the middle of the screen.
let isReadingReferences = false;

// Mark the link to the section with this step name as the current one, or the references link while
// they're being read.
function highlightNav(stepName) {
    for (const link of navLinks) {
        const isCurrent = isReadingReferences ? link.hash === "#references" : link.dataset.step === stepName;
        if (!isCurrent) {
            link.removeAttribute("aria-current");
        } else if (!link.hasAttribute("aria-current")) {
            link.setAttribute("aria-current", "step");
            centreNavLink(link);
        }
    }
}

// the middle line of the screen, the same one that makes a step active (see scroll.js)
new IntersectionObserver(([entry]) => {
    isReadingReferences = entry.isIntersecting;
    highlightNav(scrollState.stepName);
}, { rootMargin: "-50% 0px -50% 0px" }).observe(references);

// A step's link jumps straight to it, rather than scrolling through everything in between. (The
// references link is an ordinary link to #references.)
for (const link of nav.querySelectorAll("a[data-step]")) {
    link.addEventListener("click", (event) => {
        event.preventDefault();
        scrollToStep(link.dataset.step, "instant"); // scroll.js
    });
}

const navigation = performance.getEntriesByType("navigation")[0];
if (navigation && navigation.type === "reload") showNav();
