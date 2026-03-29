let clickState = {
    duration: 10,
    isRunning: false,
    startTime: 0,
    remainingSeconds: 0,
    leftClicks: 0,
    rightClicks: 0,
    timerId: null,
    intervalId: null,
    leftPerSecond: [],
    rightPerSecond: [],
    currentSecond: 0
};

function setDuration(seconds) {
    clickState.duration = seconds;
    document.querySelectorAll('.duration-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.duration) === seconds);
    });
    updateClickDisplay();
}

function startClickSpeedTest() {
    resetClickSpeedTest(false);
    clickState.isRunning = true;
    clickState.startTime = Date.now();
    clickState.remainingSeconds = clickState.duration;
    clickState.leftClicks = 0;
    clickState.rightClicks = 0;
    clickState.leftPerSecond = new Array(clickState.duration).fill(0);
    clickState.rightPerSecond = new Array(clickState.duration).fill(0);
    clickState.currentSecond = 0;

    document.getElementById('click-area').classList.add('active');
    document.getElementById('click-message').textContent = '快速点击！';
    document.getElementById('click-message').style.display = 'none';
    document.getElementById('start-clickspeed-btn').classList.add('hidden');
    document.getElementById('reset-clickspeed-btn').classList.remove('hidden');

    document.getElementById('chart-container').classList.remove('hidden');
    document.getElementById('clickspeed-result').classList.add('hidden');
    
    drawChart();

    updateClickDisplay();

    clickState.intervalId = setInterval(() => {
        clickState.remainingSeconds--;
        if (clickState.remainingSeconds <= 0) {
            clickState.remainingSeconds = 0;
            updateClickDisplay();
            finishClickSpeedTest();
            return;
        }
        clickState.currentSecond = clickState.duration - clickState.remainingSeconds;
        updateClickDisplay();
        drawChart();
    }, 1000);

    clickState.timerId = setInterval(() => {
        if (clickState.currentSecond < clickState.duration) {
            clickState.leftPerSecond[clickState.currentSecond] = 0;
            clickState.rightPerSecond[clickState.currentSecond] = 0;
        }
    }, 1000);
}

function handleClick(event) {
    event.preventDefault();

    const clickArea = document.getElementById('click-area');
    const rect = clickArea.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    const isLeft = event.button === 0;
    const isRight = event.button === 2;
    
    if (isLeft || isRight) {
        createClickDot(x, y, isLeft ? 'left' : 'right');
    }
    
    if (!clickState.isRunning) return;

    const sec = clickState.currentSecond;
    if (sec < clickState.duration) {
        if (isLeft) {
            clickState.leftClicks++;
            clickState.leftPerSecond[sec]++;
        } else if (isRight) {
            clickState.rightClicks++;
            clickState.rightPerSecond[sec]++;
        }
    }
    updateClickDisplay();
    drawChart();
}

function createClickDot(x, y, type) {
    const dot = document.createElement('div');
    dot.className = 'click-dot ' + type;
    dot.style.left = x + 'px';
    dot.style.top = y + 'px';
    document.getElementById('click-area').appendChild(dot);
    
    setTimeout(() => {
        dot.remove();
    }, 1000);
}

function updateClickDisplay() {
    document.getElementById('remaining-time').textContent = clickState.remainingSeconds > 0 ? clickState.remainingSeconds : '--';
    document.getElementById('left-clicks').textContent = clickState.leftClicks;
    document.getElementById('right-clicks').textContent = clickState.rightClicks;
    const total = clickState.leftClicks + clickState.rightClicks;
    const elapsed = clickState.duration - clickState.remainingSeconds;
    const cps = elapsed > 0 ? (total / elapsed).toFixed(1) : '0.0';
    document.getElementById('total-cps').textContent = cps;
}

