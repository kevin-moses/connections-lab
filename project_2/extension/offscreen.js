let socket = null;
let muted = false;
const playing = new Set();
let state = {connected: false, count: 0, lastReceived: ""};

function publish() {
    chrome.runtime.sendMessage({type: "state", state}).catch(() => {});
}

function playSound(name) {
    // older clients send names without an extension
    const file = /\.\w+$/.test(name) ? name : name + ".mp3";
    const audio = new Audio("assets/" + encodeURIComponent(file));
    playing.add(audio);
    audio.addEventListener("ended", () => playing.delete(audio));
    audio.play();
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
        if (!muted) playSound(data.sound);
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
    } else if (message.type === "setMuted") {
        muted = message.muted;
        // cut off anything already playing
        if (muted) playing.forEach((audio) => audio.pause());
        playing.clear();
    }
})

// offscreen documents can't use chrome.storage, so the service worker reads settings for us
chrome.runtime.sendMessage({type: "getSettings"}).then((settings) => {
    muted = settings.muted;
    connect(settings.server);
});
