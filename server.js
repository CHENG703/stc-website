/**
 * ============================================================================
 * STC网站 - 版权所有
 * ============================================================================
 * 
 * 本软件及其所有源代码、文档和相关文件均受版权保护。
 * 
 * 版权声明：
 * - 本项目所有代码、设计、文档均为原创开发
 * - 未经授权，禁止复制、修改、分发、出售或用于商业目的
 * - 禁止将本代码用于任何未经授权的项目或产品
 * - 任何违反版权的行为将承担法律责任
 * 
 * 技术支持：请联系原作者获取授权和技术支持
 * 
 * Copyright © 2025-2026 STC. All Rights Reserved.
 * ============================================================================
 */

require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Vercel KV（条件加载，本地未安装时不报错）
let kv = null;
const KV_KEY = 'stc:database';
const KV_ENABLED = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const KV_READ_TTL = 1500; // 从 KV 刷新数据的间隔（毫秒），避免每个请求都读 KV
if (KV_ENABLED) {
    try {
        // 优先 @upstash/redis（@vercel/kv 的底层，已随依赖安装）。
        // 必须禁用 auto-pipelining：默认批量发送会在 nextTick 才执行，
        // Serverless 响应返回后进程可能被冻结，导致数据没真正写入 KV。
        const { Redis } = require('@upstash/redis');
        kv = new Redis({
            url: process.env.KV_REST_API_URL,
            token: process.env.KV_REST_API_TOKEN,
            enableAutoPipelining: false
        });
        console.log('[KV] Vercel KV 已启用（@upstash/redis，auto-pipelining 已禁用）');
    } catch (e) {
        try {
            // 兜底：@vercel/kv 命名导出
            const vercelKv = require('@vercel/kv');
            const _kv = vercelKv.kv || vercelKv;
            if (typeof _kv.get === 'function' && typeof _kv.set === 'function') {
                kv = _kv;
                console.log('[KV] Vercel KV 已启用（@vercel/kv 命名导出）');
            }
        } catch (e2) {
            console.warn('[KV] KV 客户端加载失败，回退到文件存储:', e2.message);
        }
    }
}

// Logto 配置（安全修复：appId/appSecret 必须由环境变量提供，不再内置默认凭据）
const LOGTO_CONFIG = {
    endpoint: process.env.LOGTO_ENDPOINT || 'https://auth.manymice.cn',
    appId: process.env.LOGTO_APP_ID || '',
    appSecret: process.env.LOGTO_APP_SECRET || '',
    baseUrl: process.env.LOGTO_BASE_URL || 'https://stcwork.top',
    authRoutesPrefix: 'logto',
};

// 动态加载 Logto SDK (ESM 模块) - 使用 Promise 确保加载完成
let logtoReadyPromise = null;
let logtoHandleAuthRoutes = null;
let logtoWithLogto = null;

async function initLogto() {
    if (logtoHandleAuthRoutes) return { logtoHandleAuthRoutes, logtoWithLogto };
    if (logtoReadyPromise) return logtoReadyPromise;
    
    logtoReadyPromise = (async () => {
        try {
            const logto = await import('@logto/express');
            logtoHandleAuthRoutes = logto.handleAuthRoutes(LOGTO_CONFIG);
            logtoWithLogto = logto.withLogto(LOGTO_CONFIG);
            console.log('[LOGTO] SDK 加载成功');
            return { logtoHandleAuthRoutes, logtoWithLogto };
        } catch (e) {
            console.warn('[LOGTO] SDK 加载失败:', e.message);
            throw e;
        }
    })();
    
    return logtoReadyPromise;
}

// 立即开始加载（不阻塞启动）
initLogto().catch(() => {});

// Vercel Serverless 限制：只读文件系统、无 child_process
const IS_VERCEL = !!process.env.VERCEL;
const canSpawn = !IS_VERCEL;
const fsRoot = IS_VERCEL ? '/tmp' : __dirname;

const { spawn } = require('child_process');
const nodemailer = require('nodemailer');
let FileStore = null;
if (!IS_VERCEL) {
    try {
        FileStore = require('session-file-store')(session);
    } catch (e) {
        console.warn('session-file-store 加载失败，使用内存 session:', e.message);
    }
}

// 数据库锁定状态
let dbLocked = false;
let dbLockReason = '';

// 邮件发送配置
let emailTransporter = null;
function getEmailTransporter() {
    if (emailTransporter) return emailTransporter;
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;
    if (!emailUser || !emailPass) {
        console.error('[EMAIL] EMAIL_USER 或 EMAIL_PASS 环境变量未配置！');
        return null;
    }
    emailTransporter = nodemailer.createTransport({
        host: 'smtp.qq.com',
        port: 465,
        secure: true,
        auth: {
            user: emailUser,
            pass: emailPass
        },
        // 防止 SMTP 服务器无响应时请求无限挂起（页面一直转圈）
        connectionTimeout: 15000,
        socketTimeout: 20000,
        greetingTimeout: 10000
    });
    return emailTransporter;
}

// 后台发送邮件：不阻塞 HTTP 响应，即使 SMTP 卡住，页面也能立即返回
function sendMailFireAndForget(mailOptions, logTag) {
    try {
        const _t = getEmailTransporter();
        if (!_t) {
            console.error(`[EMAIL][${logTag}] 邮件服务未配置，跳过发送`);
            return;
        }
        _t.sendMail(mailOptions)
            .then(() => console.log(`[EMAIL][${logTag}] 邮件已发送: ${mailOptions.to}`))
            .catch(err => console.error(`[EMAIL][${logTag}] 发送失败:`, err.message));
    } catch (err) {
        console.error(`[EMAIL][${logTag}] 发送异常:`, err.message);
    }
}
let dbLockTime = null;
let lastBackupTime = null;
let lastBackupInfo = null;

// 自动备份状态
let autoBackupEnabled = false;
let autoBackupTime = '00:00';
let autoBackupTimer = null;

// 网站锁定状态
let siteLocked = false;
let siteLockReason = '';
let siteLockBy = '';
let siteLockTime = null;

const app = express();
const PORT = process.env.PORT || 3000;
const isVercel = !!process.env.VERCEL;
const isZeabur = !!process.env.ZEABUR;
const isProduction = process.env.NODE_ENV === 'production';

const CORS_ORIGINS = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : [];

function isAllowedOrigin(origin) {
    if (!origin) return false;
    if (CORS_ORIGINS.includes(origin)) return true;
    if (origin.endsWith('.github.io')) return true;
    if (origin === 'github.io') return true;
    if (origin.endsWith('.zeabur.app')) return true;
    if (origin.endsWith('.zeabur.com')) return true;
    return false;
}

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isAllowedOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-CSRF-Token,Authorization');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length');
    }
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    next();
});

const runtimeDir = IS_VERCEL ? '/tmp/stc-runtime' : (isZeabur ? '/data/stc-runtime' : __dirname);
if ((IS_VERCEL || isZeabur) && !fs.existsSync(runtimeDir)) {
    try { fs.mkdirSync(runtimeDir, { recursive: true }); } catch (e) {}
}

const dbPath = path.join(runtimeDir, 'database.json');
const defaults = {
    users: [],
    tasks: [],
    invite_codes: [],
    invite_requests: [],
    banned_ips: [],
    verification_codes: [],
    messages: [],
    emails: [],
    emailAttachments: [],
    emailFolders: [],
    inviteApplications: [],
    inviteCodes: [],
    bannedIPs: [],
    join_applications: []
};

const ARRAY_MUTATING_METHODS = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'];

class SimpleJSONDB {
    constructor(filePath, defaults) {
        this.filePath = filePath;
        this._data = null;
        this._defaults = defaults;
        this._kvEnabled = KV_ENABLED && !!kv;
        this._pendingKvSave = Promise.resolve();
        this._lastModified = null;
        this._kvLoaded = false;
        this._kvReadAt = 0;
        this._kvReadInFlight = null;

        this._loadFileSync();
    }

    async _loadKv() {
        if (!this._kvEnabled || this._kvLoaded) return;
        try {
            const kvData = await kv.get(KV_KEY);
            if (kvData && typeof kvData === 'object') {
                // KV 数据优先，合并默认值
                this._data = kvData;
                this._ensureDefaults();
                this._kvLoaded = true;
                console.log(`[KV] 数据已从 Vercel KV 加载（users=${(kvData.users || []).length}, tasks=${(kvData.tasks || []).length}）`);
                // 同步到本地文件（仅作缓存，不回写 KV）
                this._writeFileSync();
            } else {
                // KV 中没有数据，把本地数据上传到 KV
                console.log('[KV] KV 中无数据，上传本地数据');
                await kv.set(KV_KEY, this._data);
                this._kvLoaded = true;
            }
        } catch (e) {
            console.warn('[KV] 从 KV 加载失败，使用本地文件:', e.message);
            this._kvLoaded = true; // 标记已尝试，避免反复失败
        }
    }

    async _saveKv() {
        if (!this._kvEnabled) return;
        try {
            await kv.set(KV_KEY, this._data);
        } catch (e) {
            console.warn('[KV] 写入 KV 失败:', e.message);
            // 失败重试一次（KV 网络抖动兜底）
            try {
                await kv.set(KV_KEY, this._data);
            } catch (e2) {
                console.error('[KV] 写入 KV 再次失败:', e2.message);
            }
        }
    }

    _scheduleKvSave() {
        if (!this._kvEnabled) return;
        // 立即排队保存（不依赖 setTimeout：Serverless 响应后定时器可能不执行）
        // promise 链保证多次写入按顺序执行，最终落库最新数据
        this._pendingKvSave = this._pendingKvSave
            .catch(() => {})
            .then(() => this._saveKv());
    }

    _loadFileSync() {
        try {
            if (fs.existsSync(this.filePath)) {
                this._data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
                const stats = fs.statSync(this.filePath);
                this._lastModified = stats.mtimeMs;
            }
        } catch (e) {
            console.warn('[DB] 本地文件读取失败:', e.message);
        }
        if (!this._data || typeof this._data !== 'object') {
            this._data = {};
        }
        this._ensureDefaults();
    }

    _ensureDefaults() {
        for (const key of Object.keys(this._defaults)) {
            if (this._data[key] === undefined) {
                this._data[key] = Array.isArray(this._defaults[key]) ? [] : this._defaults[key];
            }
        }
    }

    // 仅写本地缓存文件（不同步 KV，用于 KV 读回数据的缓存）
    _writeFileSync() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this._data, null, 2));
            const stats = fs.statSync(this.filePath);
            this._lastModified = stats.mtimeMs;
        } catch (e) {
            console.error('[DB] 写入本地文件失败:', e.message);
        }
    }

    _saveFile() {
        this._writeFileSync();
        // 同时保存到 KV（立即排队，见 _scheduleKvSave）
        this._scheduleKvSave();
    }

    _onMutate() {
        this._saveFile();
    }

    _wrapArray(arr) {
        const self = this;
        return new Proxy(arr, {
            get(target, prop) {
                if (ARRAY_MUTATING_METHODS.includes(prop)) {
                    return function (...args) {
                        const result = target[prop].apply(target, args);
                        self._onMutate();
                        return result;
                    };
                }
                const val = target[prop];
                if (Array.isArray(val)) {
                    return self._wrapArray(val);
                }
                if (val && typeof val === 'object') {
                    return self._wrapObject(val);
                }
                return val;
            },
            set(target, prop, value) {
                target[prop] = value;
                self._onMutate();
                return true;
            },
            deleteProperty(target, prop) {
                delete target[prop];
                self._onMutate();
                return true;
            }
        });
    }

    _wrapObject(obj) {
        const self = this;
        return new Proxy(obj, {
            get(target, prop) {
                const val = target[prop];
                if (Array.isArray(val)) {
                    return self._wrapArray(val);
                }
                if (val && typeof val === 'object' && val.constructor === Object) {
                    return self._wrapObject(val);
                }
                return val;
            },
            set(target, prop, val) {
                target[prop] = val;
                self._onMutate();
                return true;
            },
            deleteProperty(target, prop) {
                delete target[prop];
                self._onMutate();
                return true;
            }
        });
    }

    get data() {
        const self = this;
        return new Proxy(this._data, {
            get(target, prop) {
                const val = target[prop];
                if (Array.isArray(val)) {
                    return self._wrapArray(val);
                }
                if (val && typeof val === 'object' && val.constructor === Object) {
                    return self._wrapObject(val);
                }
                return val;
            },
            set(target, prop, val) {
                target[prop] = val;
                self._onMutate();
                return true;
            },
            deleteProperty(target, prop) {
                delete target[prop];
                self._onMutate();
                return true;
            }
        });
    }

    async read() {
        // KV 模式：以 KV 为唯一事实源。首次从 KV 加载，之后按 KV_READ_TTL
        // 周期性刷新，解决 Vercel 多实例之间数据不一致（A 实例写入、B 实例读不到）的问题。
        if (this._kvEnabled) {
            const now = Date.now();
            if (!this._kvLoaded) {
                await this._loadKv();
                this._kvReadAt = now;
            } else if (now - this._kvReadAt > KV_READ_TTL) {
                // 刷新去重：多个并发请求共享同一次刷新
                if (!this._kvReadInFlight) {
                    this._kvReadInFlight = (async () => {
                        try {
                            const kvData = await kv.get(KV_KEY);
                            if (kvData && typeof kvData === 'object') {
                                this._data = kvData;
                                this._ensureDefaults();
                                this._writeFileSync();
                            }
                        } catch (e) {
                            console.warn('[KV] 刷新数据失败，沿用当前数据:', e.message);
                        }
                        this._kvReadAt = Date.now();
                    })();
                }
                try {
                    await this._kvReadInFlight;
                } finally {
                    this._kvReadInFlight = null;
                }
            }
            return this;
        }

        // 非 KV 模式：检查文件是否被修改，避免不必要的重新加载
        try {
            if (fs.existsSync(this.filePath)) {
                const stats = fs.statSync(this.filePath);
                if (this._lastModified && stats.mtimeMs <= this._lastModified) {
                    // 文件没有被修改，跳过重新加载
                    return this;
                }
                this._lastModified = stats.mtimeMs;
            }
        } catch (e) {
            // 忽略 stat 错误，继续加载
        }
        this._loadFileSync();
        return this;
    }

    async write() {
        this._saveFile();
        // 关键：等待 KV 保存完成，确保响应返回前数据已落库
        // （Serverless 实例可能在响应后立即冻结，不能依赖后台定时器）
        await this.flush();
    }

    async flush() {
        await this._pendingKvSave;
    }
}

const db = new SimpleJSONDB(dbPath, defaults);

let bannedIPs = new Set();

// ==================== KV 存储的 CSRF + Rate Limit + Nonce 防护 ====================
const CSRF_TOKEN_TTL = 15 * 60 * 1000; // 15分钟过期（防重放，原1小时太长）
const NONCE_TTL = 5 * 60 * 1000;        // nonce 5分钟过期

// 内存 Map 作为本地降级（KV不可用时使用）
const _localCsrf = new Map();
const _localRateLimit = new Map();
const _localNonces = new Map();
const _localCaptcha = new Map();

// ---------- KV 辅助：统一封装 set/get/del，自动降级 ----------
async function _kvGet(key) {
    if (KV_ENABLED && kv) {
        try { return await kv.get(key); } catch (e) { /* 降级 */ }
    }
    return _localMapGet(key);
}
async function _kvSet(key, value, ttlMs) {
    if (KV_ENABLED && kv) {
        try {
            if (ttlMs) await kv.set(key, value, { ex: Math.ceil(ttlMs / 1000) });
            else await kv.set(key, value);
            return;
        } catch (e) { /* 降级 */ }
    }
    _localMapSet(key, value, ttlMs);
}
async function _kvDel(key) {
    if (KV_ENABLED && kv) {
        try { await kv.del(key); return; } catch (e) { /* 降级 */ }
    }
    _localMapDel(key);
}
// 本地 Map 带 TTL 清理
function _localMapGet(key) {
    if (key.startsWith('csrf:')) {
        const r = _localCsrf.get(key);
        if (r && Date.now() < r.expires) return r;
        _localCsrf.delete(key); return null;
    }
    if (key.startsWith('rate:')) {
        const r = _localRateLimit.get(key);
        if (r && Date.now() < r.expires) return r;
        _localRateLimit.delete(key); return null;
    }
    if (key.startsWith('nonce:')) {
        const r = _localNonces.get(key);
        if (r && Date.now() < r.expires) return r;
        _localNonces.delete(key); return null;
    }
    if (key.startsWith('captcha:')) {
        const r = _localCaptcha.get(key);
        if (r && Date.now() < r.expires) return r;
        _localCaptcha.delete(key); return null;
    }
    return null;
}
function _localMapSet(key, value, ttlMs) {
    const expires = Date.now() + (ttlMs || 3600000);
    if (key.startsWith('csrf:')) _localCsrf.set(key, { ...value, expires });
    else if (key.startsWith('rate:')) _localRateLimit.set(key, { ...value, expires });
    else if (key.startsWith('nonce:')) _localNonces.set(key, { ...value, expires });
    else if (key.startsWith('captcha:')) _localCaptcha.set(key, { ...value, expires });
}
function _localMapDel(key) {
    if (key.startsWith('csrf:')) _localCsrf.delete(key);
    else if (key.startsWith('rate:')) _localRateLimit.delete(key);
    else if (key.startsWith('nonce:')) _localNonces.delete(key);
    else if (key.startsWith('captcha:')) _localCaptcha.delete(key);
}

// ---------- 人机验证（图形验证码，KV 存储，支持多实例） ----------
const CAPTCHA_TTL = 5 * 60 * 1000;          // 验证码有效期 5 分钟
const CAPTCHA_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去除易混淆字符 I/L/O/0/1
const CAPTCHA_LEN = 4;

// 生成随机验证码文本
function generateCaptchaCode() {
    let code = '';
    for (let i = 0; i < CAPTCHA_LEN; i++) {
        code += CAPTCHA_CHARSET[Math.floor(Math.random() * CAPTCHA_CHARSET.length)];
    }
    return code;
}

// 生成 SVG 验证码图片（无需第三方图形库）
function generateCaptchaSVG(code) {
    const w = 150, h = 50;
    const chars = code.split('');
    const colors = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#db2777'];

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
    // 背景
    svg += `<rect width="${w}" height="${h}" fill="#f1f5f9" rx="8"/>`;
    // 干扰线
    for (let i = 0; i < 5; i++) {
        const x1 = Math.floor(Math.random() * w), y1 = Math.floor(Math.random() * h);
        const x2 = Math.floor(Math.random() * w), y2 = Math.floor(Math.random() * h);
        svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${colors[Math.floor(Math.random() * colors.length)]}" stroke-width="${(Math.random() * 1.5 + 0.5).toFixed(1)}" opacity="0.5"/>`;
    }
    // 噪点
    for (let i = 0; i < 30; i++) {
        const x = Math.floor(Math.random() * w), y = Math.floor(Math.random() * h);
        svg += `<circle cx="${x}" cy="${y}" r="${(Math.random() * 1.5 + 0.5).toFixed(1)}" fill="${colors[Math.floor(Math.random() * colors.length)]}" opacity="0.6"/>`;
    }
    // 字符（随机位置、旋转、颜色）
    const step = w / (chars.length + 1);
    chars.forEach((ch, i) => {
        const x = step * (i + 1) + (Math.random() * 8 - 4);
        const y = 33 + Math.random() * 8;
        const rot = Math.random() * 40 - 20;
        const size = 28 + Math.random() * 6;
        const color = colors[Math.floor(Math.random() * colors.length)];
        svg += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size.toFixed(1)}" font-family="Arial, sans-serif" font-weight="bold" fill="${color}" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})">${ch}</text>`;
    });
    svg += '</svg>';
    return svg;
}

// 生成验证码：存入 KV（绑定 sessionID），返回 SVG 字符串
async function createCaptcha(sessionId) {
    const code = generateCaptchaCode();
    const key = `captcha:${sessionId}`;
    await _kvSet(key, { code, expires: Date.now() + CAPTCHA_TTL }, CAPTCHA_TTL);
    return generateCaptchaSVG(code);
}

// 校验验证码：单次使用（无论对错都销毁，防暴力）
async function verifyCaptcha(sessionId, input) {
    if (!input || typeof input !== 'string') return false;
    const key = `captcha:${sessionId}`;
    const record = await _kvGet(key);
    await _kvDel(key); // 单次使用：校验一次即作废
    if (!record) return false;
    if (Date.now() > record.expires) return false;
    return record.code.toUpperCase() === input.trim().toUpperCase();
}

// 中间件：要求请求携带正确的验证码
function requireCaptcha(req, res, next) {
    const sid = req.sessionID || (req.cookies && req.cookies['connect.sid']) || crypto.randomUUID();
    verifyCaptcha(sid, req.body && req.body.captcha).then(ok => {
        if (!ok) {
            return res.status(400).json({ success: false, message: '人机验证失败，请重新输入图形验证码' });
        }
        next();
    }).catch(err => {
        console.error('[CAPTCHA] 校验异常:', err);
        res.status(500).json({ success: false, message: '验证码校验失败，请重试' });
    });
}

// ---------- 通用 Rate Limit（KV 存储，支持多实例） ----------
/**
 * 通用限流函数
 * @param {string} key - 限流唯一键（如 rate:login:1.2.3.4）
 * @param {number} max - 窗口内最大请求数
 * @param {number} windowMs - 时间窗口（毫秒）
 * @returns {Promise<{allowed:boolean, remaining:number, resetAt:number}>}
 */
async function rateLimitCheck(key, max, windowMs) {
    const now = Date.now();
    const record = await _kvGet(key);
    if (!record || now > record.expires) {
        await _kvSet(key, { count: 1, expires: now + windowMs }, windowMs);
        return { allowed: true, remaining: max - 1, resetAt: now + windowMs };
    }
    if (record.count >= max) {
        return { allowed: false, remaining: 0, resetAt: record.expires };
    }
    record.count++;
    await _kvSet(key, record, record.expires - now);
    return { allowed: true, remaining: max - record.count, resetAt: record.expires };
}

// 全局通用限流（非敏感接口，较宽松）
const GLOBAL_RATE_MAX = 120;
const GLOBAL_RATE_WINDOW = 60000;

// 敏感接口限流配置
const RATE_CONFIGS = {
    login:        { max: 5,   window: 60 * 1000 },        // 登录：1分钟5次
    register:     { max: 3,   window: 60 * 1000 },        // 注册：1分钟3次
    verifyCode:   { max: 3,   window: 60 * 1000 },        // 发验证码：1分钟3次
    messages:     { max: 10,  window: 60 * 1000 },        // 留言：1分钟10条
    tasks:        { max: 10,  window: 60 * 1000 },        // 发任务：1分钟10条
    email:        { max: 5,   window: 60 * 1000 },        // 发邮件：1分钟5封
    invite:       { max: 5,   window: 60 * 1000 },        // 邀请码申请：1分钟5次
    admin:        { max: 60,  window: 60 * 1000 },        // 管理操作：1分钟60次
    password:     { max: 3,   window: 60 * 1000 },        // 改密：1分钟3次
    ai:           { max: 20,  window: 60 * 1000 },        // AI 对话：1分钟20次
};

function requireRateLimit(type) {
    const cfg = RATE_CONFIGS[type] || { max: GLOBAL_RATE_MAX, window: GLOBAL_RATE_WINDOW };
    return async (req, res, next) => {
        const ip = getClientIP(req);
        const key = `rate:${type}:${ip}`;
        const result = await rateLimitCheck(key, cfg.max, cfg.window);
        res.setHeader('X-RateLimit-Limit', cfg.max);
        res.setHeader('X-RateLimit-Remaining', result.remaining);
        res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));
        if (!result.allowed) {
            const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
            res.setHeader('Retry-After', retryAfter);
            return res.status(429).json({
                success: false,
                message: `请求过于频繁，请 ${retryAfter} 秒后再试`
            });
        }
        next();
    };
}

// ---------- CSRF Token（KV 存储 + 短过期 + 单次使用防重放） ----------
function generateCSRFToken(sessionId) {
    const token = crypto.randomBytes(32).toString('hex');
    const key = `csrf:${sessionId}`;
    _kvSet(key, { token, expires: Date.now() + CSRF_TOKEN_TTL, used: false }, CSRF_TOKEN_TTL).catch(() => {});
    return token;
}

async function validateCSRFToken(sessionId, token) {
    const key = `csrf:${sessionId}`;
    const record = await _kvGet(key);
    if (!record) return false;
    if (Date.now() > record.expires) {
        await _kvDel(key);
        return false;
    }
    if (record.token !== token) return false;
    // 单次使用：验证成功后立即删除（防抓包重放）
    await _kvDel(key);
    return true;
}

// ---------- Nonce 校验（防重放攻击的第二道防线） ----------
/**
 * 生成 nonce 给客户端，客户端每次写请求带 unique nonce
 * 服务端记录用过的 nonce，5 分钟内重复使用直接拒绝
 */
async function useNonce(sessionId, nonce) {
    if (!nonce || typeof nonce !== 'string' || nonce.length < 8) return false;
    const key = `nonce:${sessionId}:${nonce}`;
    const existing = await _kvGet(key);
    if (existing) return false; // 已使用过
    await _kvSet(key, { usedAt: Date.now() }, NONCE_TTL);
    return true;
}

function requireCSRF(req, res, next) {
    const token = req.headers['x-csrf-token'] || req.body._csrf;
    const nonce = req.headers['x-request-nonce'] || req.body._nonce;

    if (!token) {
        return res.status(403).json({ success: false, message: '缺少CSRF Token' });
    }
    // 写操作必须带 nonce（防重放）
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && !nonce) {
        return res.status(403).json({ success: false, message: '缺少请求Nonce' });
    }

    (async () => {
        const sid = req.sessionID || (req.cookies && req.cookies['connect.sid']) || crypto.randomUUID();
        if (nonce) {
            const nonceOk = await useNonce(sid, nonce);
            if (!nonceOk) {
                return res.status(403).json({ success: false, message: '请求已过期或已被重放' });
            }
        }
        const ok = await validateCSRFToken(sid, token);
        if (!ok) {
            return res.status(403).json({ success: false, message: 'CSRF Token无效或已过期，请刷新页面重试' });
        }
        next();
    })().catch(err => {
        console.error('[CSRF] 校验异常:', err);
        res.status(500).json({ success: false, message: '安全校验失败' });
    });
}

// ---------- XSS 输入过滤 ----------
/**
 * 严格 HTML/JS 转义，防止 XSS 攻击
 * 额外移除 <script>、onxxx=、javascript: 等危险模式
 */
function xssEscape(str) {
    if (str == null) return '';
    if (typeof str !== 'string') str = String(str);
    // 1. 先移除危险的脚本/事件模式（不区分大小写）
    str = str.replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '');
    str = str.replace(/<\s*iframe[^>]*>[\s\S]*?<\s*\/\s*iframe\s*>/gi, '');
    str = str.replace(/\bon\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    str = str.replace(/\bjavascript\s*:/gi, '');
    str = str.replace(/\bvbscript\s*:/gi, '');
    str = str.replace(/\bdata\s*:\s*text\/html/gi, '');
    str = str.replace(/<\s*(img|svg|video|audio|object|embed|link|meta|style)[^>]*>/gi, '');
    // 2. HTML 实体转义
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/`/g, '&#96;')
        .replace(/\//g, '&#x2F;');
}

/**
 * 递归过滤对象中的所有字符串字段（用于 req.body）
 */
function sanitizeObject(obj) {
    if (obj == null) return obj;
    if (typeof obj === 'string') return xssEscape(obj);
    if (Array.isArray(obj)) return obj.map(sanitizeObject);
    if (typeof obj === 'object') {
        const clean = {};
        for (const k of Object.keys(obj)) {
            clean[k] = sanitizeObject(obj[k]);
        }
        return clean;
    }
    return obj;
}

// 中间件：自动过滤 req.body / req.query / req.params 中的字符串
function xssFilter(req, res, next) {
    if (req.body) req.body = sanitizeObject(req.body);
    if (req.query) req.query = sanitizeObject(req.query);
    if (req.params) req.params = sanitizeObject(req.params);
    next();
}

// ---------- HTTP 方法白名单 ----------
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);
function methodWhitelist(req, res, next) {
    if (!ALLOWED_METHODS.has(req.method)) {
        res.setHeader('Allow', [...ALLOWED_METHODS].join(', '));
        return res.status(405).json({ success: false, message: '不支持的请求方法' });
    }
    next();
}

