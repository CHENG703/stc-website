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
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Vercel Serverless 限制：只读文件系统、无 child_process
const IS_VERCEL = !!process.env.VERCEL;
const canSpawn = !IS_VERCEL;
const fsRoot = IS_VERCEL ? '/tmp' : __dirname;
const nodemailer = require('nodemailer');

const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const FileStore = IS_VERCEL ? null : require('session-file-store')(session);

// 数据库锁定状态
let dbLocked = false;
let dbLockReason = '';

// 邮件发送配置
const emailTransporter = nodemailer.createTransport({
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});
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
const db = new Low(new JSONFile(dbPath), {
    users: [],
    tasks: [],
    invite_codes: [],
    invite_requests: [],
    banned_ips: [],
    verification_codes: []
});

let bannedIPs = new Set();

const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 100;

function checkRateLimit(ip) {
    const now = Date.now();
    const record = rateLimit.get(ip);
    
    if (!record) {
        rateLimit.set(ip, { count: 1, timestamp: now });
        return true;
    }
    
    if (now - record.timestamp > RATE_LIMIT_WINDOW) {
        rateLimit.set(ip, { count: 1, timestamp: now });
        return true;
    }
    
    if (record.count >= RATE_LIMIT_MAX) {
        return false;
    }
    
    record.count++;
    return true;
}

const csrfTokens = new Map();
const CSRF_TOKEN_TTL = 3600000;

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

function generateCSRFToken(sessionId) {
    const token = crypto.randomBytes(32).toString('hex');
    csrfTokens.set(sessionId, {
        token,
        expires: Date.now() + CSRF_TOKEN_TTL
    });
    return token;
}

function validateCSRFToken(sessionId, token) {
    const record = csrfTokens.get(sessionId);
    if (!record) return false;
    if (Date.now() > record.expires) {
        csrfTokens.delete(sessionId);
        return false;
    }
    if (record.token !== token) return false;
    return true;
}

function requireCSRF(req, res, next) {
    const token = req.headers['x-csrf-token'] || req.body._csrf;
    
    if (!token) {
        return res.status(403).json({ success: false, message: '缺少CSRF token' });
    }
    
    if (!validateCSRFToken(req.sessionID, token)) {
        return res.status(403).json({ success: false, message: 'CSRF token无效或已过期' });
    }
    
    next();
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
           req.headers['x-real-ip'] ||
           req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
           req.connection?.remoteAddress || 
           req.socket?.remoteAddress ||
           '127.0.0.1';
}

function addServerLog(message, type) {
    type = type || 'info';
    var entry = {
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

const dangerousExtensions = ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.vbs', '.js', '.jar', '.msi', '.dll', '.scr', '.pif', '.com'];

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
        fileSize: 2 * 1024 * 1024 * 1024
    },
    fileFilter: fileFilter
});

app.set('trust proxy', 1);

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self' https:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' https:; connect-src 'self' https: wss:;");
    next();
});

app.use((req, res, next) => {
    const ip = getClientIP(req);
    
    if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/) || 
        req.path.startsWith('/api/logs')) {
        return next();
    }
    
    if (!checkRateLimit(ip)) {
        return res.status(429).json({
            success: false,
            message: '请求过于频繁，请稍后再试'
        });
    }
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

var serverLogs = [];
const MAX_LOG_COUNT = 1000;

var sseClients = [];
var siteEventsClients = []; // 公开事件客户端（用于网站锁定通知）

const sessionDir = path.join(runtimeDir, 'sessions');
if (!fs.existsSync(sessionDir)) {
    try { fs.mkdirSync(sessionDir, { recursive: true }); } catch (e) {}
}

const sessionConfig = {
    secret: 'STC_SECRET_KEY_2025',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: isProduction,
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: false,
        sameSite: isProduction ? 'none' : 'lax',
        path: '/'
    }
};

