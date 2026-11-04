let socket = io();

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

function playSound(name) {
    // older clients send names without an extension
    const file = /\.\w+$/.test(name) ? name : name + ".mp3";
    new Audio("/assets/" + encodeURIComponent(file)).play();
}

// build one button per sound
const board = document.getElementById("board");
sounds.forEach((name) => {
    let button = document.createElement("button");
    button.textContent = name.replace(/\.\w+$/, "");
    button.addEventListener("click", () => {
        socket.emit("sendSound", name);
        document.getElementById("status").textContent = "Sent: " + name;
    });
    board.appendChild(button);
})

// another user sent us a sound
socket.on("playSound", (data) => {
    document.getElementById("status").textContent = "Received: " + data.sound;
    playSound(data.sound);
})

socket.on("userCount", (count) => {
    document.getElementById("count").textContent = count;
})
