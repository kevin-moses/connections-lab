import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import express from "express";
const app = express();
const port = 3000;


// define a route
app.use('/', express.static('public'));
const base = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs";
const links = {
    J: `${base}-jz`,
    Z: `${base}-jz`,
    A: `${base}-ace`,
    C: `${base}-ace`,
    E: `${base}-ace`,
    Sr: `${base}-ace`,
    B: `${base}-bdfm`,
    D: `${base}-bdfm`,
    F: `${base}-bdfm`,
    M: `${base}-bdfm`,
    Sf: `${base}-bdfm`,
    G: `${base}-g`,
    N: `${base}-nqrw`,
    Q: `${base}-nqrw`,
    R: `${base}-nqrw`,
    W: `${base}-nqrw`,
    L: `${base}-l`,
    1: base,
    2: base,
    3: base,
    4: base,
    5: base,
    6: base,
    7: base,
    S: base,
    SIR: `${base}-si`,
};


app.get("/trainCounts" , async (req,res)=> {
    const response = await fetch(base);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    // took this from docs https://github.com/MobilityData/gtfs-realtime-bindings/blob/master/nodejs/README.md
    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
        new Uint8Array(buffer)
      );
    const trains = feed.entity.filter((d) => d.vehicle);
    res.json(trains);
})



app.get("/trainCounts/:train", async(req,res) => {
    const train = req.params.train;
    const url = links[train];
    if (!url) {
        return res.status(404).json({ error: `Unknown train: ${train}` });
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
        new Uint8Array(buffer)
    );
    const count = feed.entity.filter((d) => d.vehicle?.trip?.routeId === train).length;
    res.json({ train, count });
})

app.listen(port, () => {
   console.log("Server listening on port " + port)
})