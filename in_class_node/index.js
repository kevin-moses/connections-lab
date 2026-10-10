 const express = require("express");
 const app = express();
 const port = 3000;


// define a route
app.use('/', express.static('public'));

const prices = {
    "mac_intel" : 5,
    "mac_m5" : 10,
    "mac_m3" : 8
    }


app.get("/prices" , (req,res)=> {
res.json(prices);
})
app.get("/about", (req, res) => {
    res.send("This page is about me. I'm a robot")
})
app.get("/test", (req,res) => {
    console.log(req.rawHeaders);
    console.log(req.rawHeaders[3]);
    res.send(req.rawHeaders[3]);
  })
app.listen(port, () => {
    console.log("Server listening on port " + port)
})