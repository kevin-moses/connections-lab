# Breathe

A desktop page shows a breathing orb and waveform. A phone, paired by QR code, streams its accelerometer over Socket.IO. The person sits upright with the phone flat against their chest, screen out, top pointing up. Each breath tilts the chest slightly, and that tilt swings gravity between the phone's y and z axes.

## Run

```sh
npm install
npm run cert   # self-signed HTTPS cert for your LAN IP
npm run dev
```

Open `https://localhost:3000` on the computer and scan the QR code with the phone. The phone browser will warn about the self-signed cert. Accept it to continue.

Phones only expose motion sensors over HTTPS. Without `certs/`, the server runs plain HTTP and the pairing card shows a warning. A tunnel or a deploy also works. Set `PUBLIC_URL` to its origin so the QR code points there.

## Test without a phone

Open `/phone/?sim&room=CODE` in another browser window, optionally with `&bpm=15&tilt=0.8`. It streams a synthetic breathing signal through the same socket path. Keep that window visible, because browsers throttle timers in background tabs.

`npm run check` runs the detector against synthetic signals: 12 and 20 bpm, noise only, and inverted.

## Deploy on Railway

Railway terminates HTTPS and forwards plain HTTP to `$PORT`, so no cert is needed there. `certs/` is gitignored and never ships. The server trusts the proxy's `X-Forwarded-Proto`, so the QR code points at the public `https://` domain on its own.

1. Push this folder to GitHub.
2. In Railway, create a project from the `connections-lab` repo.
3. In the service's Settings, set **Root Directory** to `final`.
4. In Settings, under Networking, click **Generate Domain**.
5. Open the domain on the computer and scan the QR code with the phone.

Keep the service at one replica. Rooms live in server memory, so a desktop and a phone on different replicas would never meet.

## Files

- `index.js` serves the pages, makes QR codes at `/pair/:code`, and pairs one desktop with one phone per 4-letter room.
- `public/breath.js` is the pure detector. It turns `[t, x, y, z]` samples into a value in -1..1 and a phase.
- `public/params.js` is the table of tunable parameters. The Tune panel is generated from it and saved to localStorage.
- `public/desktop.js` draws the orb and the graph.
- `public/phone/` is the installable PWA that reads the sensor.
