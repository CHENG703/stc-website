/**
 * 登录 / 注册页背景音乐（循环播放）
 *
 * 目标：让用户「不用点任何东西」就能听到音乐。
 *
 * 浏览器的自动播放策略决定了：**带声音的自动播放无法被网页强行绕过**
 * （Chrome/Safari/Firefox 都要求「用户手势」或用户手动把本站加入声音白名单）。
 * 唯一 100% 被允许的是「静音自动播放」。所以这里用三板斧：
 *
 * 1. 先尝试**带声音**自动播放。若浏览器此前已给过本站授权（用户点过页面、
 *    或手动在站点设置里允许了声音），这里就直接成功，零交互出声。
 * 2. 失败则立刻退回**静音自动播放**（这一步浏览器一定放行）——播放器已经在跑、
 *    音频已经缓冲完；同时挂一次性交互监听，用户第一次**点击 / 触摸 / 敲键盘**
 *    时同步取消静音并淡入。由于音频已就绪，出声是**瞬间**的，没有二次等待。
 * 3. 连静音自动播放都被拒（如 iOS 低电量模式）时，才退化为「点击播放」。
 *
 * 另外：
 * - 左下角悬浮按钮可随时静音 / 恢复，选择记在 localStorage，注册↔登录 保持一致，
 *   且被用户手动静音过之后不再自动播放。
 * - 注册 → 登录 跳转时用 sessionStorage 记住播放进度，续播而不是从头开始。
 * - 切到后台标签页暂停，回到页面自动续播。
 *
 * 依赖：同源音频 /music/login-bgm.mp3（CSP media-src 'self' 已放行）。
 */
