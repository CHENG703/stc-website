# STC网站

一个功能完整的网站，包含用户系统、博客文章和留言板功能。

## 功能特性

- 用户注册和登录
- QQ邮箱验证注册
- 邀请码系统
- 用户中心（修改密码）
- 博客文章发布和浏览
- 留言板功能
- 管理员系统（用户CYJ2025为管理员）
- 响应式深色主题设计

## 技术栈

- 后端：Node.js + Express
- 数据库：SQLite
- 前端：HTML + CSS + JavaScript
- 邮件服务：Nodemailer

## 快速开始

1. 安装依赖：
```bash
npm install
```

2. 配置环境变量：
复制 `.env.example` 为 `.env`，并填写你的QQ邮箱信息：
```env
EMAIL_USER=your@qq.com
EMAIL_PASS=your-qq-email-authorization-code
```

注意：EMAIL_PASS需要使用QQ邮箱的授权码，不是登录密码。获取方式：
- 登录QQ邮箱
- 设置 -> 账户
- 开启IMAP/SMTP服务
- 生成授权码

3. 启动服务器：
```bash
npm start
```

4. 访问网站：
- 主页：http://localhost:3000
- 登录：http://localhost:3000/login
- 注册：http://localhost:3000/register
- 用户中心：http://localhost:3000/user（需要登录）
- 管理面板：http://localhost:3000/admin（需要管理员权限）

## 初始账号

管理员账号：
- 用户名：CYJ2025
- 密码：Admin@123456
- 权限：管理员（可以生成邀请码）

初始邀请码：
- STC2025
- WELCOME2025
- FIRSTUSER

**重要：首次部署后请立即修改管理员密码！**

## 部署到Replit

1. 在Replit创建新项目
2. 将所有文件上传到Replit
3. 配置环境变量（在Replit的Secrets中）
4. 在Replit的Shell中运行：`npm install` && `npm start`
5. Replit会自动分配一个可从外网访问的域名

## 项目结构

```
STC网站/
├── server.js              # 服务器主文件
├── package.json           # 项目配置
├── .env.example           # 环境变量模板
├── .gitignore            # Git忽略文件
├── README.md             # 项目说明
├── public/               # 前端文件
│   ├── index.html        # 首页
│   ├── login.html        # 登录页
│   ├── register.html     # 注册页
│   ├── user.html         # 用户中心
│   ├── admin.html        # 管理面板
│   ├── css/              # 样式文件
│   └── js/               # JavaScript文件
└── database.sqlite       # SQLite数据库（自动生成）
```

## API文档

### 认证相关
- POST /api/send-verification - 发送验证码
- POST /api/register - 用户注册
- POST /api/login - 用户登录
- POST /api/logout - 用户登出
- GET /api/user - 获取当前用户信息
- PUT /api/user/password - 修改密码

### 邀请码相关（管理员）
- POST /api/invite-codes - 生成邀请码
- GET /api/invite-codes - 获取邀请码列表

### 文章相关
- POST /api/articles - 发布文章
- GET /api/articles - 获取文章列表
- GET /api/articles/:id - 获取单篇文章

### 留言相关
- POST /api/messages - 发布留言
- GET /api/messages - 获取留言列表

## 安全提示

1. 生产环境务必修改SESSION_SECRET
2. 修改初始管理员密码
3. 不要将.env文件提交到版本控制
4. 定期备份数据库文件

## 许可证

MIT License