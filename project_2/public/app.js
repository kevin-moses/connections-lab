let socket = io();

const sounds = [
    "fahh",
    "fart",
    "metal",
    "taco bell",
    "vine boom sound",
    "what the dog doin"
];

function playSound(name) {
    new Audio("/assets/" + encodeURIComponent(name) + ".mp3").play();
}

// build one button per sound
const board = document.getElementById("board");
sounds.forEach((name) => {
    let button = document.createElement("button");
    button.textContent = name;
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
