const express = require('express');
const session = require('express-session');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 配置文件上传
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        // 处理文件名编码问题
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extname = path.extname(file.originalname);
        // 使用Buffer正确处理文件名
        const originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const basename = path.basename(originalname, extname);
        cb(null, uniqueSuffix + '-' + basename + extname);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 1.5 * 1024 * 1024 * 1024 // 1.5GB
    }
});

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'stc-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 24 * 60 * 60 * 1000 // 24小时
    }
}));

// 数据库初始化 - 支持Vercel环境
const dbPath = process.env.VERCEL ? '/tmp/database.json' : 'database.json';
const adapter = new JSONFile(dbPath);
const defaultData = {
    users: [],
    inviteCodes: [],
    emailVerifications: [],
    tasks: [],
    messages: []
};
const db = new Low(adapter, defaultData);

// 初始化上传目录
const uploadsDir = process.env.VERCEL ? '/tmp/uploads' : 'uploads';
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// 修改multer配置使用正确的上传目录
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        // 处理文件名编码问题
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extname = path.extname(file.originalname);
        // 使用Buffer正确处理文件名
        const originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const basename = path.basename(originalname, extname);
        cb(null, uniqueSuffix + '-' + basename + extname);
    }
});

// 初始化数据库结构
async function initDatabase() {
    try {
        await db.read();

        // 如果数据库不存在，初始化默认数据
        if (!db.data) {
            db.data = {
                users: [],
                inviteCodes: [],
                emailVerifications: [],
                tasks: [],
                messages: []
            };
        }

        // 初始化管理员账号
        const adminUsername = 'CYJ2025';
        const adminPassword = 'Admin@123456';
        const adminEmail = 'admin@stc.com';

        const existingAdmin = db.data.users.find(u => u.username === adminUsername);
        if (!existingAdmin) {
            const hash = bcrypt.hashSync(adminPassword, 10);
            db.data.users.push({
                id: Date.now(),
                username: adminUsername,
                email: adminEmail,
                password: hash,
                is_admin: true,
                is_banned: false,
                created_at: new Date().toISOString()
            });
            console.log('管理员账号创建成功');
        }

        // 初始化邀请码
        const initialCodes = ['STC2025', 'WELCOME2025', 'FIRSTUSER'];
        initialCodes.forEach(code => {
            const existingCode = db.data.inviteCodes.find(c => c.code === code);
            if (!existingCode) {
                db.data.inviteCodes.push({
                    id: Date.now() + Math.random(),
                    code: code,
                    is_used: false,
                    created_by: null,
                    created_at: new Date().toISOString()
                });
                console.log(`邀请码 ${code} 创建成功`);
            }
        });

        await db.write();
        console.log('数据库初始化完成');
    } catch (error) {
        console.error('数据库初始化失败:', error);
        // 即使初始化失败，也继续运行
    }
}

// 邮件发送器配置
const transporter = nodemailer.createTransport({
    service: 'qq',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// 发送验证邮件
async function sendVerificationEmail(email, code) {
    try {
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'STC网站邮箱验证',
            html: `
                <h2>邮箱验证</h2>
                <p>您的验证码是：<strong>${code}</strong></p>
                <p>验证码10分钟内有效，请勿泄露给他人。</p>
                <p>如果这不是您本人的操作，请忽略此邮件。</p>
            `
        };

        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('发送邮件失败:', error);
        return false;
    }
}

// 验证QQ邮箱格式
function isValidQQEmail(email) {
    const regex = /^.+@qq\.com$/i;
    return regex.test(email);
}

// 中间件：检查是否登录
function requireLogin(req, res, next) {
    if (req.session.userId) {
        // 检查用户是否被封禁
        const user = db.data.users.find(u => u.id === req.session.userId);
        if (user && user.is_banned) {
            req.session.destroy();
            return res.status(403).json({ error: '您的账号已被封禁，请联系管理员' });
        }
        next();
    } else {
        res.status(401).json({ error: '请先登录' });
    }
}

// 中间件：检查是否是管理员
function requireAdmin(req, res, next) {
    if (req.session.isAdmin) {
        next();
    } else {
        res.status(403).json({ error: '需要管理员权限' });
    }
}

// 中间件：检查是否是超级管理员（CYJ2025）
function requireSuperAdmin(req, res, next) {
    if (req.session.username === 'CYJ2025') {
        next();
    } else {
        res.status(403).json({ error: '需要超级管理员权限（仅CYJ2025）' });
    }
}

// ============ API路由 ============

// 主页
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 登录页面
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 注册页面
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// 用户中心
app.get('/user', requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'user.html'));
});

