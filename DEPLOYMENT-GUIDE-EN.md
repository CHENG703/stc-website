# STC Website - New Computer Deployment Guide

## 📋 Prerequisites

### 1. Install Node.js
- Visit https://nodejs.org/
- Download and install LTS version (Node.js 18.x or higher recommended)
- After installation, open command line and type `node -v` to verify installation

### 2. Prepare Project Files
- Copy the entire `STC网站` folder to the new computer
- Ensure folder structure is complete with all necessary files

## 🚀 Quick Start (3 Steps)

### Step 1: Login to ngrok (First time use required)

**If this is your first time using ngrok:**

1. Run `ngrok-login-en.bat`
2. Follow the prompts to register ngrok account: https://ngrok.com/signup
3. Login and get authtoken: https://dashboard.ngrok.com/get-started/your-authtoken
4. Copy the authtoken and paste it into the command line
5. Wait for successful login message

**If you already have ngrok account and token:**
- Run `ngrok-login-en.bat` directly
- Enter your authtoken

### Step 2: One-click Startup

1. Double click `start-en.bat`
2. Script will automatically:
   - Check Node.js environment
   - Install project dependencies (first run only)
   - Start local server (port 3000)
   - Start ngrok external tunnel
3. Wait for startup to complete, browser will open automatically

### Step 3: Start Using

- **Local access**: http://localhost:3000
- **External access**: Check command line output for ngrok URL
- **Default admin**:
  - Username: `REDACTED_USER`
  - Password: `REDACTED`

## 🛠️ Common Operations

### Start Services
- Double click `start-en.bat`

### Stop Services
- Double click `stop-en.bat`
- Will automatically stop Node.js server and ngrok

### Re-login to ngrok
- Double click `ngrok-login-en.bat`
- Enter new authtoken

## 📂 Project Structure

```
STC网站/
├── start-en.bat         → One-click startup (English)
├── stop-en.bat          → Stop all services (English)
├── ngrok-login-en.bat   → Ngrok login assistant (English)
├── 一键启动.bat          → One-click startup (Chinese)
├── 停止服务.bat           → Stop all services (Chinese)
├── ngrok登录.bat         → Ngrok login assistant (Chinese)
├── server.js            → Main server program
├── database.json        → Database file
├── package.json         → Project configuration
├── public/              → Frontend files
│   ├── index.html      → Homepage
│   ├── admin.html      → Admin panel
│   ├── login.html      → Login page
│   ├── register.html   → Registration page
│   ├── user.html       → User center
│   ├── task.html       → Task page
│   ├── css/            → Style files
│   └── js/             → JavaScript files
└── uploads/             → Upload file storage directory
```

## 🔧 Troubleshooting

### Problem 1: Node.js not installed
**Symptom**: Startup script prompts "Node.js not detected"
**Solution**:
1. Visit https://nodejs.org/
2. Download and install Node.js
3. Restart computer and try again

### Problem 2: ngrok not logged in
**Symptom**: Startup prompts "ngrok not logged in"
**Solution**:
1. Run `ngrok-login-en.bat`
2. Follow the prompts to complete login

### Problem 3: Port 3000 occupied
**Symptom**: Startup fails, prompts port occupied
**Solution**:
1. Run `stop-en.bat`
2. Check if other programs are using port 3000
3. Or modify port number in `server.js`

### Problem 4: Dependency installation failed
**Symptom**: Error during dependency installation
**Solution**:
1. Check network connection
2. Delete `node_modules` folder
3. Delete `package-lock.json` file
4. Run `start-en.bat` again

### Problem 5: External access not working
**Symptom**: Local access works, but external access fails
**Solution**:
1. Check if ngrok is running properly
2. View `logs\ngrok.log` log file
3. Ensure ngrok is logged in
4. Check if ngrok account has expired

## 📊 Log Files

After starting services, log files will be generated in `logs/` directory:

- `server.log` - Local server logs
- `ngrok.log` - Ngrok tunnel logs

These log files can help diagnose problems.

## 🔐 Security Recommendations

1. **Change default password**: Change admin password immediately after first login
2. **Protect ngrok token**: Do not share your ngrok authtoken
3. **Regular data backup**: Regularly backup `database.json` file
4. **Check access logs**: Regularly check server logs for abnormal access

## 📞 Getting Help

If you encounter other problems:

1. Check log files: `logs/server.log` and `logs/ngrok.log`
2. Check command line error messages
3. Ensure all prerequisites are met
4. Follow steps again

## 🎉 Start Using Now!

You are ready to use STC website!

1. Run `start-en.bat`
2. Wait for services to start
3. Open website at http://localhost:3000 in browser
4. Login with admin account
5. Start creating tasks and managing users

Enjoy! 🚀