const dataCache = new Map();
const CACHE_TTL = 5000;

function getCachedData(key, fetchFn) {
    const cached = dataCache.get(key);
    if (cached && Date.now() < cached.expires) {
        return Promise.resolve(cached.data);
    }
    return fetchFn().then(data => {
        dataCache.set(key, { data, expires: Date.now() + CACHE_TTL });
        return data;
    });
}

function invalidateCache(key) {
    dataCache.delete(key);
}

function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function validateUsername(username) {
    return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

function validatePassword(password) {
    return password.length >= 6;
}

function getClientIP(req) {
    return req.headers['cf-connecting-ip'] || 
           req.headers['x-vercel-forwarded-for'] ||
           req.headers['x-real-ip'] ||
           req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
           req.connection?.remoteAddress || 
           req.socket?.remoteAddress ||
           '127.0.0.1';
}

var generateLogId = (function() {
    var lastTimestamp = 0;
    var seq = 0;
    return function() {
        var timestamp = Date.now();
        if (timestamp === lastTimestamp) {
            seq++;
        } else {
            lastTimestamp = timestamp;
            seq = 0;
        }
        return timestamp + '-' + String(seq).padStart(3, '0');
    };
})();

function addServerLog(message, type) {
    type = type || 'info';
    var entry = {
        id: generateLogId(),
        time: new Date().toISOString(),
        message: String(message),
        type: type
    };
    serverLogs.push(entry);
    if (serverLogs.length > MAX_LOG_COUNT) {
        serverLogs.shift();
    }
    sseClients.forEach(function(client) {
        try { client.write('data: ' + JSON.stringify(entry) + '\n\n'); } catch(e) {}
    });
}

var originalConsoleLog = console.log;
console.log = function() {
    var args = Array.prototype.slice.call(arguments);
    originalConsoleLog.apply(console, args);
    addServerLog(args.map(function(a) { return typeof a === 'object' ? JSON.stringify(a) : String(a); }).join(' '));
};

var originalConsoleError = console.error;
console.error = function() {
    var args = Array.prototype.slice.call(arguments);
    originalConsoleError.apply(console, args);
    addServerLog(args.map(function(a) { return typeof a === 'object' ? JSON.stringify(a) : String(a); }).join(' '), 'error');
};

const uploadsDir = (process.env.VERCEL || process.env.RAILWAY) ? '/tmp/uploads' : (isZeabur ? '/data/uploads' : 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// 安全修复：补充 .html/.htm/.svg 等可被浏览器直接执行/包含脚本的类型，防止上传后形成存储型 XSS
const dangerousExtensions = ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.vbs', '.js', '.jar', '.msi', '.dll', '.scr', '.pif', '.com', '.html', '.htm', '.svg', '.xhtml', '.shtml']; 

// 修复文件名编码（latin1 → utf8）
function fixFilenameEncoding(filename) {
    if (!filename) return filename;
    try {
        // 检查是否已经是正确的 UTF-8 字符
        // 如果包含 latin1 编码的特征字符，则转换
        const decoded = Buffer.from(filename, 'latin1').toString('utf8');
        // 验证是否是有效的 UTF-8
        if (Buffer.from(decoded, 'utf8').toString('utf8') === decoded && 
            !decoded.includes('\uFFFD') && 
            !/[\u0000-\u001F\u007F-\u009F]/.test(decoded)) {
            return decoded;
        }
        return filename;
    } catch (e) {
        return filename;
    }
}

function sanitizeFilename(filename) {
    const sanitized = filename
        .replace(/[\/\\]/g, '_')
        .replace(/[<>:"|?*]/g, '_')
        .replace(/\.\./g, '_');
    
    const ext = path.extname(sanitized).toLowerCase();
    if (dangerousExtensions.includes(ext)) {
        return sanitized.replace(ext, '_dangerous_' + ext);
    }
    
    return sanitized;
}

const fileFilter = function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (dangerousExtensions.includes(ext)) {
        return cb(new Error('不允许上传可执行文件'), false);
    }
    
    cb(null, true);
};

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        // 处理中文文件名编码（latin1 → utf8）
        let originalname = file.originalname;
        try {
            originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
        } catch (e) {
            // 保持原名
        }
        const extname = path.extname(originalname);
        const basename = sanitizeFilename(path.basename(originalname, extname));
        cb(null, uniqueSuffix + '-' + basename + extname);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: IS_VERCEL ? 50 * 1024 * 1024 : 2 * 1024 * 1024 * 1024
    },
    fileFilter: fileFilter
});

app.set('trust proxy', 1);

// 1. HTTP 方法白名单（只允许必要方法）
app.use(methodWhitelist);

// 2. 安全响应头（严格版）
app.use((req, res, next) => {
    // 防止 MIME 类型嗅探
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // 防止点击劫持
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // XSS 防护（老式浏览器兼容）
    res.setHeader('X-XSS-Protection', '1; mode=block');
    // Referrer 策略
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // HTTPS 强制跳转（HSTS，365天，含子域）
    if (isProduction || isVercel || isZeabur) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    // 功能权限策略（禁用危险浏览器 API）
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=(), bluetooth=(), magnetometer=(), accelerometer=(), gyroscope=()');
    // 严格 CSP（放宽了 inline 以兼容现有前端代码）
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self' https:",
            "script-src 'self' 'unsafe-inline' https:",
            "style-src 'self' 'unsafe-inline' https:",
            "img-src 'self' data: blob: https:",
            "font-src 'self' https: data:",
            "connect-src 'self' https: wss:",
            "frame-ancestors 'self'",
            "base-uri 'self'",
            "form-action 'self'",
            "object-src 'none'",
            "worker-src 'self' blob:",
            "media-src 'self' https: blob:",
            "manifest-src 'self'"
        ].join('; ')
    );
    // 跨域隔离（可选，防止 Spectre 类攻击）
    // res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    // res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
});

// 3. 全局通用限流（基于 KV，支持多实例；静态资源和 SSE 日志流放行）
app.use(async (req, res, next) => {
    const isStatic = /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map|wasm)$/i.test(req.path);
    const isSSE = req.path.startsWith('/api/logs') || req.path.startsWith('/api/events');
    if (isStatic || isSSE) return next();

    const ip = getClientIP(req);
    const key = `rate:global:${ip}`;
    const result = await rateLimitCheck(key, GLOBAL_RATE_MAX, GLOBAL_RATE_WINDOW);
    res.setHeader('X-RateLimit-Limit', GLOBAL_RATE_MAX);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));
    if (!result.allowed) {
        const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({
            success: false,
            message: `请求过于频繁，请 ${retryAfter} 秒后再试`
        });
    }
    next();
});

// 4. Cookie 解析
app.use(cookieParser());

// 5. 请求体大小限制（防止大请求攻击）
// JSON body 最大 100KB，urlencoded 表单最大 100KB，文件上传走 multer 单独限制
app.use(express.json({ limit: '100kb', strict: true }));
app.use(express.urlencoded({ extended: true, limit: '100kb', parameterLimit: 100 }));

// 6. XSS 输入过滤（所有入站字符串自动转义）
app.use(xssFilter);

var serverLogs = [];
const MAX_LOG_COUNT = 1000;

var sseClients = [];
var siteEventsClients = []; // 公开事件客户端（用于网站锁定通知）

const sessionDir = path.join(runtimeDir, 'sessions');
if (!fs.existsSync(sessionDir)) {
    try { fs.mkdirSync(sessionDir, { recursive: true }); } catch (e) {}
}

// 安全修复：所有密钥必须通过环境变量提供，未设置时使用进程内随机值。
// 生产环境请务必配置 SESSION_SECRET / TOKEN_SECRET 环境变量，否则重启/多实例会导致会话与 token 失效。
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

// 自定义 Session Store：将 session 数据加密后存储在客户端 cookie 中
// 解决 Vercel Serverless 跨实例 session 不共享的问题
// 数据量较大时自动分片存储
class CookieStore extends session.Store {
    constructor(options = {}) {
        super(options);
        this.secret = options.secret || SESSION_SECRET;
    }

    async get(sid, callback) {
        try {
            const data = await this._readFromCookie(sid);
            callback(null, data || null);
        } catch (e) {
            callback(e);
        }
    }

    async set(sid, sessionData, callback) {
        try {
            await this._writeToCookie(sid, sessionData);
            callback && callback(null);
        } catch (e) {
            callback && callback(e);
        }
    }

    async destroy(sid, callback) {
        try {
            await this._clearCookie(sid);
            callback && callback(null);
        } catch (e) {
            callback && callback(e);
        }
    }

    // 需要在请求上下文中使用 req/res
    _getRequestContext() {
        return CookieStore._currentContext;
    }

    async _readFromCookie(sid) {
        const ctx = this._getRequestContext();
        if (!ctx || !ctx.req) return null;
        
        const chunks = [];
        const prefix = 'sess_';
        const pattern = new RegExp('^' + prefix + sid + '_(\\d+)$');
        
        for (const [name, value] of Object.entries(ctx.req.cookies || {})) {
            const match = name.match(pattern);
            if (match) {
                chunks.push({ index: parseInt(match[1]), value });
            }
        }
        
        if (chunks.length === 0) return null;
        
        chunks.sort((a, b) => a.index - b.index);
        const dataStr = chunks.map(c => c.value).join('');
        
        try {
            // 解密并解析
            const decipher = crypto.createDecipher('aes-256-cbc', this.secret);
            let decrypted = decipher.update(dataStr, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return JSON.parse(decrypted);
        } catch (e) {
            // 可能未加密
            try {
                return JSON.parse(dataStr);
            } catch (e2) {
                return null;
            }
        }
    }

    async _writeToCookie(sid, sessionData) {
        const ctx = this._getRequestContext();
        if (!ctx || !ctx.res) return;

        // 序列化并加密
        let dataStr = JSON.stringify(sessionData);
        try {
            const cipher = crypto.createCipher('aes-256-cbc', this.secret);
            dataStr = cipher.update(dataStr, 'utf8', 'hex') + cipher.final('hex');
        } catch (e) {
            // 加密失败则明文存储（仅开发环境）
        }

        const prefix = 'sess_';
        const cookieName = prefix + sid;
        const maxAge = 24 * 60 * 60 * 1000; // 24小时

        // 如果数据较短，直接存储
        if (dataStr.length <= 3500) {
            ctx.res.cookie(cookieName, dataStr, {
                maxAge,
                httpOnly: false,
                secure: true,
                sameSite: 'none',
                path: '/'
            });
            // 清除旧分片
            Object.keys(ctx.req.cookies || {}).forEach(name => {
                if (name.startsWith(cookieName + '_')) {
                    ctx.res.clearCookie(name, { path: '/' });
                }
            });
            return;
        }

        // 分片存储（每片约3000字符）
        const chunkSize = 3000;
        const chunks = [];
        for (let i = 0; i < dataStr.length; i += chunkSize) {
            chunks.push(dataStr.substring(i, i + chunkSize));
        }

        chunks.forEach((chunk, index) => {
            ctx.res.cookie(`${cookieName}_${index}`, chunk, {
                maxAge,
                httpOnly: false,
                secure: true,
                sameSite: 'none',
                path: '/'
            });
        });

        // 清除旧数据
        Object.keys(ctx.req.cookies || {}).forEach(name => {
            if (name.startsWith(cookieName + '_') && !name.match(new RegExp('^' + cookieName + '_\\d+$'))) {
                ctx.res.clearCookie(name, { path: '/' });
            }
        });
    }

    async _clearCookie(sid) {
        const ctx = this._getRequestContext();
        if (!ctx || !ctx.res) return;

        const prefix = 'sess_';
        const cookieName = prefix + sid;
        ctx.res.clearCookie(cookieName, { path: '/' });

        Object.keys(ctx.req.cookies || {}).forEach(name => {
            if (name.startsWith(cookieName + '_')) {
                ctx.res.clearCookie(name, { path: '/' });
            }
        });
    }

    // 中间件用于设置请求上下文
    static contextMiddleware(req, res, next) {
        CookieStore._currentContext = { req, res };
        // 清除旧上下文
        res.on('finish', () => {
            if (CookieStore._currentContext && CookieStore._currentContext.req === req) {
                CookieStore._currentContext = null;
            }
        });
        next();
    }
}

CookieStore._currentContext = null;

// 统一的 session 配置
const sessionConfig = {
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: IS_VERCEL || isProduction,
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: false,
        sameSite: IS_VERCEL || isProduction ? 'none' : 'lax',
        path: '/'
    }
};

if (IS_VERCEL) {
    // Vercel 环境：完全依赖 token 认证（Authorization header）
    // 不使用 CookieStore，避免 session 数据分片 cookie 累积导致 494 REQUEST_HEADER_TOO_LARGE
    // session 仅作辅助，认证以 token 为准（见 authUser 中间件）
    console.log('[SESSION] Vercel 环境：使用默认内存存储 + token 认证');
} else if (FileStore) {
    // 本地环境：使用文件存储
    try {
        sessionConfig.store = new FileStore({
            path: path.join(__dirname, 'sessions'),
            ttl: 7 * 24 * 60 * 60,
            reapInterval: 3600
        });
        console.log('[SESSION] 本地环境：使用文件存储');
    } catch (e) {
        console.warn('[SESSION] FileStore 初始化失败，降级为内存存储:', e.message);
    }
} else {
    console.log('[SESSION] 默认内存存储');
}

app.use(session(sessionConfig));

// 清理旧的 CookieStore 分片 cookie（历史遗留，会导致 494 REQUEST_HEADER_TOO_LARGE）
app.use((req, res, next) => {
    const staleCookies = Object.keys(req.cookies || {}).filter(k => k.startsWith('sess_'));
    if (staleCookies.length > 0) {
        console.log('[CLEANUP] 清理旧 session 分片 cookie:', staleCookies.length, '个');
        staleCookies.forEach(name => {
            res.clearCookie(name, { path: '/', secure: true, sameSite: 'none' });
        });
    }
    next();
});

// 确保每个请求前 KV 数据已加载（Vercel Serverless 多实例共享数据的关键）
app.use(async (req, res, next) => {
    try {
        await db.read();
    } catch (e) {
        console.warn('[DB] 加载失败:', e.message);
    }
    next();
});

// 响应结束后兜底刷新 KV 写入：覆盖通过 Proxy 隐式触发保存（未显式调用 db.write）的写操作
app.use((req, res, next) => {
    res.on('finish', () => {
        db.flush().catch(() => {});
    });
    next();
});

// Logto 认证路由（等待 SDK 初始化完成）
// 注意：Logto Router 内部已经处理了 /logto/ 前缀，所以直接挂在根路径下
app.use(async (req, res, next) => {
    // 只处理 /logto/ 开头的请求
    if (!req.path.startsWith('/logto')) return next();
    
    try {
        await initLogto();
        return logtoHandleAuthRoutes(req, res, next);
    } catch (e) {
        console.error('[LOGTO] 路由错误:', e.message);
        return res.status(500).send('Logto SDK 加载失败');
    }
});

// Logto 登录回调成功后，通过 API 检查认证状态并生成 token
app.get('/api/auth/logto/check', async (req, res) => {
    try {
        await initLogto();
        // 使用 withLogto 中间件获取用户信息
        logtoWithLogto(LOGTO_CONFIG, req, res, async () => {
            try {
                if (!req.user || !req.user.isAuthenticated) {
                    return res.json({ authenticated: false });
                }
                
                const claims = req.user.claims;
                const logtoSub = claims.sub;
                const logtoUsername = claims.username || claims.email || logtoSub;
                const logtoEmail = claims.email || '';
                
                // 查找或创建用户
                await db.read();
                let user = db.data.users.find(u => u.logto_sub === logtoSub);
                
                if (!user) {
                    // 检查邮箱是否已注册
                    if (logtoEmail) {
                        user = db.data.users.find(u => u.email === logtoEmail);
                        if (user) {
                            // 关联已有账号
                            user.logto_sub = logtoSub;
                            await db.write();
                        }
                    }
                }
                
                if (!user) {
                    // 创建新用户
                    user = {
                        id: Date.now().toString(),
                        username: logtoUsername,
                        email: logtoEmail,
                        password_hash: '',
                        is_admin: false,
                        is_super_admin: false,
                        logto_sub: logtoSub,
                        created_at: new Date().toISOString(),
                        last_login: new Date().toISOString(),
                        last_login_ip: getClientIP(req)
                    };
                    db.data.users.push(user);
                    await db.write();
                } else {
                    // 更新登录信息
                    user.last_login = new Date().toISOString();
                    user.last_login_ip = getClientIP(req);
                    await db.write();
                }
                
                // 生成 token
                const token = Buffer.from(JSON.stringify({
                    userId: user.id,
                    username: user.username,
                    email: user.email || '',
                    isAdmin: user.is_admin,
                    isSuperAdmin: user.is_super_admin,
                    ts: Date.now()
                })).toString('base64');
                
                res.json({ authenticated: true, token: token, username: user.username });
            } catch (e) {
                console.error('[LOGTO] 检查认证失败:', e);
                res.json({ authenticated: false, error: 'logto_check_error' });
            }
        });
    } catch (e) {
        console.error('[LOGTO] 检查错误:', e);
        res.json({ authenticated: false, error: 'logto_error' });
    }
});

app.use((req, res, next) => {
    const authHeader = req.headers.authorization || req.headers['x-auth-token'];
    let authUser = null;
    
    if (authHeader) {
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
        try {
            const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
            // 安全修复：token 必须携带由 TOKEN_SECRET 生成的 HMAC-SHA256 签名。
            // 无签名 / 签名不匹配 / 篡改过权限字段的 token 一律拒绝，防止伪造管理员。
            const { sig, ...payload } = decoded;
            if (!sig || !payload.userId || !payload.ts) {
                throw new Error('missing signature or fields');
            }
            const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET)
                .update(JSON.stringify(payload))
                .digest('base64url');
            if (sig !== expectedSig) {
                throw new Error('invalid signature');
            }
            if (Date.now() - payload.ts >= 24 * 60 * 60 * 1000) {
                throw new Error('expired');
            }
            authUser = {
                id: payload.userId,
                username: payload.username,
                email: payload.email || '',
                is_admin: !!payload.isAdmin,
                is_super_admin: !!payload.isSuperAdmin
            };
        } catch (e) {
            console.warn('[AUTH] token 验证失败:', e.message);
        }
    }
    
    req.authUser = authUser;
    req.isAuthenticated = !!authUser;

    // 仅在 session 缺失或关键字段不一致时才同步，避免每次请求都触发 Set-Cookie
    if (authUser && req.session.userId !== authUser.id) {
        req.session.userId = authUser.id;
        req.session.username = authUser.username;
        req.session.isAdmin = authUser.is_admin;
        req.session.isSuperAdmin = authUser.is_super_admin;
    }
    
    // 生成 token 的辅助函数（HMAC-SHA256 签名，防伪造）
    req.generateAuthToken = (user) => {
        const tokenData = {
            userId: user.id,
            username: user.username,
            email: user.email || '',
            isAdmin: user.is_admin,
            isSuperAdmin: user.is_super_admin,
            ts: Date.now()
        };
        tokenData.sig = crypto.createHmac('sha256', TOKEN_SECRET)
            .update(JSON.stringify(tokenData))
            .digest('base64url');
        return Buffer.from(JSON.stringify(tokenData)).toString('base64');
    };
    
    next();
});