// 管理面板
app.get('/admin', requireLogin, requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 任务详情页面
app.get('/task.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'task.html'));
});

// API: 发送验证码
app.post('/api/send-verification', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: '邮箱不能为空' });
    }

    if (!isValidQQEmail(email)) {
        return res.status(400).json({ error: '请使用QQ邮箱' });
    }

    // 检查邮箱是否已注册
    const existingUser = db.data.users.find(u => u.email === email);
    if (existingUser) {
        return res.status(400).json({ error: '该邮箱已被注册' });
    }

    // 生成验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // 保存验证码
    db.data.emailVerifications.push({
        id: Date.now(),
        email: email,
        code: code,
        expires_at: expiresAt,
        used: false
    });
    await db.write();

    // 发送邮件
    const success = await sendVerificationEmail(email, code);
    if (success) {
        res.json({ message: '验证码已发送到您的邮箱' });
    } else {
        res.status(500).json({ error: '发送验证码失败' });
    }
});

// API: 注册
app.post('/api/register', async (req, res) => {
    const { username, email, password, inviteCode } = req.body;

    // 验证输入
    if (!username || !email || !password || !inviteCode) {
        return res.status(400).json({ error: '请填写所有字段' });
    }

    if (!isValidQQEmail(email)) {
        return res.status(400).json({ error: '请使用QQ邮箱' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: '密码长度至少6位' });
    }

    // 验证邀请码
    const invite = db.data.inviteCodes.find(c => c.code === inviteCode && !c.is_used);
    if (!invite) {
        return res.status(400).json({ error: '邀请码无效或已使用' });
    }

    // 检查用户名是否已存在
    if (db.data.users.find(u => u.username === username)) {
        return res.status(400).json({ error: '用户名已存在' });
    }

    // 检查邮箱是否已注册
    if (db.data.users.find(u => u.email === email)) {
        return res.status(400).json({ error: '该邮箱已被注册' });
    }

    // 加密密码
    const hash = bcrypt.hashSync(password, 10);

    // 创建用户
    const newUser = {
        id: Date.now(),
        username: username,
        email: email,
        password: hash,
        is_admin: false,
        is_banned: false,
        created_at: new Date().toISOString()
    };
    db.data.users.push(newUser);

    // 标记邀请码为已使用
    invite.is_used = true;

    await db.write();
    res.json({ message: '注册成功' });
});

// API: 登录
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    const user = db.data.users.find(u => u.username === username);

    if (!user) {
        return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 检查是否被封禁
    if (user.is_banned) {
        return res.status(403).json({ error: '您的账号已被封禁，无法登录' });
    }

    const result = bcrypt.compareSync(password, user.password);

    if (!result) {
        return res.status(401).json({ error: '用户名或密码错误' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.isAdmin = user.is_admin;

    res.json({
        message: '登录成功',
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            isAdmin: user.is_admin
        }
    });
});

// API: 登出
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: '登出成功' });
});

// API: 获取当前用户信息
app.get('/api/user', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: '未登录' });
    }

    const user = db.data.users.find(u => u.id === req.session.userId);

    if (!user) {
        return res.status(404).json({ error: '用户不存在' });
    }

    res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        isAdmin: user.is_admin,
        createdAt: user.created_at
    });
});

// API: 修改密码
app.put('/api/user/password', requireLogin, async (req, res) => {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: '请填写旧密码和新密码' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ error: '新密码长度至少6位' });
    }

    const userIndex = db.data.users.findIndex(u => u.id === req.session.userId);
    if (userIndex === -1) {
        return res.status(404).json({ error: '用户不存在' });
    }

    const user = db.data.users[userIndex];
    const result = bcrypt.compareSync(oldPassword, user.password);

    if (!result) {
        return res.status(400).json({ error: '旧密码错误' });
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    db.data.users[userIndex].password = hash;
    await db.write();

    res.json({ message: '密码修改成功' });
});

// API: 生成邀请码（管理员）
app.post('/api/invite-codes', requireLogin, requireAdmin, async (req, res) => {
    const code = uuidv4().substring(0, 8).toUpperCase();

    const newCode = {
        id: Date.now(),
        code: code,
        is_used: false,
        created_by: req.session.userId,
        created_at: new Date().toISOString()
    };
    db.data.inviteCodes.push(newCode);
    await db.write();

    res.json({ message: '邀请码生成成功', code: code });
});