// Vercel Serverless 用内存 session（无持久化），其他环境用文件 session
if (!IS_VERCEL) {
    sessionConfig.store = new FileStore({
        path: sessionDir,
        secret: 'STC_SECRET_KEY_2025',
        ttl: 86400 * 7,
        retries: 0
    });
}

app.use(session(sessionConfig));

app.use(express.static(path.join(__dirname, 'public'), {
    extensions: ['html', 'htm'],
    index: 'index.html'
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
            invite_codes: [],
            invite_requests: [],
            banned_ips: [],
            verification_codes: []
        };
        await db.write();
    }
    
    // 确保所有必需的字段都存在
    if (!Array.isArray(db.data.users)) db.data.users = [];
    if (!Array.isArray(db.data.tasks)) db.data.tasks = [];
    if (!Array.isArray(db.data.invite_codes)) db.data.invite_codes = [];
    if (!Array.isArray(db.data.invite_requests)) db.data.invite_requests = [];
    if (!Array.isArray(db.data.banned_ips)) db.data.banned_ips = [];
    if (!Array.isArray(db.data.verification_codes)) db.data.verification_codes = [];
    if (!Array.isArray(db.data.inviteCodes)) db.data.inviteCodes = [];
    await db.write();
    
    if (!db.data.users.find(u => u.username === 'REDACTED_USER')) {
        const hash = bcrypt.hashSync('REDACTED_USER', 10);
        db.data.users.push({
            id: Date.now(),
            username: 'REDACTED_USER',
            email: '3422187328@qq.com',
            password: hash,
            is_admin: true,
            is_super_admin: true,
            is_banned: false,
            login_attempts: 0,
            created_at: new Date().toISOString()
        });
        await db.write();
    }
    
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

const requireLogin = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(403).json({ error: '请先登录' });
    }
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(403).json({ error: '请先登录' });
    }
    const user = db.data.users.find(u => u.id === req.session.userId);
    if (!user || !user.is_admin) {
        return res.status(403).json({ error: '权限不足' });
    }
    next();
};

const requireSuperAdmin = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(403).json({ error: '请先登录' });
    }
    const user = db.data.users.find(u => u.id === req.session.userId);
    if (!user || !user.is_super_admin) {
        return res.status(403).json({ error: '权限不足' });
    }
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

app.post('/api/login', async (req, res) => {
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
    
    if (!user) {
        return res.status(400).json({ success: false, message: '用户名或密码错误' });
    }
    
    if (user.is_banned) {
        return res.status(400).json({ success: false, message: '账号已被封禁' });
    }
    
    if (loginType === 'password') {
        if (!bcrypt.compareSync(password, user.password)) {
            user.login_attempts = (user.login_attempts || 0) + 1;
            if (user.login_attempts >= 5) {
                user.is_banned = true;
            }
            await db.write();
            return res.status(400).json({ success: false, message: '用户名或密码错误' });
        }
        
        user.login_attempts = 0;
        await db.write();
    }
    // 验证码登录在前面已验证通过
    
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
    req.session.loginIP = getClientIP(req);
    
    // 更新用户最后登录IP和时间
    user.lastLoginIp = getClientIP(req);
    user.lastLoginTime = new Date().toISOString();
    await db.write();
    
    res.json({ success: true, message: '登录成功', user: { id: user.id, username: user.username, email: user.email, is_admin: user.is_admin } });
});

// IP检查中间件 - 检测异地登录
app.use('/api/', (req, res, next) => {
    // 跳过不需要登录的API
    const publicPaths = ['/api/login', '/api/register', '/api/send-code', '/api/csrf-token', '/api/verification'];
    if (publicPaths.includes(req.path) || req.path.startsWith('/api/logs')) {
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

app.post('/api/register', async (req, res) => {
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

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true, message: '登出成功' });
});

app.get('/api/csrf-token', (req, res) => {
    const token = generateCSRFToken(req.sessionID);
    res.json({ success: true, csrfToken: token });
});

app.get('/api/user', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: '未登录' });
    }
    const user = db.data.users.find(u => u.id === req.session.userId);
    if (!user) {
        return res.status(404).json({ error: '用户不存在' });
    }
    res.json({ id: user.id, username: user.username, email: user.email, is_admin: user.is_admin, is_super_admin: user.is_super_admin });
});

