/**
 * 登录 / 注册页背景音乐（循环播放）
 *
 * 行为：
 * 1. 进入页面后尝试自动播放；被浏览器自动播放策略拦截时，挂一次性交互监听，
 *    用户第一次点击 / 按键 / 触摸时再开始播放（不静音强制播放是做不到的，这是浏览器限制）。
 * 2. 左下角悬浮按钮可随时静音 / 恢复，选择记在 localStorage，注册↔登录 之间保持一致。
 * 3. 注册 → 登录 跳转时用 sessionStorage 记住播放进度，续播而不是从头开始。
 * 4. 切到后台标签页暂停，回到页面自动续播（同样受自动播放策略约束）。
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
    var HINT_DELAY = 1500;      // 自动播放被拦截多久后给提示
    var HINT_LIFE = 6000;       // 提示停留时长

    var audio = null;
    var btn = null;
    var hintEl = null;
    var muted = false;
    var gestureArmed = false;
    var fadeTimer = null;
    var hintTimer = null;
    var lastPosSave = 0;
    var wasPlayingBeforeHide = false;

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
            '#login-bgm-hint{position:fixed;left:68px;bottom:26px;z-index:9998;padding:6px 12px;border-radius:999px;',
            'background:rgba(15,17,24,.82);border:1px solid rgba(255,255,255,.18);color:#e6e8f0;font-size:12px;',
            'white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .4s ease;}',
            '#login-bgm-hint.show{opacity:1;}',
            '@media (prefers-reduced-motion: reduce){#login-bgm-toggle{transition:none;}',
            '#login-bgm-toggle.is-playing::after{animation:none;opacity:.5;}}',
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
        hintEl.textContent = '点击播放背景音乐';
        document.body.appendChild(hintEl);

        btn.addEventListener('click', function () {
            hideHint();
            if (audio.paused || audio.ended) {
                play();
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
        var playing = !audio.paused && !audio.ended;
        btn.classList.toggle('is-playing', playing);
        btn.textContent = playing ? '🔊' : '🔇';
        btn.title = playing ? '点击暂停背景音乐' : '点击播放背景音乐';
    }

    function showHint() {
        if (!hintEl) return;
        hintEl.classList.add('show');
        if (hintTimer) clearTimeout(hintTimer);
        hintTimer = setTimeout(hideHint, HINT_LIFE);
    }

    function hideHint() {
        if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
        if (hintEl) hintEl.classList.remove('show');
    }

    // ---------- 播放控制 ----------
    function removeGestureHooks() {
        if (!gestureArmed) return;
        gestureArmed = false;
        GESTURE_EVENTS.forEach(function (ev) {
            document.removeEventListener(ev, onFirstGesture, true);
        });
    }

    function onFirstGesture() {
        if (muted) { removeGestureHooks(); return; }
        play();
    }

    function armGestureHooks() {
        if (gestureArmed) return;
        gestureArmed = true;
        GESTURE_EVENTS.forEach(function (ev) {
            document.addEventListener(ev, onFirstGesture, true);
        });
    }

    function play() {
        hideHint();
        var p;
        try {
            p = audio.play();
        } catch (e) {
            armGestureHooks();
            return;
        }
        if (p && typeof p.then === 'function') {
            p.then(function () {
                removeGestureHooks();
                fadeTo(TARGET_VOLUME);
                updateButton();
            }).catch(function () {
                // 自动播放被拦截：等用户第一次交互
                updateButton();
                armGestureHooks();
                showHint();
            });
        } else {
            removeGestureHooks();
            fadeTo(TARGET_VOLUME);
            updateButton();
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
                play();
            }
        });
        window.addEventListener('pagehide', savePosition);
    }

    // ---------- 启动 ----------
    function boot() {
        if (document.getElementById('login-bgm-audio')) return;

        var pref = readPref(MUTE_KEY);
        muted = pref === '1';

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
            hideHint();
            return;
        }
        play();
        // 若一直没能播放，给一次可见提示（避免用户以为坏了）
        setTimeout(function () {
            if (audio.paused && !muted) showHint();
        }, HINT_DELAY);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