function finishClickSpeedTest() {
    clickState.isRunning = false;
    clearInterval(clickState.intervalId);
    clearInterval(clickState.timerId);

    const total = clickState.leftClicks + clickState.rightClicks;
    const duration = clickState.duration;
    const leftCps = duration > 0 ? (clickState.leftClicks / duration).toFixed(2) : '0.00';
    const rightCps = duration > 0 ? (clickState.rightClicks / duration).toFixed(2) : '0.00';
    const totalCps = duration > 0 ? (total / duration).toFixed(2) : '0.00';

    document.getElementById('click-area').classList.remove('active');
    document.getElementById('click-message').style.display = 'block';
    document.getElementById('click-message').textContent = '测试完成！';

    document.getElementById('final-total-clicks').textContent = total;
    document.getElementById('final-left-cps').textContent = leftCps;
    document.getElementById('final-right-cps').textContent = rightCps;
    document.getElementById('final-total-cps').textContent = totalCps;

    document.getElementById('clickspeed-rank').textContent = getClickspeedRank(parseFloat(totalCps));

    drawChart();

    document.getElementById('clickspeed-result').classList.remove('hidden');
}

function getClickspeedRank(cps) {
    if (cps >= 10) return '🔥 手速超神！电竞选手级别！';
    if (cps >= 8) return '🚀 手速极快！超越99%的人！';
    if (cps >= 6) return '⚡ 手速很快！反应敏捷！';
    if (cps >= 4) return '✨ 手速不错！超过平均水平！';
    if (cps >= 2) return '👍 手速正常！';
    return '🐢 手速稍慢，多练习会更快的！';
}

function drawChart() {
    const canvas = document.getElementById('click-chart');
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 5; i++) {
        const y = padding + (chartHeight * i / 5);
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
    }

    for (let i = 0; i <= clickState.duration; i++) {
        const x = padding + (chartWidth * i / clickState.duration);
        ctx.beginPath();
        ctx.moveTo(x, padding);
        ctx.lineTo(x, height - padding);
        ctx.stroke();
    }

    const maxClicks = Math.max(
        ...clickState.leftPerSecond,
        ...clickState.rightPerSecond,
        1
    );

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '11px Arial';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
        const y = padding + (chartHeight * i / 5);
        const val = Math.round(maxClicks * (1 - i / 5));
        ctx.fillText(val, padding - 5, y + 4);
    }

    ctx.textAlign = 'center';
    for (let i = 0; i <= clickState.duration; i++) {
        const x = padding + (chartWidth * i / clickState.duration);
        ctx.fillText(i + 's', x, height - padding + 15);
    }

    const displaySeconds = clickState.isRunning 
        ? Math.min(clickState.currentSecond + 1, clickState.duration) 
        : clickState.duration;

    function drawLine(data, color) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        for (let i = 0; i < displaySeconds; i++) {
            const x = padding + (chartWidth * i / clickState.duration);
            const y = padding + chartHeight - (chartHeight * data[i] / maxClicks);
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        ctx.fillStyle = color;
        for (let i = 0; i < displaySeconds; i++) {
            const x = padding + (chartWidth * i / clickState.duration);
            const y = padding + chartHeight - (chartHeight * data[i] / maxClicks);
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawLine(clickState.leftPerSecond, '#ff4444');
    drawLine(clickState.rightPerSecond, '#44ff44');
}

function resetClickSpeedTest(showBtn) {
    if (showBtn === undefined) showBtn = true;
    clearInterval(clickState.intervalId);
    clearInterval(clickState.timerId);

    clickState.isRunning = false;
    clickState.leftClicks = 0;
    clickState.rightClicks = 0;
    clickState.leftPerSecond = [];
    clickState.rightPerSecond = [];
    clickState.currentSecond = 0;
    clickState.remainingSeconds = clickState.duration;

    document.getElementById('click-area').classList.remove('active');
    document.getElementById('click-message').style.display = 'block';
    document.getElementById('click-message').textContent = '点击「开始测试」按钮';
    document.getElementById('remaining-time').textContent = '--';
    document.getElementById('left-clicks').textContent = '0';
    document.getElementById('right-clicks').textContent = '0';
    document.getElementById('total-cps').textContent = '0';

    document.getElementById('chart-container').classList.add('hidden');
    document.getElementById('clickspeed-result').classList.add('hidden');

    if (showBtn) {
        document.getElementById('start-clickspeed-btn').classList.remove('hidden');
        document.getElementById('reset-clickspeed-btn').classList.add('hidden');
    }
}

document.addEventListener('contextmenu', function(e) {
    if (clickState.isRunning) {
        e.preventDefault();
    }
});

document.getElementById('click-area')?.addEventListener('contextmenu', function(e) {
    if (clickState.isRunning) {
        e.preventDefault();
    }
});
