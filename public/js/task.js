// 全局消息提示函数
function showMessage(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `message-toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// 封装的fetch函数，处理403错误
async function fetchWithAuth(url, options = {}) {
    const response = await fetch(url, options);
    
    if (response.status === 403) {
        const error = await response.json();
        if (error.error && error.error.includes('被封禁')) {
            showMessage(error.error, 'error');
            localStorage.removeItem('user');
            setTimeout(() => {
                window.location.href = '/login';
            }, 2000);
            throw new Error('Banned');
        }
    }
    
    return response;
}

// 检查登录状态并更新导航栏
async function checkLoginStatus() {
    try {
        const response = await fetchWithAuth('/api/user');
        if (response.ok) {
            const user = await response.json();
            const navUser = document.getElementById('nav-user');
            if (navUser) {
                let navHtml = `<a href="/user">${user.username}</a>`;
                if (user.isAdmin) {
                    navHtml += ` | <a href="/admin">管理面板</a>`;
                }
                navHtml += ` | <a href="#" onclick="logout()">登出</a>`;
                navUser.innerHTML = navHtml;
            }
            return user;
        }
    } catch (error) {
        if (error.message !== 'Banned') {
            console.error('检查登录状态失败:', error);
        }
    }
    return null;
}

// 登出函数
async function logout() {
    try {
        const response = await fetchWithAuth('/api/logout', {
            method: 'POST'
        });
        if (response.ok) {
            showMessage('登出成功');
            setTimeout(() => {
                window.location.href = '/';
            }, 1000);
        } else {
            showMessage('登出失败', 'error');
        }
    } catch (error) {
        if (error.message !== 'Banned') {
            showMessage('登出失败', 'error');
        }
    }
}

// 主题切换功能
function toggleTheme() {
    const body = document.body;
    const themeToggle = document.getElementById('theme-toggle');
    
    if (body.classList.contains('light-theme')) {
        body.classList.remove('light-theme');
        body.classList.add('dark-theme');
        themeToggle.textContent = '🌙';
        localStorage.setItem('theme', 'dark');
    } else {
        body.classList.remove('dark-theme');
        body.classList.add('light-theme');
        themeToggle.textContent = '☀️';
        localStorage.setItem('theme', 'light');
    }
}

// 初始化主题
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    const body = document.body;
    const themeToggle = document.getElementById('theme-toggle');
    
    if (savedTheme === 'light') {
        body.classList.add('light-theme');
        if (themeToggle) themeToggle.textContent = '☀️';
    } else {
        body.classList.add('dark-theme');
        if (themeToggle) themeToggle.textContent = '🌙';
    }
}

// 返回上一页
function goBack() {
    window.history.back();
}

// 获取任务ID
function getTaskId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('id');
}

// 加载任务详情
async function loadTaskDetail() {
    const taskId = getTaskId();
    
    if (!taskId) {
        showMessage('任务ID不存在', 'error');
        setTimeout(() => {
            window.location.href = '/';
        }, 2000);
        return;
    }

    try {
        const response = await fetchWithAuth(`/api/tasks/${taskId}`);
        
        if (!response.ok) {
            if (response.status === 404) {
                showMessage('任务不存在', 'error');
            } else {
                showMessage('加载任务详情失败', 'error');
            }
            setTimeout(() => {
                window.location.href = '/';
            }, 2000);
            return;
        }

        const task = await response.json();
        displayTaskDetail(task);
    } catch (error) {
        if (error.message !== 'Banned') {
            console.error('加载任务详情失败:', error);
            showMessage('加载任务详情失败', 'error');
            setTimeout(() => {
                window.location.href = '/';
            }, 2000);
        }
    }
}

// 显示任务详情
function displayTaskDetail(task) {
    const taskDetail = document.getElementById('task-detail');
    
    const pinnedBadge = task.is_pinned ? '<span class="pinned-badge">📌 置顶</span>' : '';
    const content = escapeHtml(task.content).replace(/\n/g, '<br>');
    
    taskDetail.innerHTML = `
        <div class="task-detail-header">
            <h1 class="task-detail-title">${escapeHtml(task.title)}</h1>
            ${pinnedBadge}
        </div>
        
        <div class="task-detail-meta">
            <span>👤 作者：${escapeHtml(task.author_name)}</span>
            <span>📅 发布时间：${formatDateTime(task.created_at)}</span>
        </div>
        
        <div class="task-detail-content">
            <h3>任务内容</h3>
            <div class="task-detail-text">${content}</div>
        </div>
    `;
}

// 格式化日期时间
function formatDateTime(dateString) {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// HTML转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', async () => {
    // 初始化主题
    initTheme();
    
    // 检查登录状态
    await checkLoginStatus();
    
    // 加载任务详情
    loadTaskDetail();
});