app.use(express.static(path.join(__dirname, 'public'), {
    extensions: ['html', 'htm'],
    index: 'index.html',
    // 防止浏览器缓存旧版 HTML（如验证码功能更新后仍显示旧页面）
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// 处理无扩展名的HTML页面访问
app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
        let pathname = decodeURIComponent(req.path);
        if (pathname.endsWith('/')) pathname = pathname.slice(0, -1);
        
        if (pathname && !pathname.includes('.') && !pathname.startsWith('/api/') && !pathname.startsWith('/css/') && !pathname.startsWith('/js/') && !pathname.startsWith('/avatars/') && !pathname.startsWith('/uploads/')) {
            const filePath = path.join(__dirname, 'public', pathname + '.html');
            if (fs.existsSync(filePath)) {
                return res.sendFile(filePath);
            }
        }
    }
    next();
});

async function initDatabase() {
    await db.read();
    
    if (!db.data) {
        db.data = {
            users: [],
            tasks: [],
            messages: [],
            invite_codes: [],
            invite_requests: [],
            banned_ips: [],
            verification_codes: [],
            emails: [],
            emailAttachments: [],
            emailFolders: [],
            inviteApplications: [],
            inviteCodes: [],
            bannedIPs: []
        };
        await db.write();
    }
    
    // 确保所有必需的字段都存在（与 defaults 完全一致）
    if (!Array.isArray(db.data.users)) db.data.users = [];
    if (!Array.isArray(db.data.tasks)) db.data.tasks = [];
    if (!Array.isArray(db.data.messages)) db.data.messages = [];
    if (!Array.isArray(db.data.invite_codes)) db.data.invite_codes = [];
    if (!Array.isArray(db.data.invite_requests)) db.data.invite_requests = [];
    if (!Array.isArray(db.data.banned_ips)) db.data.banned_ips = [];
    if (!Array.isArray(db.data.verification_codes)) db.data.verification_codes = [];
    if (!Array.isArray(db.data.emails)) db.data.emails = [];
    if (!Array.isArray(db.data.emailAttachments)) db.data.emailAttachments = [];
    if (!Array.isArray(db.data.emailFolders)) db.data.emailFolders = [];
    if (!Array.isArray(db.data.inviteApplications)) db.data.inviteApplications = [];
    if (!Array.isArray(db.data.inviteCodes)) db.data.inviteCodes = [];
    if (!Array.isArray(db.data.bannedIPs)) db.data.bannedIPs = [];
    if (!Array.isArray(db.data.ai_conversations)) db.data.ai_conversations = [];
    await db.write();
    
    // 安全修复：不再自动创建硬编码管理员账号（原 REDACTED_USER/REDACTED 凭据已从源码移除）。
    // 超级管理员统一由 ensureAdminUser() 根据环境变量 ADMIN_USERNAME/ADMIN_PASSWORD 创建。
    // 注意：数据库中已存在的旧账号不会自动删除，请登录后在管理后台修改密码，或修改对应数据。
    
    if (!db.data.verification_codes) {
        db.data.verification_codes = [];
        await db.write();
    }
}

async function loadBannedIPs() {
    await db.read();
    if (db.data.banned_ips) {
        bannedIPs = new Set(db.data.banned_ips);
    }
}

function isSafePath(filePath, allowedDir) {
    const resolvedPath = path.resolve(filePath);
    const resolvedAllowedDir = path.resolve(allowedDir);
    return resolvedPath.startsWith(resolvedAllowedDir);
}

// 统一的用户获取函数（支持 session 和 authUser 两种方式）
// 核心策略：token 已经验证了用户身份和权限，直接使用 authUser 作为用户对象
async function getCurrentUser(req) {
    // Vercel 环境：每次尝试重新加载数据库，确保数据最新
    if (IS_VERCEL) {
        try {
            await db.read();
        } catch (e) {
            console.warn('[AUTH] 数据库重新加载失败:', e.message);
        }
    }
    
    // 优先使用 authUser（从 token 解析，最可靠）
    if (req.authUser && req.authUser.id) {
        // 先尝试从数据库查找完整用户信息
        let user = db.data.users.find(u => u.id === req.authUser.id);
        if (user) {
            // 仅在 session 缺失时同步，避免每次请求都触发 Set-Cookie
            if (!req.session.userId) {
                req.session.userId = user.id;
                req.session.username = user.username;
                req.session.isAdmin = user.is_admin;
                req.session.isSuperAdmin = user.is_super_admin;
            }
            return user;
        }

        // 安全修复：数据库中找不到用户时拒绝认证。
        // 绝不能信任 token 中携带的 isAdmin/isSuperAdmin 字段，否则可伪造任意管理员 token。
        console.warn('[AUTH] 数据库中未找到用户，拒绝认证:', req.authUser.id, req.authUser.username);
        return null;
    }
    
    // 如果没有 authUser，尝试用 session
    if (req.session.userId) {
        let user = db.data.users.find(u => u.id === req.session.userId);
        if (user) return user;
        return null;
    }
    
    return null;
}

const requireLogin = async (req, res, next) => {
    const user = await getCurrentUser(req);
    if (!user) {
        console.log('[AUTH] requireLogin 失败，session.userId:', req.session.userId, 'authUser:', req.authUser?.id);
        console.log('[AUTH] 数据库用户数:', db.data.users?.length || 0);
        console.log('[AUTH] Authorization header:', req.headers.authorization ? 'present' : 'missing');
        return res.status(403).json({ 
            error: '请先登录',
            debug: {
                hasAuthHeader: !!req.headers.authorization,
                hasAuthUser: !!req.authUser,
                authUserId: req.authUser?.id || null,
                sessionUserId: req.session.userId || null,
                dbUserCount: db.data.users?.length || 0
            }
        });
    }
    req.currentUser = user;
    next();
};

const requireAdmin = async (req, res, next) => {
    const user = await getCurrentUser(req);
    if (!user) {
        console.log('[AUTH] requireAdmin 失败，session.userId:', req.session.userId, 'authUser:', req.authUser?.id);
        console.log('[AUTH] 数据库用户数:', db.data.users?.length || 0);
        console.log('[AUTH] Authorization header:', req.headers.authorization ? 'present' : 'missing');
        return res.status(403).json({ 
            error: '请先登录',
            debug: {
                hasAuthHeader: !!req.headers.authorization,
                hasAuthUser: !!req.authUser,
                authUserId: req.authUser?.id || null,
                authUsername: req.authUser?.username || null,
                sessionUserId: req.session.userId || null,
                dbUserCount: db.data.users?.length || 0
            }
        });
    }
    if (!user.is_admin && !user.is_super_admin) {
        console.log('[AUTH] requireAdmin 权限不足，用户:', user.username, 'is_admin:', user.is_admin, 'is_super_admin:', user.is_super_admin);
        return res.status(403).json({ error: '权限不足' });
    }
    req.currentUser = user;
    next();
};

const requireSuperAdmin = async (req, res, next) => {
    const user = await getCurrentUser(req);
    if (!user) {
        return res.status(403).json({ error: '请先登录' });
    }
    if (!user.is_super_admin) {
        return res.status(403).json({ error: '权限不足' });
    }
    req.currentUser = user;
    next();
};

app.get('/', (req, res) => {
    res.redirect('/home');
});

app.get('/home', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/about', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'about.html'));
});

app.get('/products', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'products.html'));
});

app.get('/members', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'members.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/user', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'user.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/reaction', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reaction.html'));
});

app.get('/ai', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ai-chat.html'));
});

app.get('/terms', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

// 数据库锁定检查中间件（必须在所有API路由之前）
app.use((req, res, next) => {
    // 检查所有API请求（包括读取和写入）
    const apiPaths = ['/api/'];
    
    if (apiPaths.some(p => req.path.startsWith(p))) {
        // 排除解锁和状态查询API
        const excludedPaths = ['/api/admin/db-unlock', '/api/admin/db-status', '/api/admin/db-lock', '/api/admin/backup', '/api/admin/backup-info', '/api/admin/site-lock', '/api/admin/site-unlock', '/api/admin/site-status', '/api/login', '/api/logout', '/api/user', '/api/csrf-token'];
        if (!excludedPaths.includes(req.path) && dbLocked) {
            return res.status(503).json({
                success: false,
                message: '数据库已锁定: ' + dbLockReason,
                locked: true
            });
        }
    }
    
    next();
});

// ============== 超级管理员回退机制 ==============
// 确保数据库中始终存在超级管理员用户（Vercel环境数据库可能为空）
async function ensureAdminUser() {
    if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
        return;
    }
    
    await db.read();
    
    // 检查是否已存在超级管理员
    const existingAdmin = db.data.users.find(u => u.is_super_admin);
    if (existingAdmin) {
        // 确保管理员存在于所有Vercel实例
        // 如果存在但密码不对，不修改（用户可能已改过密码）
        return;
    }
    
    // 从环境变量创建超级管理员
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminEmail = process.env.ADMIN_EMAIL || adminUsername;
    
    // 检查用户名是否已存在（不是超级管理员的话升级）
    let user = db.data.users.find(u => u.username === adminUsername);
    
    if (user) {
        // 升级为超级管理员
        user.is_admin = true;
        user.is_super_admin = true;
        if (adminEmail && !user.email) {
            user.email = adminEmail;
        }
        console.log('[ADMIN] 用户 ' + adminUsername + ' 已升级为超级管理员');
    } else {
        // 创建新的超级管理员
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        
        user = {
            id: crypto.randomUUID(),
            username: adminUsername,
            email: adminEmail,
            password: hashedPassword,
            is_admin: true,
            is_super_admin: true,
            status: 'active',
            created_at: new Date().toISOString()
        };
        
        db.data.users.push(user);
        console.log('[ADMIN] 已创建超级管理员: ' + adminUsername);
    }
    
    await db.write();
}

// 启动时初始化管理员
ensureAdminUser().catch(err => console.error('[ADMIN] 初始化管理员失败:', err));

// 调试端点（无需认证，用于诊断Vercel环境问题）
app.get('/api/debug', async (req, res) => {
    try {
        await db.read();
        
        const users = db.data.users || [];
        const hasAdmin = users.some(u => u.is_super_admin);
        const hasAdminUsername = users.some(u => u.username === process.env.ADMIN_USERNAME);
        
        res.json({
            status: 'ok',
            vercel: IS_VERCEL,
            kvEnabled: db._kvEnabled,
            kvLoaded: db._kvLoaded,
            dbFileExists: require('fs').existsSync(dbPath),
            dbFilePath: dbPath,
            taskCount: (db.data.tasks || []).length,
            userCount: users.length,
            hasSuperAdmin: hasAdmin,
            hasAdminUsername: hasAdminUsername,
            adminUsername: process.env.ADMIN_USERNAME || 'not-set',
            users: users.map(u => ({
                username: u.username,
                is_admin: u.is_admin,
                is_super_admin: u.is_super_admin,
                status: u.status
            })),
            envVars: {
                VERCEL: process.env.VERCEL,
                VERCEL_URL: process.env.VERCEL_URL,
                SITE_URL: process.env.SITE_URL,
                hasAdminEnv: !!(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD)
            },
            session: {
                userId: req.session.userId,
                username: req.session.username,
                isAdmin: req.session.isAdmin,
                isSuperAdmin: req.session.isSuperAdmin,
                id: req.sessionID,
                storeType: IS_VERCEL ? 'CookieStore' : (FileStore ? 'FileStore' : 'MemoryStore'),
                cookieKeys: Object.keys(req.cookies || {}).filter(k => k.startsWith('sess_'))
            },
            authUser: req.authUser ? {
                id: req.authUser.id,
                username: req.authUser.username,
                is_admin: req.authUser.is_admin,
                is_super_admin: req.authUser.is_super_admin
            } : null,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        res.status(500).json({
            status: 'error',
            message: e.message,
            stack: IS_VERCEL ? 'hidden' : e.stack
        });
    }
});

// 认证测试端点（通过 fetchWithAuth 调用，测试 token 是否有效）
app.get('/api/auth-test', async (req, res) => {
    const user = await getCurrentUser(req);
    res.json({
        authenticated: !!user,
        user: user ? {
            id: user.id,
            username: user.username,
            email: user.email,
            is_admin: user.is_admin,
            is_super_admin: user.is_super_admin
        } : null,
        authUser: req.authUser ? {
            id: req.authUser.id,
            username: req.authUser.username,
            is_admin: req.authUser.is_admin,
            is_super_admin: req.authUser.is_super_admin
        } : null,
        hasAuthHeader: !!req.headers.authorization,
        sessionUserId: req.session.userId || null
    });
});

app.post('/api/login', requireRateLimit('login'), requireCSRF, requireCaptcha, async (req, res) => {
    const { username, password, code, loginType } = req.body;
    
    if (!username && loginType !== 'code') {
        return res.status(400).json({ success: false, message: '请填写用户名' });
    }
    
    if (loginType === 'password' && !password) {
        return res.status(400).json({ success: false, message: '请填写密码' });
    }
    
    if (loginType === 'code' && !code) {
        return res.status(400).json({ success: false, message: '请填写验证码' });
    }
    
    const MAX_FAILED_ATTEMPTS = 3;     // 最多尝试3次
    const LOCK_DURATION_MS = 5 * 60 * 1000; // 锁定5分钟

    // 验证码登录不需要用户名
    let user;
    if (loginType === 'code') {
        // 从验证码记录中获取邮箱对应的用户
        const emailCode = db.data.verification_codes.find(c => c.code === code);
        if (emailCode) {
            user = db.data.users.find(u => u.email === emailCode.email);
        }
        if (!user) {
            return res.status(400).json({ success: false, message: '验证码错误' });
        }
        
        if (Date.now() > emailCode.expires) {
            return res.status(400).json({ success: false, message: '验证码已过期' });
        }
        
        db.data.verification_codes = db.data.verification_codes.filter(c => c.email !== user.email);
    } else {
        user = db.data.users.find(u => u.username === username || u.email === username);
    }
    
    // Vercel 回退机制：如果用户不存在且是密码登录，检查环境变量中的管理员凭据
    if (!user && loginType === 'password' && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
        const adminUsername = process.env.ADMIN_USERNAME;
        const adminPassword = process.env.ADMIN_PASSWORD;
        
        // 检查用户名是否匹配
        if (username === adminUsername) {
            // 验证密码
            if (password === adminPassword) {
                console.log('[LOGIN] 使用环境变量回退凭据登录:', username);
                
                // 确保管理员用户存在于数据库（即时创建）
                await ensureAdminUser();
                
                // 重新加载数据库获取用户
                await db.read();
                user = db.data.users.find(u => u.username === adminUsername);
                
                if (!user) {
                    // 如果ensureAdminUser没有成功创建，直接创建
                    user = {
                        id: crypto.randomUUID(),
                        username: adminUsername,
                        email: process.env.ADMIN_EMAIL || adminUsername,
                        password: bcrypt.hashSync(adminPassword, 10),
                        is_admin: true,
                        is_super_admin: true,
                        status: 'active',
                        login_attempts: 0,
                        locked_until: 0,
                        created_at: new Date().toISOString()
                    };
                    db.data.users.push(user);
                    await db.write();
                    console.log('[LOGIN] 即时创建管理员用户:', adminUsername);
                }
            }
        }
    }
    
    if (!user) {
        return res.status(400).json({ success: false, message: '用户名或密码错误' });
    }
    
    if (user.is_banned) {
        return res.status(400).json({ success: false, message: '账号已被封禁，请联系管理员' });
    }

    // 检查临时锁定状态（5分钟锁定）
    if (user.locked_until && Date.now() < user.locked_until) {
        const remainSec = Math.ceil((user.locked_until - Date.now()) / 1000);
        const remainMin = Math.ceil(remainSec / 60);
        return res.status(400).json({
            success: false,
            message: `密码错误次数过多，账号已锁定，请 ${remainMin} 分钟后再试（还剩 ${remainSec} 秒）`
        });
    }
    // 锁定时间已过，清除历史计数
    if (user.locked_until && Date.now() >= user.locked_until) {
        user.login_attempts = 0;
        user.locked_until = 0;
    }
    
    if (loginType === 'password') {
        if (!bcrypt.compareSync(password, user.password)) {
            // 密码错误：累加计数
            user.login_attempts = (user.login_attempts || 0) + 1;
            let lockMsg = '';
            if (user.login_attempts >= MAX_FAILED_ATTEMPTS) {
                // 达到阈值：锁定5分钟
                user.locked_until = Date.now() + LOCK_DURATION_MS;
                lockMsg = `（连续错误 ${user.login_attempts} 次，账号已锁定 5 分钟）`;
                // 重置计数，避免下次解除后立刻又被锁
                user.login_attempts = 0;
            } else {
                const left = MAX_FAILED_ATTEMPTS - user.login_attempts;
                lockMsg = `（还剩 ${left} 次尝试机会，超过将锁定 5 分钟）`;
            }
            await db.write();
            return res.status(400).json({ success: false, message: '用户名或密码错误' + lockMsg });
        }
        
        // 密码正确：清除失败计数与锁定
        user.login_attempts = 0;
        user.locked_until = 0;
        await db.write();
    }
    // 验证码登录在前面已验证通过，也清除锁定计数
    if (loginType === 'code') {
        user.login_attempts = 0;
        user.locked_until = 0;
        await db.write();
    }
    
    // 检查网站是否被锁定
    if (siteLocked && !user.is_admin && !user.is_super_admin) {
        return res.status(503).json({ 
            success: false, 
            message: '网站已锁定，暂时无法登录',
            locked: true,
            lockBy: siteLockBy,
            lockReason: siteLockReason
        });
    }
    
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.isAdmin = user.is_admin;
    req.session.isSuperAdmin = user.is_super_admin;
    req.session.loginIP = getClientIP(req);
    
    // 更新用户最后登录IP和时间
    user.lastLoginIp = getClientIP(req);
    user.lastLoginTime = new Date().toISOString();
    await db.write();
    
    // 始终生成并返回 token（前端存储到 localStorage）
    const token = req.generateAuthToken(user);
    console.log('[LOGIN] 生成 token 给用户:', user.username, 'IS_VERCEL:', IS_VERCEL);
    res.json({ 
        success: true, 
        message: '登录成功', 
        token: token,
        user: { id: user.id, username: user.username, email: user.email, is_admin: user.is_admin, is_super_admin: user.is_super_admin } 
    });
});

// IP检查中间件 - 检测异地登录
app.use('/api/', (req, res, next) => {
    // 跳过不需要登录的API
    const publicPaths = ['/api/login', '/api/register', '/api/send-code', '/api/csrf-token', '/api/verification'];
    if (publicPaths.includes(req.path) || req.path.startsWith('/api/logs')) {
        return next();
    }

    // Vercel/Serverless 环境下跳过 IP 检查：
    // 1. CDN 和负载均衡会使 x-vercel-forwarded-for 等IP头不稳定
    // 2. 认证已由 Authorization header (token) 提供，IP 检查意义不大
    if (IS_VERCEL) {
        return next();
    }

    // 如果没有登录，跳过
    if (!req.session.userId) {
        return next();
    }

    const currentIP = getClientIP(req);
    const loginIP = req.session.loginIP;

    // 如果有记录的登录IP且不匹配，说明异地登录了
    if (loginIP && currentIP !== loginIP) {
        // 清除session
        req.session.destroy((err) => {
            return res.status(401).json({
                error: '账号已在其他设备登录，请重新登录',
                relogin: true
            });
        });
        return;
    }

    next();
});

// 网站锁定检查中间件
app.use('/api/', (req, res, next) => {
    // 跳过公开API和管理员API
    const publicPaths = ['/api/login', '/api/register', '/api/send-code', '/api/csrf-token', '/api/verification', '/api/admin/site-lock', '/api/admin/site-unlock', '/api/admin/site-status'];
    if (publicPaths.includes(req.path) || req.path.startsWith('/api/logs') || req.path.startsWith('/api/admin/')) {
        return next();
    }
    
    // 如果网站被锁定
    if (siteLocked) {
        // 检查用户是否是管理员
        if (req.session.userId) {
            const user = db.data.users.find(u => u.id === req.session.userId);
            if (user && (user.is_admin || user.is_super_admin)) {
                // 管理员可以继续操作
                return next();
            }
        }
        
        // 非管理员被拒绝
        return res.status(503).json({ 
            error: '网站已锁定',
            locked: true,
            lockBy: siteLockBy,
            lockReason: siteLockReason
        });
    }
    
    next();
});

app.post('/api/register', requireRateLimit('register'), requireCSRF, requireCaptcha, async (req, res) => {
    const { username, email, password, invite_code, verify_code } = req.body;
    
    if (!username || !email || !password || !verify_code) {
        return res.status(400).json({ success: false, message: '请填写所有字段' });
    }
    
    if (!validateUsername(username)) {
        return res.status(400).json({ success: false, message: '用户名格式不正确' });
    }
    
    if (!validateEmail(email)) {
        return res.status(400).json({ success: false, message: '邮箱格式不正确' });
    }
    
    if (!validatePassword(password)) {
        return res.status(400).json({ success: false, message: '密码长度至少6位' });
    }
    
    const emailCode = db.data.verification_codes.find(c => c.email === email && c.code === verify_code);
    
    if (!emailCode) {
        return res.status(400).json({ success: false, message: '验证码错误' });
    }
    
    if (Date.now() > emailCode.expires) {
        return res.status(400).json({ success: false, message: '验证码已过期' });
    }
    
    if (db.data.users.find(u => u.username === username)) {
        return res.status(400).json({ success: false, message: '用户名已存在' });
    }
    
    if (db.data.users.find(u => u.email === email)) {
        return res.status(400).json({ success: false, message: '该邮箱已被注册' });
    }
    
    if (invite_code) {
        const invite = db.data.invite_codes.find(c => c.code === invite_code && !c.used);
        if (!invite) {
            return res.status(400).json({ success: false, message: '邀请码无效或已使用' });
        }
        invite.used = true;
        invite.used_by = email;
        invite.used_at = new Date().toISOString();
    }
    
    const hash = bcrypt.hashSync(password, 10);
    db.data.users.push({
        id: Date.now(),
        username: username,
        email: email,
        password: hash,
        is_admin: false,
        is_super_admin: false,
        is_banned: false,
        login_attempts: 0,
        created_at: new Date().toISOString()
    });
    
    db.data.verification_codes = db.data.verification_codes.filter(c => c.email !== email);
    await db.write();
    
    res.json({ success: true, message: '注册成功' });
});

app.post('/api/logout', requireCSRF, (req, res) => {
    // 清除客户端 token
    req.session.destroy((err) => {
        if (err) console.error('[LOGOUT] Session 销毁失败:', err);
        // 清除所有 session cookie
        const sessCookies = Object.keys(req.cookies || {}).filter(k => k.startsWith('sess_'));
        sessCookies.forEach(name => {
            res.clearCookie(name, { path: '/' });
        });
        res.json({ success: true, message: '登出成功' });
    });
});

app.get('/api/csrf-token', (req, res) => {
    // 强制创建/保持 session：saveUninitialized:false 下仅 touch 不会下发 cookie，
    // 必须给 session 赋值才会触发 Set-Cookie，否则 CSRF token 绑定的 sessionID
    // 在两次请求间不一致，导致校验永远失败。
    try {
        if (req.session) req.session._csrfAt = Date.now();
    } catch (e) {
        // 忽略失败
    }
    const token = generateCSRFToken(req.sessionID);
    res.json({ success: true, csrfToken: token });
});

// 人机验证码图片（SVG，无 cookie 依赖，答案存 KV 绑定 sessionID）
app.get('/api/captcha', (req, res) => {
    // 强制保持 sessionID 稳定（同 csrf-token 的原因）
    try {
        if (req.session) req.session._captchaAt = Date.now();
    } catch (e) { /* 忽略 */ }
    const sid = req.sessionID || (req.cookies && req.cookies['connect.sid']) || crypto.randomUUID();
    createCaptcha(sid).then(svg => {
        res.set('Content-Type', 'image/svg+xml; charset=utf-8');
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.send(svg);
    }).catch(err => {
        console.error('[CAPTCHA] 生成失败:', err);
        res.status(500).send('captcha error');
    });
});

// ==================== AI 对话（SenseNova） ====================
const https = require('https');
const SENSENOVA_BASE_URL = process.env.SENSENOVA_BASE_URL || 'https://token.sensenova.cn/v1';
const SENSENOVA_API_KEY = process.env.SENSENOVA_API_KEY || '';
const SENSENOVA_DEFAULT_MODEL = process.env.SENSENOVA_MODEL || 'sensenova-6.7-flash-lite';
const AI_ALLOWED_MODELS = ['sensenova-6.7-flash-lite', 'sensenova-6.8-flash-lite', 'glm-5.2', 'deepseek-v4-flash'];
const AI_MAX_MESSAGES = 12;   // 最多携带的历史消息条数（控制请求体大小，加快响应）
const AI_MAX_CONTENT = 2000;  // 单条消息最长字符数
const AI_MAX_TOTAL = 8000;    // 所有消息总字符上限（超出只保留最近）

// 查找当前用户的 AI 会话
function findAIConv(req, id) {
    const list = db.data.ai_conversations || [];
    return list.find(c => c.id === id && c.user_id === String(req.currentUser.id));
}

// 规范化 AI 消息：支持纯文本与多模态（content 数组）两种格式
function normalizeAIMessages(messages) {
    return messages.slice(-AI_MAX_MESSAGES).map(m => {
        const role = m.role === 'assistant' ? 'assistant' : 'user';
        const text = typeof m.content === 'string' ? m.content : (m.content || '');
        const images = Array.isArray(m.images) ? m.images.slice(0, 4) : [];
        if (role === 'user' && images.length) {
            const content = [{ type: 'text', text: text.slice(0, AI_MAX_CONTENT) }];
            for (const img of images) {
                const url = typeof img === 'string' ? img : (img.data ? `data:${img.mime || 'image/jpeg'};base64,${img.data}` : '');
                if (url && url.length < 4 * 1024 * 1024) content.push({ type: 'image_url', image_url: { url } });
            }
            return { role, content };
        }
        return { role, content: text.slice(0, AI_MAX_CONTENT) };
    }).filter(m => {
        if (typeof m.content === 'string') return m.content.length > 0;
        return Array.isArray(m.content) && m.content.length > 0;
    });
}

// ==================== AI 技能市场 ====================
const AI_SKILLS = [
    { id: 'code', name: '编程专家', icon: '💻', desc: '编写、调试、优化代码，讲解算法与架构', system: '你是资深软件工程师。优先给出完整、可直接运行的代码示例，并解释关键实现。涉及技术选型时给出对比和建议。' },
    { id: 'translate', name: '翻译官', icon: '🌐', desc: '中英互译，提供地道自然的表达', system: '你是专业翻译。逐句提供准确、地道的翻译，必要时附上简短的语法或文化注释。中译英时追求自然，英译中时保持原意。' },
    { id: 'writer', name: '文案写手', icon: '✍️', desc: '周报、通知、宣传文案、演讲稿', system: '你是资深文案。能撰写周报、通知、宣传文案、演讲稿等。文字简洁有感染力，结构清晰，符合中文职场表达习惯。' },
    { id: 'idea', name: '点子王', icon: '💡', desc: '头脑风暴、创意策划、方案建议', system: '你是创意策划专家。面对问题时给出多个有差异化的方案，并简要评估优劣。思维活跃但不脱离实际，鼓励大胆想法。' },
    { id: 'study', name: '学习导师', icon: '📚', desc: '深入浅出讲解概念，举一反三', system: '你是耐心的学习导师。用生活化的类比讲解概念，由浅入深，并出练习题帮助巩固，最后给出总结。' },
    { id: 'life', name: '生活助手', icon: '🎯', desc: '日程规划、健康饮食、生活小妙招', system: '你是贴心的生活助手。帮助规划日程、推荐健康饮食、提供实用生活技巧。建议具体、可执行。' }
];

// 用户技能状态（存储在用户对象上）
function getUserAISkills(user) {
    if (!user.ai_skills || typeof user.ai_skills !== 'object') user.ai_skills = { installed: [], active: null };
    if (!Array.isArray(user.ai_skills.installed)) user.ai_skills.installed = [];
    return user.ai_skills;
}

// 获取用户当前启用的技能定义
function getActiveSkill(user) {
    const st = getUserAISkills(user);
    if (!st.active || !st.installed.includes(st.active)) return null;
    return AI_SKILLS.find(k => k.id === st.active) || null;
}

app.get('/api/ai/skills', requireLogin, (req, res) => {
    const st = getUserAISkills(req.currentUser);
    const skills = AI_SKILLS.map(k => ({ id: k.id, name: k.name, icon: k.icon, desc: k.desc, installed: st.installed.includes(k.id) }));
    res.json({ success: true, data: { skills, activeSkillId: (st.installed.includes(st.active) ? st.active : null) } });
});

app.post('/api/ai/skills/:id/install', requireLogin, requireRateLimit('ai'), requireCSRF, async (req, res) => {
    const skill = AI_SKILLS.find(k => k.id === req.params.id);
    if (!skill) return res.status(404).json({ success: false, message: '技能不存在' });
    const st = getUserAISkills(req.currentUser);
    if (!st.installed.includes(skill.id)) {
        st.installed.push(skill.id);
        if (!st.active) st.active = skill.id;
        await db.write();
    }
    res.json({ success: true, data: { installed: st.installed, activeSkillId: st.active } });
});

app.post('/api/ai/skills/:id/uninstall', requireLogin, requireRateLimit('ai'), requireCSRF, async (req, res) => {
    const skill = AI_SKILLS.find(k => k.id === req.params.id);
    if (!skill) return res.status(404).json({ success: false, message: '技能不存在' });
    const st = getUserAISkills(req.currentUser);
    st.installed = st.installed.filter(x => x !== skill.id);
    if (st.active === skill.id) st.active = null;
    await db.write();
    res.json({ success: true, data: { installed: st.installed, activeSkillId: st.active } });
});

app.post('/api/ai/skills/:id/activate', requireLogin, requireRateLimit('ai'), requireCSRF, async (req, res) => {
    const st = getUserAISkills(req.currentUser);
    if (!st.installed.includes(req.params.id)) return res.status(400).json({ success: false, message: '请先安装该技能' });
    st.active = req.params.id;
    await db.write();
    res.json({ success: true, data: { activeSkillId: st.active } });
});

// ==================== AI 图片/视频生成（Pollinations 免 Key） ====================
const POLLINATIONS_IMAGE = 'https://image.pollinations.ai/prompt/';
const AI_IMAGE_BLOCK = ['裸体', '裸照', '色情', '性感写真', '儿童色情', '血腥', '暴力', '恐怖袭击', '枪支', '毒品', '自杀', '赌博'];
const AI_GEN_MODEL = process.env.AI_GEN_MODEL || 'flux';

// 构造 Pollinations 图片 URL（图片在浏览器加载时实时生成）
function aiImageUrl(prompt, size, seed) {
    const parts = (size || '1024x1024').toLowerCase().split('x');
    const params = ['nologo=true', 'safe=true', 'model=' + AI_GEN_MODEL];
    if (parts[0] && /^\d+$/.test(parts[0])) params.push('width=' + parseInt(parts[0]));
    if (parts[1] && /^\d+$/.test(parts[1])) params.push('height=' + parseInt(parts[1]));
    if (seed !== undefined) params.push('seed=' + seed);
    return POLLINATIONS_IMAGE + encodeURIComponent(prompt) + '?' + params.join('&');
}

// 生成内容安全检查
function checkGenPrompt(prompt) {
    const p = (prompt || '').trim();
    if (!p) return '缺少内容描述';
    if (p.length > 300) return '描述过长（最多 300 字）';
    for (const w of AI_IMAGE_BLOCK) {
        if (p.toLowerCase().includes(w)) return '内容涉及不适宜生成的主题，请重新描述';
    }
    return null;
}

app.post('/api/ai/generate-image', requireLogin, requireRateLimit('ai'), requireCSRF, (req, res) => {
    const { prompt, size } = req.body || {};
    const err = checkGenPrompt(prompt);
    if (err) return res.status(400).json({ success: false, message: err });
    const url = aiImageUrl(prompt.trim().slice(0, 300), size || '1024x1024');
    res.json({ success: true, data: { url, size: size || '1024x1024' } });
});

// 视频生成：返回多帧动画序列（前端 canvas 合成播放 / 录制 WebM）
app.post('/api/ai/generate-video', requireLogin, requireRateLimit('ai'), requireCSRF, (req, res) => {
    const { prompt } = req.body || {};
    const err = checkGenPrompt(prompt);
    if (err) return res.status(400).json({ success: false, message: err });
    const p = prompt.trim().slice(0, 200);
    const FRAMES = 8;
    const frames = [];
    for (let i = 0; i < FRAMES; i++) {
        const fp = 'cinematic AI animation of ' + p + ', motion frame ' + (i + 1) + ' of ' + FRAMES + ', smooth subtle motion, film still';
        frames.push(aiImageUrl(fp, '768x768', 1000 + i));
    }
    res.json({ success: true, data: { frames, fps: 8 } });
});

// ==================== 上下文压缩（长对话自动摘要） ====================
const AI_COMPRESS_THRESHOLD = 6000; // 超过该字符数触发压缩
const ctxSummaryCache = new Map();  // 指纹 -> 摘要（避免重复压缩调用）

function aiMsgTextLen(m) {
    if (typeof m.content === 'string') return m.content.length;
    if (Array.isArray(m.content)) return m.content.reduce((s, p) => s + (p && p.text ? p.text.length : 0), 0);
    return 0;
}

// 单条消息标准化（不截断条数，压缩用）
function stdAIMessage(m) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const text = typeof m.content === 'string' ? m.content : (m.content || '');
    const images = Array.isArray(m.images) ? m.images.slice(0, 4) : [];
    if (role === 'user' && images.length) {
        const content = [{ type: 'text', text: text.slice(0, AI_MAX_CONTENT) }];
        for (const img of images) {
            const url = typeof img === 'string' ? img : (img.data ? `data:${img.mime || 'image/jpeg'};base64,${img.data}` : '');
            if (url && url.length < 4 * 1024 * 1024) content.push({ type: 'image_url', image_url: { url } });
        }
        return { role, content };
    }
    return { role, content: text.slice(0, AI_MAX_CONTENT) };
}

// 调用上游模型生成历史摘要（非流式）
function aiSummarize(history) {
    return new Promise((resolve, reject) => {
        const transcript = history.map(m =>
            (m.role === 'user' ? '用户' : '助手') + '：' +
            (typeof m.content === 'string' ? m.content : (m.content || []).map(p => (p && p.text) || '[图片]').join(' '))
        ).join('\n');
        const body = JSON.stringify({
            model: SENSENOVA_DEFAULT_MODEL,
            messages: [{ role: 'user', content: '请把下面的对话历史压缩成一段简洁的中文摘要，保留用户需求、关键结论、重要数据与代码要点。只输出摘要，不要任何解释和前缀：\n\n' + transcript.slice(-16000) }],
            temperature: 0.3,
            max_tokens: 500,
            stream: false
        });
        const uReq = https.request(`${SENSENOVA_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SENSENOVA_API_KEY}`, 'Content-Length': Buffer.byteLength(body) },
            timeout: 30000
        }, (uRes) => {
            let buf = '';
            uRes.on('data', c => buf += c);
            uRes.on('end', () => {
                try {
                    const j = JSON.parse(buf);
                    const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
                    resolve(c ? c.trim() : '');
                } catch (e) { resolve(''); }
            });
        });
        uReq.on('timeout', () => uReq.destroy(new Error('上游摘要请求超时')));
        uReq.on('error', (e) => reject(e));
        uReq.write(body);
        uReq.end();
    });
}