// 修改密码
app.put('/api/user/password', requireLogin, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ error: '请填写旧密码和新密码' });
        }

        if (!validatePassword(newPassword)) {
            return res.status(400).json({ error: '新密码长度至少6位' });
        }

        const user = db.data.users.find(u => u.id === req.session.userId);
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
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

app.post('/api/send-code', async (req, res) => {
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
        const info = await emailTransporter.sendMail({
            from: `"STC任务网站" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: '【STC】您的验证码',
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
        });
        console.log(`[SEND-CODE OK] ${email} -> code=${code}, accepted=${info.accepted || '-'}, rejected=${info.rejected || '-'}, msgId=${info.messageId || '-'}`);
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
    const user = db.data.users.find(u => u.id === req.session.userId);
    if (!user) {
        return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
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
        return t.author_id === req.session.userId && t.created_at >= todayStart;
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
app.post('/api/messages', requireLogin, async (req, res) => {
    const { content } = req.body;
    
    if (!content || content.trim().length === 0) {
        return res.status(400).json({ success: false, message: '留言内容不能为空' });
    }
    
    const message = {
        id: Date.now(),
        content: content.trim(),
        user_id: req.session.userId,
        created_at: new Date().toISOString()
    };
    
    if (!db.data.messages) db.data.messages = [];
    db.data.messages.push(message);
    await db.write();
    
    const user = db.data.users.find(u => u.id === req.session.userId);
    res.json({ 
        success: true, 
        data: {
            ...message,
            user: user ? { id: user.id, username: user.username } : null
        }
    });
});

app.post('/api/tasks', requireLogin, upload.single('file'), async (req, res) => {
    const { title, description, reward, deadline, status } = req.body;
    
    if (!title || !description) {
        return res.status(400).json({ success: false, message: '请填写标题和描述' });
    }
    
    if (!req.session.userId) {
        return res.status(403).json({ error: '请先登录' });
    }
    
    const user = db.data.users.find(u => u.id === req.session.userId);
    if (!user) {
        return res.status(400).json({ success: false, message: '用户不存在' });
    }
    
    const isAdmin = user.is_admin || user.is_super_admin;
    const DAILY_LIMIT = 5;
    
    if (!isAdmin) {
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
        const todayTasks = (db.data.tasks || []).filter(t => {
            return t.author_id === req.session.userId && t.created_at >= todayStart;
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
        author_id: req.session.userId,
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

app.put('/api/tasks/:id', requireLogin, async (req, res) => {
    const task = db.data.tasks.find(t => t.id === parseInt(req.params.id));
    
    if (!task) {
        return res.status(404).json({ success: false, message: '任务不存在' });
    }
    
    if (task.author_id !== req.session.userId) {
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
app.put('/api/tasks/:id/status', requireLogin, async (req, res) => {
    const task = db.data.tasks.find(t => t.id === parseInt(req.params.id));
    
    if (!task) {
        return res.status(404).json({ success: false, message: '任务不存在' });
    }
    
    const user = db.data.users.find(u => u.id === req.session.userId);
    const isAdmin = user && (user.is_admin || user.is_super_admin);
    
    // 只有任务作者或管理员可以修改状态
    if (task.author_id !== req.session.userId && !isAdmin) {
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

app.delete('/api/tasks/:id', requireLogin, async (req, res) => {
    const task = db.data.tasks.find(t => t.id === parseInt(req.params.id));
    
    if (!task) {
        return res.status(404).json({ success: false, message: '任务不存在' });
    }
    
    const user = db.data.users.find(u => u.id === req.session.userId);
    const isAdmin = user && (user.is_admin || user.is_super_admin);
    
    if (task.author_id !== req.session.userId && !isAdmin) {
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

app.post('/api/invite/request', async (req, res) => {
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
        if (process.env.SITE_URL) {
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

    // 1. 发通知邮件给管理员（3422187328@qq.com），包含批准/拒绝按钮
    try {
        await emailTransporter.sendMail({
            from: `"STC任务网站" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER,
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
        console.log(`[INVITE-ADMIN] 邀请码申请通知邮件(含审批按钮)已发送: ${email}`);
    } catch (error) {
        console.error('[INVITE-ADMIN] 邀请码申请通知邮件发送失败:', error.message);
    }

    // 2. 发回执邮件给申请人（REDACTED@example.com 等）
    try {
        await emailTransporter.sendMail({
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
        try {
            await emailTransporter.sendMail({
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
            console.log(`[APPROVE-TOKEN] 邀请码邮件已通过邮件链接发送给 ${request.email}`);
        } catch (err) {
            console.error('[APPROVE-TOKEN] 邀请码邮件发送失败:', err.message);
        }
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
        await emailTransporter.sendMail({
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

app.post('/api/invite/requests/:id/approve', requireAdmin, async (req, res) => {
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
        await emailTransporter.sendMail({
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

app.post('/api/invite/requests/:id/reject', requireAdmin, async (req, res) => {
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
        await emailTransporter.sendMail({
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
        lastLoginIp: u.lastLoginIp || '无',
        lastLoginTime: u.lastLoginTime || null
    }));
    res.json({ success: true, data: members });
});

// 管理员重置用户密码
app.put('/api/members/:id/reset-password', requireAdmin, async (req, res) => {
    try {
        const currentUser = db.data.users.find(u => u.id === req.session.userId);
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

app.post('/api/members/:id/ban', requireAdmin, async (req, res) => {
    const currentUser = db.data.users.find(u => u.id === req.session.userId);
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

app.post('/api/members/:id/unban', requireAdmin, async (req, res) => {
    const currentUser = db.data.users.find(u => u.id === req.session.userId);
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

app.post('/api/members/:id/set_admin', requireAdmin, async (req, res) => {
    const currentUser = db.data.users.find(u => u.id === req.session.userId);
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

app.post('/api/members/:id/unset_admin', requireAdmin, async (req, res) => {
    const currentUser = db.data.users.find(u => u.id === req.session.userId);
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

app.delete('/api/members/:id', requireAdmin, async (req, res) => {
    const currentUser = db.data.users.find(u => u.id === req.session.userId);
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

app.post('/api/invite-codes', requireAdmin, async (req, res) => {
    const code = 'STC' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const newCode = {
        id: Date.now(),
        code: code,
        is_used: false,
        created_by: req.session.userId,
        created_at: new Date().toISOString()
    };
    if (!db.data.inviteCodes) db.data.inviteCodes = [];
    db.data.inviteCodes.push(newCode);
    await db.write();
    res.json({ success: true, data: newCode, code: code });
});

app.delete('/api/invite-codes/:id', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id) || parseFloat(req.params.id);
    if (!db.data.inviteCodes) db.data.inviteCodes = [];
    db.data.inviteCodes = db.data.inviteCodes.filter(c => c.id !== id);
    await db.write();
    res.json({ success: true, message: '邀请码已删除' });
});

app.post('/api/console/create_user', requireAdmin, async (req, res) => {
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
    app.post('/api/console/stop', requireLogin, requireAdmin, (req, res) => {
        console.log('服务器被管理员停止');
        res.json({ success: true, message: '服务器已停止' });
        setTimeout(() => process.exit(0), 1000);
    });

    app.post('/api/console/restart', requireLogin, requireAdmin, (req, res) => {
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

// 网站备份API（仅超级管理员）
async function createBackup() {
    try {
        const backupDir = path.join(__dirname, 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `backup-${timestamp}`;
        const backupPath = path.join(backupDir, backupName);
        
        fs.mkdirSync(backupPath, { recursive: true });
        
        const dbPath = path.join(__dirname, 'database.json');
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

app.post('/api/admin/backup', requireSuperAdmin, async (req, res) => {
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
app.post('/api/admin/auto-backup', requireSuperAdmin, (req, res) => {
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
app.post('/api/admin/auto-backup/stop', requireSuperAdmin, (req, res) => {
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
app.get('/api/admin/backups', requireSuperAdmin, (req, res) => {
    try {
        const backupDir = path.join(__dirname, 'backups');
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
app.post('/api/admin/rollback', requireSuperAdmin, async (req, res) => {
    const { backupName } = req.body;
    
    if (!backupName) {
        return res.status(400).json({ success: false, message: '请指定备份名称' });
    }
    
    try {
        const backupDir = path.join(__dirname, 'backups');
        const backupPath = path.join(backupDir, backupName);
        
        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ success: false, message: '备份不存在' });
        }
        
        // 备份当前数据库（作为回滚前的备份）
        const dbPath = path.join(__dirname, 'database.json');
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
app.delete('/api/admin/backup/:name', requireSuperAdmin, async (req, res) => {
    const { name } = req.params;
    
    if (!name) {
        return res.status(400).json({ success: false, message: '请指定备份名称' });
    }
    
    try {
        const backupDir = path.join(__dirname, 'backups');
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
app.post('/api/admin/db-lock', requireSuperAdmin, async (req, res) => {
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
app.post('/api/admin/db-unlock', requireSuperAdmin, async (req, res) => {
    if (!dbLocked) {
        return res.json({ success: false, message: '数据库未被锁定' });
    }
    
    dbLocked = false;
    dbLockReason = '';
    dbLockTime = null;
    
    res.json({ success: true, message: '数据库已解锁' });
});

// 网站锁定API - 管理员可用
app.post('/api/admin/site-lock', requireAdmin, async (req, res) => {
    const { reason } = req.body;
    const user = db.data.users.find(u => u.id === req.session.userId);
    
    siteLocked = true;
    siteLockReason = reason || '维护中';
    siteLockBy = user ? user.username : '未知';
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
app.post('/api/admin/site-unlock', requireAdmin, async (req, res) => {
    if (!siteLocked) {
        return res.json({ success: false, message: '网站未被锁定' });
    }
    
    const user = db.data.users.find(u => u.id === req.session.userId);
    const unlockedBy = user ? user.username : '未知';
    
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

app.post('/api/ban-ip', requireSuperAdmin, async (req, res) => {
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
            banned_by: req.session.userId,
            banned_at: new Date().toISOString()
        });
        await db.write();
    }
    
    res.json({ success: true, message: 'IP已封禁' });
});

app.get('/api/ban-ips', requireSuperAdmin, async (req, res) => {
    res.json({ success: true, data: db.data.banned_ip_info || [] });
});

app.post('/api/unban-ip', requireSuperAdmin, async (req, res) => {
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
    res.write('data: ' + JSON.stringify({message: '日志连接已建立', type: 'system'}) + '\n\n');
    
    sseClients.push(res);
    
    // 心跳机制 - 每15秒发送心跳保持连接
    const heartbeat = setInterval(() => {
        try {
            res.write(': heartbeat\n\n');
        } catch (e) {
            clearInterval(heartbeat);
            sseClients = sseClients.filter(client => client !== res);
        }
    }, 15000);
    
    req.on('close', () => {
        clearInterval(heartbeat);
        sseClients = sseClients.filter(client => client !== res);
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
    return app;
}

module.exports = app;
module.exports.default = app;
module.exports.ensureReady = ensureReady;