(function () {
    'use strict';

    var SRC = '/music/login-bgm.mp3';
    var TARGET_VOLUME = 0.35;   // 背景音量，别太吵
    var FADE_MS = 1400;         // 淡入 / 淡出时长
    var MUTE_KEY = 'stc_login_bgm_muted';
    var POS_KEY = 'stc_login_bgm_position';
    var HINT_DELAY = 1600;      // 多久后给可见提示
    var HINT_LIFE = 7000;       // 提示停留时长
    var CLICK_GRACE = 600;      // 同一次点击里刚开过声音，就别再当作「暂停」处理

    var audio = null;
    var btn = null;
    var hintEl = null;
    var muted = false;          // 用户偏好：手动静音过
    var pendingUnmute = false;  // 已在静音自动播放中，等一次交互取消静音
    var gestureArmed = false;
    var fadeTimer = null;
    var hintTimer = null;
    var lastPosSave = 0;
    var wasPlayingBeforeHide = false;
    var justUnmutedAt = 0;

    var GESTURE_EVENTS = ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click'];

    // ---------- 本地偏好 ----------
    function readPref(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function writePref(key, value) {
        try { localStorage.setItem(key, value); } catch (e) {}
    }

    function readNumber(key) {
        try { return parseFloat(sessionStorage.getItem(key)) || 0; } catch (e) { return 0; }
    }

    function writeNumber(key, value) {
        try { sessionStorage.setItem(key, String(value)); } catch (e) {}
    }

    // ---------- 音量渐变 ----------
    function fadeTo(target) {
        if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
        var from = audio.volume;
        var start = Date.now();
        fadeTimer = setInterval(function () {
            var k = Math.min(1, (Date.now() - start) / FADE_MS);
            try { audio.volume = Math.max(0, Math.min(1, from + (target - from) * k)); } catch (e) {}
            if (k >= 1) { clearInterval(fadeTimer); fadeTimer = null; }
        }, 40);
    }

    // ---------- 悬浮按钮 ----------
    function injectStyle() {
        if (document.getElementById('login-bgm-style')) return;
        var style = document.createElement('style');
        style.id = 'login-bgm-style';
        style.textContent = [
            '#login-bgm-toggle{position:fixed;left:16px;bottom:16px;z-index:9998;width:44px;height:44px;',
            'padding:0;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:rgba(15,17,24,.72);',
            '-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);color:#e6e8f0;font-size:18px;line-height:1;',
            'display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:.8;',
            'transition:transform .2s ease,opacity .2s ease,border-color .2s ease;',
            '-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;}',
            '#login-bgm-toggle:hover{opacity:1;transform:scale(1.06);border-color:rgba(255,255,255,.35);}',
            '#login-bgm-toggle:active{transform:scale(.96);}',
            '#login-bgm-toggle:focus-visible{outline:2px solid #667eea;outline-offset:2px;}',
            '#login-bgm-toggle.is-playing::after{content:"";position:absolute;inset:-4px;border-radius:50%;',
            'border:2px solid rgba(102,126,234,.55);animation:loginBgmPulse 2.2s ease-out infinite;pointer-events:none;}',
            '@keyframes loginBgmPulse{0%{transform:scale(.9);opacity:.75;}100%{transform:scale(1.4);opacity:0;}}',
            /* 静音待命状态：已自动播放但还没出声，用呼吸光环提醒「动一下就有声音」 */
            '#login-bgm-toggle.is-waiting{border-color:rgba(102,126,234,.75);}',
            '#login-bgm-toggle.is-waiting::after{content:"";position:absolute;inset:-3px;border-radius:50%;',
            'border:2px solid rgba(102,126,234,.7);animation:loginBgmBreath 1.6s ease-in-out infinite;pointer-events:none;}',
            '@keyframes loginBgmBreath{0%,100%{transform:scale(1);opacity:.35;}50%{transform:scale(1.12);opacity:1;}}',
            '#login-bgm-hint{position:fixed;left:68px;bottom:26px;z-index:9998;padding:6px 12px;border-radius:999px;',
            'background:rgba(15,17,24,.82);border:1px solid rgba(255,255,255,.18);color:#e6e8f0;font-size:12px;',
            'white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .4s ease;}',
            '#login-bgm-hint.show{opacity:1;}',
            '@media (prefers-reduced-motion: reduce){#login-bgm-toggle{transition:none;}',
            '#login-bgm-toggle.is-playing::after{animation:none;opacity:.5;}',
            '#login-bgm-toggle.is-waiting::after{animation:none;opacity:.8;}}',
            '@media (max-width:480px){#login-bgm-toggle{width:38px;height:38px;font-size:16px;left:12px;bottom:12px;}',
            '#login-bgm-hint{left:58px;bottom:20px;font-size:11px;}}'
        ].join('');
        document.head.appendChild(style);
    }

    function createButton() {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'login-bgm-toggle';
        btn.setAttribute('aria-label', '背景音乐开关');
        document.body.appendChild(btn);

        hintEl = document.createElement('span');
        hintEl.id = 'login-bgm-hint';
        document.body.appendChild(hintEl);

        btn.addEventListener('click', function () {
            // 这一次点击刚刚被用来「取消静音」，不要再当成暂停
            if (Date.now() - justUnmutedAt < CLICK_GRACE) return;
            hideHint();
            if (pendingUnmute) { unmute(); return; }
            if (audio.paused || audio.ended) {
                muted = false;
                writePref(MUTE_KEY, '0');
                playWithSound();
            } else {
                muted = true;
                writePref(MUTE_KEY, '1');
                fadeTo(0);
                setTimeout(function () { if (muted) audio.pause(); }, 220);
                updateButton();
            }
        });
    }

    function updateButton() {
        if (!btn) return;
        var playing = !audio.paused && !audio.ended && !pendingUnmute;
        btn.classList.toggle('is-playing', playing);
        btn.classList.toggle('is-waiting', pendingUnmute);
        btn.textContent = playing ? '🔊' : '🔇';
        if (pendingUnmute) {
            btn.title = '点一下页面即可开启声音';
        } else {
            btn.title = playing ? '点击暂停背景音乐' : '点击播放背景音乐';
        }
    }

    function showHint(text) {
        if (!hintEl) return;
        if (text) hintEl.textContent = text;
        hintEl.classList.add('show');
        if (hintTimer) clearTimeout(hintTimer);
        hintTimer = setTimeout(hideHint, HINT_LIFE);
    }

    function hideHint() {
        if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
        if (hintEl) hintEl.classList.remove('show');
    }

    // ---------- 交互监听（用于取消静音 / 兜底播放） ----------
    function removeGestureHooks() {
        if (!gestureArmed) return;
        gestureArmed = false;
        GESTURE_EVENTS.forEach(function (ev) {
            document.removeEventListener(ev, onFirstGesture, true);
        });
    }

    function armGestureHooks() {
        if (gestureArmed) return;
        gestureArmed = true;
        GESTURE_EVENTS.forEach(function (ev) {
            document.addEventListener(ev, onFirstGesture, true);
        });
    }

    // 必须在用户手势的同一个同步回调里改 muted / 调 play()，否则浏览器不认
    function onFirstGesture() {
        if (muted) { removeGestureHooks(); return; }
        if (pendingUnmute) { unmute(); return; }
        playWithSound();
    }

    // ---------- 播放控制 ----------
    // 1) 带声音尝试自动播放
    function playWithSound() {
        audio.muted = false;
        var p;
        try {
            p = audio.play();
        } catch (e) {
            startMutedAutoplay();
            return;
        }
        if (p && typeof p.then === 'function') {
            p.then(function () {
                pendingUnmute = false;
                removeGestureHooks();
                hideHint();
                fadeTo(TARGET_VOLUME);
                updateButton();
            }).catch(function () {
                startMutedAutoplay();
            });
        } else {
            pendingUnmute = false;
            removeGestureHooks();
            fadeTo(TARGET_VOLUME);
            updateButton();
        }
    }

    // 2) 静音自动播放：浏览器一定放行，先让音乐跑起来
    function startMutedAutoplay() {
        if (muted) { updateButton(); return; }
        audio.muted = true;
        audio.volume = 0;
        var p;
        try {
            p = audio.play();
        } catch (e) {
            armGestureHooks();
            updateButton();
            return;
        }
        var onOk = function () {
            pendingUnmute = true;
            armGestureHooks();
            updateButton();
            showHint('轻触或敲键盘即可开启声音');
        };
        var onFail = function () {
            pendingUnmute = false;
            armGestureHooks();
            updateButton();
            showHint('点击播放背景音乐');
        };
        if (p && typeof p.then === 'function') {
            p.then(onOk).catch(onFail);
        } else {
            onOk();
        }
    }

    // 3) 用户交互后取消静音（在手势回调内同步执行）
    function unmute() {
        pendingUnmute = false;
        justUnmutedAt = Date.now();
        audio.muted = false;
        audio.volume = 0;
        removeGestureHooks();
        hideHint();
        if (audio.paused) {
            var p;
            try { p = audio.play(); } catch (e) { updateButton(); return; }
            if (p && typeof p.then === 'function') {
                p.then(function () { fadeTo(TARGET_VOLUME); updateButton(); })
                 .catch(function () { armGestureHooks(); updateButton(); });
            } else {
                fadeTo(TARGET_VOLUME);
                updateButton();
            }
        } else {
            fadeTo(TARGET_VOLUME);
            updateButton();
        }
    }

    function resumePlayback() {
        if (pendingUnmute) {
            // 仍是静音待命状态，安静地续播即可
            var p = audio.play();
            if (p && typeof p.catch === 'function') p.catch(function () {});
            updateButton();
        } else {
            playWithSound();
        }
    }

    function savePosition() {
        if (!audio) return;
        writeNumber(POS_KEY, audio.currentTime || 0);
    }

    function restorePosition() {
        var saved = readNumber(POS_KEY);
        if (!(saved > 0)) return;
        if (isFinite(audio.duration) && audio.duration > 0) {
            if (saved < audio.duration - 1) {
                try { audio.currentTime = saved; } catch (e) {}
            }
        } else {
            audio.addEventListener('loadedmetadata', function once() {
                audio.removeEventListener('loadedmetadata', once);
                if (isFinite(audio.duration) && saved < audio.duration - 1) {
                    try { audio.currentTime = saved; } catch (e) {}
                }
            });
        }
    }

    function bindAudioEvents() {
        audio.addEventListener('play', updateButton);
        audio.addEventListener('pause', updateButton);
        audio.addEventListener('ended', updateButton);
        audio.addEventListener('timeupdate', function () {
            var now = Date.now();
            if (now - lastPosSave > 2000) {
                lastPosSave = now;
                savePosition();
            }
        });
        audio.addEventListener('error', function () {
            // 音频加载失败（缺失 / 被拦截）时不再反复提示
            if (btn) btn.title = '背景音乐加载失败';
            pendingUnmute = false;
            hideHint();
        });
    }

    function bindVisibility() {
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                wasPlayingBeforeHide = !audio.paused;
                if (wasPlayingBeforeHide) {
                    savePosition();
                    audio.pause();
                }
            } else if (wasPlayingBeforeHide && !muted) {
                wasPlayingBeforeHide = false;
                resumePlayback();
            }
        });
        window.addEventListener('pagehide', savePosition);
    }

    // ---------- 启动 ----------
    function boot() {
        if (document.getElementById('login-bgm-audio')) return;

        muted = readPref(MUTE_KEY) === '1';

        injectStyle();

        audio = document.createElement('audio');
        audio.id = 'login-bgm-audio';
        audio.src = SRC;
        audio.loop = true;
        audio.preload = 'metadata';
        audio.setAttribute('playsinline', '');
        audio.volume = 0;
        audio.style.display = 'none';
        document.body.appendChild(audio);

        createButton();
        bindAudioEvents();
        bindVisibility();
        restorePosition();
        updateButton();

        if (muted) {
            // 用户明确关过音乐：不自动播，也不打扰
            hideHint();
            return;
        }

        playWithSound();

        setTimeout(function () {
            if (muted) return;
            if (pendingUnmute) {
                showHint('轻触或敲键盘即可开启声音');
            } else if (audio.paused) {
                showHint('点击播放背景音乐');
            }
        }, HINT_DELAY);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