// 智能压缩历史：超长时把早期消息压成摘要
async function compressAIHistory(msgs) {
    let total = 0;
    for (const m of msgs) total += aiMsgTextLen(m);
    if (total <= AI_COMPRESS_THRESHOLD || msgs.length <= 4) return { messages: msgs, compressed: false };

    const keep = msgs.slice(-2);      // 保留最近 2 条
    const hist = msgs.slice(0, -2);   // 更早的用于压缩
    if (!hist.length) return { messages: msgs, compressed: false };

    const key = crypto.createHash('md5').update(hist.map(m => m.role + ':' + aiMsgTextLen(m)).join('|')).digest('hex');
    let summary = ctxSummaryCache.get(key);
    if (!summary) {
        try { summary = await aiSummarize(hist); } catch (e) { summary = ''; }
        if (summary) {
            ctxSummaryCache.set(key, summary);
            if (ctxSummaryCache.size > 80) ctxSummaryCache.delete(ctxSummaryCache.keys().next().value);
        }
    }
    if (!summary) return { messages: msgs, compressed: false };
    return {
        messages: [{ role: 'user', content: '【以下为更早对话的自动摘要，请视为真实对话上下文】' + summary.slice(0, 1200) }, ...keep],
        compressed: true
    };
}

// 会话列表（不携带完整消息，避免数据量过大）
app.get('/api/ai/conversations', requireLogin, async (req, res) => {
    const list = (db.data.ai_conversations || [])
        .filter(c => c.user_id === String(req.currentUser.id))
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
        .slice(0, 100)
        .map(c => ({
            id: c.id,
            title: c.title || '新对话',
            updated_at: c.updated_at,
            message_count: (c.messages || []).length
        }));
    res.json({ success: true, data: list });
});

// 会话详情
app.get('/api/ai/conversations/:id', requireLogin, async (req, res) => {
    const conv = findAIConv(req, req.params.id);
    if (!conv) return res.status(404).json({ success: false, message: '会话不存在' });
    res.json({ success: true, data: { id: conv.id, title: conv.title || '新对话', messages: conv.messages || [] } });
});

// 新建会话
app.post('/api/ai/conversations', requireLogin, requireRateLimit('ai'), requireCSRF, async (req, res) => {
    const conv = {
        id: 'ai_' + Date.now().toString(36) + Math.random().toString(16).slice(2, 8),
        user_id: String(req.currentUser.id),
        title: (req.body && req.body.title) ? String(req.body.title).slice(0, 30) : '新对话',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        messages: []
    };
    if (!Array.isArray(db.data.ai_conversations)) db.data.ai_conversations = [];
    db.data.ai_conversations.push(conv);
    await db.write();
    res.json({ success: true, data: { id: conv.id, title: conv.title } });
});

// 删除会话
app.delete('/api/ai/conversations/:id', requireLogin, requireRateLimit('ai'), requireCSRF, async (req, res) => {
    const before = (db.data.ai_conversations || []).length;
    db.data.ai_conversations = (db.data.ai_conversations || []).filter(c => !(c.id === req.params.id && c.user_id === String(req.currentUser.id)));
    await db.write();
    if (db.data.ai_conversations.length === before) {
        return res.status(404).json({ success: false, message: '会话不存在' });
    }
    res.json({ success: true });
});

// AI 对话：流式转发 SenseNova（OpenAI 兼容接口），仅登录用户可用
// 支持：thinking 模式（deep/fast）、多模态图片消息、会话历史保存
app.post('/api/ai/chat', requireLogin, requireRateLimit('ai'), requireCSRF, async (req, res) => {
    console.log('[AI] 收到对话请求, model=', req.body && req.body.model, 'conv=', req.body && req.body.conversationId, 'thinking=', req.body && req.body.thinking);
    try {
        if (!SENSENOVA_API_KEY) {
            return res.status(500).json({ success: false, message: '服务器尚未配置 SenseNova API Key（SENSENOVA_API_KEY）' });
        }
        const { messages, model, conversationId, thinking, mode, skillId } = req.body || {};
        if (!Array.isArray(messages) || !messages.length) {
            return res.status(400).json({ success: false, message: '缺少对话内容' });
        }

        // thinking 模式：deep 优先带推理链的模型；fast 优先更快的模型
        let chosenModel;
        if (model && AI_ALLOWED_MODELS.includes(model)) {
            chosenModel = model;
        } else {
            chosenModel = (thinking === 'fast') ? 'deepseek-v4-flash' : SENSENOVA_DEFAULT_MODEL;
        }

        // 组装系统提示词（基础人格 + 技能 + 编程模式）
        let systemPrompt = '你是STC工会任务平台的AI助手，由商汤日日新（SenseNova）大模型提供技术支持。请用简洁、友好的中文回答问题，涉及代码时给出完整可运行的示例。可以分析用户上传的图片。';
        const activeSkill = (skillId && AI_SKILLS.find(k => k.id === skillId && getUserAISkills(req.currentUser).installed.includes(skillId)))
            || getActiveSkill(req.currentUser);
        if (activeSkill) {
            systemPrompt += '\n\n【当前启用技能：' + activeSkill.name + '】\n' + activeSkill.system;
        }
        if (mode === 'code') {
            systemPrompt += '\n\n【编程模式】请以资深工程师的方式工作：优先给出完整可运行的代码，注意边界情况与安全性，必要时给出调用示例与测试。';
        }

        // 规范化消息（过滤前端传入的 system，系统提示词由后端统一组装）
        const stdMsgs = messages.filter(m => m.role !== 'system').map(stdAIMessage).filter(m => {
            if (typeof m.content === 'string') return m.content.length > 0;
            return Array.isArray(m.content) && m.content.length > 0;
        });

        // 智能上下文压缩：长对话自动摘要（压缩后通过 SSE 通知前端）
        let ctxCompressed = false;
        let safeMessages = stdMsgs;
        try {
            const c = await compressAIHistory(stdMsgs);
            safeMessages = c.messages;
            ctxCompressed = c.compressed;
        } catch (e) {
            console.error('[AI] 上下文压缩失败:', e.message);
        }

        // 总字符超限兜底：只保留最近的消息
        let totalChars = safeMessages.reduce((s, m) => {
            if (typeof m.content === 'string') return s + m.content.length;
            return s + m.content.reduce((x, part) => x + (part.text ? part.text.length : 0), 0);
        }, 0);
        while (totalChars > AI_MAX_TOTAL && safeMessages.length > 2) {
            const dropped = safeMessages.splice(1, 1)[0];
            const droppedLen = typeof dropped.content === 'string' ? dropped.content.length
                : dropped.content.reduce((x, part) => x + (part.text ? part.text.length : 0), 0);
            totalChars -= droppedLen;
        }
        safeMessages = safeMessages.slice(-AI_MAX_MESSAGES);

        // 使用 https 模块转发上游（长驻进程下 fetch/undici 不稳定，改用核心模块）
        const upstreamBody = JSON.stringify({
            model: chosenModel,
            messages: [{ role: 'system', content: systemPrompt }, ...safeMessages],
            temperature: 0.7,
            stream: true
        });

        // 待保存的会话消息（流式结束后写入）
        let userText = '';
        let userImages = [];
        const userMsg = Array.isArray(messages) && messages.length ? messages[messages.length - 1] : null;
        if (userMsg && userMsg.role !== 'assistant') {
            userText = typeof userMsg.content === 'string' ? userMsg.content : '';
            userImages = Array.isArray(userMsg.images) ? userMsg.images.slice(0, 4) : [];
        }
        let fullContent = '';
        let fullReasoning = '';

        await new Promise((resolve) => {
            const uReq = https.request(`${SENSENOVA_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SENSENOVA_API_KEY}`,
                    'Content-Length': Buffer.byteLength(upstreamBody)
                },
                timeout: 60000
            }, (uRes) => {
                if (uRes.statusCode >= 200 && uRes.statusCode < 300) {
                    // 流式透传 SSE，同时累积正文与推理链
                    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
                    res.setHeader('Cache-Control', 'no-cache, no-transform');
                    res.setHeader('Connection', 'keep-alive');
                    res.setHeader('X-Accel-Buffering', 'no');
                    res.flushHeaders();
                    // 通知前端：已自动压缩早前对话
                    if (ctxCompressed) {
                        try {
                            res.write('data: ' + JSON.stringify({ type: 'ctx_compressed', message: '📦 对话较长，已自动压缩早前内容并保留关键信息' }) + '\n\n');
                        } catch (e) {}
                    }
                    uRes.on('data', (chunk) => {
                        try { res.write(chunk); } catch (e) {}
                        try {
                            const lines = chunk.toString('utf-8').split('\n');
                            for (const line of lines) {
                                if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
                                const payload = line.slice(5).trim();
                                if (!payload) continue;
                                const j = JSON.parse(payload);
                                const delta = j.choices && j.choices[0] && j.choices[0].delta;
                                if (delta) {
                                    if (delta.content) fullContent += delta.content;
                                    if (delta.reasoning) fullReasoning += delta.reasoning;
                                }
                            }
                        } catch (e) { /* 忽略解析失败 */ }
                    });
                    uRes.on('end', async () => {
                        try { res.end(); } catch (e) {}
                        // 流结束：保存会话
                        if (conversationId && (userText || userImages.length || fullContent)) {
                            try {
                                const conv = findAIConv(req, conversationId);
                                if (conv) {
                                    if (!Array.isArray(conv.messages)) conv.messages = [];
                                    if (conv.messages.length === 0 && (conv.title === '新对话' || !conv.title)) {
                                        conv.title = (userText || '新对话').slice(0, 20);
                                    }
                                    conv.messages.push({ role: 'user', content: userText, images: userImages, ts: Date.now() });
                                    conv.messages.push({ role: 'assistant', content: fullContent, thinking: fullReasoning || undefined, ts: Date.now() });
                                    conv.updated_at = new Date().toISOString();
                                    if (conv.messages.length > 200) conv.messages = conv.messages.slice(-200);
                                    await db.write();
                                }
                            } catch (e) { console.error('[AI] 保存会话失败:', e.message); }
                        }
                        resolve();
                    });
                } else {
                    let errBody = '';
                    uRes.on('data', (c) => { errBody += c; });
                    uRes.on('end', () => {
                        console.error('[AI] SenseNova 上游错误:', uRes.statusCode, errBody.slice(0, 300));
                        if (!res.headersSent) {
                            res.status(502).json({ success: false, message: `AI 服务响应异常（${uRes.statusCode}），请稍后重试` });
                        }
                        resolve();
                    });
                }
            });
            uReq.on('timeout', () => uReq.destroy(new Error('上游请求超时')));
            uReq.on('error', (e) => {
                console.error('[AI] 上游连接失败:', e.message);
                const timedOut = /超时|timeout/i.test(e.message);
                if (!res.headersSent) {
                    res.status(502).json({
                        success: false,
                        message: timedOut
                            ? 'AI 服务响应超时（上游较慢），请稍后重试，或尝试在右上角切换其他模型'
                            : 'AI 服务连接失败，请稍后重试'
                    });
                } else {
                    try { res.end(); } catch (ignored) {}
                }
                resolve();
            });
            uReq.write(upstreamBody);
            uReq.end();
        });
    } catch (e) {
        console.error('[AI] 对话接口异常:', e.message);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'AI 对话服务异常，请稍后重试' });
        } else {
            try { res.end(); } catch (ignored) {}
        }
    }
});

