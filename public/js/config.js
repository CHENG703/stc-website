// ============================================================
// STC网站 - API 跨域配置
// ============================================================
// 【使用说明】
// 1. 在 Vercel 上直接部署时，保持 API_BASE = '' 即可（同源）
// 2. 在 GitHub Pages 上部署时，取消下方注释并填入 Vercel 地址
//    例如：var API_BASE = 'https://stc-website-weld.vercel.app';
// ============================================================

// 配置 API 后端地址（留空=同源，填 Vercel 地址=跨域）
var API_BASE_CONFIG = '';

// 以下代码自动给所有 /api/、/avatars/、/uploads/ 请求加上前缀
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

    var _fetch = window.fetch;
    window.fetch = function(url, options) {
        if (needsPrefix(url)) {
            url = API_BASE + url;
        }
        return _fetch.apply(this, arguments);
    };

    var _EventSource = window.EventSource;
    if (_EventSource) {
        var PatchedEventSource = function(url, options) {
            if (needsPrefix(url)) {
                url = API_BASE + url;
            }
            return new _EventSource(url, options);
        };
        PatchedEventSource.prototype = _EventSource.prototype;
        window.EventSource = PatchedEventSource;
    }
})();
