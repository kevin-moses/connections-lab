async function getTrainTimes() {
    let response = await fetch('/trainTimes');
    let data = await response.json();
    console.log(data);
}

document.getElementById('getTrainTimes').addEventListener('click', getTrainTimes);