// 清理累积的 cookie（解决 494 REQUEST_HEADER_TOO_LARGE）
app.get('/api/clean', (req, res) => {
    const staleCookies = Object.keys(req.cookies || {}).filter(k => k.startsWith('sess_') || k === 'connect.sid');
    staleCookies.forEach(name => {
        res.clearCookie(name, { path: '/', secure: true, sameSite: 'none' });
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Cookie 清理完成</title><style>body{font-family:sans-serif;text-align:center;padding:60px;background:#0d1117;color:#f0f6fc}.box{max-width:500px;margin:0 auto;padding:40px;background:#161b22;border-radius:12px;border:1px solid #30363d}h2{color:#2ea043}.count{font-size:48px;color:#2ea043}a{display:inline-block;margin-top:24px;padding:12px 32px;background:#238636;color:#fff;text-decoration:none;border-radius:6px}</style></head><body><div class="box"><h2>Cookie 清理完成</h2><div class="count">${staleCookies.length}</div><p>已清理 ${staleCookies.length} 个旧 cookie</p><a href="/">返回首页</a></div><script>setTimeout(function(){location.href='/'},3000)</script></body></html>`);
});

app.get('/api/user', async (req, res) => {
    const user = await getCurrentUser(req);
    console.log('[USER API] session.userId:', req.session.userId, 'authUser:', req.authUser?.username, 'found:', !!user, 'dbUsers:', db.data.users?.length || 0);
    if (!user) {
        return res.status(401).json({ error: '未登录' });
    }
    res.json({ id: user.id, username: user.username, email: user.email, is_admin: user.is_admin, is_super_admin: user.is_super_admin });
});

// 修改密码
app.put('/api/user/password', requireLogin, requireRateLimit('password'), requireCSRF, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ error: '请填写旧密码和新密码' });
        }

        if (!validatePassword(newPassword)) {
            return res.status(400).json({ error: '新密码长度至少6位' });
        }

        // 先尝试从数据库找用户
        let user = db.data.users.find(u => u.id === req.currentUser.id);
        // 如果用户不在数据库里（Vercel 环境 token 构建的虚拟用户），先注册到数据库
        if (!user) {
            user = {
                id: req.currentUser.id,
                username: req.currentUser.username,
                email: req.currentUser.email || '',
                password: '',
                is_admin: !!req.currentUser.is_admin,
                is_super_admin: !!req.currentUser.is_super_admin,
                status: 'active',
                created_at: new Date().toISOString()
            };
            db.data.users.push(user);
            console.log(`[USER-PWD] 用户 ${user.username} 不在数据库，自动补录`);
        }

        if (!bcrypt.compareSync(oldPassword, user.password)) {
            return res.status(400).json({ error: '旧密码不正确' });
        }

        if (oldPassword === newPassword) {
            return res.status(400).json({ error: '新密码不能与旧密码相同' });
        }

        user.password = bcrypt.hashSync(newPassword, 10);
        await db.write();

        res.json({ success: true, message: '密码修改成功，请重新登录' });
    } catch (err) {
        console.error('修改密码失败:', err);
        res.status(500).json({ error: '服务器错误' });
    }
});

app.post('/api/send-code', requireRateLimit('verifyCode'), requireCSRF, requireCaptcha, async (req, res) => {
    const { email, type } = req.body;
    
    if (!validateEmail(email)) {
        return res.status(400).json({ success: false, message: '邮箱格式不正确' });
    }
    
    if (type === 'register') {
        if (db.data.users.find(u => u.email === email)) {
            return res.status(400).json({ success: false, message: '该邮箱已被注册' });
        }
    } else if (type === 'login') {
        if (!db.data.users.find(u => u.email === email)) {
            return res.status(400).json({ success: false, message: '该邮箱未注册' });
        }
    }

    if (!Array.isArray(db.data.verification_codes)) db.data.verification_codes = [];
    
    const existingCode = db.data.verification_codes.find(c => c.email === email);
    if (existingCode && Date.now() - existingCode.created_at < 60000) {
        return res.status(400).json({ success: false, message: '请等待60秒后再发送' });
    }
    
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    if (existingCode) {
        existingCode.code = code;
        existingCode.created_at = Date.now();
        existingCode.expires = Date.now() + 300000;
    } else {
        db.data.verification_codes.push({
            email: email,
            code: code,
            type: type,
            created_at: Date.now(),
            expires: Date.now() + 300000
        });
    }
    
    await db.write();
    
    // 发送邮件
    try {
        const transporter = getEmailTransporter();
        if (!transporter) {
            console.error('[SEND-CODE FAIL] 邮件服务未配置');
            return res.status(500).json({ success: false, message: '邮件服务未配置，请联系管理员设置 EMAIL_USER 和 EMAIL_PASS 环境变量' });
        }
        const mailPayload = {
            from: `"STC任务网站" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: '【STC】您的验证码',
            text: `您正在${type === 'login' ? '登录' : '注册'}STC任务网站，您的验证码是：${code}，有效期5分钟，请勿泄露给他人。`,
            html: `
                <div style="font-family: 'Microsoft YaHei', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #0ea5e9, #38bdf8); padding: 30px; border-radius: 16px 16px 0 0;">
                        <h1 style="color: white; margin: 0; font-size: 24px; text-align: center;">STC 验证码</h1>
                    </div>
                    <div style="background: #f0f9ff; padding: 30px; border-radius: 0 0 16px 16px; border: 1px solid #bae6fd;">
                        <p style="color: #475569; font-size: 16px; margin: 0 0 20px;">您好！</p>
                        <p style="color: #475569; font-size: 16px; margin: 0 0 20px;">您正在${type === 'login' ? '登录' : '注册'}STC任务网站，您的验证码是：</p>
                        <div style="background: white; padding: 20px; border-radius: 12px; text-align: center; margin: 20px 0; border: 2px dashed #0ea5e9;">
                            <span style="font-size: 32px; font-weight: bold; color: #0284c7; letter-spacing: 8px;">${code}</span>
                        </div>
                        <p style="color: #64748b; font-size: 14px; margin: 20px 0 0;">验证码有效期为5分钟，请勿泄露给他人。</p>
                    </div>
                    <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 20px 0 0;">© 2025 STC任务网站</p>
                </div>
            `
        };
        const info = await transporter.sendMail(mailPayload);
        console.log(`[SEND-CODE OK] email=${email} code=${code} accepted=${JSON.stringify(info.accepted)} rejected=${JSON.stringify(info.rejected)} msgId=${info.messageId}`);
    } catch (error) {
        const detail = JSON.stringify({ message: error.message, code: error.code, response: error.response, command: error.command });
        console.error(`[SEND-CODE FAIL] ${email}: ${detail}`);
        return res.status(500).json({ success: false, message: '邮件发送失败，请稍后重试' });
    }
    
    res.json({ success: true, message: '验证码已发送' });
});

app.get('/api/tasks', async (req, res) => {
    const { page = 1, pageSize = 10, status } = req.query;
    let tasks = [...db.data.tasks];
    
    if (status) {
        tasks = tasks.filter(t => t.status === status);
    }
    
    // 置顶任务优先
    tasks.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.created_at) - new Date(a.created_at);
    });
    
    const total = tasks.length;
    const start = (page - 1) * pageSize;
    const paginatedTasks = tasks.slice(start, start + parseInt(pageSize));
    
    paginatedTasks.forEach(task => {
        const user = db.data.users.find(u => u.id === task.author_id);
        task.user = user ? { id: user.id, username: user.username } : null;
        // 修复文件名编码
        if (task.file_name) {
            task.file_name = fixFilenameEncoding(task.file_name);
        }
    });
    
    res.json({ success: true, data: paginatedTasks, total, page: parseInt(page), pageSize: parseInt(pageSize) });
});

app.get('/api/tasks/daily-limit', requireLogin, async (req, res) => {
    const user = req.currentUser;
    const userId = user.id;
    const isAdmin = user.is_admin || user.is_super_admin;
    const DAILY_LIMIT = 5;
    
    if (isAdmin) {
        return res.json({ 
            success: true, 
            data: { 
                is_admin: true, 
                used: 0, 
                limit: -1,
                remaining: -1
            } 
        });
    }
    
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const todayTasks = (db.data.tasks || []).filter(t => {
        return t.author_id === userId && t.created_at >= todayStart;
    });
    
    res.json({ 
        success: true, 
        data: { 
            is_admin: false, 
            used: todayTasks.length, 
            limit: DAILY_LIMIT,
            remaining: Math.max(0, DAILY_LIMIT - todayTasks.length)
        } 
    });
});

app.get('/api/tasks/:id', async (req, res) => {
    const taskId = parseInt(req.params.id);
    if (isNaN(taskId)) {
        return res.status(400).json({ success: false, message: '无效的任务ID' });
    }
    const task = db.data.tasks.find(t => t.id === taskId);
    
    if (!task) {
        return res.status(404).json({ success: false, message: '任务不存在' });
    }
    
    const user = db.data.users.find(u => u.id === task.author_id);
    
    // 修复文件名编码
    const fixedFileName = task.file_name ? fixFilenameEncoding(task.file_name) : null;
    
    res.json({
        success: true,
        data: {
            ...task,
            file_name: fixedFileName,
            user: user ? { id: user.id, username: user.username } : null,
            author_name: user ? user.username : '匿名',
            author_id: task.author_id
        }
    });
});

// 公开的留言列表API（普通用户可查看）
app.get('/api/public/messages', async (req, res) => {
    const messages = db.data.messages || [];
    // 按时间倒序排列
    messages.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    // 添加用户信息
    const publicMessages = messages.map(m => {
        const user = db.data.users.find(u => u.id === m.user_id);
        return {
            id: m.id,
            content: m.content,
            created_at: m.created_at,
            user: user ? { id: user.id, username: user.username } : null
        };
    });
    
    res.json({ success: true, data: publicMessages });
});

// 发布留言（需要登录）
app.post('/api/messages', requireLogin, requireRateLimit('messages'), requireCSRF, async (req, res) => {
    const { content } = req.body;
    
    if (!content || content.trim().length === 0) {
        return res.status(400).json({ success: false, message: '留言内容不能为空' });
    }
    
    const user = req.currentUser;
    const userId = user.id;
    
    const message = {
        id: Date.now(),
        content: content.trim(),
        user_id: userId,
        created_at: new Date().toISOString()
    };
    
    if (!db.data.messages) db.data.messages = [];
    db.data.messages.push(message);
    await db.write();
    
    res.json({ 
        success: true, 
        data: {
            ...message,
            user: { id: user.id, username: user.username }
        }
    });
});

app.post('/api/tasks', requireLogin, requireRateLimit('tasks'), upload.single('file'), requireCSRF, async (req, res) => {
    const { title, description, reward, deadline, status } = req.body;
    
    if (!title || !description) {
        return res.status(400).json({ success: false, message: '请填写标题和描述' });
    }
    
    const user = req.currentUser;
    const userId = user.id;
    
    const isAdmin = user.is_admin || user.is_super_admin;
    const DAILY_LIMIT = 5;
    
    if (!isAdmin) {
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
        const todayTasks = (db.data.tasks || []).filter(t => {
            return t.author_id === userId && t.created_at >= todayStart;
        });
        
        if (todayTasks.length >= DAILY_LIMIT) {
            return res.status(403).json({ 
                success: false, 
                message: `普通用户每天最多发布 ${DAILY_LIMIT} 个任务，您今日已发布 ${todayTasks.length} 个` 
            });
        }
    }
    
    const validStatuses = ['pending', 'in_progress', 'completed', 'planning', 'idle'];
    const taskStatus = (status && validStatuses.includes(status)) ? status : 'idle';
    
    const task = {
        id: Date.now(),
        title: title,
        content: description,
        reward: parseFloat(reward) || 0,
        deadline: deadline || null,
        status: taskStatus,
        status_text: {
            'pending': '备货中',
            'planning': '建设中',
            'in_progress': '进行中',
            'completed': '已完成',
            'idle': '一笔未动'
        }[taskStatus],
        author_id: userId,
        is_pinned: false,
        // 处理中文文件名
        file_name: req.file ? (() => {
            try { return Buffer.from(req.file.originalname, 'latin1').toString('utf8'); }
            catch (e) { return req.file.originalname; }
        })() : null,
        file_path: req.file ? req.file.path : null,
        created_at: new Date().toISOString()
    };
    
    db.data.tasks.push(task);
    await db.write();
    
    res.json({ success: true, message: '任务发布成功', data: task });
});

app.put('/api/tasks/:id', requireLogin, requireRateLimit('tasks'), requireCSRF, async (req, res) => {
    const task = db.data.tasks.find(t => t.id === parseInt(req.params.id));
    
    if (!task) {
        return res.status(404).json({ success: false, message: '任务不存在' });
    }
    
    const userId = req.currentUser.id;
    if (task.author_id !== userId) {
        return res.status(403).json({ success: false, message: '无权修改此任务' });
    }
    
    const { title, description, reward, deadline, status } = req.body;
    if (title) task.title = title;
    if (description) task.content = description;
    if (reward) task.reward = parseFloat(reward);
    if (deadline) task.deadline = deadline;
    if (status) task.status = status;
    
    await db.write();
    
    res.json({ success: true, message: '任务更新成功', data: task });
});

// 更新任务状态接口
app.put('/api/tasks/:id/status', requireLogin, requireRateLimit('tasks'), requireCSRF, async (req, res) => {
    const task = db.data.tasks.find(t => t.id === parseInt(req.params.id));
    
    if (!task) {
        return res.status(404).json({ success: false, message: '任务不存在' });
    }
    
    const user = req.currentUser;
    const userId = user.id;
    const isAdmin = user.is_admin || user.is_super_admin;
    
    // 只有任务作者或管理员可以修改状态
    if (task.author_id !== userId && !isAdmin) {
        return res.status(403).json({ success: false, message: '无权修改此任务状态' });
    }
    
    const { status } = req.body;
    const validStatuses = ['pending', 'in_progress', 'completed', 'planning', 'idle'];
    const statusMap = {
        'pending': '备货中',
        'planning': '建设中',
        'in_progress': '进行中',
        'completed': '已完成',
        'idle': '一笔未动'
    };
    
    if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: '无效的状态值' });
    }
    
    task.status = status;
    task.status_text = statusMap[status];
    
    await db.write();
    
    res.json({ success: true, message: '状态更新成功', data: task });
});

app.delete('/api/tasks/:id', requireLogin, requireRateLimit('tasks'), requireCSRF, async (req, res) => {
    const task = db.data.tasks.find(t => t.id === parseInt(req.params.id));
    
    if (!task) {
        return res.status(404).json({ success: false, message: '任务不存在' });
    }
    
    const user = req.currentUser;
    const userId = user.id;
    const isAdmin = user.is_admin || user.is_super_admin;
    
    if (task.author_id !== userId && !isAdmin) {
        return res.status(403).json({ success: false, message: '无权删除此任务' });
    }
    
    db.data.tasks = db.data.tasks.filter(t => t.id !== parseInt(req.params.id));
    await db.write();
    
    res.json({ success: true, message: '任务已删除' });
});

app.get('/api/tasks/:id/download', async (req, res) => {
    const task = db.data.tasks.find(t => t.id === parseInt(req.params.id));
    if (!task) {
        return res.status(404).json({ success: false, message: '任务不存在' });
    }
    
    if (!task.file_path || !fs.existsSync(task.file_path)) {
        return res.status(404).json({ success: false, message: '文件不存在' });
    }
    
    if (!isSafePath(task.file_path, uploadsDir)) {
        return res.status(403).json({ success: false, message: '非法文件路径' });
    }
    
    res.download(task.file_path, task.file_name || 'download');
});

app.post('/api/invite/request', requireRateLimit('invite'), requireCSRF, requireCaptcha, async (req, res) => {
    const { email } = req.body;
    
    if (!validateEmail(email)) {
        return res.status(400).json({ success: false, message: '邮箱格式不正确' });
    }
    
    if (!Array.isArray(db.data.invite_requests)) db.data.invite_requests = [];
    
    const existingRequest = (db.data.invite_requests || []).find(r => r.email === email && r.status === 'pending');
    if (existingRequest) {
        return res.status(400).json({ success: false, message: '已有待处理的申请，请等待审批' });
    }
    
    db.data.invite_requests.push({
        id: Date.now(),
        email: email,
        status: 'pending',
        created_at: new Date().toISOString(),
        approval_token: crypto.randomBytes(24).toString('hex'),
        reject_token: crypto.randomBytes(24).toString('hex')
    });
    
    await db.write();

    // 邮件里的审批链接域名优先使用环境变量 SITE_URL，没有就检测部署环境，没有就回落到请求 host
    function getPublicSiteUrl(req) {
        // 本地开发环境：不使用 SITE_URL（否则邮件审批链接会指向生产域名，本地点击打不开）
        const isLocalDev = !process.env.VERCEL && !process.env.ZEABUR && !process.env.RAILWAY && process.env.NODE_ENV !== 'production';
        if (!isLocalDev && process.env.SITE_URL) {
            const url = process.env.SITE_URL.replace(/\/$/, '');
            console.log(`[DEBUG-SITEURL] 使用 SITE_URL 环境变量: ${url}`);
            return url;
        }
        if (process.env.VERCEL && process.env.VERCEL_URL) {
            const url = `https://${process.env.VERCEL_URL}`;
            console.log(`[DEBUG-SITEURL] 使用 VERCEL_URL: ${url}`);
            return url;
        }
        if (process.env.VERCEL_BRANCH_URL) {
            const url = `https://${process.env.VERCEL_BRANCH_URL}`;
            console.log(`[DEBUG-SITEURL] 使用 VERCEL_BRANCH_URL: ${url}`);
            return url;
        }
        if (process.env.ZEABUR && process.env.ZEABUR_DOMAIN) {
            const url = `https://${process.env.ZEABUR_DOMAIN}`;
            console.log(`[DEBUG-SITEURL] 使用 ZEABUR_DOMAIN: ${url}`);
            return url;
        }
        if (process.env.ZEABUR && process.env.RAILWAY_STATIC_URL) {
            const url = process.env.RAILWAY_STATIC_URL.replace(/\/$/, '');
            console.log(`[DEBUG-SITEURL] 使用 RAILWAY_STATIC_URL: ${url}`);
            return url;
        }
        const fallback = `${req.protocol}://${req.get('host')}`;
        console.log(`[DEBUG-SITEURL] ⚠️  未配置 SITE_URL，回落至请求 host: ${fallback} （仅本机可用！）`);
        if (fallback.includes('localhost') || fallback.includes('127.0.0.1')) {
            console.log(`[DEBUG-SITEURL] ⚠️  警告：链接使用 localhost/127.0.0.1，在邮件中点击将无法访问服务器！请在 .env 中配置 SITE_URL 为你的公网IP或域名`);
        }
        return fallback;
    }
    const host = getPublicSiteUrl(req);
    const reqEntry = db.data.invite_requests.find(r => r.email === email && r.status === 'pending');
    const approveUrl = `${host}/api/invite/approve/${reqEntry.approval_token}`;
    const rejectUrl = `${host}/api/invite/reject/${reqEntry.reject_token}`;
    console.log(`[DEBUG-EMAIL-LINK] 申请邮箱: ${email}`);
    console.log(`[DEBUG-EMAIL-LINK] 批准链接: ${approveUrl}`);
    console.log(`[DEBUG-EMAIL-LINK] 拒绝链接: ${rejectUrl}`);

    // 1. 发通知邮件给管理员，包含批准/拒绝按钮
    try {
        const adminNotifyEmail = process.env.ADMIN_NOTIFY_EMAIL || process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
        const _t = getEmailTransporter(); if (!_t) throw new Error('邮件服务未配置'); await _t.sendMail({
            from: `"STC任务网站" <${process.env.EMAIL_USER}>`,
            to: adminNotifyEmail,
            subject: '【STC】新的邀请码申请',
            html: `
                <div style="font-family: 'Microsoft YaHei', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #8b5cf6, #a78bfa); padding: 30px; border-radius: 16px 16px 0 0;">
                        <h1 style="color: white; margin: 0; font-size: 24px; text-align: center;">新邀请码申请</h1>
                    </div>
                    <div style="background: #faf5ff; padding: 30px; border-radius: 0 0 16px 16px; border: 1px solid #ddd6fe;">
                        <p style="color: #475569; font-size: 16px;">管理员您好，</p>
                        <p style="color: #475569; font-size: 16px;">以下用户申请了邀请码：</p>
                        <div style="background: white; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #e9d5ff;">
                            <p style="margin: 0 0 10px;"><strong>申请邮箱：</strong> ${email}</p>
                            <p style="margin: 0;"><strong>申请时间：</strong> ${new Date().toLocaleString('zh-CN')}</p>
                        </div>
                        <p style="color: #64748b; font-size: 14px; margin: 20px 0;">直接点击下方按钮审批，无需登录管理面板：</p>
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 10px 0 20px;">
                            <tr>
                                <td align="center" style="padding: 6px;">
                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                                        <tr>
                                            <td style="border-radius: 12px; background: #10b981;">
                                                <a href="${approveUrl}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:bold;color:white;text-decoration:none;border-radius:12px;background:#10b981;">✅ 批准并发送邀请码</a>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                                <td align="center" style="padding: 6px;">
                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                                        <tr>
                                            <td style="border-radius: 12px; background: #ef4444;">
                                                <a href="${rejectUrl}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:bold;color:white;text-decoration:none;border-radius:12px;background:#ef4444;">❌ 拒绝该申请</a>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                        <p style="color: #94a3b8; font-size: 12px;">如按钮无法点击，可复制链接在浏览器中打开：<br>批准：<span style="word-break:break-all;color:#64748b;">${approveUrl}</span><br>拒绝：<span style="word-break:break-all;color:#64748b;">${rejectUrl}</span></p>
                    </div>
                    <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 20px 0 0;">© 2025 STC任务网站</p>
                </div>
            `
        });
        console.log(`[INVITE-ADMIN] 邀请码申请通知邮件(含审批按钮)已发送至管理员: ${adminNotifyEmail}, 申请人邮箱: ${email}`);
    } catch (error) {
        console.error('[INVITE-ADMIN] 邀请码申请通知邮件发送失败:', error.message);
    }

    // 2. 发回执邮件给申请人（REDACTED@example.com 等）
    try {
        const _t = getEmailTransporter(); if (!_t) throw new Error('邮件服务未配置'); await _t.sendMail({
            from: `"STC任务网站" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: '【STC】您的邀请码申请已收到',
            html: `
                <div style="font-family: 'Microsoft YaHei', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #0ea5e9, #38bdf8); padding: 30px; border-radius: 16px 16px 0 0;">
                        <h1 style="color: white; margin: 0; font-size: 24px; text-align: center;">申请已收到 ✉</h1>
                    </div>
                    <div style="background: #f0f9ff; padding: 30px; border-radius: 0 0 16px 16px; border: 1px solid #bae6fd;">
                        <p style="color: #475569; font-size: 16px;">您好！</p>
                        <p style="color: #475569; font-size: 16px;">感谢您对 STC任务网站 的关注。</p>
                        <p style="color: #475569; font-size: 16px;">我们已收到您的邀请码申请，管理员会尽快审批。审批通过后，您的专属邀请码将通过邮件发送到此邮箱，请耐心等待。</p>
                        <div style="background: white; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #e0f2fe;">
                            <p style="margin: 0 0 10px;"><strong>申请邮箱：</strong> ${email}</p>
                            <p style="margin: 0;"><strong>提交时间：</strong> ${new Date().toLocaleString('zh-CN')}</p>
                        </div>
                        <p style="color: #64748b; font-size: 14px;">如有疑问，请回复此邮件与管理员联系。</p>
                    </div>
                    <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 20px 0 0;">© 2025 STC任务网站</p>
                </div>
            `
        });
        console.log(`[INVITE-USER] 邀请码申请回执邮件已发送给申请人: ${email}`);
    } catch (error) {
        console.error('[INVITE-USER] 邀请码申请回执邮件发送失败:', error.message);
    }
    
    res.json({ success: true, message: '申请已提交，请等待管理员审批' });
});

app.get('/api/invite/approve/:token', async (req, res) => {
    const token = req.params.token;
    const clientIP = getClientIP(req);
    console.log(`[DEBUG-APPROVE] ⚡ 收到批准请求! token=${token.substring(0, 12)}... 来自IP=${clientIP}, UA=${req.headers['user-agent']?.substring(0, 80) || '-'}`);
    if (!Array.isArray(db.data.invite_requests)) db.data.invite_requests = [];
    console.log(`[DEBUG-APPROVE] 数据库中 invite_requests 总数: ${db.data.invite_requests.length}`);
    db.data.invite_requests.forEach((r, i) => {
        console.log(`[DEBUG-APPROVE] 记录#${i}: email=${r.email}, status=${r.status}, approval_token=${r.approval_token ? r.approval_token.substring(0,12)+'...' : 'MISSING!'}`);
    });
    const request = db.data.invite_requests.find(r => r.approval_token === token);
    if (!request) {
        console.log(`[DEBUG-APPROVE] ❌ token 不匹配任何记录！`);
        return res.status(404).send(`<div style="font-family:'Microsoft YaHei';padding:40px;text-align:center;"><h1 style="color:#ef4444;">❌ 链接无效或已过期</h1><p>该审批链接不存在或已被使用。</p><a href="/" style="color:#6366f1;">返回首页</a></div>`);
    }
    console.log(`[DEBUG-APPROVE] ✅ 找到申请记录: email=${request.email}, status=${request.status}`);
    if (request.status !== 'pending') {
        console.log(`[DEBUG-APPROVE] ⚠️  状态不是 pending，已处理过: ${request.status}`);
        return res.status(400).send(`<div style="font-family:'Microsoft YaHei';padding:40px;text-align:center;"><h1>该申请已处理</h1><p>当前状态：<strong>${request.status}</strong></p><a href="/" style="color:#6366f1;">返回首页</a></div>`);
    }
    try {
        const inviteCode = crypto.randomBytes(16).toString('hex');
        if (!Array.isArray(db.data.invite_codes)) db.data.invite_codes = [];
        if (!Array.isArray(db.data.inviteCodes)) db.data.inviteCodes = [];
        db.data.invite_codes.push({ code: inviteCode, used: false, created_at: new Date().toISOString() });
        db.data.inviteCodes.push(inviteCode);
        request.status = 'approved';
        request.approved_at = new Date().toISOString();
        request.approved_by = 'email-link';
        request.invite_code = inviteCode;
        await db.write();
        // 先返回页面，邮件改为后台发送（避免 SMTP 卡住导致批准页一直转圈）
        res.send(`
            <div style="font-family:'Microsoft YaHei';padding:40px;text-align:center;max-width:500px;margin:0 auto;">
                <div style="background:linear-gradient(135deg,#10b981,#34d399);padding:30px;border-radius:16px 16px 0 0;">
                    <h1 style="color:white;margin:0;font-size:24px;">✅ 已批准申请</h1>
                </div>
                <div style="background:#ecfdf5;padding:30px;border-radius:0 0 16px 16px;border:1px solid #a7f3d0;">
                    <p style="color:#475569;font-size:16px;">已为邮箱 <strong>${request.email}</strong> 生成邀请码：</p>
                    <div style="background:white;padding:20px;border-radius:12px;text-align:center;margin:20px 0;border:2px dashed #10b981;">
                        <span style="font-size:26px;font-weight:bold;color:#047857;letter-spacing:3px;word-break:break-all;">${inviteCode}</span>
                    </div>
                    <p style="color:#64748b;font-size:14px;">邀请码已同步发送到申请人邮箱。</p>
                    <p><a href="/admin.html" style="color:#047857;font-weight:bold;">返回管理面板</a></p>
                </div>
            </div>
        `);
        // 后台发送邀请码邮件（不阻塞响应）
        sendMailFireAndForget({
            from: `"STC任务网站" <${process.env.EMAIL_USER}>`,
            to: request.email,
            subject: '【STC】邀请码申请已通过',
            html: `
                <div style="font-family: 'Microsoft YaHei', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #10b981, #34d399); padding: 30px; border-radius: 16px 16px 0 0;">
                        <h1 style="color: white; margin: 0; font-size: 24px; text-align: center;">申请已通过 ✅</h1>
                    </div>
                    <div style="background: #ecfdf5; padding: 30px; border-radius: 0 0 16px 16px; border: 1px solid #a7f3d0;">
                        <p style="color: #475569; font-size: 16px;">您好！</p>
                        <p style="color: #475569; font-size: 16px;">您的邀请码申请已通过审批，您的专属邀请码是：</p>
                        <div style="background: white; padding: 20px; border-radius: 12px; text-align: center; margin: 20px 0; border: 2px dashed #10b981;">
                            <span style="font-size: 28px; font-weight: bold; color: #047857; letter-spacing: 4px; word-break: break-all;">${inviteCode}</span>
                        </div>
                        <p style="color: #64748b; font-size: 14px;">请在注册页使用该邀请码完成注册，邀请码仅限一次使用。</p>
                    </div>
                    <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 20px 0 0;">© 2025 STC任务网站</p>
                </div>
            `
        }, 'APPROVE-TOKEN');
    } catch (error) {
        console.error('[APPROVE-TOKEN] 批准失败:', error.message);
        res.status(500).send(`<div style="font-family:'Microsoft YaHei';padding:40px;text-align:center;"><h1 style="color:#ef4444;">❌ 服务器错误</h1><p>${error.message}</p></div>`);
    }
});

app.get('/api/invite/reject/:token', async (req, res) => {
    const token = req.params.token;
    const clientIP = getClientIP(req);
    console.log(`[DEBUG-REJECT] ⚡ 收到拒绝请求! token=${token.substring(0, 12)}... 来自IP=${clientIP}, UA=${req.headers['user-agent']?.substring(0, 80) || '-'}`);
    if (!Array.isArray(db.data.invite_requests)) db.data.invite_requests = [];
    console.log(`[DEBUG-REJECT] 数据库中 invite_requests 总数: ${db.data.invite_requests.length}`);
    db.data.invite_requests.forEach((r, i) => {
        console.log(`[DEBUG-REJECT] 记录#${i}: email=${r.email}, status=${r.status}, reject_token=${r.reject_token ? r.reject_token.substring(0,12)+'...' : 'MISSING!'}`);
    });
    const request = db.data.invite_requests.find(r => r.reject_token === token);
    if (!request) {
        console.log(`[DEBUG-REJECT] ❌ token 不匹配任何记录！`);
        return res.status(404).send(`<div style="font-family:'Microsoft YaHei';padding:40px;text-align:center;"><h1 style="color:#ef4444;">❌ 链接无效或已过期</h1><p>该审批链接不存在或已被使用。</p><a href="/" style="color:#6366f1;">返回首页</a></div>`);
    }
    console.log(`[DEBUG-REJECT] ✅ 找到申请记录: email=${request.email}, status=${request.status}`);
    if (request.status !== 'pending') {
        console.log(`[DEBUG-REJECT] ⚠️  状态不是 pending，已处理过: ${request.status}`);
        return res.status(400).send(`<div style="font-family:'Microsoft YaHei';padding:40px;text-align:center;"><h1>该申请已处理</h1><p>当前状态：<strong>${request.status}</strong></p><a href="/" style="color:#6366f1;">返回首页</a></div>`);
    }
    request.status = 'rejected';
    request.rejected_at = new Date().toISOString();
    request.rejected_by = 'email-link';
    await db.write();
    try {
        const _t = getEmailTransporter(); if (!_t) throw new Error('邮件服务未配置'); await _t.sendMail({
            from: `"STC任务网站" <${process.env.EMAIL_USER}>`,
            to: request.email,
            subject: '【STC】邀请码申请未通过',
            html: `
                <div style="font-family: 'Microsoft YaHei', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #ef4444, #f87171); padding: 30px; border-radius: 16px 16px 0 0;">
                        <h1 style="color: white; margin: 0; font-size: 24px; text-align: center;">申请未通过</h1>
                    </div>
                    <div style="background: #fef2f2; padding: 30px; border-radius: 0 0 16px 16px; border: 1px solid #fecaca;">
                        <p style="color: #475569; font-size: 16px;">您好，</p>
                        <p style="color: #475569; font-size: 16px;">很遗憾，您的邀请码申请未通过管理员审批。如有疑问，请与管理员联系。</p>
                    </div>
                    <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 20px 0 0;">© 2025 STC任务网站</p>
                </div>
            `
        });
        console.log(`[REJECT-TOKEN] 邀请码驳回通知邮件已发送: ${request.email}`);
    } catch (err) {
        console.error('[REJECT-TOKEN] 邀请码驳回通知邮件发送失败:', err.message);
    }
    res.send(`
        <div style="font-family:'Microsoft YaHei';padding:40px;text-align:center;max-width:500px;margin:0 auto;">
            <div style="background:linear-gradient(135deg,#ef4444,#f87171);padding:30px;border-radius:16px 16px 0 0;">
                <h1 style="color:white;margin:0;font-size:24px;">❌ 已拒绝申请</h1>
            </div>
            <div style="background:#fef2f2;padding:30px;border-radius:0 0 16px 16px;border:1px solid #fecaca;">
                <p style="color:#475569;font-size:16px;">已拒绝邮箱 <strong>${request.email}</strong> 的邀请码申请。</p>
                <p style="color:#64748b;font-size:14px;">驳回通知邮件已发送给申请人。</p>
                <p><a href="/admin.html" style="color:#b91c1c;font-weight:bold;">返回管理面板</a></p>
            </div>
        </div>
    `);
});

app.get('/api/invite/requests', requireAdmin, async (req, res) => {
    res.json({ success: true, data: db.data.invite_requests || [] });
});

app.post('/api/invite/requests/:id/approve', requireAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    const request = db.data.invite_requests.find(r => r.id === parseInt(req.params.id));
    
    if (!request) {
        return res.status(404).json({ success: false, message: '申请不存在' });
    }
    
    request.status = 'approved';
    request.approved_at = new Date().toISOString();
    
    const inviteCode = crypto.randomBytes(16).toString('hex');
    db.data.invite_codes.push({
        id: Date.now(),
        code: inviteCode,
        used: false,
        created_at: new Date().toISOString()
    });
    
    await db.write();

    // 发送邀请码给申请人
    try {
        const _t = getEmailTransporter(); if (!_t) throw new Error('邮件服务未配置'); await _t.sendMail({
            from: `"STC任务网站" <${process.env.EMAIL_USER}>`,
            to: request.email,
            subject: '【STC】邀请码申请已通过',
            html: `
                <div style="font-family: 'Microsoft YaHei', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #10b981, #34d399); padding: 30px; border-radius: 16px 16px 0 0;">
                        <h1 style="color: white; margin: 0; font-size: 24px; text-align: center;">申请已通过 ✅</h1>
                    </div>
                    <div style="background: #ecfdf5; padding: 30px; border-radius: 0 0 16px 16px; border: 1px solid #a7f3d0;">
                        <p style="color: #475569; font-size: 16px;">您好！</p>
                        <p style="color: #475569; font-size: 16px;">您的邀请码申请已通过审批，您的专属邀请码是：</p>
                        <div style="background: white; padding: 20px; border-radius: 12px; text-align: center; margin: 20px 0; border: 2px dashed #10b981;">
                            <span style="font-size: 28px; font-weight: bold; color: #047857; letter-spacing: 4px; word-break: break-all;">${inviteCode}</span>
                        </div>
                        <p style="color: #64748b; font-size: 14px;">请在注册页使用该邀请码完成注册，邀请码仅限一次使用。</p>
                    </div>
                    <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 20px 0 0;">© 2025 STC任务网站</p>
                </div>
            `
        });
        console.log(`邀请码邮件已发送给申请人: ${request.email}`);
    } catch (error) {
        console.error('邀请码邮件发送失败:', error.message);
    }
    
    res.json({ success: true, message: '邀请码已生成并发送', invite_code: inviteCode });
});

