// The "swarm" step: every agent and wiki page as one network (data/swarm_graph.json), drawn with
// force-graph (https://github.com/vasturiano/force-graph) on its own canvas, which lies over the
// p5 canvas while the step is active.
//
// Squares are pages, grouped by task family and sized by how many agents have posted on them;
// dots are agents (labels). A line joins each agent to every page it posted on; dashed curves join
// pages that link to other pages, and red curves join agents that address other agents by
// name. Positions come from the data and never move. The graph grows as posts[] are replayed:
// press play, change the speed, or drag the scrubber.
// Hover a node for its latest post, or a line for what was written along it. Click a node to list
// its revisions and neighbours; click one of those to move to it.
//
// Shown whenever the "swarm" step is active (scrollState), with no scene in sketch.js. Uses these
// from sketch.js: formatUTC, setStepHeight, and p5's deltaTime.

const SWARM = {
    screens: 3, // step height in screen heights
    speeds: [1, 3, 12], // playback speed in wiki hours per second; the first is the default
    recentSeconds: 30 * 60, // an agent–page line stays bright this long after a post on it
    fitMargin: 40, // px kept around the graph when it's fitted to the screen
    // pages of the five biggest families (by agents), in order; every other family is grey
    // (red is kept for agent → agent curves)
    familyColors: ["#6c8ebf", "#f2c14e", "#f78154", "#c3a1ff", "#5fb49c"],
    otherFamilyColor: "#aaaaaa",
    agentColor: "#dddddd",
    // line colours (see swarmLinkColor); agent → agent curves are red
    lineColors: {
        dimmed: "rgba(255, 255, 255, 0.02)", // outside the highlight
        edge: "rgba(255, 255, 255, 0.14)",
        edgeCross: "rgba(255, 255, 255, 0.05)", // page outside the agent's home family
        edgeRecent: "rgba(255, 255, 255, 0.75)",
        edgeFocused: "rgba(255, 255, 255, 0.85)",
        link: "rgba(220, 220, 220, 0.35)",
        linkFocused: "rgba(220, 220, 220, 0.8)",
        address: "rgba(255, 59, 59, 0.8)",
        addressFocused: "rgba(255, 59, 59, 1)",
    },
    maxNeighboursListed: 60,
    maxRevisionsListed: 40, // in the inspect panel, newest first
    maxTooltipPosts: 3, // in a line's hover tooltip, newest first
};

// nodes, links and lookups (built once in setupSwarm)
let swarmGraph; // the ForceGraph instance
let swarmMeta;
let swarmFamilies = [];
let swarmPosts = []; // sorted by time
let swarmNodes = []; // pages and agents
let swarmLinks = []; // agent–page "edge"s, page→page "link"s, agent→agent "address"es
let swarmNodeById = new Map(); // "page:<id>" / "agent:<id>" → node
let swarmEdgeByKey = new Map(); // "<agent>|<page>" → its agent–page edge
let swarmPostByRev = new Map(); // revision id → its post

// playback
let swarmNow; // wiki time shown, unix seconds
let swarmNextPost = 0; // index of the first post not replayed yet
let swarmPlaying = false;
let swarmSpeedIndex = 0;

// what the reader is looking at
let swarmSelected = null; // clicked node
let swarmHovered = null; // node under the mouse (or under a node button in the panel)
let isSwarmHoverFromPanel = false; // whether swarmHovered came from a node button
let swarmHoveredLink = null; // line under the mouse
let swarmFocus = null; // { nodes, links } to highlight, or null; set every frame by updateSwarmFocus

// whether the graph is showing (the swarm step is active), as of the last updateSwarm
let isSwarmShown = false;
let swarmWasPlaying = true; // whether it was playing when the reader last left (so it auto-plays at first)
let swarmInspectKey = null; // what the inspect panel last showed (see updateSwarmPanel); null redraws it

// the panel's elements (see setupSwarmPanel), and the time it last showed (null: redraw it)
let swarmUI = {};
let swarmPanelNow = null;
let swarmHourlyMax = 1; // the busiest hour's posts, for the posts-per-hour chart
let swarmHourlySize = { width: 0, height: 0 }; // the chart's size in CSS px (see measureSwarmHourly)

