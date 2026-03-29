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
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const nodemailer = require('nodemailer');

const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const FileStore = require('session-file-store')(session);

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
const isProduction = process.env.NODE_ENV === 'production';

const db = new Low(new JSONFile('database.json'), {
    users: [],
    tasks: [],
    invite_codes: [],
    invite_requests: [],
    banned_ips: [],
    emails: [],
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
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
           req.headers['x-real-ip'] || 
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

const uploadsDir = (process.env.VERCEL || process.env.RAILWAY) ? '/tmp/uploads' : 'uploads';
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const dangerousExtensions = ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.vbs', '.js', '.jar', '.msi', '.dll', '.scr', '.pif', '.com'];

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
        const extname = path.extname(file.originalname);
        const originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const basename = sanitizeFilename(path.basename(originalname, extname));
        cb(null, uniqueSuffix + '-' + basename + extname);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 1.5 * 1024 * 1024 * 1024
    },
    fileFilter: fileFilter
});

app.set('trust proxy', 1);

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';");
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

app.use(session({
    secret: 'STC_SECRET_KEY_2025',
    resave: false,
    saveUninitialized: false,
    store: new FileStore({
        path: path.join(__dirname, 'sessions'),
        secret: 'STC_SECRET_KEY_2025',
        ttl: 86400 * 7, // 7天
        retries: 2
    }),
    cookie: {
        secure: isProduction,
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: isProduction ? 'none' : 'lax',
        path: '/'
    }
}));

app.use(express.static(path.join(__dirname, 'public')));

async function initDatabase() {
    await db.read();
    
    if (!db.data) {
        db.data = {
            users: [],
            tasks: [],
            invite_codes: [],
            invite_requests: [],
            banned_ips: [],
            emails: [],
            verification_codes: []
        };
        await db.write();
    }
    
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

app.get('/emails', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'emails.html'));
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
        await emailTransporter.sendMail({
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
        console.log(`邮箱验证码已发送: ${email} -> ${code}`);
    } catch (error) {
        console.error('邮件发送失败:', error);
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
        const user = db.data.users.find(u => u.id === task.user_id);
        task.user = user ? { id: user.id, username: user.username } : null;
    });
    
    res.json({ success: true, data: paginatedTasks, total, page: parseInt(page), pageSize: parseInt(pageSize) });
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
    const { title, description, reward, deadline } = req.body;
    
    if (!title || !description) {
        return res.status(400).json({ success: false, message: '请填写标题和描述' });
    }
    
    const task = {
        id: Date.now(),
        title: title,
        description: description,
        reward: parseFloat(reward) || 0,
        deadline: deadline || null,
        status: 'pending',
        user_id: req.session.userId,
        file_name: req.file ? req.file.originalname : null,
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
    
    if (task.user_id !== req.session.userId) {
        return res.status(403).json({ success: false, message: '无权修改此任务' });
    }
    
    const { title, description, reward, deadline, status } = req.body;
    if (title) task.title = title;
    if (description) task.description = description;
    if (reward) task.reward = parseFloat(reward);
    if (deadline) task.deadline = deadline;
    if (status) task.status = status;
    
    await db.write();
    
    res.json({ success: true, message: '任务更新成功', data: task });
});

app.delete('/api/tasks/:id', requireLogin, async (req, res) => {
    const task = db.data.tasks.find(t => t.id === parseInt(req.params.id));
    
    if (!task) {
        return res.status(404).json({ success: false, message: '任务不存在' });
    }
    
    if (task.user_id !== req.session.userId) {
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
    
    res.download(task.file_path, task.file_name);
});

app.post('/api/invite/request', async (req, res) => {
    const { email } = req.body;
    
    if (!validateEmail(email)) {
        return res.status(400).json({ success: false, message: '邮箱格式不正确' });
    }
    
    if (db.data.users.find(u => u.email === email)) {
        return res.status(400).json({ success: false, message: '该邮箱已注册' });
    }
    
    const existingRequest = db.data.invite_requests.find(r => r.email === email && r.status === 'pending');
    if (existingRequest) {
        return res.status(400).json({ success: false, message: '已有待处理的申请，请等待审批' });
    }
    
    db.data.invite_requests.push({
        id: Date.now(),
        email: email,
        status: 'pending',
        created_at: new Date().toISOString()
    });
    
    await db.write();
    
    res.json({ success: true, message: '申请已提交，请等待管理员审批' });
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
    
    res.json({ success: true, message: '邀请码已生成并发送', invite_code: inviteCode });
});

app.post('/api/invite/requests/:id/reject', requireAdmin, async (req, res) => {
    const request = db.data.invite_requests.find(r => r.id === parseInt(req.params.id));
    
    if (!request) {
        return res.status(404).json({ success: false, message: '申请不存在' });
    }
    
    request.status = 'rejected';
    request.rejected_at = new Date().toISOString();
    await db.write();
    
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
        created_at: u.created_at
    }));
    res.json({ success: true, data: members });
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
            tasksCount: db.data.tasks.length,
            emailsCount: db.data.emails.length
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

