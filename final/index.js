import express from "express";
import { Server } from "socket.io";
import { createServer as createHttp } from "node:http";
import { createServer as createHttps } from "node:https";
import { createServer as createNet } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import QRCode from "qrcode";

const PORT = Number(process.env.PORT) || 3000;
const CERT = { key: "certs/key.pem", cert: "certs/cert.pem" };
const useHttps = existsSync(CERT.key) && existsSync(CERT.cert);

const app = express();
app.set("trust proxy", true);
const server = useHttps
    ? createHttps({ key: readFileSync(CERT.key), cert: readFileSync(CERT.cert) }, app)
    : createHttp(app);
const io = new Server(server);

app.use(express.static("public"));

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE = new RegExp(`^[${ALPHABET}]{4}$`);
const MAX_BATCH = 200;

const parseCode = (raw) => {
    const code = String(raw ?? "").trim().toUpperCase();
    return CODE.test(code) ? code : null;
};

const parseSamples = (raw) =>
    Array.isArray(raw) && raw.length > 0 && raw.length <= MAX_BATCH &&
    raw.every((s) => Array.isArray(s) && s.length === 4 && s.every(Number.isFinite))
        ? raw
        : null;

function lanAddress() {
    for (const list of Object.values(networkInterfaces())) {
        for (const iface of list ?? []) {
            if (iface.family === "IPv4" && !iface.internal) return iface.address;
        }
    }
    return null;
}

// The QR code must point somewhere the phone can reach, so localhost becomes the LAN address.
function publicOrigin(req) {
    if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
    const url = new URL(`${req.protocol}://${req.get("host")}`);
    const lan = lanAddress();
    if (lan && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) url.hostname = lan;
    return url.origin;
}

app.get("/pair/:code", async (req, res) => {
    const code = parseCode(req.params.code);
    if (!code) return res.status(400).json({ error: "bad code" });
    const url = `${publicOrigin(req)}/phone/?room=${code}`;
    const svg = await QRCode.toString(url, { type: "svg", margin: 1 });
    res.json({ url, svg, secure: url.startsWith("https:") });
});

// code -> { desktop: socketId | null, phone: socketId | null }
const rooms = new Map();

function newCode() {
    let code;
    do {
        code = Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
    } while (rooms.has(code));
    return code;
}

const otherRole = { desktop: "phone", phone: "desktop" };

function seat(socket, role, code) {
    const room = rooms.get(code) ?? { desktop: null, phone: null };
    const previous = room[role];
    if (previous && previous !== socket.id) {
        const old = io.sockets.sockets.get(previous);
        old?.emit("replaced");
        old?.leave(code);
        if (old) old.data = {};
    }
    room[role] = socket.id;
    rooms.set(code, room);
    socket.data = { role, code };
    socket.join(code);
    const peer = room[otherRole[role]];
    if (peer) io.to(peer).emit("peer", { connected: true });
    return Boolean(peer);
}

io.on("connection", (socket) => {
    // A desktop asks for its previous code back after a reload, and gets a fresh one if it is taken.
    socket.on("desktop:hello", (requested, ack) => {
        const wanted = parseCode(requested);
        const code = wanted && !rooms.get(wanted)?.desktop ? wanted : newCode();
        const peerConnected = seat(socket, "desktop", code);
        ack?.({ code, peerConnected });
    });

    socket.on("phone:join", (requested, ack) => {
        const code = parseCode(requested);
        if (!code || !rooms.has(code)) return ack?.({ ok: false, error: "No screen is showing that code." });
        const peerConnected = seat(socket, "phone", code);
        ack?.({ ok: true, code, peerConnected });
    });

    socket.on("samples", (raw) => {
        const samples = parseSamples(raw);
        if (socket.data.role !== "phone" || !samples) return;
        socket.to(socket.data.code).volatile.emit("samples", samples);
    });

    socket.on("disconnect", () => {
        const { role, code } = socket.data;
        const room = rooms.get(code);
        if (!room || room[role] !== socket.id) return;
        room[role] = null;
        const peer = room[otherRole[role]];
        if (peer) io.to(peer).emit("peer", { connected: false });
        else rooms.delete(code);
    });
});

// One port for both schemes. A TLS handshake starts with byte 0x16. Anything else is plain HTTP
// and gets redirected, so typing http://localhost:3000 still works.
const TLS_HANDSHAKE = 0x16;
const redirect = createHttp((req, res) => {
    res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
    res.end();
});
const front = useHttps
    ? createNet((socket) => {
        socket.once("data", (chunk) => {
            socket.pause();
            socket.unshift(chunk);
            (chunk[0] === TLS_HANDSHAKE ? server : redirect).emit("connection", socket);
            process.nextTick(() => socket.resume());
        });
    })
    : server;

front.listen(PORT, () => {
    const hosted = process.env.RAILWAY_PUBLIC_DOMAIN;
    if (hosted) return console.log(`listening on ${PORT}, public at https://${hosted}`);
    const scheme = useHttps ? "https" : "http";
    const lan = lanAddress();
    console.log(`desktop: ${scheme}://localhost:${PORT}`);
    if (lan) console.log(`phone:   ${scheme}://${lan}:${PORT}/phone/`);
    if (!useHttps) console.log("phones need HTTPS for motion sensors. Run `npm run cert` and restart, or set PUBLIC_URL to a tunnel.");
});