// Build the graph from the data and hook up the panel. Called once from setup() in sketch.js.
function setupSwarm(json) {
    swarmMeta = json.meta;
    setStepHeight("swarm", SWARM.screens);

    const familyColor = pickSwarmFamilyColors(json.families);
    swarmFamilies = json.families;
    buildSwarmNodes(json, familyColor);
    buildSwarmLinks(json);
    indexSwarmPosts(json);

    swarmNow = swarmMeta.play_start;
    resetSwarmReplay();
    replaySwarmPosts();

    swarmGraph = createSwarmGraph(document.getElementById("swarm-graph"));
    swarmGraph.pauseAnimation(); // until the step is reached
    setupSwarmPanel();
}

// family id → colour: the biggest families (by agents) get SWARM.familyColors in order, the rest grey
function pickSwarmFamilyColors(families) {
    const bySize = [...families].sort((a, b) => b.n_labels - a.n_labels);
    const familyColor = new Map();
    bySize.forEach((family, i) => {
        const hasOwnColour = i < SWARM.familyColors.length && family.id !== "unclassified";
        familyColor.set(family.id, hasOwnColour ? SWARM.familyColors[i] : SWARM.otherFamilyColor);
    });
    return familyColor;
}

// One node per agent and per page. Positions are final, so they're pinned (see addSwarmNode).
// Agents go first so pages, drawn later, sit on top and catch the mouse over their squares.
function buildSwarmNodes(json, familyColor) {
    swarmNodes = [];
    swarmNodeById = new Map();
    for (const label of json.labels) {
        addSwarmNode({
            id: "agent:" + label.id,
            kind: "agent",
            name: label.id,
            families: label.families,
            x: label.x,
            y: label.y,
            t: label.t,
            tPost: label.t_post,
        });
    }
    for (const page of json.pages) {
        addSwarmNode({
            id: "page:" + page.id,
            kind: "page",
            name: page.id,
            family: page.family,
            color: familyColor.get(page.family) || SWARM.otherFamilyColor,
            x: page.x,
            y: page.y,
            t: page.t,
            tPost: page.t_post,
        });
    }
}

// One link per agent–page pair, and one per distinct page→page / agent→agent pair. The data lists
// every mention of a pair (in time order); the link appears with the first and keeps them all.
function buildSwarmLinks(json) {
    swarmLinks = [];
    swarmEdgeByKey = new Map();
    for (const edge of json.edges) {
        const link = addSwarmLink("edge", "agent:" + edge.label, "page:" + edge.page, edge.t);
        link.cross = edge.cross; // the page is outside the agent's home family
        link.posts = []; // the agent's posts on the page (see indexSwarmPosts)
        swarmEdgeByKey.set(swarmEdgeKey(edge.label, edge.page), link);
    }

    const linkByPair = new Map();
    const addMention = (kind, prefix, mention) => {
        if (mention.src === mention.dst) return;
        const key = `${kind}|${mention.src}|${mention.dst}`;
        if (!linkByPair.has(key)) {
            const link = addSwarmLink(kind, prefix + mention.src, prefix + mention.dst, mention.t);
            link.mentions = []; // { t, rev, page or label, and its post (see indexSwarmPosts) }
            linkByPair.set(key, link);
        }
        linkByPair.get(key).mentions.push({ ...mention });
    };
    for (const pageLink of json.links) addMention("link", "page:", pageLink);
    for (const address of json.addresses) addMention("address", "agent:", address);
}

// Posts in time order, by node, by agent–page edge and by revision; and each mention's post.
function indexSwarmPosts(json) {
    swarmPosts = [...json.posts].sort((a, b) => a.t - b.t);
    swarmPostByRev = new Map();
    for (const post of swarmPosts) {
        swarmPage(post.page).posts.push(post);
        swarmAgent(post.label).posts.push(post);
        swarmEdgeOf(post).posts.push(post);
        swarmPostByRev.set(post.rev, post);
    }
    for (const link of swarmLinks) {
        for (const mention of link.mentions || []) mention.post = swarmPostByRev.get(mention.rev);
    }
}

