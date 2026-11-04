let socket = null;
let state = {connected: false, count: 0, lastReceived: ""};

function publish() {
    chrome.runtime.sendMessage({type: "state", state}).catch(() => {});
}

function playSound(name) {
    new Audio("assets/" + encodeURIComponent(name) + ".mp3").play();
}

function connect(url) {
    if (socket) socket.disconnect();
    state = {connected: false, count: 0, lastReceived: ""};
    socket = io(url, {transports: ["websocket"]});

    socket.on("connect", () => {
        state.connected = true;
        publish();
    })

    socket.on("disconnect", () => {
        state.connected = false;
        publish();
    })

    // another user sent us a sound
    socket.on("playSound", (data) => {
        state.lastReceived = data.sound;
        publish();
        playSound(data.sound);
    })

    socket.on("userCount", (count) => {
        state.count = count;
        publish();
    })
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "getState") {
        sendResponse(state);
    } else if (message.type === "sendSound") {
        if (socket) socket.emit("sendSound", message.sound);
    } else if (message.type === "setServer") {
        connect(message.url);
    }
})

// offscreen documents can't use chrome.storage, so the service worker reads it for us
chrome.runtime.sendMessage({type: "getServer"}).then((server) => connect(server || DEFAULT_SERVER));
