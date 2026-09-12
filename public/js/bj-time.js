/* ============================================================
 * STC 网站 - 北京时间工具 + 愚人节彩蛋
 * ------------------------------------------------------------
 * 1) 自动获取北京时间
 *    以服务器时间为基准校正本地时钟（消除访客电脑时区 / 系统时间错误的影响），
 *    所有时间显示统一按北京时间（UTC+8，中国无夏令时）格式化。
 *
 * 2) 每年 4 月 1 日（北京时间）自动跳转彩蛋页面
 *    同一会话只跳转一次，返回后可正常访问网站；管理端默认不跳转。
 *
 * 公开 API（window.STCBeijing）：
 *   now()            -> 校正后的当前时刻（Date）
 *   nowMs()          -> 校正后的当前毫秒时间戳
 *   parts(v)         -> 北京时间字段 { year, month, day, hour, minute, second, weekday, date }
 *   dateStr(v)       -> 'YYYY-MM-DD'
 *   timeStr(v)       -> 'HH:mm:ss'
 *   datetimeStr(v)   -> 'YYYY-MM-DD HH:mm:ss'
 *   fullDateTime(v)  -> '2026年9月12日 20:15'
 *   relative(v)      -> '刚刚 / 5分钟前 / 3小时前 / 2天前 / 9月12日'
 *   sync()           -> 与服务器校时（Promise）
 *   ready(cb)        -> 校时完成后回调
 *   isFoolsDay()     -> 当前是否为 4 月 1 日（北京时间）
 *
 * v 支持：Date / 毫秒或秒级时间戳 / 可被 Date 解析的字符串，缺省为当前时间。
 * ============================================================ */