const LINK_DASH = [2, 2]; // page → page curves (one array, not a new one per link per frame)

// The force-graph instance: every node pinned (no simulation), redrawn every frame, and drawn,
// highlighted and hovered by the functions below.
function createSwarmGraph(container) {
    return new ForceGraph(container)
        .width(window.innerWidth)
        .height(window.innerHeight)
        .graphData({ nodes: swarmNodes, links: swarmLinks })
        .nodeId("id")
        // no simulation: every node stays where the data puts it
        .d3Force("charge", null)
        .d3Force("link", null)
        .d3Force("center", null)
        .cooldownTicks(0)
        .autoPauseRedraw(false) // the graph changes over time, so redraw every frame
        .enableNodeDrag(false)
        // plain scrolling keeps scrolling the page; ctrl/cmd + scroll (and trackpad pinch) zooms
        .enableZoomInteraction((event) => event.ctrlKey || event.metaKey)
        // what's shown so far
        .nodeVisibility((node) => node.t <= swarmNow)
        .linkVisibility(isSwarmLinkVisible)
        // how it's drawn
        .nodeCanvasObjectMode(() => "replace")
        .nodeCanvasObject(drawSwarmNode)
        .nodePointerAreaPaint(paintSwarmNodeArea)
        .nodeLabel(swarmTooltip)
        .linkLabel(swarmLinkTooltip)
        .linkColor(swarmLinkColor)
        .linkWidth((link) => (link.kind === "edge" ? 0.4 + 0.4 * Math.sqrt(link.weight) : 1))
        .linkCurvature((link) => (link.kind === "edge" ? 0 : 0.25))
        .linkLineDash((link) => (link.kind === "link" ? LINK_DASH : null))
        .linkDirectionalArrowLength((link) => (link.kind === "edge" ? 0 : 3))
        .linkDirectionalArrowRelPos(1)
        .onRenderFramePre((ctx, globalScale) => {
            updateSwarmFocus(); // once per frame, before any node or link asks
            drawSwarmFamilies(ctx, globalScale);
        })
        // interaction
        .onNodeHover((node) => {
            swarmHovered = node;
            isSwarmHoverFromPanel = false;
        })
        .onLinkHover((link) => { swarmHoveredLink = link; })
        .onNodeClick((node) => selectSwarmNode(node))
        .onBackgroundClick(() => selectSwarmNode(null));
}

function addSwarmNode(node) {
    node.fx = node.x;
    node.fy = node.y;
    node.posts = []; // this node's posts, sorted by time
    node.links = []; // links touching this node
    swarmNodes.push(node);
    swarmNodeById.set(node.id, node);
}

function addSwarmLink(kind, sourceId, targetId, t) {
    const link = { kind, source: sourceId, target: targetId, t };
    swarmNodeById.get(sourceId).links.push(link);
    swarmNodeById.get(targetId).links.push(link);
    swarmLinks.push(link);
    return link;
}

// Nodes and agent–page edges by their ids in the data.
function swarmPage(pageId) {
    return swarmNodeById.get("page:" + pageId);
}
function swarmAgent(labelId) {
    return swarmNodeById.get("agent:" + labelId);
}
function swarmEdgeKey(labelId, pageId) {
    return labelId + "|" + pageId;
}
function swarmEdgeOf(post) {
    return swarmEdgeByKey.get(swarmEdgeKey(post.label, post.page));
}

// A link's two nodes, [source, target]. (force-graph swaps the ids for node objects.)
function swarmLinkEnds(link) {
    const toNode = (end) => (typeof end === "object" ? end : swarmNodeById.get(end));
    return [toNode(link.source), toNode(link.target)];
}

// The node at the other end of a link from `node`.
function otherSwarmEnd(link, node) {
    const [source, target] = swarmLinkEnds(link);
    return source === node ? target : source;
}

// Agent–page lines appear with their first post; the other links when they're first mentioned.
function isSwarmLinkVisible(link) {
    return link.kind === "edge" ? link.weight > 0 : link.t <= swarmNow;
}