// API: 获取邀请码列表（管理员）
app.get('/api/invite-codes', requireLogin, requireAdmin, (req, res) => {
    const codes = [...db.data.inviteCodes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(codes);
});

// API: 删除邀请码（管理员）
app.delete('/api/invite-codes/:id', requireLogin, requireAdmin, async (req, res) => {
    const codeId = parseInt(req.params.id);
    const codeIndex = db.data.inviteCodes.findIndex(c => c.id === codeId);
    
    if (codeIndex === -1) {
        return res.status(404).json({ error: '邀请码不存在' });
    }

    db.data.inviteCodes.splice(codeIndex, 1);
    await db.write();

    res.json({ message: '邀请码删除成功' });
});

// API: 发布任务（管理员）
app.post('/api/tasks', requireLogin, requireAdmin, upload.single('file'), async (req, res) => {
    const { title, content, isPinned, status } = req.body;

    if (!title || !content) {
        return res.status(400).json({ error: '标题和内容不能为空' });
    }

    // 验证状态
    const validStatuses = ['备货', '正在建', '已完成'];
    const taskStatus = status || '备货';
    if (!validStatuses.includes(taskStatus)) {
        return res.status(400).json({ error: '无效的任务状态' });
    }

    const newTask = {
        id: Date.now(),
        title: title,
        content: content,
        author_id: req.session.userId,
        is_pinned: isPinned || false,
        status: taskStatus,
        file_path: req.file ? req.file.path : null,
        file_name: req.file ? req.file.originalname : null,
        file_size: req.file ? req.file.size : null,
        created_at: new Date().toISOString()
    };
    db.data.tasks.push(newTask);
    await db.write();

    res.json({ message: '任务发布成功', id: newTask.id });
});

// API: 获取任务列表
app.get('/api/tasks', (req, res) => {
    const tasksWithAuthors = db.data.tasks.map(task => {
        const author = db.data.users.find(u => u.id === task.author_id);
        return {
            ...task,
            author_name: author ? author.username : '未知用户'
        };
    }).sort((a, b) => {
        // 置顶任务排在前面
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        // 都置顶或都不置顶，按时间倒序
        return new Date(b.created_at) - new Date(a.created_at);
    });
    
    res.json(tasksWithAuthors);
});

// API: 获取单个任务
app.get('/api/tasks/:id', (req, res) => {
    const task = db.data.tasks.find(t => t.id === parseInt(req.params.id));
    if (!task) {
        return res.status(404).json({ error: '任务不存在' });
    }

    const author = db.data.users.find(u => u.id === task.author_id);
    res.json({
        ...task,
        author_name: author ? author.username : '未知用户'
    });
});

// API: 更新任务状态（管理员）
app.put('/api/tasks/:id/status', requireLogin, requireAdmin, async (req, res) => {
    const { status } = req.body;
    const validStatuses = ['备货', '正在建', '已完成'];

    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: '无效的任务状态' });
    }

    const taskIndex = db.data.tasks.findIndex(t => t.id === parseInt(req.params.id));
    if (taskIndex === -1) {
        return res.status(404).json({ error: '任务不存在' });
    }

    db.data.tasks[taskIndex].status = status;
    await db.write();

    res.json({ message: '任务状态更新成功' });
});

// API: 下载任务文件
app.get('/api/tasks/:id/download', async (req, res) => {
    const task = db.data.tasks.find(t => t.id === parseInt(req.params.id));
    if (!task) {
        return res.status(404).json({ error: '任务不存在' });
    }

    if (!task.file_path || !fs.existsSync(task.file_path)) {
        return res.status(404).json({ error: '文件不存在' });
    }

    res.download(task.file_path, task.file_name);
});

// API: 删除任务（管理员）
app.delete('/api/tasks/:id', requireLogin, requireAdmin, async (req, res) => {
    const taskIndex = db.data.tasks.findIndex(t => t.id === parseInt(req.params.id));
    if (taskIndex === -1) {
        return res.status(404).json({ error: '任务不存在' });
    }

    // 删除关联的文件
    const task = db.data.tasks[taskIndex];
    if (task.file_path && fs.existsSync(task.file_path)) {
        fs.unlinkSync(task.file_path);
    }

    db.data.tasks.splice(taskIndex, 1);
    await db.write();

    res.json({ message: '任务删除成功' });
});

// API: 发布留言
app.post('/api/messages', requireLogin, async (req, res) => {
    const { content } = req.body;

    if (!content) {
        return res.status(400).json({ error: '留言内容不能为空' });
    }

    if (content.length > 500) {
        return res.status(400).json({ error: '留言内容不能超过500字' });
    }

    const newMessage = {
        id: Date.now(),
        content: content,
        user_id: req.session.userId,
        created_at: new Date().toISOString()
    };
    db.data.messages.push(newMessage);
    await db.write();

    res.json({ message: '留言发布成功', id: newMessage.id });
});

