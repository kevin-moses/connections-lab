const sounds = [
    "alien cat.mp3",
    "bingqiling.mp3",
    "fahh.mp3",
    "fart.mp3",
    "huh.wav",
    "low meow.mp3",
    "meow laugh.mp3",
    "meow.mp3",
    "metal.mp3",
    "mi bombo.mp3",
    "muehehehe.mp3",
    "roaches.mp3",
    "samsung.mp3",
    "taco bell.mp3",
    "tortles.mp3",
    "vine boom sound.mp3",
    "what the dog doin.mp3"
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
    button.textContent = name.replace(/\.\w+$/, "");
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

// mute incoming sounds (your own presses are never played back to you anyway)
const muteInput = document.getElementById("mute");
chrome.storage.sync.get({muted: false}).then(({muted}) => {
    muteInput.checked = muted;
});
muteInput.addEventListener("change", () => {
    chrome.storage.sync.set({muted: muteInput.checked});
    chrome.runtime.sendMessage({type: "setMuted", muted: muteInput.checked});
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