// A node's visible links, and the distinct nodes at their other ends.
function visibleSwarmLinks(node) {
    return node.links.filter(isSwarmLinkVisible);
}
function visibleSwarmNeighbours(node) {
    return [...new Set(visibleSwarmLinks(node).map((link) => otherSwarmEnd(link, node)))];
}

// "page · family" or "agent · family, family".
function swarmNodeKind(node) {
    return node.kind === "page" ? `page · ${node.family}` : `agent · ${node.families.join(", ")}`;
}

// playback -------------------------------------------------------------------

// Forget every replayed post: no agent–page pair has posts yet, and no page has agents.
function resetSwarmReplay() {
    for (const link of swarmLinks) {
        if (link.kind !== "edge") continue;
        link.weight = 0; // posts replayed so far
        link.lastPost = -Infinity; // time of the latest one
    }
    for (const node of swarmNodes) if (node.kind === "page") node.swarm = 0; // agents that have posted here
    swarmNextPost = 0;
}

// Replay every post up to swarmNow: count each agent–page pair's posts, and each page's agents.
function replaySwarmPosts() {
    while (swarmNextPost < swarmPosts.length && swarmPosts[swarmNextPost].t <= swarmNow) {
        const post = swarmPosts[swarmNextPost];
        const edge = swarmEdgeOf(post);
        if (edge.weight === 0) swarmPage(post.page).swarm += 1;
        edge.weight += 1;
        edge.lastPost = post.t;
        swarmNextPost += 1;
    }
}

// Jump to wiki time `t`. Going back starts the replay over (3,825 posts, so it's instant).
function setSwarmTime(t) {
    t = constrain(t, swarmMeta.play_start, swarmMeta.t_end);
    if (t < swarmNow) resetSwarmReplay();
    swarmNow = t;
    replaySwarmPosts();
}

function setSwarmPlaying(isPlaying) {
    // pressing play at the end starts again from the beginning
    if (isPlaying && swarmNow >= swarmMeta.t_end) setSwarmTime(swarmMeta.play_start);
    swarmPlaying = isPlaying;
    swarmUI.play.textContent = isPlaying ? "❚❚ pause" : "▶ play";
}

// Show or hide the graph as the swarm step is entered or left, advance the playback, and keep the
// panel up to date. Called every frame from draw() in sketch.js.
function updateSwarm() {
    const shouldShow = scrollState.stepName === "swarm";
    if (shouldShow !== isSwarmShown) {
        isSwarmShown = shouldShow;
        swarmUI.graph.classList.toggle("is-shown", isSwarmShown);
        if (isSwarmShown) {
            swarmGraph.resumeAnimation();
            swarmPanelNow = null; // redraw the panel
            measureSwarmHourly();
            fitSwarmGraph();
            // carry on as it was when the reader left (it plays the first time)
            setSwarmPlaying(swarmWasPlaying);
        } else {
            swarmWasPlaying = swarmPlaying;
            setSwarmPlaying(false);
            swarmGraph.pauseAnimation();
        }
    }
    if (!isSwarmShown) return;

    if (swarmPlaying) {
        const wikiSeconds = SWARM.speeds[swarmSpeedIndex] * 3600 * (deltaTime / 1000);
        setSwarmTime(swarmNow + wikiSeconds);
        if (swarmNow >= swarmMeta.t_end) setSwarmPlaying(false);
    }
    updateSwarmPanel();
}

// highlighting ---------------------------------------------------------------

// What to highlight (swarmFocus): the hovered node (on the graph or a node button) and its
// neighbours, else the hovered line and its two nodes, else the selected node and its neighbours.
// Called once per frame, before the graph is drawn.
function updateSwarmFocus() {
    // (a selected node the scrubber has gone back before is hidden, so it doesn't count)
    const selected = swarmSelected && swarmSelected.t <= swarmNow ? swarmSelected : null;
    if (swarmHovered) {
        swarmFocus = nodeFocus(swarmHovered);
    } else if (swarmHoveredLink) {
        swarmFocus = {
            nodes: new Set(swarmLinkEnds(swarmHoveredLink)),
            links: new Set([swarmHoveredLink]),
        };
    } else if (selected) {
        swarmFocus = nodeFocus(selected);
    } else {
        swarmFocus = null;
    }
}

