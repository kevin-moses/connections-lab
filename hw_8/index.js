import express from "express";
import {Server} from "socket.io";
import {createServer} from "node:http";

const app = express();
const server = createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use("/", express.static("public"));
app.use("/assets", express.static("assets"));

io.on("connect", (socket) => {
    console.log("new connection ID: ", socket.id);
    io.emit("userCount", io.engine.clientsCount);

    // a client pressed a button: forward the sound to everyone else
    socket.on("sendSound", (sound) => {
        console.log(socket.id, "sent", sound);
        socket.broadcast.emit("playSound", {sound: sound, from: socket.id});
    })

    socket.on("disconnect", () => {
        console.log("disconnection ID: ", socket.id);
        io.emit("userCount", io.engine.clientsCount);
    })
})

server.listen(PORT, () => {
    console.log("Running at localhost: ", PORT)
})
