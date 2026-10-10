async function getTrainCounts() {
    let response = await fetch('/trainCounts');
    let data = await response.json();
    console.log(data);
}

async function getSingleTrain(e) {
    let response = await fetch(`/trainCounts/${e.target.value}`);
    let data = await response.json();
    console.log(data);
}

document.getElementById('train-select').addEventListener('change', getSingleTrain);

document.getElementById('getTrainCounts').addEventListener('click', getTrainCounts);