app.post('/api/invite/requests/:id/reject', requireAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    const request = db.data.invite_requests.find(r => r.id === parseInt(req.params.id));
    
    if (!request) {
        return res.status(404).json({ success: false, message: '申请不存在' });
    }
    
    request.status = 'rejected';
    request.rejected_at = new Date().toISOString();
    const { reason } = req.body || {};
    await db.write();

    // 通知申请人被驳回
    try {
        const _t = getEmailTransporter(); if (!_t) throw new Error('邮件服务未配置'); await _t.sendMail({
            from: `"STC任务网站" <${process.env.EMAIL_USER}>`,
            to: request.email,
            subject: '【STC】邀请码申请未通过',
            html: `
                <div style="font-family: 'Microsoft YaHei', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #ef4444, #f87171); padding: 30px; border-radius: 16px 16px 0 0;">
                        <h1 style="color: white; margin: 0; font-size: 24px; text-align: center;">申请未通过</h1>
                    </div>
                    <div style="background: #fef2f2; padding: 30px; border-radius: 0 0 16px 16px; border: 1px solid #fecaca;">
                        <p style="color: #475569; font-size: 16px;">您好，</p>
                        <p style="color: #475569; font-size: 16px;">很遗憾，您的邀请码申请未通过管理员审批。</p>
                        ${reason ? `<div style="background: white; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #fecaca;"><p style="margin: 0; color: #b91c1c;"><strong>驳回原因：</strong>${reason}</p></div>` : ''}
                        <p style="color: #64748b; font-size: 14px;">如有疑问，请与管理员联系。</p>
                    </div>
                    <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 20px 0 0;">© 2025 STC任务网站</p>
                </div>
            `
        });
        console.log(`邀请码驳回通知邮件已发送: ${request.email}`);
    } catch (error) {
        console.error('邀请码驳回通知邮件发送失败:', error.message);
    }
    
    res.json({ success: true, message: '申请已驳回' });
});

// ============================================================
// 加入申请 API（JOIN）
// ============================================================
// 审批邮件链接的站点域名：优先 SITE_URL，其次 Vercel/Zeabur 环境，最后回落到请求 host
function getSiteBaseUrl(req) {
    // 本地开发环境：不使用 SITE_URL（否则邮件审批链接会指向生产域名，本地点击打不开）
    const isLocalDev = !process.env.VERCEL && !process.env.ZEABUR && !process.env.RAILWAY && process.env.NODE_ENV !== 'production';
    if (!isLocalDev && process.env.SITE_URL) {
        return process.env.SITE_URL.replace(/\/$/, '');
    }
    if (process.env.VERCEL && process.env.VERCEL_URL) {
        return `https://${process.env.VERCEL_URL}`;
    }
    if (process.env.VERCEL_BRANCH_URL) {
        return `https://${process.env.VERCEL_BRANCH_URL}`;
    }
    if (process.env.ZEABUR && process.env.ZEABUR_DOMAIN) {
        return `https://${process.env.ZEABUR_DOMAIN}`;
    }
    return `${req.protocol}://${req.get('host')}`;
}

