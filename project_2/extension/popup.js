const sounds = [
    "fahh",
    "fart",
    "metal",
    "taco bell",
    "vine boom sound",
    "what the dog doin"
];

const status = document.getElementById("status");

function render(state) {
    document.getElementById("connection").textContent = state.connected ? "Connected" : "Disconnected";
    document.getElementById("count").textContent = state.count;
    if (state.lastReceived) status.textContent = "Received: " + state.lastReceived;
}

// build one button per sound
const board = document.getElementById("board");
sounds.forEach((name) => {
    let button = document.createElement("button");
    button.textContent = name;
    button.addEventListener("click", () => {
        chrome.runtime.sendMessage({type: "sendSound", sound: name});
        status.textContent = "Sent: " + name;
    });
    board.appendChild(button);
})

// let the user point the extension at a deployed server
const serverInput = document.getElementById("server");
chrome.storage.sync.get({server: DEFAULT_SERVER}).then(({server}) => {
    serverInput.value = server;
});
serverInput.addEventListener("change", () => {
    chrome.storage.sync.set({server: serverInput.value});
    chrome.runtime.sendMessage({type: "setServer", url: serverInput.value});
})

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "state") render(message.state);
})

// make sure the offscreen document is running, then ask it for current state
chrome.runtime.sendMessage({type: "ensureOffscreen"}).then(() => {
    chrome.runtime.sendMessage({type: "getState"}).then((state) => {
        if (state) render(state);
    });
})