// A node, its visible links, and the nodes at their other ends.
function nodeFocus(node) {
    return {
        nodes: new Set([node, ...visibleSwarmNeighbours(node)]),
        links: new Set(visibleSwarmLinks(node)),
    };
}

// Select a node (or clear the selection with null) and bring it to the middle of the graph area.
function selectSwarmNode(node) {
    swarmSelected = node;
    swarmInspectKey = null; // redraw the inspect panel
    if (node) centreSwarmOn(node.x, node.y);
}

// drawing --------------------------------------------------------------------

function swarmPageSize(node) {
    return 3 + 1.6 * Math.sqrt(node.swarm);
}

// Pages are squares in their family's colour, agents are dots; hollow until their first post.
// Agents that worked on several families get a ring. Anything outside the highlight is faded.
function drawSwarmNode(node, ctx, globalScale) {
    ctx.globalAlpha = swarmFocus && !swarmFocus.nodes.has(node) ? 0.12 : 1;
    const isHollow = swarmNow < node.tPost;
    const lineWidth = 1 / globalScale;

    if (node.kind === "page") {
        const size = swarmPageSize(node);
        if (isHollow) {
            ctx.strokeStyle = node.color;
            ctx.lineWidth = lineWidth;
            ctx.strokeRect(node.x - size / 2, node.y - size / 2, size, size);
        } else {
            ctx.fillStyle = node.color;
            ctx.fillRect(node.x - size / 2, node.y - size / 2, size, size);
        }
    } else {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 1.6, 0, 2 * Math.PI);
        if (isHollow) {
            ctx.strokeStyle = SWARM.agentColor;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        } else {
            ctx.fillStyle = SWARM.agentColor;
            ctx.fill();
        }
        if (node.families.length > 1) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, 3, 0, 2 * Math.PI);
            ctx.strokeStyle = SWARM.agentColor;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        }
    }

    // the selected node gets a white ring
    if (node === swarmSelected) {
        const radius = (node.kind === "page" ? swarmPageSize(node) : 3) + 3;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

// The area that catches the mouse: the node's shape, but never smaller than 8px (pages) or 6px
// (agents) on screen.
function paintSwarmNodeArea(node, color, ctx, globalScale) {
    const size = node.kind === "page"
        ? Math.max(swarmPageSize(node), 8 / globalScale)
        : Math.max(5, 6 / globalScale);
    ctx.fillStyle = color;
    ctx.fillRect(node.x - size / 2, node.y - size / 2, size, size);
}

// Agent–page lines are faint, bright just after a post, and fainter still outside the agent's home
// family. Highlighted links are bright; the rest nearly vanish.
function swarmLinkColor(link) {
    const colors = SWARM.lineColors;
    const isFocused = swarmFocus && swarmFocus.links.has(link);
    if (swarmFocus && !isFocused) return colors.dimmed;
    if (link.kind === "address") return isFocused ? colors.addressFocused : colors.address;
    if (link.kind === "link") return isFocused ? colors.linkFocused : colors.link;
    if (isFocused) return colors.edgeFocused;
    if (swarmNow - link.lastPost < SWARM.recentSeconds) return colors.edgeRecent;
    return link.cross ? colors.edgeCross : colors.edge;
}

// Family areas: a faint circle and the family's name, once the family's first page appears.
function drawSwarmFamilies(ctx, globalScale) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.font = `${10 / globalScale}px monospace`;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.fillStyle = "rgba(200, 200, 200, 0.55)";
    ctx.lineWidth = 1 / globalScale;
    for (const family of swarmFamilies) {
        if (family.t > swarmNow) continue;
        ctx.beginPath();
        ctx.arc(family.x, family.y, family.r, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.fillText(family.id, family.x, family.y - family.r - 3 / globalScale);
    }
    ctx.restore();
}


const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

// `text`, HTML-escaped, with every mention of `name` in bold.
function escapeWithBoldName(text, name) {
    const escapedName = escapeHtml(name);
    return escapeHtml(text).split(escapedName).join(`<b>${escapedName}</b>`);
}

// "1 post", "3 posts"
function countOf(count, word) {
    return `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;
}

// A node's posts (or a link's mentions) up to swarmNow.
function soFar(items) {
    return items.filter((item) => item.t <= swarmNow);
}

// "12 revisions so far by 5 agents" for a page, "12 revisions so far" for an agent.
function swarmRevisionSummary(node) {
    const agents = node.kind === "page" ? ` by ${countOf(node.swarm, "agent")}` : "";
    return `${countOf(soFar(node.posts).length, "revision")} so far${agents}`;
}

// Hover tooltip for a node (HTML): the node, what it is, its revisions so far, and its latest one.
function swarmTooltip(node) {
    const name = escapeHtml(node.name);
    const kind = escapeHtml(swarmNodeKind(node));
    const post = soFar(node.posts).at(-1);
    const latest = post ? `${formatUTC(post.t)} UTC<br>${escapeHtml(post.text)}` : "no posts yet";
    return `<b>${name}</b><br><span class="muted">${kind}<br>${swarmRevisionSummary(node)}</span>` +
        `<br><br>${latest}`;
}

// Hover tooltip for a line (HTML): what was written along it so far, newest first. For an
// agent–page line, the agent's posts on that page; for an agent → agent curve, the posts where one
// agent addressed the other by name (in bold); for a page → page curve, the posts that linked them.
function swarmLinkTooltip(link) {
    const [source, target] = swarmLinkEnds(link);
    const nameInText = target.name.split("/").pop(); // pages are linked as [[Name]], without "dse/"
    const kinds = {
        // each post; the verb; what's counted; and what to add after each post's time
        edge: { items: link.posts, verb: "on", unit: "post", detail: () => "" },
        address: { items: link.mentions, verb: "addressed", unit: "time", detail: (m) => ` · on ${m.page}` },
        link: { items: link.mentions, verb: "links to", unit: "time", detail: (m) => ` · by ${m.label}` },
    };
    const { items, verb, unit, detail } = kinds[link.kind];
    const shown = soFar(items);

    let html = `<b>${escapeHtml(source.name)}</b> ${verb} <b>${escapeHtml(target.name)}</b>` +
        `<br><span class="muted">${countOf(shown.length, unit)} so far</span>`;
    for (const item of shown.reverse().slice(0, SWARM.maxTooltipPosts)) {
        const text = link.kind === "edge"
            ? escapeHtml(item.text)
            : escapeWithBoldName(item.post.text, nameInText);
        html += `<br><br>${formatUTC(item.t)} UTC${escapeHtml(detail(item))}<br>${text}`;
    }
    return html;
}

// camera ---------------------------------------------------------------------

// The part of the screen the graph should fill: left of the panel (see spaceLeftOfPinnedCards).
function swarmGraphArea() {
    return { width: spaceLeftOfPinnedCards("swarm"), height: window.innerHeight };
}

// Zoom and pan so the whole canvas (meta.canvas) fits the graph area.
function fitSwarmGraph() {
    const area = swarmGraphArea();
    const canvas = swarmMeta.canvas;
    const zoomToFitWidth = (area.width - 2 * SWARM.fitMargin) / canvas.width;
    const zoomToFitHeight = (area.height - 2 * SWARM.fitMargin) / canvas.height;
    const zoom = Math.min(zoomToFitWidth, zoomToFitHeight);
    // the canvas centre should land in the middle of the graph area, not of the whole screen
    const centreX = canvas.width / 2 + (window.innerWidth - area.width) / (2 * zoom);
    swarmGraph.zoom(zoom);
    swarmGraph.centerAt(centreX, canvas.height / 2);
}

// Pan so graph point (x, y) sits in the middle of the graph area.
function centreSwarmOn(x, y) {
    const area = swarmGraphArea();
    const offset = (window.innerWidth - area.width) / (2 * swarmGraph.zoom());
    swarmGraph.centerAt(x + offset, y, 600);
}

// Keep the graph the size of the window. Called from windowResized() in sketch.js.
function resizeSwarm() {
    swarmGraph.width(window.innerWidth).height(window.innerHeight);
    measureSwarmHourly();
    swarmPanelNow = null; // redraw the chart at its new size
    if (isSwarmShown) fitSwarmGraph();
}

// panel ----------------------------------------------------------------------

function setupSwarmPanel() {
    swarmUI = {
        graph: document.getElementById("swarm-graph"),
        play: document.getElementById("swarm-play"),
        time: document.getElementById("swarm-time"),
        scrubber: document.getElementById("swarm-scrubber"),
        counts: document.getElementById("swarm-counts"),
        hourly: document.getElementById("swarm-hourly"),
        inspect: document.getElementById("swarm-inspect"),
    };
    swarmHourlyMax = Math.max(...swarmMeta.hourly.counts);

    swarmUI.play.addEventListener("click", () => setSwarmPlaying(!swarmPlaying));

    const speed = document.getElementById("swarm-speed");
    SWARM.speeds.forEach((hours, i) => speed.add(new Option(`${hours} h/s`, i)));
    speed.addEventListener("change", () => { swarmSpeedIndex = Number(speed.value); });

    // dragging the scrubber pauses the playback
    const scrubber = swarmUI.scrubber;
    scrubber.min = swarmMeta.play_start;
    scrubber.max = swarmMeta.t_end;
    scrubber.step = 60;
    scrubber.addEventListener("input", () => {
        setSwarmPlaying(false);
        // the range moves in whole minutes from its start, so its last step can fall just short of
        // t_end (and the last post); snap it to the end
        const value = Number(scrubber.value);
        setSwarmTime(value > swarmMeta.t_end - Number(scrubber.step) ? swarmMeta.t_end : value);
    });

    // escape clears the selection
    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && isSwarmShown) selectSwarmNode(null);
    });

    // the legend, in the graph's own colours and settings
    const legend = document.querySelector(".graph-panel .legend");
    legend.style.setProperty("--key-page", SWARM.familyColors[0]);
    legend.style.setProperty("--key-agent", SWARM.agentColor);
    legend.style.setProperty("--key-edge", SWARM.lineColors.edgeRecent);
    legend.style.setProperty("--key-link", SWARM.lineColors.linkFocused);
    legend.style.setProperty("--key-address", SWARM.lineColors.addressFocused);
    document.getElementById("swarm-legend-families").textContent = SWARM.familyColors.length;
    document.getElementById("swarm-legend-recent").textContent = SWARM.recentSeconds / 60;

    setSwarmPlaying(false);
}

// Time, counts, scrubber, posts-per-hour chart (only when the time has moved), and the inspect panel.
function updateSwarmPanel() {
    if (swarmNow !== swarmPanelNow) {
        swarmPanelNow = swarmNow;
        swarmUI.time.textContent = formatUTC(swarmNow) + " UTC";
        swarmUI.scrubber.value = swarmNow;
        swarmUI.counts.textContent = `${countOf(swarmNextPost, "post")} so far`;
        drawSwarmHourly();
    }

    // the inspect panel follows the playback, redrawn only when the selected node's revisions or
    // links so far change (or the selection does)
    const node = swarmSelected && swarmSelected.t <= swarmNow ? swarmSelected : null;
    const inspectKey = node
        ? `${node.id}|${soFar(node.posts).length}|${visibleSwarmLinks(node).length}`
        : "nothing selected";
    if (inspectKey !== swarmInspectKey) {
        swarmInspectKey = inspectKey;
        renderSwarmInspect(node);
    }
}

// The posts-per-hour chart's size, read only when it can change (the step is shown, the window
// resizes) rather than every frame.
function measureSwarmHourly() {
    swarmHourlySize = { width: swarmUI.hourly.clientWidth, height: swarmUI.hourly.clientHeight };
}

// Posts per hour (meta.hourly) over the scrubber's range; the replayed part is brighter, and a
// white line marks now.
function drawSwarmHourly() {
    const canvas = swarmUI.hourly;
    const pixelRatio = window.devicePixelRatio || 1;
    const { width, height } = swarmHourlySize;
    if (canvas.width !== Math.round(width * pixelRatio)) {
        canvas.width = Math.round(width * pixelRatio);
        canvas.height = Math.round(height * pixelRatio);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const start = swarmMeta.play_start;
    const end = swarmMeta.t_end;
    const xOf = (t) => map(t, start, end, 0, width);
    const { t0, counts } = swarmMeta.hourly;
    counts.forEach((count, i) => {
        const hourStart = t0 + i * 3600;
        const x0 = Math.max(0, xOf(hourStart));
        const x1 = Math.min(width, xOf(hourStart + 3600));
        if (x1 <= x0) return;
        const barHeight = (count / swarmHourlyMax) * height;
        ctx.fillStyle = hourStart <= swarmNow ? "#aaaaaa" : "#444444";
        ctx.fillRect(x0, height - barHeight, Math.max(1, x1 - x0 - 0.5), barHeight);
    });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(xOf(swarmNow) - 0.5, 0, 1, height);
}

// The selected node: what it is, its revisions so far (newest first; for a page, each with the agent
// who wrote it, for an agent, the page it's on), and its neighbours. Node buttons move there when
// clicked and highlight the node when hovered.
function renderSwarmInspect(node) {
    const panel = swarmUI.inspect;
    // the node buttons are about to be replaced, so the one under the mouse won't see it leave
    if (isSwarmHoverFromPanel) {
        swarmHovered = null;
        isSwarmHoverFromPanel = false;
    }
    panel.replaceChildren();
    if (!node) {
        const hint = "Click a page or agent to see its revisions; click a name to move there.";
        panel.append(swarmElement("div", "muted", hint));
        return;
    }

    panel.append(swarmElement("div", "muted", swarmNodeKind(node)));
    panel.append(swarmElement("div", "inspect-name", node.name));

    // revisions
    const posts = soFar(node.posts).reverse();
    panel.append(swarmElement("div", "inspect-heading", `${swarmRevisionSummary(node)}:`));
    const revisions = swarmElement("div", "revisions", "");
    for (const post of posts.slice(0, SWARM.maxRevisionsListed)) {
        const other = node.kind === "page" ? swarmAgent(post.label) : swarmPage(post.page);
        const row = swarmElement("div", "revision", "");
        row.append(swarmElement("span", "muted", formatUTC(post.t).slice(5) + " "), swarmNodeButton(other));
        row.append(swarmElement("div", "", post.text));
        revisions.append(row);
    }
    if (posts.length > SWARM.maxRevisionsListed) {
        const earlier = posts.length - SWARM.maxRevisionsListed;
        revisions.append(swarmElement("div", "muted", `+ ${earlier} earlier`));
    }
    panel.append(revisions);

    // neighbours: pages first, then agents, each alphabetically
    const neighbours = visibleSwarmNeighbours(node);
    neighbours.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "page" ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    panel.append(swarmElement("div", "inspect-heading", `connected to ${neighbours.length}:`));
    const list = swarmElement("div", "neighbours", "");
    for (const neighbour of neighbours.slice(0, SWARM.maxNeighboursListed)) {
        list.append(swarmNodeButton(neighbour));
    }
    if (neighbours.length > SWARM.maxNeighboursListed) {
        list.append(swarmElement("span", "muted", `+ ${neighbours.length - SWARM.maxNeighboursListed} more`));
    }
    panel.append(list);
}

// A button naming a node: click to select it, hover to highlight it on the graph.
function swarmNodeButton(node) {
    const symbol = node.kind === "page" ? "■" : "●";
    const button = swarmElement("button", "", `${symbol} ${node.name}`);
    button.addEventListener("click", () => selectSwarmNode(node));
    button.addEventListener("mouseenter", () => {
        swarmHovered = node;
        isSwarmHoverFromPanel = true;
    });
    button.addEventListener("mouseleave", () => {
        swarmHovered = null;
        isSwarmHoverFromPanel = false;
    });
    return button;
}

function swarmElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    return element;
}