// 接收加入申请的管理员邮箱（通过环境变量 JOIN_ADMIN_EMAILS 配置，多个邮箱用逗号分隔）
// 安全：不再内置默认邮箱，未配置时跳过审批邮件通知
const JOIN_ADMIN_EMAILS = (process.env.JOIN_ADMIN_EMAILS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

// 提交加入申请
app.post('/api/join/apply', requireRateLimit('invite'), requireCSRF, requireCaptcha, async (req, res) => {
    const { qq, gameId, age, projection, playTime } = req.body || {};

    if (!qq || !/^\d+$/.test(qq)) {
        return res.status(400).json({ success: false, message: 'QQ号码必须为纯数字' });
    }
    if (qq.length < 5 || qq.length > 12) {
        return res.status(400).json({ success: false, message: 'QQ号码长度不正确' });
    }
    if (!gameId || !String(gameId).trim()) {
        return res.status(400).json({ success: false, message: '请填写游戏ID' });
    }
    if (!age || !String(age).trim()) {
        return res.status(400).json({ success: false, message: '请填写年龄或年级' });
    }
    if (!projection || !String(projection).trim()) {
        return res.status(400).json({ success: false, message: '请填写是否会使用投影' });
    }
    if (!playTime || !String(playTime).trim()) {
        return res.status(400).json({ success: false, message: '请填写日常上线时间' });
    }

    const email = String(qq) + '@qq.com';

    if (!Array.isArray(db.data.join_applications)) db.data.join_applications = [];

    // 防止重复申请
    const existing = db.data.join_applications.find(a => a.qq === String(qq) && a.status === 'pending');
    if (existing) {
        return res.status(400).json({ success: false, message: '已有待处理的申请，请等待管理员审批' });
    }

    // 该 QQ 邮箱已注册过账号
    if (db.data.users.find(u => u.email === email)) {
        return res.status(400).json({ success: false, message: '该QQ邮箱已注册过账号，请直接登录' });
    }

    const application = {
        id: Date.now(),
        qq: String(qq),
        gameId: String(gameId).trim(),
        age: String(age).trim(),
        projection: String(projection).trim(),
        playTime: String(playTime).trim(),
        email: email,
        status: 'pending',
        created_at: new Date().toISOString(),
        approval_token: crypto.randomBytes(24).toString('hex'),
        reject_token: crypto.randomBytes(24).toString('hex')
    };
    db.data.join_applications.push(application);
    await db.write();

    const host = getSiteBaseUrl(req);
    const approveUrl = `${host}/api/join/approve/${application.approval_token}`;
    const rejectUrl = `${host}/api/join/reject/${application.reject_token}`;

    // 发审批邮件给管理员们（按 JOIN_ADMIN_EMAILS 配置，首邮箱为主收件人，其余抄送）
    try {
        const _t = getEmailTransporter(); if (!_t) throw new Error('邮件服务未配置');
        if (JOIN_ADMIN_EMAILS.length === 0) {
            console.warn('[JOIN] JOIN_ADMIN_EMAILS 未配置，跳过审批邮件通知');
            return res.json({ success: true, message: '申请已提交，请耐心等待管理员审批' });
        }
        const adminTo = JOIN_ADMIN_EMAILS[0];
        const adminCc = JOIN_ADMIN_EMAILS.slice(1);
        await _t.sendMail({
            from: `"STC任务网站" <${process.env.EMAIL_USER}>`,
            to: adminTo,
            cc: adminCc.join(','),
            subject: `【STC】新的加入申请：${application.gameId} (QQ ${application.qq})`,
            html: `
                <div style="font-family: 'Microsoft YaHei', Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #2563eb, #3b82f6); padding: 30px; border-radius: 16px 16px 0 0;">
                        <h1 style="color: white; margin: 0; font-size: 24px; text-align: center;">新的加入申请</h1>
                    </div>
                    <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 16px 16px; border: 1px solid #dbeafe;">
                        <p style="color: #475569; font-size: 16px;">管理员您好，</p>
                        <p style="color: #475569; font-size: 16px;">有玩家申请加入 STC 工会，申请信息如下：</p>
                        <div style="background: white; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #bfdbfe;">
                            <p style="margin: 0 0 10px;"><strong>QQ号码：</strong> ${application.qq}</p>
                            <p style="margin: 0 0 10px;"><strong>游戏ID：</strong> ${application.gameId}</p>
                            <p style="margin: 0 0 10px;"><strong>年龄/年级：</strong> ${application.age}</p>
                            <p style="margin: 0 0 10px;"><strong>是否会使用投影：</strong> ${application.projection}</p>
                            <p style="margin: 0 0 10px;"><strong>日常上线时间：</strong> ${application.playTime}</p>
                            <p style="margin: 0;"><strong>申请时间：</strong> ${new Date().toLocaleString('zh-CN')}</p>
                        </div>
                        <p style="color: #64748b; font-size: 14px; margin: 20px 0;">直接点击下方按钮审批，无需登录管理面板：</p>
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 10px 0 20px;">
                            <tr>
                                <td align="center" style="padding: 6px;">
                                    <a href="${approveUrl}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:bold;color:white;text-decoration:none;border-radius:12px;background:#10b981;">✅ 批准加入</a>
                                </td>
                                <td align="center" style="padding: 6px;">
                                    <a href="${rejectUrl}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:bold;color:white;text-decoration:none;border-radius:12px;background:#ef4444;">❌ 驳回申请</a>
                                </td>
                            </tr>
                        </table>
                        <p style="color: #94a3b8; font-size: 12px;">如按钮无法点击，可复制链接在浏览器中打开：<br>批准：<span style="word-break:break-all;color:#64748b;">${approveUrl}</span><br>驳回：<span style="word-break:break-all;color:#64748b;">${rejectUrl}</span></p>
                    </div>
                    <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 20px 0 0;">© 2025 STC任务网站</p>
                </div>
            `
        });
        console.log(`[JOIN-ADMIN] 加入申请通知邮件已发送: ${JOIN_ADMIN_EMAILS.join(', ')}, 申请人: ${application.gameId} (${application.qq})`);
    } catch (error) {
        console.error('[JOIN-ADMIN] 加入申请通知邮件发送失败:', error.message);
    }

    res.json({ success: true, message: '申请已提交，审核通过后会通过邮件通知你' });
});

// 批准加入申请：创建账号 + 发邮件给申请人
app.get('/api/join/approve/:token', async (req, res) => {
    const token = req.params.token;
    if (!Array.isArray(db.data.join_applications)) db.data.join_applications = [];

    const application = db.data.join_applications.find(a => a.approval_token === token);
    if (!application) {
        return res.status(404).send(`<div style="font-family:'Microsoft YaHei';padding:40px;text-align:center;"><h1 style="color:#ef4444;">❌ 链接无效或已过期</h1><p>该审批链接不存在或已被使用。</p><a href="/" style="color:#6366f1;">返回首页</a></div>`);
    }
    if (application.status !== 'pending') {
        return res.status(400).send(`<div style="font-family:'Microsoft YaHei';padding:40px;text-align:center;"><h1>该申请已处理</h1><p>当前状态：<strong>${application.status}</strong></p><a href="/" style="color:#6366f1;">返回首页</a></div>`);
    }

    const email = application.email;
    const password = '123456';

    // 该 QQ 邮箱已注册过账号：标记已处理，并提示
    if (db.data.users.find(u => u.email === email)) {
        application.status = 'approved';
        application.approved_at = new Date().toISOString();
        application.note = 'QQ邮箱已存在账号，未重复创建';
        await db.write();
        return res.send(`<div style="font-family:'Microsoft YaHei';padding:40px;text-align:center;max-width:500px;margin:0 auto;"><h1 style="color:#f59e0b;">⚠️ 该QQ已注册过账号</h1><p>申请人 <strong>${application.gameId}</strong>（QQ ${application.qq}）的邮箱已存在账号，请让其直接登录。</p><a href="/admin.html" style="color:#6366f1;">返回管理面板</a></div>`);
    }

    // 用户名使用游戏ID；若冲突则加 QQ 号后缀
    let username = application.gameId;
    if (db.data.users.find(u => u.username === username)) {
        username = `${application.gameId}_${application.qq}`;
    }
    if (db.data.users.find(u => u.username === username)) {
        username = `${application.gameId}_${application.qq}_${Math.random().toString(36).slice(2, 6)}`;
    }

    const hash = bcrypt.hashSync(password, 10);
    db.data.users.push({
        id: Date.now(),
        username: username,
        email: email,
        password: hash,
        is_admin: false,
        is_super_admin: false,
        is_banned: false,
        login_attempts: 0,
        created_at: new Date().toISOString(),
        join_from: 'join-application'
    });

    application.status = 'approved';
    application.approved_at = new Date().toISOString();
    application.created_username = username;
    await db.write();

    // 先返回页面，邮件改为后台发送（避免 SMTP 卡住导致批准页一直转圈）
    res.send(`
        <div style="font-family:'Microsoft YaHei';padding:40px;text-align:center;max-width:500px;margin:0 auto;">
            <div style="background:linear-gradient(135deg,#10b981,#34d399);padding:30px;border-radius:16px 16px 0 0;">
                <h1 style="color:white;margin:0;font-size:24px;">✅ 已批准加入</h1>
            </div>
            <div style="background:#ecfdf5;padding:30px;border-radius:0 0 16px 16px;border:1px solid #a7f3d0;">
                <p style="color:#475569;font-size:16px;">已批准 <strong>${application.gameId}</strong>（QQ ${application.qq}）加入 STC 工会。</p>
                <p style="color:#475569;font-size:16px;">账号已自动创建：</p>
                <div style="background:white;padding:16px;border-radius:12px;margin:16px 0;border:2px dashed #10b981;text-align:left;">
                    <p style="margin:4px 0;color:#475569;">用户名：<strong>${username}</strong></p>
                    <p style="margin:4px 0;color:#475569;">邮箱：<strong>${email}</strong></p>
                    <p style="margin:4px 0;color:#475569;">密码：<strong>${password}</strong></p>
                </div>
                <p style="color:#64748b;font-size:14px;">审核通过邮件（含加群链接）后台发送中。</p>
                <p><a href="/admin.html" style="color:#047857;font-weight:bold;">返回管理面板</a></p>
            </div>
        </div>
    `);

    // 后台发送审核通过邮件（不阻塞响应）
    sendMailFireAndForget({
        from: `"STC任务网站" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: '【STC】恭喜你通过审核，欢迎加入STC工会！',
        html: `
            <div style="font-family: 'Microsoft YaHei', Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #10b981, #34d399); padding: 30px; border-radius: 16px 16px 0 0;">
                    <h1 style="color: white; margin: 0; font-size: 24px; text-align: center;">审核通过 ✅</h1>
                </div>
                <div style="background: #ecfdf5; padding: 30px; border-radius: 0 0 16px 16px; border: 1px solid #a7f3d0;">
                    <p style="color: #475569; font-size: 16px;">您好，${application.gameId}！</p>
                    <p style="color: #475569; font-size: 16px;">恭喜你通过了 STC 工会的加入审核，欢迎你的到来！</p>
                    <p style="color: #475569; font-size: 16px;">请点击加入我们的QQ群：</p>
                    <div style="text-align:center;margin: 24px 0;">
                        <a href="https://qm.qq.com/q/12Gs3NNm2c" style="display:inline-block;padding:14px 36px;font-size:16px;font-weight:bold;color:white;text-decoration:none;border-radius:12px;background:#2563eb;">加入QQ群</a>
                    </div>
                    <div style="background: white; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #a7f3d0;">
                        <p style="margin: 0 0 10px; color:#475569;"><strong>你的账号信息：</strong></p>
                        <p style="margin: 0 0 8px; color:#475569;">用户名：<strong>${username}</strong></p>
                        <p style="margin: 0 0 8px; color:#475569;">邮箱：<strong>${email}</strong></p>
                        <p style="margin: 0; color:#475569;">密码：<strong>${password}</strong></p>
                    </div>
                    <p style="color: #64748b; font-size: 14px;">请使用以上账号密码在网站 <a href="${getSiteBaseUrl(req)}/login" style="color:#047857;">登录</a>，建议登录后及时修改密码。</p>
                </div>
                <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 20px 0 0;">© 2025 STC任务网站</p>
            </div>
        `
    }, 'JOIN-APPROVE');
});

// 驳回加入申请
app.get('/api/join/reject/:token', async (req, res) => {
    const token = req.params.token;
    if (!Array.isArray(db.data.join_applications)) db.data.join_applications = [];

    const application = db.data.join_applications.find(a => a.reject_token === token);
    if (!application) {
        return res.status(404).send(`<div style="font-family:'Microsoft YaHei';padding:40px;text-align:center;"><h1 style="color:#ef4444;">❌ 链接无效或已过期</h1><p>该审批链接不存在或已被使用。</p><a href="/" style="color:#6366f1;">返回首页</a></div>`);
    }
    if (application.status !== 'pending') {
        return res.status(400).send(`<div style="font-family:'Microsoft YaHei';padding:40px;text-align:center;"><h1>该申请已处理</h1><p>当前状态：<strong>${application.status}</strong></p><a href="/" style="color:#6366f1;">返回首页</a></div>`);
    }

    application.status = 'rejected';
    application.rejected_at = new Date().toISOString();
    await db.write();

    // 先返回页面，邮件改为后台发送（避免 SMTP 卡住导致页面一直转圈）
    res.send(`
        <div style="font-family:'Microsoft YaHei';padding:40px;text-align:center;max-width:500px;margin:0 auto;">
            <div style="background:linear-gradient(135deg,#ef4444,#f87171);padding:30px;border-radius:16px 16px 0 0;">
                <h1 style="color:white;margin:0;font-size:24px;">❌ 已驳回申请</h1>
            </div>
            <div style="background:#fef2f2;padding:30px;border-radius:0 0 16px 16px;border:1px solid #fecaca;">
                <p style="color:#475569;font-size:16px;">已驳回 <strong>${application.gameId}</strong>（QQ ${application.qq}）的加入申请。</p>
                <p style="color:#64748b;font-size:14px;">驳回通知邮件后台发送中。</p>
                <p><a href="/admin.html" style="color:#b91c1c;font-weight:bold;">返回管理面板</a></p>
            </div>
        </div>
    `);

    // 后台发送驳回通知邮件（不阻塞响应）
    sendMailFireAndForget({
        from: `"STC任务网站" <${process.env.EMAIL_USER}>`,
        to: application.email,
        subject: '【STC】加入申请未通过',
        html: `
            <div style="font-family: 'Microsoft YaHei', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #ef4444, #f87171); padding: 30px; border-radius: 16px 16px 0 0;">
                    <h1 style="color: white; margin: 0; font-size: 24px; text-align: center;">申请未通过</h1>
                </div>
                <div style="background: #fef2f2; padding: 30px; border-radius: 0 0 16px 16px; border: 1px solid #fecaca;">
                    <p style="color: #475569; font-size: 16px;">您好，${application.gameId}！</p>
                    <p style="color: #475569; font-size: 16px;">很遗憾，您的 STC 工会加入申请未通过管理员审批。</p>
                    <p style="color: #64748b; font-size: 14px;">如有疑问，请与管理员联系。</p>
                </div>
                <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 20px 0 0;">© 2025 STC任务网站</p>
            </div>
        `
    }, 'JOIN-REJECT');
});

function canModifyUser(currentUser, targetUser, action) {
    if (targetUser.username === 'REDACTED_USER') {
        return { allowed: false, reason: '不能操作超级管理员' };
    }
    
    if (targetUser.id === currentUser.id) {
        return { allowed: false, reason: '不能操作自己' };
    }
    
    switch (action) {
        case 'ban':
            if (!currentUser.is_super_admin && targetUser.is_admin) {
                return { allowed: false, reason: '普通管理员不能封禁其他管理员' };
            }
            break;
        case 'set_admin':
            if (!currentUser.is_super_admin) {
                return { allowed: false, reason: '只有超级管理员可以设置管理员' };
            }
            break;
        case 'set_superadmin':
            if (!currentUser.is_super_admin) {
                return { allowed: false, reason: '只有超级管理员可以设置超级管理员' };
            }
            break;
        case 'reset_password':
            if (!currentUser.is_super_admin && targetUser.is_super_admin) {
                return { allowed: false, reason: '普通管理员不能重置超级管理员密码' };
            }
            break;
        case 'delete':
            if (!currentUser.is_super_admin && targetUser.is_super_admin) {
                return { allowed: false, reason: '普通管理员不能删除超级管理员' };
            }
            break;
    }
    
    return { allowed: true };
}

app.get('/api/members', requireAdmin, async (req, res) => {
    const members = db.data.users.map(u => ({
        id: u.id,
        username: u.username,
        email: u.email,
        is_admin: u.is_admin,
        is_super_admin: u.is_super_admin,
        is_banned: u.is_banned,
        created_at: u.created_at,
        last_login_ip: u.lastLoginIp || '无',
        lastLoginTime: u.lastLoginTime || null
    }));
    res.json({ success: true, data: members });
});

// 管理员重置用户密码
app.put('/api/members/:id/reset-password', requireAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    try {
        const currentUser = req.currentUser;
        const user = db.data.users.find(u => u.id === parseInt(req.params.id));

        if (!user) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }

        const result = canModifyUser(currentUser, user, 'reset_password');
        if (!result.allowed) {
            return res.status(403).json({ success: false, message: result.reason });
        }

        const newPassword = req.body && req.body.newPassword ? req.body.newPassword : '123456';
        if (!validatePassword(newPassword)) {
            return res.status(400).json({ success: false, message: '密码长度至少6位' });
        }
        user.password = bcrypt.hashSync(newPassword, 10);
        await db.write();

        res.json({ success: true, message: `密码已重置为 ${newPassword}` });
    } catch (err) {
        console.error('重置密码失败:', err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

app.post('/api/members/:id/ban', requireAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    const currentUser = req.currentUser;
    const user = db.data.users.find(u => u.id === parseInt(req.params.id));
    
    if (!user) {
        return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    const result = canModifyUser(currentUser, user, 'ban');
    if (!result.allowed) {
        return res.status(403).json({ success: false, message: result.reason });
    }
    
    user.is_banned = true;
    await db.write();
    
    res.json({ success: true, message: '用户已封禁' });
});

app.post('/api/members/:id/unban', requireAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    const currentUser = req.currentUser;
    const user = db.data.users.find(u => u.id === parseInt(req.params.id));
    
    if (!user) {
        return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    const result = canModifyUser(currentUser, user, 'ban');
    if (!result.allowed) {
        return res.status(403).json({ success: false, message: result.reason });
    }
    
    user.is_banned = false;
    await db.write();
    
    res.json({ success: true, message: '用户已解封' });
});

app.post('/api/members/:id/set_admin', requireAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    const currentUser = req.currentUser;
    const user = db.data.users.find(u => u.id === parseInt(req.params.id));
    
    if (!user) {
        return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    const result = canModifyUser(currentUser, user, 'set_admin');
    if (!result.allowed) {
        return res.status(403).json({ success: false, message: result.reason });
    }
    
    user.is_admin = true;
    await db.write();
    
    res.json({ success: true, message: '用户已设为管理员' });
});

app.post('/api/members/:id/unset_admin', requireAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    const currentUser = req.currentUser;
    const user = db.data.users.find(u => u.id === parseInt(req.params.id));
    
    if (!user) {
        return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    const result = canModifyUser(currentUser, user, 'set_admin');
    if (!result.allowed) {
        return res.status(403).json({ success: false, message: result.reason });
    }
    
    user.is_admin = false;
    await db.write();
    
    res.json({ success: true, message: '用户管理员权限已移除' });
});

app.delete('/api/members/:id', requireAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    const currentUser = req.currentUser;
    const user = db.data.users.find(u => u.id === parseInt(req.params.id));
    
    if (!user) {
        return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    const result = canModifyUser(currentUser, user, 'delete');
    if (!result.allowed) {
        return res.status(403).json({ success: false, message: result.reason });
    }
    
    db.data.users = db.data.users.filter(u => u.id !== parseInt(req.params.id));
    await db.write();
    
    res.json({ success: true, message: '用户已删除' });
});

// 留言管理API
app.get('/api/messages', requireAdmin, async (req, res) => {
    const messages = db.data.messages || [];
    res.json({ success: true, data: messages });
});

// 邀请码管理API
app.get('/api/invite-codes', requireAdmin, async (req, res) => {
    const codes = db.data.inviteCodes || [];
    res.json({ success: true, data: codes });
});

app.post('/api/invite-codes', requireAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    const code = 'STC' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const newCode = {
        id: Date.now(),
        code: code,
        is_used: false,
        created_by: req.currentUser.id,
        created_at: new Date().toISOString()
    };
    if (!db.data.inviteCodes) db.data.inviteCodes = [];
    db.data.inviteCodes.push(newCode);
    await db.write();
    res.json({ success: true, data: newCode, code: code });
});

app.delete('/api/invite-codes/:id', requireAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    const id = parseInt(req.params.id) || parseFloat(req.params.id);
    if (!db.data.inviteCodes) db.data.inviteCodes = [];
    db.data.inviteCodes = db.data.inviteCodes.filter(c => c.id !== id);
    await db.write();
    res.json({ success: true, message: '邀请码已删除' });
});

app.post('/api/console/create_user', requireAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    const { username, email, password, isAdmin } = req.body;
    
    if (!username || !email || !password) {
        return res.status(400).json({ success: false, message: '请填写所有字段' });
    }
    
    if (db.data.users.find(u => u.username === username)) {
        return res.status(400).json({ success: false, message: '用户名已存在' });
    }
    
    if (db.data.users.find(u => u.email === email)) {
        return res.status(400).json({ success: false, message: '该邮箱已被注册' });
    }
    
    const hash = bcrypt.hashSync(password, 10);
    const newUser = {
        id: Date.now(),
        username: username,
        email: email,
        password: hash,
        is_admin: !!isAdmin,
        is_super_admin: false,
        is_banned: false,
        login_attempts: 0,
        created_at: new Date().toISOString()
    };
    
    db.data.users.push(newUser);
    await db.write();
    
    res.json({ success: true, message: `用户 ${username} 创建成功`, user: { id: newUser.id, username, email } });
});

const isLocalDev = !process.env.VERCEL && !process.env.RAILWAY;
if (isLocalDev) {
    app.post('/api/console/stop', requireLogin, requireAdmin, requireRateLimit('admin'), requireCSRF, (req, res) => {
        console.log('服务器被管理员停止');
        res.json({ success: true, message: '服务器已停止' });
        setTimeout(() => process.exit(0), 1000);
    });

    app.post('/api/console/restart', requireLogin, requireAdmin, requireRateLimit('admin'), requireCSRF, (req, res) => {
        console.log('服务器被管理员重启');
        res.json({ success: true, message: '服务器正在重启...' });
        
        setTimeout(() => {
            if (IS_VERCEL) {
                console.log('Vercel Serverless 环境不支持重启');
                return;
            }
            const restartScript = 'node';
            const args = ['server.js'];
            const options = {
                detached: true,
                stdio: ['ignore', 'ignore', 'ignore'],
                cwd: __dirname
            };
            
            if (!isSafePath(__dirname, process.cwd())) {
                console.error('非法工作目录');
                return;
            }
            
            const child = spawn(restartScript, args, options);
            child.unref();
            process.exit(0);
        }, 1000);
    });
}

// ---------- KV 持久化备份（Vercel 环境使用） ----------
const KV_BACKUP_LIST = 'stc:backup:list';
const KV_BACKUP_PREFIX = 'stc:backup:';
const KV_BACKUP_CHUNK_SIZE = 400 * 1024; // 每块 400KB 原始字节（base64 后约 533KB，安全低于 KV 单 key 限制）

async function _kvBackupSave(name, data, time, files) {
    const json = JSON.stringify(data);
    const buf = Buffer.from(json, 'utf-8');
    const chunks = [];
    for (let i = 0; i < buf.length; i += KV_BACKUP_CHUNK_SIZE) {
        chunks.push(buf.slice(i, i + KV_BACKUP_CHUNK_SIZE).toString('base64'));
    }
    const meta = { name, time, size: buf.length, files, chunks: chunks.length, storage: 'kv' };
    await _kvSet(KV_BACKUP_PREFIX + name + ':meta', meta);
    for (let i = 0; i < chunks.length; i++) {
        await _kvSet(KV_BACKUP_PREFIX + name + ':chunk:' + i, chunks[i]);
    }
    const list = (await _kvGet(KV_BACKUP_LIST)) || [];
    list.unshift(meta);
    await _kvSet(KV_BACKUP_LIST, list);
    return meta;
}

async function _kvBackupLoad(name) {
    const meta = await _kvGet(KV_BACKUP_PREFIX + name + ':meta');
    if (!meta) return null;
    const parts = [];
    for (let i = 0; i < meta.chunks; i++) {
        const chunk = await _kvGet(KV_BACKUP_PREFIX + name + ':chunk:' + i);
        if (!chunk) return null;
        parts.push(chunk);
    }
    try {
        const json = Buffer.from(parts.join(''), 'base64').toString('utf-8');
        return { meta, data: JSON.parse(json) };
    } catch (e) {
        return null;
    }
}

async function _kvBackupDelete(name) {
    const meta = await _kvGet(KV_BACKUP_PREFIX + name + ':meta');
    if (meta) {
        for (let i = 0; i < meta.chunks; i++) {
            await _kvDel(KV_BACKUP_PREFIX + name + ':chunk:' + i);
        }
        await _kvDel(KV_BACKUP_PREFIX + name + ':meta');
    }
    const list = (await _kvGet(KV_BACKUP_LIST)) || [];
    await _kvSet(KV_BACKUP_LIST, list.filter(b => b.name !== name));
}

// 网站备份API（仅超级管理员）
async function createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `backup-${timestamp}`;

    // Vercel/KV 环境：备份持久化到 KV（重启不丢失）
    if (KV_ENABLED && kv) {
        const dbData = db._data || {};
        const meta = await _kvBackupSave(backupName, dbData, new Date().toISOString(), ['database.json']);
        lastBackupTime = new Date();
        lastBackupInfo = {
            name: backupName,
            path: 'kv://' + backupName,
            time: lastBackupTime.toISOString(),
            files: meta.files,
            storage: 'kv'
        };
        return lastBackupInfo;
    }

    // 本地/Zeabur 环境：文件备份
    try {
        const backupDir = path.join(runtimeDir, 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        const backupPath = path.join(backupDir, backupName);
        
        fs.mkdirSync(backupPath, { recursive: true });
        
        if (fs.existsSync(dbPath)) {
            fs.copyFileSync(dbPath, path.join(backupPath, 'database.json'));
        }
        
        const importantFiles = ['server.js', 'package.json'];
        importantFiles.forEach(file => {
            const filePath = path.join(__dirname, file);
            if (fs.existsSync(filePath)) {
                fs.copyFileSync(filePath, path.join(backupPath, file));
            }
        });
        
        const publicDir = path.join(__dirname, 'public');
        if (fs.existsSync(publicDir)) {
            const publicBackup = path.join(backupPath, 'public');
            fs.mkdirSync(publicBackup, { recursive: true });
            
            const copyDir = (src, dest) => {
                const entries = fs.readdirSync(src, { withFileTypes: true });
                entries.forEach(entry => {
                    const srcPath = path.join(src, entry.name);
                    const destPath = path.join(dest, entry.name);
                    if (entry.isDirectory()) {
                        fs.mkdirSync(destPath, { recursive: true });
                        copyDir(srcPath, destPath);
                    } else {
                        fs.copyFileSync(srcPath, destPath);
                    }
                });
            };
            copyDir(publicDir, publicBackup);
        }
        
        lastBackupTime = new Date();
        lastBackupInfo = {
            name: backupName,
            path: backupPath,
            time: lastBackupTime.toISOString(),
            files: ['database.json', 'server.js', 'package.json', 'public/']
        };
        
        return lastBackupInfo;
    } catch (error) {
        throw error;
    }
}

function startAutoBackup(timeStr) {
    if (autoBackupTimer) {
        clearInterval(autoBackupTimer);
        clearTimeout(autoBackupTimer);
        autoBackupTimer = null;
    }
    
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        throw new Error('无效的时间格式，请使用 HH:MM 格式');
    }
    
    autoBackupEnabled = true;
    autoBackupTime = timeStr;
    
    const scheduleBackup = () => {
        const now = new Date();
        const target = new Date();
        target.setHours(hours, minutes, 0, 0);
        
        if (target <= now) {
            target.setDate(target.getDate() + 1);
        }
        
        const delay = target.getTime() - now.getTime();
        
        addServerLog(`自动备份已计划: ${timeStr} (北京时间)，延迟 ${Math.floor(delay / 1000)} 秒`, 'info');
        
        autoBackupTimer = setTimeout(() => {
            createBackup().then(info => {
                addServerLog(`自动备份完成: ${info.name}`, 'info');
            }).catch(err => {
                addServerLog(`自动备份失败: ${err.message}`, 'error');
            });
            
            autoBackupTimer = setInterval(() => {
                createBackup().then(info => {
                    addServerLog(`自动备份完成: ${info.name}`, 'info');
                }).catch(err => {
                    addServerLog(`自动备份失败: ${err.message}`, 'error');
                });
            }, 24 * 60 * 60 * 1000);
        }, delay);
    };
    
    scheduleBackup();
}

function stopAutoBackup() {
    if (autoBackupTimer) {
        clearInterval(autoBackupTimer);
        clearTimeout(autoBackupTimer);
        autoBackupTimer = null;
    }
    autoBackupEnabled = false;
}

app.post('/api/admin/backup', requireSuperAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    try {
        const backup = await createBackup();
        res.json({ 
            success: true, 
            message: '备份完成',
            backup: backup
        });
    } catch (error) {
        res.status(500).json({ success: false, message: '备份失败: ' + error.message });
    }
});

// 查看备份信息API
app.get('/api/admin/backup-info', requireSuperAdmin, (req, res) => {
    res.json({
        success: true,
        lastBackup: lastBackupTime ? {
            time: lastBackupTime.toISOString(),
            info: lastBackupInfo
        } : null,
        autoBackup: {
            enabled: autoBackupEnabled,
            time: autoBackupTime
        }
    });
});

// 设置自动备份API
app.post('/api/admin/auto-backup', requireSuperAdmin, requireRateLimit('admin'), requireCSRF, (req, res) => {
    const { time } = req.body;
    
    if (!time) {
        return res.json({ success: false, message: '请指定备份时间' });
    }
    
    try {
        startAutoBackup(time);
        res.json({ 
            success: true, 
            message: `自动备份已设置为每天 ${time} (北京时间)`,
            autoBackup: {
                enabled: autoBackupEnabled,
                time: autoBackupTime
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 关闭自动备份API
app.post('/api/admin/auto-backup/stop', requireSuperAdmin, requireRateLimit('admin'), requireCSRF, (req, res) => {
    stopAutoBackup();
    res.json({ 
        success: true, 
        message: '自动备份已关闭',
        autoBackup: {
            enabled: autoBackupEnabled,
            time: autoBackupTime
        }
    });
});

// 获取所有备份列表API
app.get('/api/admin/backups', requireSuperAdmin, async (req, res) => {
    try {
        // KV 模式：从 KV 读取备份列表（持久化，重启不丢失）
        if (KV_ENABLED && kv) {
            const list = (await _kvGet(KV_BACKUP_LIST)) || [];
            const backups = list.map(meta => ({
                name: meta.name,
                path: 'kv://' + meta.name,
                created: meta.time,
                size: meta.size,
                storage: 'kv'
            }));
            return res.json({ success: true, backups });
        }

        const backupDir = path.join(runtimeDir, 'backups');
        if (!fs.existsSync(backupDir)) {
            return res.json({ success: true, backups: [] });
        }
        
        const backups = fs.readdirSync(backupDir, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => {
                const backupPath = path.join(backupDir, entry.name);
                const stats = fs.statSync(backupPath);
                return {
                    name: entry.name,
                    path: backupPath,
                    created: stats.birthtime.toISOString(),
                    size: getDirSize(backupPath)
                };
            })
            .sort((a, b) => new Date(b.created) - new Date(a.created));
        
        res.json({ success: true, backups });
    } catch (error) {
        res.status(500).json({ success: false, message: '获取备份列表失败: ' + error.message });
    }
});

// 获取目录大小
function getDirSize(dirPath) {
    let size = 0;
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                size += getDirSize(fullPath);
            } else {
                size += fs.statSync(fullPath).size;
            }
        }
    } catch (e) {}
    return size;
}

// 回滚到指定备份API
app.post('/api/admin/rollback', requireSuperAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    const { backupName } = req.body;
    
    if (!backupName) {
        return res.status(400).json({ success: false, message: '请指定备份名称' });
    }
    
    try {
        // KV 模式：从 KV 恢复备份
        if (KV_ENABLED && kv) {
            const backup = await _kvBackupLoad(backupName);
            if (!backup) {
                return res.status(404).json({ success: false, message: '备份不存在' });
            }
            
            // 备份当前数据库（作为回滚前的备份）
            let preName = null;
            try {
                const preTs = new Date().toISOString().replace(/[:.]/g, '-');
                preName = `pre-rollback-${Date.now()}`;
                await _kvBackupSave(preName, db._data || {}, new Date().toISOString(), ['database.json']);
            } catch (e) {
                console.warn('[备份] 回滚前自动备份失败:', e.message);
            }
            
            // 恢复数据库到 KV 和本地缓存
            db._data = backup.data;
            db._ensureDefaults();
            await db._saveKv();
            db._writeFileSync();
            db._kvReadAt = 0;
            
            res.json({ 
                success: true, 
                message: '已回滚到备份: ' + backupName,
                preBackup: preName
            });
            return;
        }

        const backupDir = path.join(runtimeDir, 'backups');
        const backupPath = path.join(backupDir, backupName);
        
        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ success: false, message: '备份不存在' });
        }
        
        // 备份当前数据库（作为回滚前的备份）
        let preBackup = null;
        if (fs.existsSync(dbPath)) {
            preBackup = path.join(backupDir, `pre-rollback-${Date.now()}`);
            fs.mkdirSync(preBackup, { recursive: true });
            fs.copyFileSync(dbPath, path.join(preBackup, 'database.json'));
        }
        
        // 恢复数据库
        const backupDb = path.join(backupPath, 'database.json');
        if (!fs.existsSync(backupDb)) {
            return res.status(404).json({ success: false, message: '备份中没有数据库文件' });
        }
        
        fs.copyFileSync(backupDb, dbPath);
        
        // 重新加载数据库
        await db.read();
        
        res.json({ 
            success: true, 
            message: '已回滚到备份: ' + backupName,
            preBackup: preBackup ? path.basename(preBackup) : null
        });
    } catch (error) {
        res.status(500).json({ success: false, message: '回滚失败: ' + error.message });
    }
});

// 删除指定备份API
app.delete('/api/admin/backup/:name', requireSuperAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    const { name } = req.params;
    
    if (!name) {
        return res.status(400).json({ success: false, message: '请指定备份名称' });
    }
    
    try {
        // KV 模式：从 KV 删除备份
        if (KV_ENABLED && kv) {
            const meta = await _kvGet(KV_BACKUP_PREFIX + name + ':meta');
            if (!meta) {
                return res.status(404).json({ success: false, message: '备份不存在' });
            }
            await _kvBackupDelete(name);
            return res.json({ success: true, message: '已删除备份: ' + name });
        }

        const backupDir = path.join(runtimeDir, 'backups');
        const backupPath = path.join(backupDir, name);
        
        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ success: false, message: '备份不存在' });
        }
        
        // 递归删除目录
        fs.rmSync(backupPath, { recursive: true, force: true });
        
        res.json({ success: true, message: '已删除备份: ' + name });
    } catch (error) {
        res.status(500).json({ success: false, message: '删除备份失败: ' + error.message });
    }
});

// 锁定数据库API
app.post('/api/admin/db-lock', requireSuperAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    const { reason } = req.body;
    
    if (dbLocked) {
        return res.json({ success: false, message: '数据库已被锁定' });
    }
    
    dbLocked = true;
    dbLockReason = reason || '管理员锁定';
    dbLockTime = new Date();
    
    res.json({
        success: true,
        message: '数据库已锁定',
        lockInfo: {
            reason: dbLockReason,
            time: dbLockTime.toISOString()
        }
    });
});

// 查看数据库状态API
app.get('/api/admin/db-status', requireSuperAdmin, (req, res) => {
    res.json({
        success: true,
        status: {
            locked: dbLocked,
            lockReason: dbLockReason,
            lockTime: dbLockTime ? dbLockTime.toISOString() : null,
            dataSize: JSON.stringify(db.data).length,
            usersCount: db.data.users.length,
            tasksCount: db.data.tasks.length
        }
    });
});

// 解锁数据库API
app.post('/api/admin/db-unlock', requireSuperAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    if (!dbLocked) {
        return res.json({ success: false, message: '数据库未被锁定' });
    }
    
    dbLocked = false;
    dbLockReason = '';
    dbLockTime = null;
    
    res.json({ success: true, message: '数据库已解锁' });
});

// 网站锁定API - 管理员可用
app.post('/api/admin/site-lock', requireAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    const { reason } = req.body;
    const currentUser = req.currentUser;
    
    siteLocked = true;
    siteLockReason = reason || '维护中';
    siteLockBy = currentUser ? currentUser.username : '未知';
    siteLockTime = new Date().toISOString();
    
    // 广播锁定事件给所有连接的客户端（先通知，再清除session）
    const lockEvent = JSON.stringify({
        type: 'site-locked',
        lockBy: siteLockBy,
        lockReason: siteLockReason
    });
    siteEventsClients.forEach(client => {
        try {
            client.write('data: ' + lockEvent + '\n\n');
        } catch (e) {
            // 忽略发送失败的客户端
        }
    });
    
    // 清除所有非管理员用户的session
    const sessionsDir = './sessions';
    if (fs.existsSync(sessionsDir)) {
        const sessionFiles = fs.readdirSync(sessionsDir);
        for (const file of sessionFiles) {
            try {
                const sessionPath = path.join(sessionsDir, file);
                const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
                
                // 检查session中的用户是否是管理员
                if (sessionData.userId) {
                    const sessionUser = db.data.users.find(u => u.id === sessionData.userId);
                    if (sessionUser && !sessionUser.is_admin && !sessionUser.is_super_admin) {
                        // 删除非管理员用户的session文件
                        fs.unlinkSync(sessionPath);
                    }
                }
            } catch (e) {
                // 忽略解析错误的文件
            }
        }
    }
    
    // 广播锁定消息给所有连接的客户端
    addServerLog(`网站已被 ${siteLockBy} 锁定: ${siteLockReason}`, 'warn');
    addServerLog('所有非管理员用户已被强制退出登录', 'warn');
    
    res.json({ 
        success: true, 
        message: '网站已锁定',
        lockBy: siteLockBy,
        lockReason: siteLockReason
    });
});

// 网站解锁API - 仅超级管理员
app.post('/api/admin/site-unlock', requireAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    if (!siteLocked) {
        return res.json({ success: false, message: '网站未被锁定' });
    }
    
    const currentUser = req.currentUser;
    const unlockedBy = currentUser ? currentUser.username : '未知';
    
    siteLocked = false;
    siteLockReason = '';
    siteLockBy = '';
    siteLockTime = null;
    
    addServerLog(`网站已被 ${unlockedBy} 解锁`, 'system');
    
    res.json({ success: true, message: '网站已解锁' });
});

// 网站状态API - 仅超级管理员
app.get('/api/admin/site-status', requireAdmin, async (req, res) => {
    res.json({
        success: true,
        locked: siteLocked,
        lockReason: siteLockReason,
        lockBy: siteLockBy,
        lockTime: siteLockTime
    });
});

app.post('/api/ban-ip', requireSuperAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    const { ip, reason } = req.body;
    
    if (!ip) {
        return res.status(400).json({ success: false, message: '请输入IP地址' });
    }
    
    bannedIPs.add(ip);
    
    if (!db.data.banned_ips) {
        db.data.banned_ips = [];
    }
    
    if (!db.data.banned_ips.includes(ip)) {
        db.data.banned_ips.push(ip);
        db.data.banned_ip_info = db.data.banned_ip_info || [];
        db.data.banned_ip_info.push({
            ip: ip,
            reason: reason || '违规操作',
            banned_by: req.currentUser.id,
            banned_at: new Date().toISOString()
        });
        await db.write();
    }
    
    res.json({ success: true, message: 'IP已封禁' });
});

app.get('/api/ban-ips', requireSuperAdmin, async (req, res) => {
    res.json({ success: true, data: db.data.banned_ip_info || [] });
});

app.post('/api/unban-ip', requireSuperAdmin, requireRateLimit('admin'), requireCSRF, async (req, res) => {
    const { ip } = req.body;
    
    if (!ip) {
        return res.status(400).json({ success: false, message: '请输入IP地址' });
    }
    
    bannedIPs.delete(ip);
    
    if (db.data.banned_ips) {
        db.data.banned_ips = db.data.banned_ips.filter(i => i !== ip);
    }
    
    if (db.data.banned_ip_info) {
        db.data.banned_ip_info = db.data.banned_ip_info.filter(i => i.ip !== ip);
    }
    
    await db.write();
    
    res.json({ success: true, message: 'IP已解封' });
});

app.use((req, res, next) => {
    const ip = getClientIP(req);
    
    if (bannedIPs.has(ip)) {
        return res.status(403).json({ success: false, message: '您的IP已被封禁' });
    }
    
    next();
});

app.get('/api/logs', requireAdmin, (req, res) => {
    var since = req.query.since;
    if (since && typeof since === 'string') {
        var sinceParts = since.split('-');
        var sinceTimestamp = parseInt(sinceParts[0], 10);
        var sinceSeq = sinceParts[1] ? parseInt(sinceParts[1], 10) : 0;
        if (!isNaN(sinceTimestamp) && !isNaN(sinceSeq)) {
            var filteredLogs = serverLogs.filter(function(log) {
                if (!log.id) return false;
                var logParts = log.id.split('-');
                var logTimestamp = parseInt(logParts[0], 10);
                var logSeq = logParts[1] ? parseInt(logParts[1], 10) : 0;
                if (logTimestamp > sinceTimestamp) return true;
                if (logTimestamp === sinceTimestamp && logSeq > sinceSeq) return true;
                return false;
            });
            res.json({ success: true, data: filteredLogs });
            return;
        }
    }
    res.json({ success: true, data: serverLogs });
});

app.get('/api/logs/sse', requireAdmin, (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    
    // 发送初始连接成功消息
    res.write('data: ' + JSON.stringify({id: generateLogId(), message: '日志连接已建立', type: 'system'}) + '\n\n');
    
    sseClients.push(res);
    
    // 心跳机制 - 每10秒发送心跳保持连接
    var heartbeat = setInterval(function() {
        try {
            res.write(': heartbeat\n\n');
        } catch (e) {
            clearInterval(heartbeat);
            sseClients = sseClients.filter(function(client) { return client !== res; });
        }
    }, 10000);
    
    // 优雅重连机制
    // Vercel Serverless 函数有平台超时限制（免费版约10秒，Pro 60秒），
    // 若等平台强制掐断连接，前端会走"已断开"路径反复闪烁。
    // 因此 Vercel 上缩短到 8 秒主动断开，让前端收到 reconnect 事件静默重连。
    var reconnectDelay = IS_VERCEL ? 8000 : 25000;
    var reconnectTimer = setTimeout(function() {
        try {
            res.write('data: ' + JSON.stringify({ type: 'reconnect', message: '连接即将超时，请重连', time: new Date().toISOString() }) + '\n\n');
        } catch (e) {
            // 忽略写入错误
        }
        setTimeout(function() {
            clearInterval(heartbeat);
            sseClients = sseClients.filter(function(client) { return client !== res; });
            try {
                res.end();
            } catch (e) {
                // 忽略结束错误
            }
        }, 1000);
    }, reconnectDelay);
    
    req.on('close', function() {
        clearInterval(heartbeat);
        clearTimeout(reconnectTimer);
        sseClients = sseClients.filter(function(client) { return client !== res; });
    });
});

// 公开的网站事件SSE端点（用于网站锁定通知）
app.get('/api/site-events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    
    // 发送初始连接成功消息
    res.write('data: ' + JSON.stringify({type: 'connected'}) + '\n\n');
    
    siteEventsClients.push(res);
    
    // 心跳机制 - 每15秒发送心跳保持连接
    const heartbeat = setInterval(() => {
        try {
            res.write(': heartbeat\n\n');
        } catch (e) {
            clearInterval(heartbeat);
            siteEventsClients = siteEventsClients.filter(client => client !== res);
        }
    }, 15000);
    
    req.on('close', () => {
        clearInterval(heartbeat);
        siteEventsClients = siteEventsClients.filter(client => client !== res);
    });
});

// 访问日志中间件 - 记录IP访问页面
app.use((req, res, next) => {
    // 只记录页面访问，不记录静态资源和API
    if (!req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/) && 
        !req.path.startsWith('/api/')) {
        const ip = getClientIP(req);
        const time = new Date().toLocaleString();
        const page = req.path || '/';
        addServerLog(`[${ip}] ${time} 访问页面: ${page}`, 'info');
    }
    next();
});

const startPromise = (async () => {
    await initDatabase();
    await loadBannedIPs();

    // 持久化警告：Vercel 上必须配置 KV，否则数据只存在于 /tmp 临时文件系统，实例回收即丢失
    if (IS_VERCEL && !KV_ENABLED) {
        console.warn('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        console.warn('!! [WARN] Vercel 环境未检测到 KV 配置（KV_REST_API_URL / KV_REST_API_TOKEN）');
        console.warn('!! 数据将只写入 /tmp 临时文件，实例回收后任务/用户等数据会丢失！');
        console.warn('!! 请在 Vercel 控制台创建 KV Database 并绑定环境变量后再部署。');
        console.warn('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    } else if (KV_ENABLED) {
        console.log('[KV] 持久化已启用（Vercel KV），数据将以 KV 为准');
    }
    
    if (!process.env.VERCEL && !process.env.RAILWAY) {
        app.listen(PORT, () => {
            console.log(`服务器运行在 http://localhost:${PORT}`);
        });
    }
})();

