const TOTAL_ROUNDS = 5;
const reactionState = {
    currentRound: 0,
    times: [],
    isWaiting: false,
    isGreen: false,
    startTime: 0,
    timerId: null
};

function setBoxState(stateName, message) {
    const box = document.getElementById('reaction-box');
    const boxMessage = document.getElementById('box-message');
    box.className = 'reaction-box ' + stateName;
    boxMessage.textContent = message;
}

function startTest() {
    resetTest(false);
    reactionState.currentRound = 0;
    reactionState.times = [];
    updateStats();
    startRound();
    document.getElementById('start-btn').classList.add('hidden');
    document.getElementById('reset-btn').classList.remove('hidden');
}

function startRound() {
    reactionState.currentRound++;
    if (reactionState.currentRound > TOTAL_ROUNDS) {
        finishTest();
        return;
    }
    updateStats();
    setBoxState('waiting', '等待变绿...看到绿色立即点击！');
    reactionState.isWaiting = true;
    reactionState.isGreen = false;

    const delay = 3000 + Math.random() * 7000;
    reactionState.timerId = setTimeout(() => {
        setBoxState('green', '点击！');
        reactionState.isGreen = true;
        reactionState.startTime = performance.now();
    }, delay);
}

function handleBoxClick() {
    if (!reactionState.isWaiting) return;

    if (!reactionState.isGreen) {
        clearTimeout(reactionState.timerId);
        setBoxState('too-soon', '太早了！点击「重置」重新开始');
        reactionState.isWaiting = false;
        return;
    }

    const reactionTime = performance.now() - reactionState.startTime;
    reactionState.times.push(reactionTime);
    updateStats();
    showRoundResult(reactionState.currentRound, reactionTime);

    setTimeout(() => {
        startRound();
    }, 500);
}

function showRoundResult(round, time) {
    const roundResults = document.getElementById('round-results');
    const resultsList = document.getElementById('results-list');
    if (roundResults.classList.contains('hidden')) {
        roundResults.classList.remove('hidden');
    }
    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `<span class="result-round">第 ${round} 轮</span><span class="result-time">${time.toFixed(2)} ms</span>`;
    resultsList.appendChild(item);
}

function updateStats() {
    const currentRoundEl = document.getElementById('current-round');
    const avgTimeEl = document.getElementById('avg-time');
    currentRoundEl.textContent = reactionState.currentRound;
    if (reactionState.times.length > 0) {
        const avg = reactionState.times.reduce((a, b) => a + b, 0) / reactionState.times.length;
        avgTimeEl.textContent = avg.toFixed(2);
    } else {
        avgTimeEl.textContent = '--';
    }
}

function finishTest() {
    reactionState.isWaiting = false;
    reactionState.isGreen = false;
    setBoxState('done', '测试完成！');
    const avg = reactionState.times.reduce((a, b) => a + b, 0) / reactionState.times.length;
    document.getElementById('final-avg').textContent = avg.toFixed(2);
    document.getElementById('final-rank').textContent = getRank(avg);
    document.getElementById('final-result').classList.remove('hidden');
}

function getRank(avg) {
    if (avg < 200) return '🔥 超神反应！职业电竞选手水平！';
    if (avg < 250) return '🚀 极快反应！超越99%的人！';
    if (avg < 300) return '⚡ 非常快！反应敏捷！';
    if (avg < 350) return '✨ 良好反应！超过平均水平！';
    if (avg < 400) return '👍 正常反应！';
    if (avg < 500) return '😐 稍慢，多练习会更快的！';
    return '🐢 反应较慢，继续加油！';
}

function resetTest(fullReset) {
    if (fullReset === undefined) fullReset = true;
    clearTimeout(reactionState.timerId);
    reactionState.isWaiting = false;
    reactionState.isGreen = false;
    reactionState.currentRound = 0;
    reactionState.times = [];
    updateStats();
    setBoxState('waiting', '点击「开始」重新测试');
    if (fullReset) {
        document.getElementById('round-results').classList.add('hidden');
        document.getElementById('results-list').innerHTML = '';
        document.getElementById('final-result').classList.add('hidden');
        document.getElementById('start-btn').classList.remove('hidden');
        document.getElementById('reset-btn').classList.add('hidden');
    }
}

resetTest();
