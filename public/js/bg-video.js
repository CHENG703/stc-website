/**
 * STC 全站视频背景组件（2026-09）
 *
 * 用法：在任意页面 </head> 之前引入即可，无需改 CSS、无需加 DOM：
 *     <script src="/js/bg-video.js?v=1" defer></script>
 *
 * 会自动注入：
 *   <div id="stc-bg-video-layer">       固定全屏层，z-index:-1（垫在页面内容与 html 画布之间）
 *       <video id="stc-bg-video" ...>   静音 / 循环 / 自动播放
 *       <div id="stc-bg-video-mask">    径向压暗遮罩，保证正文可读
 *   </div>
 *
 * 适配策略：
 *   1. 屏幕 ≤768px、开启省流（saveData）或 2G 网络 → 使用 0.67MB 低码率版本，桌面用 2.12MB 版本。
 *   2. 从不禁用视频（放置层始终尝试播放），未加载完成时由 poster 封面兜底。
 *   3. 自动播放被拒 → 在用户第一次点击/按键/触摸时重试。
 *   4. 页面切到后台自动暂停，回到前台续播（省电、省流量）。
 *   5. 视频真的加载失败（error）才退化为静态封面。
 */
(function () {
    'use strict';

    if (window.__stcBgVideoLoaded) return;
    window.__stcBgVideoLoaded = true;

    var SRC_DESKTOP = '/video/login-bg.mp4';
    var SRC_MOBILE = '/video/login-bg-mobile.mp4';
    var POSTER = '/video/login-bg-poster.jpg';
    var STYLE_ID = 'stc-bg-video-style';
    var LAYER_ID = 'stc-bg-video-layer';
    var MASK_ID = 'stc-bg-video-mask';
    var VIDEO_ID = 'stc-bg-video';

    var CONN = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};

    function pickSrc() {
        var narrow = !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
        var light = narrow || CONN.saveData === true || /(^|-)2g$/.test(CONN.effectiveType || '');
        return light ? SRC_MOBILE : SRC_DESKTOP;
    }

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var css = [
            '#' + LAYER_ID + '{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none;background-color:#0c1220}',
            '#' + LAYER_ID + ' video{width:100%;height:100%;object-fit:cover;display:block;border:0}',
            '#' + LAYER_ID + '.no-video video{display:none}',
            '#' + LAYER_ID + '.no-video{background-image:url("' + POSTER + '");background-size:cover;background-position:center}',
            '#' + MASK_ID + '{position:absolute;inset:0;background:radial-gradient(circle at 50% 38%,rgba(8,12,24,.42) 0%,rgba(8,12,24,.7) 100%)}',
            '@media (max-width:768px){#' + MASK_ID + '{background:radial-gradient(circle at 50% 38%,rgba(8,12,24,.5) 0%,rgba(8,12,24,.78) 100%)}}',
            '@media print{#' + LAYER_ID + '{display:none}}'
        ].join('');
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    function log(msg) {
        if (window.console && console.info) console.info('[bg-video] ' + msg);
    }

    function fallbackToPoster(layer, video, why) {
        if (!layer.classList.contains('no-video')) {
            layer.classList.add('no-video');
            try { video.pause(); } catch (e) { /* ignore */ }
            video.removeAttribute('src');
            try { video.load(); } catch (e) { /* ignore */ }
        }
        log('视频不可用，改用静态封面（' + why + '）');
    }

    function start(video, layer) {
        var dead = false;

        video.addEventListener('error', function () {
            if (dead) return;
            dead = true;
            fallbackToPoster(layer, video, '媒体加载失败');
        });

        function play() {
            if (dead) return;
            var p = null;
            try { p = video.play(); } catch (e) { p = null; }
            if (p && typeof p.catch === 'function') {
                p.catch(function (err) {
                    // 静音视频理论上不会被拒；若被拒也不降级，等用户手势时再试
                    log('等待用户交互后重试自动播放（' + ((err && err.name) || 'unknown') + '）');
                });
            }
        }

        video.src = pickSrc();
        try { video.load(); } catch (e) { /* ignore */ }
        play();

        // 用户第一次交互时补一次播放（应对极少数拦截自动播放的环境）
        var onGesture = function () {
            document.removeEventListener('pointerdown', onGesture, true);
            document.removeEventListener('touchstart', onGesture, true);
            document.removeEventListener('keydown', onGesture, true);
            if (!dead && video.paused) play();
        };
        document.addEventListener('pointerdown', onGesture, true);
        document.addEventListener('touchstart', onGesture, true);
        document.addEventListener('keydown', onGesture, true);

        // 切后台暂停，回前台续播
        document.addEventListener('visibilitychange', function () {
            if (dead || layer.classList.contains('no-video')) return;
            if (document.hidden) {
                try { video.pause(); } catch (e) { /* ignore */ }
            } else if (video.paused) {
                play();
            }
        });
    }

    function build() {
        injectStyle();
        if (document.getElementById(LAYER_ID)) return;

        var layer = document.createElement('div');
        layer.id = LAYER_ID;

        var video = document.createElement('video');
        video.id = VIDEO_ID;
        video.muted = true;
        video.defaultMuted = true;
        video.loop = true;
        video.autoplay = true;
        video.playsInline = true;
        video.setAttribute('muted', '');
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.setAttribute('preload', 'auto');
        video.setAttribute('aria-hidden', 'true');
        video.setAttribute('tabindex', '-1');
        video.poster = POSTER;

        var mask = document.createElement('div');
        mask.id = MASK_ID;
        mask.setAttribute('aria-hidden', 'true');

        layer.appendChild(video);
        layer.appendChild(mask);

        var host = document.body || document.documentElement;
        host.insertBefore(layer, host.firstChild);

        start(video, layer);
    }

    if (document.body) build();
    else document.addEventListener('DOMContentLoaded', build);
})();
