// show station input only when not on the train
document.getElementById('in_train').addEventListener('change', (event) => {
    document.getElementById('station_name').hidden = event.target.checked;
});

async function newPost(p) {
    p.preventDefault();
    let post = {
        author: document.getElementById('author').value,
        title: document.getElementById('title').value,
        content: document.getElementById('content').value,
        tag: document.getElementById('tag').value,
        train_name: document.getElementById('train_name').value,
        train_bound: document.getElementById('train_bound').value,
        in_train: document.getElementById('in_train').checked,
        station_name: document.getElementById('station_name').value,
    };
    let response = await fetch('/new-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(post),
    });
    let data = await response.json();
    console.log(data);
    getPosts();
}

async function getPosts() {
    let response = await fetch('/data');
    let data = await response.json();
    let postsDiv = document.getElementById('posts');
    postsDiv.innerHTML = '';
    data.reverse().forEach((post) => {
        let where = post.in_train ? 'on the train' : 'at ' + post.station_name;
        let div = document.createElement('div');
        div.className = 'post';
        div.innerHTML = `
            <h3>${post.title}</h3>
            <p>${post.content}</p>
            <small>${post.tag} · ${post.train_name} train, ${post.train_bound}, ${where} · by ${post.author} · ${new Date(post.timestamp).toLocaleString()} · ${post.likes} likes</small>
        `;
        postsDiv.appendChild(div);
    });
}

document.getElementById('post-form').addEventListener('submit', newPost);
document.getElementById('load-posts').addEventListener('click', getPosts);
