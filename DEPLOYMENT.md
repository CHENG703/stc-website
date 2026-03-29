# 部署指南 - Replit

本指南将帮助你将STC网站部署到Replit，实现24小时外网访问。

## 前提条件

1. 一个Replit账号（免费注册：https://replit.com）
2. 一个QQ邮箱（用于发送验证邮件）
3. 项目所有文件已准备好

## 第一步：创建Replit项目

1. 访问 https://replit.com 并登录
2. 点击 "Create Repl"
3. 选择 "Node.js" 模板
4. 命名为 "stc-website"
5. 点击 "Create Repl"

## 第二步：上传项目文件

### 方法A：直接复制粘贴（适合小型项目）

1. 在Replit的左侧文件面板中，点击 "Upload"
2. 或者直接在Replit的文件编辑器中创建以下文件：
   - `package.json`
   - `server.js`
   - `.env`
   - `README.md`
   - `.gitignore`
   - `public/index.html`
   - `public/login.html`
   - `public/register.html`
   - `public/user.html`
   - `public/admin.html`
   - `public/css/style.css`
   - `public/js/main.js`
   - `public/js/login.js`
   - `public/js/register.js`
   - `public/js/user.js`
   - `public/js/admin.js`

### 方法B：使用Git（推荐）

1. 在本地初始化Git仓库：
```bash
cd "D:\Desktop\STC网站"
git init
git add .
git commit -m "Initial commit"
```

2. 在GitHub创建新仓库
3. 推送到GitHub：
```bash
git remote add origin https://github.com/你的用户名/stc-website.git
git branch -M main
git push -u origin main
```

4. 在Replit中，选择 "Import from Git"
5. 输入你的GitHub仓库地址
6. 点击 "Import"

## 第三步：配置环境变量

1. 在Replit中，找到左侧面板的 "Secrets"（或 "Environment Variables"）
2. 添加以下环境变量：

```env
PORT=3000
SESSION_SECRET=your-very-secure-random-string-here
EMAIL_USER=你的QQ邮箱@qq.com
EMAIL_PASS=你的QQ邮箱授权码
```

### 获取QQ邮箱授权码

1. 登录QQ邮箱网页版
2. 点击 "设置" -> "账户"
3. 找到 "POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV服务"
4. 开启 "IMAP/SMTP服务"
5. 点击 "生成授权码"
6. 按照提示验证，获得授权码
7. 将授权码填入 `EMAIL_PASS` 环境变量

## 第四步：安装依赖

在Replit的Shell（命令行）中运行：

```bash
npm install
```

或者，Replit会自动检测 `package.json` 并自动安装依赖。

## 第五步：启动服务器

在Replit的Shell中运行：

```bash
npm start
```

服务器应该会在端口3000上启动。Replit会自动分配一个可从外网访问的URL。

## 第六步：启用Always On（24小时运行）

为了确保网站24小时可用，你需要启用Replit的Always On功能：

1. 在Replit中，点击项目设置（齿轮图标）
2. 找到 "Always On" 或 "Uptime" 设置
3. 启用Always On功能
4. 如果没有免费的Always On选项，可以使用第三方服务监控你的网站

### 使用Uptime Robot监控（免费）

1. 访问 https://uptimerobot.com
2. 注册免费账号
3. 添加一个新的Monitor：
   - Monitor Type: HTTPS
   - URL: 你的Replit项目URL
   - Monitoring Interval: 5 minutes
4. 保存后，Uptime Robot会定期访问你的网站，保持其活跃状态

## 第七步：获取你的域名

Replit会自动分配一个免费域名，格式如下：

```
https://你的项目名.你的用户名.repl.co
```

例如：`https://stc-website.johndoe.repl.co`

这个域名可以24小时从外网访问。

## 第八步：测试网站

1. 访问你的Replit项目URL
2. 测试注册功能（使用初始邀请码：STC2025、WELCOME2025、FIRSTUSER）
3. 测试登录功能
4. 测试用户中心和密码修改

## 初始管理员账号

- 用户名：`CYJ2025`
- 密码：`Admin@123456`
- 权限：管理员

**重要：首次登录后请立即修改密码！**

## 常见问题

### 1. 数据库文件丢失

Replit的免费版可能会在一段时间后删除文件。为了防止数据库丢失：

1. 定期备份数据库文件 `database.sqlite`
2. 或者升级到Replit的付费计划

### 2. 邮件发送失败

确保：
- QQ邮箱已开启IMAP/SMTP服务
- 授权码正确
- 环境变量配置正确

### 3. 网站无法访问

检查：
- 服务器是否正在运行
- Always On功能是否启用
- Uptime Robot是否正常工作

### 4. 端口被占用

如果端口3000被占用，可以修改 `.env` 文件中的 `PORT` 值：

```env
PORT=8080
```

## 安全建议

1. 修改初始管理员密码
2. 使用强密码作为 `SESSION_SECRET`
3. 不要将 `.env` 文件提交到版本控制
4. 定期更新依赖包

## 维护

### 更新依赖

```bash
npm update
```

### 查看日志

在Replit的Shell中，所有日志都会实时显示。

### 重启服务器

在Shell中按 `Ctrl+C` 停止服务器，然后重新运行：

```bash
npm start
```

## 下一步

- 添加更多功能（如文章详情页、用户头像等）
- 自定义域名（如果需要）
- 集成其他服务（如云存储、CDN等）

## 技术支持

如果遇到问题：
1. 查看Replit的日志输出
2. 检查环境变量配置
3. 参考项目README.md文档

祝你部署顺利！🎉