const MAX_STORAGE = 5 * 1024 * 1024 * 1024;

function getUserStorageUsage(userId) {
    let totalSize = 0;
    db.data.emails.forEach(email => {
        if (email.to_user_id === userId || email.from_user_id === userId) {
            if (email.attachments) {
                email.attachments.forEach(att => {
                    if (att.size) totalSize += att.size;
                });
            }
        }
    });
    return totalSize;
}

function enrichEmailWithUserInfo(email) {
    const fromUser = db.data.users.find(u => u.id === email.from_user_id);
    const toUser = db.data.users.find(u => u.id === email.to_user_id);
    
    email.from_user = fromUser ? { 
        id: fromUser.id, 
        username: fromUser.username, 
        email: fromUser.email 
    } : null;
    
    if (toUser) {
        email.to_user = { 
            id: toUser.id, 
            username: toUser.username, 
            email: toUser.email 
        };
    } else if (email.to_email) {
        email.to_user = { 
            id: null, 
            username: email.to_username || email.to_email, 
            email: email.to_email 
        };
    } else {
        email.to_user = null;
    }
}

app.get('/api/emails', requireLogin, async (req, res) => {
    const { folder = 'inbox', page = 1, pageSize = 20, search = '' } = req.query;
    const userId = req.session.userId;
    
    let emails = [];
    switch (folder) {
        case 'inbox':
            emails = db.data.emails.filter(e => e.to_user_id === userId && !e.deleted && e.folder !== 'deleted');
            break;
        case 'sent':
            emails = db.data.emails.filter(e => e.from_user_id === userId && !e.deleted);
            break;
        case 'drafts':
            emails = db.data.emails.filter(e => e.to_user_id === userId && e.is_draft && !e.deleted);
            break;
        case 'deleted':
            emails = db.data.emails.filter(e => e.to_user_id === userId && e.folder === 'deleted');
            break;
        default:
            emails = db.data.emails.filter(e => e.to_user_id === userId && !e.deleted);
    }
    
    if (search) {
        const searchLower = search.toLowerCase();
        emails = emails.filter(e => 
            e.subject.toLowerCase().includes(searchLower) ||
            e.content.toLowerCase().includes(searchLower) ||
            (e.from_user && e.from_user.username.toLowerCase().includes(searchLower))
        );
    }
    
    emails.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    const total = emails.length;
    const start = (page - 1) * pageSize;
    const paginatedEmails = emails.slice(start, start + parseInt(pageSize));
    
    paginatedEmails.forEach(enrichEmailWithUserInfo);
    
    res.json({ success: true, data: paginatedEmails, total, page: parseInt(page), pageSize: parseInt(pageSize) });
});

app.get('/api/emails/:id', requireLogin, async (req, res) => {
    const emailId = parseInt(req.params.id);
    const userId = req.session.userId;
    
    const email = db.data.emails.find(e => e.id === emailId);
    
    if (!email) {
        return res.status(404).json({ success: false, message: '邮件不存在' });
    }
    
    if (email.to_user_id !== userId && email.from_user_id !== userId) {
        return res.status(403).json({ success: false, message: '无权访问此邮件' });
    }
    
    if (!email.is_read && email.to_user_id === userId) {
        email.is_read = true;
        await db.write();
    }
    
    enrichEmailWithUserInfo(email);
    
    res.json({ success: true, data: email });
});

app.post('/api/emails/send', requireLogin, upload.array('attachments', 10), async (req, res) => {
    const { to, subject, content, is_draft } = req.body;
    const userId = req.session.userId;
    
    if (!to && !is_draft) {
        return res.status(400).json({ success: false, message: '请填写收件人' });
    }
    
    if (!subject && !is_draft) {
        return res.status(400).json({ success: false, message: '请填写主题' });
    }
    
    if (!content && !is_draft) {
        return res.status(400).json({ success: false, message: '请填写内容' });
    }
    
    let toUserId = null;
    let toEmail = to;
    let toUsername = null;
    if (to) {
        const toUser = db.data.users.find(u => u.email === to || u.username === to);
        if (toUser) {
            toUserId = toUser.id;
            toEmail = toUser.email;
            toUsername = toUser.username;
        }
    }
    
    const attachments = [];
    let totalAttachmentSize = 0;
    
    if (req.files && req.files.length > 0) {
        req.files.forEach(file => {
            const attachment = {
                id: Date.now() + Math.random(),
                filename: file.originalname,
                path: file.path,
                size: file.size,
                content_type: file.mimetype
            };
            attachments.push(attachment);
            totalAttachmentSize += file.size;
        });
    }
    
    const currentUsage = getUserStorageUsage(userId);
    if (currentUsage + totalAttachmentSize > MAX_STORAGE) {
        return res.status(400).json({ success: false, message: '存储空间不足（5GB限制）' });
    }
    
    const email = {
        id: Date.now(),
        from_user_id: userId,
        to_user_id: toUserId,
        to_email: toEmail,
        to_username: toUsername,
        subject: subject || '',
        content: content || '',
        is_read: false,
        is_draft: !!is_draft,
        folder: 'inbox',
        deleted: false,
        attachments: attachments,
        created_at: new Date().toISOString()
    };
    
    db.data.emails.push(email);
    await db.write();
    
    res.json({ success: true, message: is_draft ? '草稿已保存' : '邮件发送成功', data: email });
});