// API: 获取留言列表
app.get('/api/messages', (req, res) => {
    const messagesWithAuthors = db.data.messages.map(message => {
        const author = db.data.users.find(u => u.id === message.user_id);
        return {
            ...message,
            author_name: author ? author.username : '未知用户'
        };
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
     .slice(0, 50);
    
    res.json(messagesWithAuthors);
});

// API: 删除留言（管理员）
app.delete('/api/messages/:id', requireLogin, requireAdmin, async (req, res) => {
    const messageIndex = db.data.messages.findIndex(m => m.id === parseInt(req.params.id));
    if (messageIndex === -1) {
        return res.status(404).json({ error: '留言不存在' });
    }

    db.data.messages.splice(messageIndex, 1);
    await db.write();

    res.json({ message: '留言删除成功' });
});

// API: 获取成员列表（管理员）
app.get('/api/members', requireLogin, requireAdmin, (req, res) => {
    const members = db.data.users.map(user => ({
        id: user.id,
        username: user.username,
        email: user.email,
        password: user.password,
        is_admin: user.is_admin,
        is_banned: user.is_banned,
        created_at: user.created_at
    })).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    res.json(members);
});

// API: 封禁/解封用户（仅超级管理员）
app.put('/api/members/:id/ban', requireLogin, requireSuperAdmin, async (req, res) => {
    const { isBanned } = req.body;
    const userId = parseInt(req.params.id);

    const userIndex = db.data.users.findIndex(u => u.id === userId);
    if (userIndex === -1) {
        return res.status(404).json({ error: '用户不存在' });
    }

    const user = db.data.users[userIndex];
    
    // 不能封禁超级管理员自己
    if (user.username === 'CYJ2025') {
        return res.status(403).json({ error: '不能封禁超级管理员' });
    }

    db.data.users[userIndex].is_banned = isBanned;
    await db.write();

    const response = { message: isBanned ? '用户已封禁' : '用户已解封' };
    
    // 如果封禁的是当前登录的用户（非超级管理员），标记需要登出
    if (isBanned && userId === req.session.userId) {
        response.logoutRequired = true;
        req.session.destroy();
    }
    
    res.json(response);
});

// API: 设置/取消管理员（仅超级管理员）
app.put('/api/members/:id/admin', requireLogin, requireSuperAdmin, async (req, res) => {
    const { isAdmin } = req.body;
    const userId = parseInt(req.params.id);

    const userIndex = db.data.users.findIndex(u => u.id === userId);
    if (userIndex === -1) {
        return res.status(404).json({ error: '用户不存在' });
    }

    const user = db.data.users[userIndex];
    
    // 不能修改超级管理员自己的权限
    if (user.username === 'CYJ2025') {
        return res.status(403).json({ error: '不能修改超级管理员权限' });
    }

    db.data.users[userIndex].is_admin = isAdmin;
    await db.write();

    res.json({ message: isAdmin ? '已设置为管理员' : '已取消管理员权限' });
});

// API: 删除账号（仅超级管理员）
app.delete('/api/accounts/:id', requireLogin, requireSuperAdmin, async (req, res) => {
    const userId = parseInt(req.params.id);

    const userIndex = db.data.users.findIndex(u => u.id === userId);
    if (userIndex === -1) {
        return res.status(404).json({ error: '用户不存在' });
    }

    const user = db.data.users[userIndex];
    
    // 不能删除超级管理员自己
    if (user.username === 'CYJ2025') {
        return res.status(403).json({ error: '不能删除超级管理员' });
    }

    // 不能删除自己
    if (user.id === req.session.userId) {
        return res.status(403).json({ error: '不能删除自己的账号' });
    }

    // 删除用户发布的相关数据
    // 删除任务
    db.data.tasks = db.data.tasks.filter(task => task.author_id !== userId);
    
    // 删除留言
    db.data.messages = db.data.messages.filter(message => message.user_id !== userId);
    
    // 删除用户
    db.data.users.splice(userIndex, 1);
    
    await db.write();
    res.json({ message: '账号及其相关数据删除成功' });
});

// Vercel导出 - 在初始化完成后导出
const serverPromise = (async () => {
    await initDatabase();
    
    if (!process.env.VERCEL) {
        app.listen(PORT, () => {
            console.log(`服务器运行在 http://localhost:${PORT}`);
        });
    }
    
    return app;
})();

module.exports = serverPromise;