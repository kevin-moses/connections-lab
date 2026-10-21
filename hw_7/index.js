import express from "express";
import { JSONFilePreset } from "lowdb/node";
const app = express();
const port = 3000;

const db = await JSONFilePreset("db.json", { posts: [] });

// route 1 - serve the static page
app.use('/', express.static('public'));
app.use(express.json());

// route 2 - store a new post
app.post("/new-data", async (req, res) => {
    const post = {
        post_id: Date.now(),
        timestamp: new Date().toISOString(),
        author: req.body.author,
        title: req.body.title,
        content: req.body.content,
        tag: req.body.tag,
        likes: 0,
        train_name: req.body.train_name,
        in_train: req.body.in_train,
        station_name: req.body.in_train ? null : req.body.station_name,
        train_bound: req.body.train_bound,
    };
    db.data.posts.push(post);
    await db.write();
    res.json({ message: "Post stored!", post });
})

// route 3 - serve all stored posts
app.get("/data", (req, res) => {
    res.json(db.data.posts);
})

app.listen(port, () => {
   console.log("Server listening on port " + port)
})