app.get('/api/users/list', requireLogin, async (req, res) => {
    const users = db.data.users.map(u => ({
        id: u.id,
        username: u.username,
        email: u.email
    }));
    res.json({ success: true, data: users });
});

app.delete('/api/emails/:id', requireLogin, async (req, res) => {
    const emailId = parseInt(req.params.id);
    const userId = req.session.userId;
    
    const email = db.data.emails.find(e => e.id === emailId);
    
    if (!email) {
        return res.status(404).json({ success: false, message: '邮件不存在' });
    }
    
    if (email.to_user_id !== userId && email.from_user_id !== userId) {
        return res.status(403).json({ success: false, message: '无权删除此邮件' });
    }
    
    if (email.folder === 'deleted') {
        const emailIndex = db.data.emails.indexOf(email);
        if (emailIndex > -1) {
            db.data.emails.splice(emailIndex, 1);
        }
        await db.write();
        return res.json({ success: true, message: '邮件已永久删除' });
    }
    
    email.folder = 'deleted';
    await db.write();
    
    res.json({ success: true, message: '邮件已移至回收站' });
});

app.post('/api/emails/:id/restore', requireLogin, async (req, res) => {
    const emailId = parseInt(req.params.id);
    const userId = req.session.userId;
    
    const email = db.data.emails.find(e => e.id === emailId);
    
    if (!email) {
        return res.status(404).json({ success: false, message: '邮件不存在' });
    }
    
    if (email.to_user_id !== userId) {
        return res.status(403).json({ success: false, message: '无权恢复此邮件' });
    }
    
    email.folder = 'inbox';
    await db.write();
    
    res.json({ success: true, message: '邮件已恢复' });
});

app.put('/api/emails/:id/read', requireLogin, async (req, res) => {
    const emailId = parseInt(req.params.id);
    const userId = req.session.userId;
    const { is_read } = req.body;
    
    const email = db.data.emails.find(e => e.id === emailId);
    
    if (!email) {
        return res.status(404).json({ success: false, message: '邮件不存在' });
    }
    
    if (email.to_user_id !== userId) {
        return res.status(403).json({ success: false, message: '无权修改此邮件状态' });
    }
    
    email.is_read = !!is_read;
    await db.write();
    
    res.json({ success: true, message: '邮件状态已更新' });
});

app.get('/api/emails/stats', requireLogin, async (req, res) => {
    const userId = req.session.userId;
    
    const inboxCount = db.data.emails.filter(e => e.to_user_id === userId && !e.deleted && e.folder !== 'deleted' && !e.is_read).length;
    const sentCount = db.data.emails.filter(e => e.from_user_id === userId && !e.deleted).length;
    const draftCount = db.data.emails.filter(e => e.to_user_id === userId && e.is_draft && !e.deleted).length;
    const deletedCount = db.data.emails.filter(e => e.to_user_id === userId && e.folder === 'deleted').length;
    const storageUsed = getUserStorageUsage(userId);
    
    res.json({
        success: true,
        data: {
            inbox: inboxCount,
            sent: sentCount,
            drafts: draftCount,
            deleted: deletedCount,
            storageUsed,
            storageLimit: MAX_STORAGE
        }
    });
});

app.get('/api/emails/attachments/:id/download', requireLogin, async (req, res) => {
    const attachmentId = parseFloat(req.params.id);
    const userId = req.session.userId;
    
    let foundAttachment = null;
    let foundEmail = null;
    
    for (const email of db.data.emails) {
        if (email.to_user_id !== userId && email.from_user_id !== userId) continue;
        
        if (email.attachments) {
            const att = email.attachments.find(a => a.id === attachmentId);
            if (att) {
                foundAttachment = att;
                foundEmail = email;
                break;
            }
        }
    }
    
    if (!foundAttachment || !foundEmail) {
        return res.status(404).json({ success: false, message: '附件不存在' });
    }
    
    const filePath = path.resolve(foundAttachment.path);
    
    if (!isSafePath(filePath, uploadsDir)) {
        return res.status(403).json({ success: false, message: '非法文件路径' });
    }
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, message: '附件文件不存在' });
    }
    
    res.download(filePath, foundAttachment.filename);
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

(async () => {
    await initDatabase();
    await loadBannedIPs();
    
    if (!process.env.VERCEL && !process.env.RAILWAY) {
        app.listen(PORT, () => {
            console.log(`服务器运行在 http://localhost:${PORT}`);
        });
    }
})();

const isDevelopment = !process.env.VERCEL && !process.env.RAILWAY;