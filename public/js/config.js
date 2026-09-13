// ============================================================
// STC网站 - API 跨域配置 + 跨域登录态（镜像用）
// ============================================================
// 【使用说明】
// 1. 在 Vercel 上直接部署时，保持 API_BASE = '' 即可（同源）
// 2. 在 GitHub Pages 上部署时，取消下方注释并填入 Vercel 地址
//    例如：var API_BASE = 'https://stc-website-weld.vercel.app';
//    同时要把 https://<你的用户名>.github.io 写进后端环境变量 CORS_ORIGINS
//    （后端只精确匹配来源，见 server.js 顶部 CORS 说明）
// 3. 跨域部署时登录态：浏览器可能拦第三方 cookie，故镜像端把登录响应里的
//    token 存 localStorage 并用 Authorization 头自持登录态（见下方 STCAPI）
// ============================================================

// 配置 API 后端地址（留空=同源，填 Vercel 地址=跨域）
var API_BASE_CONFIG = '';

(function() {
    var API_BASE = (window.API_BASE || API_BASE_CONFIG || '').replace(/\/$/, '');
    var API_PREFIXES = ['/api/', '/avatars/', '/uploads/'];

    function needsPrefix(url) {
        if (typeof url !== 'string') return false;
        for (var i = 0; i < API_PREFIXES.length; i++) {
            if (url.indexOf(API_PREFIXES[i]) === 0) return true;
        }
        return false;
    }

    // ---------- 跨域判定 ----------
    var CROSS_ORIGIN = (function() {
        if (!API_BASE) return false;
        try { return new URL(API_BASE, location.href).origin !== location.origin; } catch (e) { return false; }
    })();

    // ---------- 跨域登录态 ----------
    // 主站（同源）：登录态只走服务端 httpOnly cookie，前端不接触 token（XSS 偷不走）。
    // 镜像（跨域）：浏览器对第三方 cookie 的政策不一（Safari / 无痕会拦），
    //   所以退化为「登录响应里的 token 存 localStorage + 每次请求带 Authorization 头」。
    //   key 特意与历史 stc_auth_token 区分：各 fetchWithAuth 会清掉那个旧 key 的残留。
    var TOKEN_KEY = 'stc_mirror_token';
    // 只有这些接口会在跨域响应体里回 token（见 server.js shouldExposeTokenInBody）
    var AUTH_JSON_RE = /\/api\/(?:login|auth\/logto\/check)(?:\?|$)/;
    var LOGOUT_RE = /\/api\/logout(?:\?|$)/;

    function getToken() {
        try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
    }
    function setToken(t) {
        if (!CROSS_ORIGIN || typeof t !== 'string' || !t) return;
        try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* 隐私模式等，忽略 */ }
    }
    function clearToken() {
        try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* 忽略 */ }
    }

    // 给 headers 补 Authorization，兼容对象 / Headers 实例 / 二维数组三种写法，且不覆盖已有同名头
    function withAuthHeader(headers, token) {
        var value = 'Bearer ' + token;
        try {
            if (!headers) return { 'Authorization': value };
            if (typeof Headers !== 'undefined' && headers instanceof Headers) {
                var h = new Headers(headers);
                if (!h.has('Authorization')) h.set('Authorization', value);
                return h;
            }
            if (Array.isArray(headers)) {
                var exists = headers.some(function(kv) { return String(kv[0]).toLowerCase() === 'authorization'; });
                if (!exists) headers.push(['Authorization', value]);
                return headers;
            }
            var out = {};
            var hasAuth = false;
            for (var k in headers) {
                if (!Object.prototype.hasOwnProperty.call(headers, k)) continue;
                if (String(k).toLowerCase() === 'authorization') hasAuth = true;
                out[k] = headers[k];
            }
            if (!hasAuth) out['Authorization'] = value;
            return out;
        } catch (e) {
            return headers;
        }
    }

    var _fetch = window.fetch;
    window.fetch = function(url, options) {
        var isApi = needsPrefix(url);
        if (isApi && API_BASE) {
            url = API_BASE + url;
        }
        if (isApi && CROSS_ORIGIN) {
            if (!options) options = {};
            // 跨站请求要显式 include 才可能带上 cookie（后端 AUTH_COOKIE_SAMESITE=None 时才有效）
            if (options.credentials === undefined) options.credentials = 'include';
            var token = getToken();
            if (token) options.headers = withAuthHeader(options.headers, token);
        }
        var promise = _fetch.call(this, url, options);
        if (!isApi || !CROSS_ORIGIN) return promise;

        return promise.then(function(res) {
            try {
                if (!res) return res;
                if (res.status === 401) {
                    clearToken();               // 登录态已失效，别拿着废 token 继续
                } else if (res.ok && AUTH_JSON_RE.test(url)) {
                    res.clone().json().then(function(d) {
                        if (d && typeof d.token === 'string') setToken(d.token);
                    }).catch(function() { /* 非 JSON 响应，忽略 */ });
                }
                if (LOGOUT_RE.test(url)) clearToken();
            } catch (e) { /* 兜底：绝不影响业务请求 */ }
            return res;
        });
    };

    var _EventSource = window.EventSource;
    if (_EventSource) {
        var PatchedEventSource = function(url, options) {
            if (needsPrefix(url)) {
                url = API_BASE + url;
            }
            // 跨域 SSE 无法带自定义头，只能靠 cookie：必须 withCredentials，
            // 否则第三方 cookie 不会被带上（后端需配 AUTH_COOKIE_SAMESITE=None）
            if (CROSS_ORIGIN) {
                if (!options) options = {};
                if (options.withCredentials === undefined) options.withCredentials = true;
            }
            return new _EventSource(url, options);
        };
        PatchedEventSource.prototype = _EventSource.prototype;
        window.EventSource = PatchedEventSource;
    }

    // 供页面/调试使用：window.STCAPI.crossOrigin / base / getToken() / setToken() / clearToken()
    window.STCAPI = {
        base: API_BASE,
        crossOrigin: CROSS_ORIGIN,
        getToken: getToken,
        setToken: setToken,
        clearToken: clearToken
    };
})();