const isDevelopment = !process.env.VERCEL && !process.env.RAILWAY;

if (isZeabur) {
    setInterval(async () => {
        try {
            await db.read();
            await db.write();
        } catch (e) {}
    }, 30000);
}

async function ensureReady() {
    await startPromise;
    console.log('[Vercel] Server ready, app listening');
    return app;
}

// 数据库导出/导入API（用于Vercel等Serverless环境的数据持久化）
app.get('/api/db/export', requireSuperAdmin, async (req, res) => {
    try {
        const data = db._data;
        const json = JSON.stringify(data, null, 2);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="database.json"');
        res.send(json);
    } catch (error) {
        res.status(500).json({ success: false, message: '导出失败: ' + error.message });
    }
});

app.post('/api/db/import', requireSuperAdmin, express.json({ limit: '10mb' }), requireRateLimit('admin'), requireCSRF, async (req, res) => {
    try {
        const newData = req.body;
        if (!newData || typeof newData !== 'object') {
            return res.status(400).json({ success: false, message: '无效的数据库文件' });
        }
        db._data = newData;
        db._ensureDefaults();
        await db.write();
        res.json({ success: true, message: '数据库导入成功' });
    } catch (error) {
        res.status(500).json({ success: false, message: '导入失败: ' + error.message });
    }
});

// ============================================================
// AstrBot 机器人集成 API
// ============================================================
// 安全修复：机器人 API Key 必须由环境变量提供，未设置时使用进程内随机值
const BOT_API_KEY = process.env.BOT_API_KEY || crypto.randomBytes(16).toString('hex');

// 机器人状态缓存（跨Vercel实例通过数据库共享）
async function ensureBotCollections() {
    await db.read();
    if (!db.data.bot_instances) db.data.bot_instances = [];       // 机器人在线状态
    if (!db.data.bot_messages) db.data.bot_messages = [];        // 收到的消息
    if (!db.data.bot_send_queue) db.data.bot_send_queue = [];    // 待发送队列
    if (!db.data.bot_send_results) db.data.bot_send_results = []; // 发送结果
}

// 验证机器人 API Key
function verifyBotKey(req) {
    const headerKey = req.headers['x-bot-key'] || req.headers['authorization']?.replace('Bearer ', '');
    return headerKey === BOT_API_KEY;
}

// 机器人连接/长轮询（获取待发送消息）
app.post('/api/bot/connect', requireRateLimit('email'), async (req, res) => {
    if (!verifyBotKey(req)) {
        return res.status(401).json({ success: false, message: '无效的 API Key' });
    }

    try {
        await ensureBotCollections();
        const { platform, bot_id, nickname, session_count = 0, sessions = [] } = req.body || {};
        const now = Date.now();

        // 更新/注册机器人实例状态
        const existingIdx = db.data.bot_instances.findIndex(b => b.bot_id === bot_id && b.platform === platform);
        const instanceData = {
            platform: platform || 'unknown',
            bot_id: bot_id || '',
            nickname: nickname || '',
            session_count: session_count,
            sessions: sessions || [],
            last_seen: now,
            first_seen: existingIdx >= 0 ? db.data.bot_instances[existingIdx].first_seen : now,
        };

        if (existingIdx >= 0) {
            db.data.bot_instances[existingIdx] = { ...db.data.bot_instances[existingIdx], ...instanceData };
        } else {
            db.data.bot_instances.push(instanceData);
        }

        // 清理超过5分钟未在线的机器人
        db.data.bot_instances = db.data.bot_instances.filter(b => now - b.last_seen < 5 * 60 * 1000);

        // 获取待发送的消息（取出并从队列删除）
        const toSend = db.data.bot_send_queue.slice(0, 20); // 最多20条
        db.data.bot_send_queue = db.data.bot_send_queue.slice(20);

        await db.write();

        res.json({
            success: true,
            bot_instances: db.data.bot_instances,
            messages: toSend, // 待发送的消息
            poll_interval: 2000, // 建议轮询间隔 (ms)
            server_time: now,
        });
    } catch (e) {
        console.error('[BOT] Connect error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 机器人上报消息发送结果
app.post('/api/bot/report-send-result', requireRateLimit('email'), async (req, res) => {
    if (!verifyBotKey(req)) {
        return res.status(401).json({ success: false, message: '无效的 API Key' });
    }

    try {
        await ensureBotCollections();
        const { request_id, success, message } = req.body || {};
        const result = {
            request_id,
            success: !!success,
            message: message || '',
            reported_at: Date.now(),
        };

        db.data.bot_send_results.push(result);
        // 限制结果数量
        if (db.data.bot_send_results.length > 500) {
            db.data.bot_send_results = db.data.bot_send_results.slice(-500);
        }

        await db.write();
        res.json({ success: true });
    } catch (e) {
        console.error('[BOT] Report send result error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 机器人上报收到的消息
app.post('/api/bot/report-message', requireRateLimit('email'), async (req, res) => {
    if (!verifyBotKey(req)) {
        return res.status(401).json({ success: false, message: '无效的 API Key' });
    }

    try {
        await ensureBotCollections();
        const msg = req.body || {};

        const record = {
            id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
            session_key: msg.session_key,
            message_type: msg.message_type,  // group / private
            group_id: msg.group_id,
            group_name: msg.group_name,
            sender_id: msg.sender_id,
            sender_name: msg.sender_name,
            message_text: msg.message_text,
            images: msg.images || [],
            umo: msg.umo,
            session_id: msg.session_id,
            timestamp: msg.timestamp || Date.now(),
            platform: msg.platform || (req.body && req.body.platform) || 'unknown',
            bot_id: msg.bot_id || (req.body && req.body.bot_id) || '',
        };

        db.data.bot_messages.push(record);
        // 限制消息数量
        if (db.data.bot_messages.length > 5000) {
            db.data.bot_messages = db.data.bot_messages.slice(-5000);
        }

        await db.write();
        res.json({ success: true, id: record.id });
    } catch (e) {
        console.error('[BOT] Report message error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 管理员：查看机器人状态
app.get('/api/bot/status', requireAdmin, async (req, res) => {
    try {
        await ensureBotCollections();
        const now = Date.now();
        // 刷新在线状态：超过2分钟未上报视为离线
        const instances = db.data.bot_instances.map(b => ({
            ...b,
            online: now - b.last_seen < 2 * 60 * 1000,
            last_seen_str: new Date(b.last_seen).toLocaleString('zh-CN'),
            first_seen_str: new Date(b.first_seen).toLocaleString('zh-CN'),
        }));

        res.json({
            success: true,
            instances,
            send_queue_size: db.data.bot_send_queue.length,
            received_messages_count: db.data.bot_messages.length,
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 管理员：获取机器人收到的消息（分页）
app.get('/api/bot/messages', requireAdmin, async (req, res) => {
    try {
        await ensureBotCollections();
        const page = parseInt(req.query.page) || 1;
        const pageSize = parseInt(req.query.pageSize) || 50;
        const type = req.query.type;    // 'group' / 'private' 过滤
        const q = req.query.q;          // 关键词搜索

        let messages = [...db.data.bot_messages].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        if (type) {
            messages = messages.filter(m => m.message_type === type);
        }
        if (q) {
            const lower = String(q).toLowerCase();
            messages = messages.filter(m =>
                (m.sender_name || '').toLowerCase().includes(lower) ||
                (m.message_text || '').toLowerCase().includes(lower) ||
                (m.group_name || '').toLowerCase().includes(lower) ||
                String(m.sender_id || '').includes(lower) ||
                String(m.group_id || '').includes(lower)
            );
        }

        const total = messages.length;
        const paged = messages.slice((page - 1) * pageSize, page * pageSize);

        res.json({
            success: true,
            total,
            page,
            pageSize,
            messages: paged,
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 管理员：发送消息（加入发送队列）
app.post('/api/bot/send', requireAdmin, requireRateLimit('email'), requireCSRF, async (req, res) => {
    try {
        await ensureBotCollections();
        const { target_type, target_id, content, image_url, group_id, user_id } = req.body || {};

        // 同时支持 target_type+target_id 或 group_id/user_id
        const finalType = target_type || (group_id ? 'group' : (user_id ? 'private' : null));
        const finalTargetId = target_id || group_id || user_id || '';

        if (!finalType || !finalTargetId) {
            return res.status(400).json({ success: false, message: '请指定目标类型和目标ID (group_id 或 user_id)' });
        }
        if (!content && !image_url) {
            return res.status(400).json({ success: false, message: '请填写内容或图片' });
        }

        const request_id = 'req_' + Date.now().toString() + Math.random().toString(36).slice(2, 6);

        const sendTask = {
            request_id,
            target_type: finalType,
            target_id: String(finalTargetId),
            content: content || '',
            image_url: image_url || '',
            created_by: (req.authUser?.username) || (req.session.username) || 'admin',
            created_at: Date.now(),
        };

        db.data.bot_send_queue.push(sendTask);
        await db.write();

        res.json({
            success: true,
            request_id,
            message: '消息已加入发送队列，请等待机器人下一次轮询',
            queue_position: db.data.bot_send_queue.length,
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 管理员：查询发送结果
app.get('/api/bot/send-result/:request_id', requireAdmin, async (req, res) => {
    try {
        await ensureBotCollections();
        const { request_id } = req.params;

        // 先找发送结果
        const result = db.data.bot_send_results.find(r => r.request_id === request_id);
        if (result) {
            return res.json({
                success: true,
                status: 'completed',
                result,
            });
        }

        // 再查队列
        const inQueue = db.data.bot_send_queue.find(r => r.request_id === request_id);
        if (inQueue) {
            return res.json({
                success: true,
                status: 'queued',
                queue_position: db.data.bot_send_queue.indexOf(inQueue) + 1,
                queue_size: db.data.bot_send_queue.length,
            });
        }

        res.json({
            success: true,
            status: 'not_found',
            message: '未找到该请求',
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = app;
module.exports.default = app;
module.exports.ensureReady = ensureReady;