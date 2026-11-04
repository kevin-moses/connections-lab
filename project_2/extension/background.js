importScripts("config.js");

// The service worker can't play audio or hold a socket open, so an offscreen
// document does both. This just makes sure that document exists.
async function ensureOffscreen() {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK", "WORKERS"],
        justification: "Keep a socket connection open and play received sounds"
    });
}

chrome.runtime.onInstalled.addListener(ensureOffscreen);
chrome.runtime.onStartup.addListener(ensureOffscreen);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "ensureOffscreen") {
        ensureOffscreen().then(() => sendResponse({ok: true}));
        return true;
    } else if (message.type === "getServer") {
        chrome.storage.sync.get({server: DEFAULT_SERVER}).then(({server}) => sendResponse(server));
        return true;
    }
})
