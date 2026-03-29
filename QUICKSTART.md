# 快速开始指南

## 本地运行

### 1. 安装Node.js

确保你的系统已安装Node.js（推荐v18或更高版本）。

下载地址：https://nodejs.org/

### 2. 安装依赖

在项目目录下运行：

```bash
npm install
```

### 3. 配置环境变量

复制 `.env.example` 为 `.env`：

```bash
copy .env.example .env
```

编辑 `.env` 文件，填写你的QQ邮箱信息：

```env
PORT=3000
SESSION_SECRET=change-this-to-a-random-string
EMAIL_USER=你的QQ邮箱@qq.com
EMAIL_PASS=你的QQ邮箱授权码
```

### 获取QQ邮箱授权码

1. 登录QQ邮箱网页版
2. 设置 → 账户
3. 开启IMAP/SMTP服务
4. 生成授权码
5. 将授权码填入 `EMAIL_PASS`

### 4. 启动服务器

```bash
npm start
```

### 5. 访问网站

打开浏览器访问：http://localhost:3000

## 初始账号

### 管理员账号
- 用户名：`CYJ2025`
- 密码：`Admin@123456`

### 初始邀请码
- `STC2025`
- `WELCOME2025`
- `FIRSTUSER`

**重要：首次登录后请立即修改管理员密码！**

## 主要功能

### 用户功能
- ✅ 用户注册（需要QQ邮箱验证和邀请码）
- ✅ 用户登录
- ✅ 修改密码
- ✅ 查看文章
- ✅ 发布留言

### 管理员功能
- ✅ 生成邀请码
- ✅ 查看邀请码使用情况
- ✅ 发布文章

## 网站结构

```
http://localhost:3000          # 首页
http://localhost:3000/login    # 登录页
http://localhost:3000/register # 注册页
http://localhost:3000/user     # 用户中心（需要登录）
http://localhost:3000/admin    # 管理面板（需要管理员权限）
```

## 部署到Replit

详细步骤请参考 `DEPLOYMENT.md` 文档。

## 开发模式

使用nodemon自动重启服务器：

```bash
npm run dev
```

## 故障排除

### 邮件发送失败
- 确认QQ邮箱已开启IMAP/SMTP服务
- 确认授权码正确
- 检查.env文件配置

### 数据库错误
- 删除 `database.sqlite` 文件，重启服务器会自动重建数据库
- 确保Node.js有写入权限

### 端口被占用
- 修改.env中的PORT值
- 或者关闭占用3000端口的程序

## 项目文件说明

- `server.js` - 服务器主文件
- `package.json` - 项目配置
- `.env` - 环境变量（需自行创建）
- `public/` - 前端文件
  - `index.html` - 首页
  - `login.html` - 登录页
  - `register.html` - 注册页
  - `user.html` - 用户中心
  - `admin.html` - 管理面板
  - `css/style.css` - 样式文件
  - `js/` - JavaScript文件

## 技术栈

- **后端**: Node.js + Express
- **数据库**: SQLite
- **前端**: HTML + CSS + JavaScript
- **邮件**: Nodemailer

## 下一步

1. 阅读完整的 `README.md` 了解更多细节
2. 参考 `DEPLOYMENT.md` 部署到Replit
3. 根据需要修改样式和功能

## 支持

如遇问题，请检查：
1. Node.js版本是否正确
2. 依赖是否正确安装
3. 环境变量是否正确配置
4. 端口是否被占用

祝你使用愉快！🎉