/* STC 设备指纹脚本
 * 作用：为每个浏览器生成一个尽量稳定的设备标识（Cookie: stc_dev），
 *       供服务端做"设备级封禁"。封禁 IP 时会连带封禁该设备——
 *       即使对方切换网络/更换 IP，只要仍使用同一浏览器就会被 403 拦截。
 * 实现：Canvas 2D 渲染 + WebGL 渲染器 + 系统环境信息的哈希（与缓存、换 IP 无关）。
 */
(function () {
    'use strict';
    try {
        var COOKIE_KEY = 'stc_dev';
        var LS_KEY = 'stc_fp';
        var stored = null;
        try { stored = localStorage.getItem(LS_KEY); } catch (e) { /* 隐私模式或禁用存储时忽略 */ }
        var fp = (typeof stored === 'string' && /^[0-9a-f]{16,40}$/.test(stored)) ? stored : computeFP();
        try { localStorage.setItem(LS_KEY, fp); } catch (e) { /* ignore */ }
        // 过期时间 1 年；每次加载都刷新，长期有效
        document.cookie = COOKIE_KEY + '=' + fp + ';path=/;max-age=31536000;SameSite=Lax';
    } catch (e) { /* 指纹失败不影响页面功能 */ }

    // ---------- 设备指纹计算 ----------
    function computeFP() {
        var parts = [];
        parts.push(canvasFP());
        try {
            var cv = document.createElement('canvas');
            var gl = cv.getContext('webgl') || cv.getContext('experimental-webgl');
            if (gl) {
                var ext = gl.getExtension('WEBGL_debug_renderer_info');
                if (ext) {
                    parts.push(String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || ''));
                    parts.push(String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || ''));
                } else {
                    parts.push(String(gl.getParameter(gl.VERSION) || ''));
                }
            }
        } catch (e) { /* ignore */ }
        try { parts.push(navigator.language || ''); } catch (e) {}
        try { parts.push(navigator.platform || ''); } catch (e) {}
        try { parts.push(String(new Date().getTimezoneOffset())); } catch (e) {}
        if (navigator.hardwareConcurrency) parts.push(String(navigator.hardwareConcurrency));
        if (navigator.deviceMemory) parts.push(String(navigator.deviceMemory));
        // 返回 16 位十六进制指纹
        return fnvHash(parts.join('||')).slice(0, 16);
    }

    // Canvas 2D 渲染指纹：不同设备/浏览器/系统的字体与渲染管线差异很大
    function canvasFP() {
        try {
            var c = document.createElement('canvas');
            c.width = 240;
            c.height = 60;
            var ctx = c.getContext('2d');
            if (!ctx) return 'no-2d';
            ctx.textBaseline = 'top';
            ctx.font = '16px "Arial", "Microsoft YaHei", sans-serif';
            ctx.fillStyle = 'rgb(16,120,240)';
            ctx.fillRect(0, 0, 240, 60);
            var grd = ctx.createLinearGradient(0, 0, 240, 0);
            grd.addColorStop(0, '#06a');
            grd.addColorStop(1, '#f0a');
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.arc(120, 30, 20, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(0,0,0,0.82)';
            ctx.fillText('STC-DEVICE-FP-6f3b2a', 6, 4);
            ctx.fillStyle = 'rgba(255,255,255,0.65)';
            ctx.fillText('QWERTY 0123456789 中文字符', 6, 30);
            return c.toDataURL();
        } catch (e) {
            return 'canvas-error';
        }
    }

    // FNV-1a 双通道 64 位哈希（返回 16 位 hex）
    function fnvHash(str) {
        var h1 = 0x811c9dc5, h2 = 0x811c9dc7;
        for (var i = 0; i < str.length; i++) {
            var code = str.charCodeAt(i);
            h1 ^= code; h1 = Math.imul(h1, 0x01000193) >>> 0;
            h2 ^= code; h2 = Math.imul(h2, 0x01000197) >>> 0;
        }
        h1 ^= str.length; h1 = Math.imul(h1, 0x01000193) >>> 0;
        h2 ^= str.length; h2 = Math.imul(h2, 0x01000197) >>> 0;
        var p1 = ('00000000' + h1.toString(16)).slice(-8);
        var p2 = ('00000000' + h2.toString(16)).slice(-8);
        return p1 + p2;
    }
})();
