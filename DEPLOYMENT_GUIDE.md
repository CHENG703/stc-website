# 免费云部署指南

## 🎯 推荐方案：Railway.app

**为什么选择Railway：**
- ✅ 完全免费（每月5美元额度，足够小型项目使用）
- ✅ 支持文件上传
- ✅ 支持持久化数据库
- ✅ 部署简单
- ✅ 自动HTTPS
- ✅ 自定义域名支持

## 📋 部署步骤

### 第1步：注册Railway账号

1. 访问 https://railway.app/
2. 点击 "Start a New Project"
3. 使用GitHub账号登录（推荐）

### 第2步：准备代码

1. 在你的项目中创建GitHub仓库
2. 推送代码到GitHub：
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/你的用户名/仓库名.git
git push -u origin main
```

### 第3步：在Railway创建项目

1. 登录Railway后，点击 "New Project"
2. 选择 "Deploy from GitHub repo"
3. 选择你的仓库
4. 点击 "Deploy Now"

### 第4步：配置环境变量

在Railway项目设置中添加以下环境变量：

```
SESSION_SECRET=你的随机密钥
DATABASE_URL=自动生成的数据库连接字符串
PORT=3000
```

### 第5步：完成部署

1. 等待部署完成（约2-3分钟）
2. Railway会提供一个访问地址
3. 你的网站现在24/7可用了！

## 💡 重要提示

### 关于免费额度：
- Railway每月5美元免费额度
- 小型网站通常不会超出限制
- 如果超出，只需支付少量费用

### 关于文件上传：
- Railway支持临时文件存储
- 建议文件大小控制在100MB以内
- 长期存储建议使用Cloudinary

### 关于数据库：
- Railway提供免费的PostgreSQL数据库
- 数据会持久化保存
- 不需要额外配置

## 🔧 需要修改的代码

### 1. 修改端口配置
```javascript
const PORT = process.env.PORT || 3000;
```

### 2. 使用Railway的PostgreSQL
- 将JSON数据库改为PostgreSQL
- 需要安装pg包：`npm install pg`

### 3. 文件存储
- 短期存储：使用Railway临时目录
- 长期存储：集成Cloudinary

## 🚀 快速部署（推荐）

如果不想修改代码，可以使用以下简化方案：

1. 访问 https://railway.app/template/QZ8r4b
2. 点击 "Deploy Now"
3. 使用一键部署模板

## 📞 需要帮助？

如果部署过程中遇到问题，可以：
1. 查看Railway文档：https://docs.railway.app/
2. 联系我帮你解决具体问题

## ✅ 部署完成后的好处

- ✅ 24/7在线，电脑关机也能访问
- ✅ 自动HTTPS安全访问
- ✅ 全球CDN加速
- ✅ 自动备份
- ✅ 免费域名