(function (window, document) {
    'use strict';

    var BJ_OFFSET_MS = 8 * 60 * 60 * 1000;      // 北京时间 = UTC + 8 小时
    var TIME_API = '/api/time';
    var SKEW_KEY = 'stc_bj_time_skew';          // 校时结果缓存（服务器时间 - 本地时间）
    var JUMP_KEY = 'stc_fools_day_jumped';      // 愚人节跳转标记
    var SKEW_TTL = 30 * 60 * 1000;              // 校时缓存有效期 30 分钟
    var SYNC_TIMEOUT = 4000;                    // 校时请求兜底超时

    /* ---------------- 愚人节彩蛋配置 ---------------- */
    var FOOLS_DAY = {
        enabled: true,                          // 总开关（false 可临时关闭彩蛋）
        month: 4,                               // 月份 1-12
        day: 1,                                 // 日期
        url: 'https://www.bilibili.com/video/BV1GJ411x7h7/?spm_id_from=333.337.search-card.all.click',
        skipPaths: ['/admin']                   // 路径中包含这些字符串的页面不跳转（管理端便于维护）
    };

    // 调试：URL 上加 ?fools=1 立即预览跳转，?fools=0 临时关闭
    var FORCE_ON = /[?&]fools=1(&|$)/.test(window.location.search);
    var FORCE_OFF = /[?&]fools=0(&|$)/.test(window.location.search);

    var skewMs = 0;         // 服务器时间 - 本地时间
    var synced = false;     // 是否已成功校时
    var syncPromise = null;

    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    /* ---------------- 校时 ---------------- */

    function readCachedSkew() {
        try {
            var raw = sessionStorage.getItem(SKEW_KEY);
            if (!raw) return;
            var obj = JSON.parse(raw);
            if (obj && typeof obj.skew === 'number' && Date.now() - obj.at < SKEW_TTL) {
                skewMs = obj.skew;
                synced = true;
            }
        } catch (e) { /* 忽略：隐私模式下 sessionStorage 不可用 */ }
    }

    function saveCachedSkew() {
        try {
            sessionStorage.setItem(SKEW_KEY, JSON.stringify({ skew: skewMs, at: Date.now() }));
        } catch (e) { /* 忽略 */ }
    }

    // 与服务器校时；失败时静默回退到本地时间
    function sync() {
        if (syncPromise) return syncPromise;
        var start = Date.now();

        syncPromise = new Promise(function (resolve) {
            var finished = false;
            var finish = function () {
                if (!finished) { finished = true; resolve(skewMs); }
            };
            var timer = setTimeout(finish, SYNC_TIMEOUT);

            try {
                fetch(TIME_API, { credentials: 'include', cache: 'no-store' })
                    .then(function (r) { return r.ok ? r.json() : null; })
                    .then(function (res) {
                        if (res && res.success && res.data && typeof res.data.timestamp === 'number') {
                            var rtt = Date.now() - start;
                            // 服务端时间戳 + 半个往返耗时，尽量贴近真实时刻
                            skewMs = res.data.timestamp + Math.round(rtt / 2) - Date.now();
                            synced = true;
                            saveCachedSkew();
                        }
                    })
                    .catch(function () { /* 忽略，沿用本地时间 */ })
                    .then(function () { clearTimeout(timer); finish(); });
            } catch (e) {
                clearTimeout(timer);
                finish();
            }
        });

        return syncPromise;
    }

    function ready(cb) {
        if (typeof cb === 'function') {
            sync().then(function () {
                try { cb(now()); } catch (e) { /* 忽略回调异常 */ }
            });
        }
        return sync();
    }

    /* ---------------- 时间取值 / 格式化 ---------------- */

    function nowMs() { return Date.now() + skewMs; }
    function now() { return new Date(nowMs()); }

    // 把各种输入统一转换为「绝对毫秒时间戳」（并修正本地时钟偏差）
    function toMs(value) {
        if (value === undefined || value === null || value === '') return nowMs();
        if (value instanceof Date) return value.getTime() + skewMs;
        if (typeof value === 'number') {
            return (value < 1e12 ? value * 1000 : value) + skewMs; // 兼容秒级时间戳
        }
        var parsed = new Date(value);
        if (isNaN(parsed.getTime())) return nowMs();
        return parsed.getTime() + skewMs;
    }

    // 由绝对毫秒得到北京时间的各个字段
    function bjParts(absMs) {
        var t = new Date(absMs + BJ_OFFSET_MS);
        var year = t.getUTCFullYear();
        var month = t.getUTCMonth() + 1;
        var day = t.getUTCDate();
        return {
            year: year,
            month: month,
            day: day,
            hour: t.getUTCHours(),
            minute: t.getUTCMinutes(),
            second: t.getUTCSeconds(),
            weekday: t.getUTCDay(),
            date: year + '-' + pad(month) + '-' + pad(day)
        };
    }

    function parts(value) { return bjParts(toMs(value)); }

    function dateStr(value) { return bjParts(toMs(value)).date; }

    function timeStr(value) {
        var p = bjParts(toMs(value));
        return pad(p.hour) + ':' + pad(p.minute) + ':' + pad(p.second);
    }

    function datetimeStr(value) { return dateStr(value) + ' ' + timeStr(value); }

    function fullDateTime(value) {
        var p = bjParts(toMs(value));
        return p.year + '年' + p.month + '月' + p.day + '日 ' + pad(p.hour) + ':' + pad(p.minute);
    }

    // 相对时间描述（以北京时间的自然日计算"今天/昨天"）
    function relative(value) {
        var diff = nowMs() - toMs(value);
        if (diff < 0) diff = 0;

        var minute = 60 * 1000;
        var hour = 60 * minute;
        var day = 24 * hour;

        if (diff < minute) return '刚刚';
        if (diff < hour) return Math.floor(diff / minute) + '分钟前';

        var nowParts = bjParts(nowMs());
        var target = bjParts(toMs(value));

        if (target.date === nowParts.date) return Math.floor(diff / hour) + '小时前';

        var yesterday = bjParts(nowMs() - day);
        if (target.date === yesterday.date) return '昨天';

        if (diff < 7 * day) return Math.floor(diff / day) + '天前';

        if (target.year === nowParts.year) return target.month + '月' + target.day + '日';
        return target.year + '年' + target.month + '月' + target.day + '日';
    }

    /* ---------------- 愚人节彩蛋 ---------------- */

    function isFoolsDay() {
        var p = bjParts(nowMs());
        return p.month === FOOLS_DAY.month && p.day === FOOLS_DAY.day;
    }

    function shouldSkipPage() {
        try {
            var path = (window.location && window.location.pathname) || '';
            for (var i = 0; i < FOOLS_DAY.skipPaths.length; i++) {
                if (path.indexOf(FOOLS_DAY.skipPaths[i]) !== -1) return true;
            }
            // 页面可在 <html data-no-fools> 上主动排除
            if (document.documentElement && document.documentElement.hasAttribute('data-no-fools')) return true;
        } catch (e) { /* 忽略 */ }
        return false;
    }

    function alreadyJumped() {
        try { return sessionStorage.getItem(JUMP_KEY) === dateStr(); } catch (e) { return false; }
    }

    function jump(keepHistory) {
        try { sessionStorage.setItem(JUMP_KEY, dateStr()); } catch (e) { /* 忽略 */ }
        if (keepHistory) {
            window.location.href = FOOLS_DAY.url;          // 调试预览：保留返回历史
        } else {
            window.location.replace(FOOLS_DAY.url);        // 正式彩蛋：避免"返回"时被反复跳转
        }
    }

    function checkFoolsDay() {
        if (FORCE_OFF) return;
        if (!FOOLS_DAY.url) return;
        if (!FOOLS_DAY.enabled && !FORCE_ON) return;
        if (shouldSkipPage()) return;
        if (!FORCE_ON && alreadyJumped()) return;
        // 以服务器校时后的北京时间判定，避免访客时区/时钟偏差导致误判
        sync().then(function () {
            if (FORCE_ON) { jump(true); return; }
            if (isFoolsDay() && !alreadyJumped()) jump(false);
        });
    }

    /* ---------------- 初始化 ---------------- */

    readCachedSkew();
    checkFoolsDay();

    window.STCBeijing = {
        BJ_OFFSET_MS: BJ_OFFSET_MS,
        now: now,
        nowMs: nowMs,
        absMs: nowMs,       // 当前真实时刻（毫秒，已校正本地时钟偏差）
        toMs: toMs,         // 原始值 -> 绝对毫秒（含本地时钟校正）
        partsAbs: bjParts,  // 已校正的绝对毫秒 -> 北京时间字段
        parts: parts,
        dateStr: dateStr,
        timeStr: timeStr,
        datetimeStr: datetimeStr,
        fullDateTime: fullDateTime,
        relative: relative,
        sync: sync,
        ready: ready,
        isSynced: function () { return synced; },
        isFoolsDay: isFoolsDay,
        config: FOOLS_DAY
    };
})(window, document);
