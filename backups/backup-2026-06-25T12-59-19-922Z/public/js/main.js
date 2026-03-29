/**
 * ============================================================================
 * STC网站前端脚本 - 版权所有
 * ============================================================================
 * 
 * Copyright © 2025-2026 STC. All Rights Reserved.
 * 
 * 本代码受版权保护，未经授权禁止：
 * - 复制、修改、分发本代码
 * - 用于任何商业或非授权项目
 * - 声称本代码为原创作品
 * 
 * 任何违规行为将承担法律责任
 * ============================================================================
 */

// ==================== 代码保护 ====================

// 简单的警告提示函数（代码保护专用）
function showWarning(message) {
    const toast = document.createElement('div');
    toast.className = 'message-toast error';
    toast.textContent = message;
    toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);padding:15px 25px;background:#ef4444;color:#fff;border-radius:8px;z-index:9999;font-size:14px;';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// 禁用右键菜单
document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    showWarning('此页面受版权保护，禁止复制');
    return false;
});

// 禁用开发者工具快捷键
document.addEventListener('keydown', function(e) {
    // F12
    if (e.key === 'F12') {
        e.preventDefault();
        showWarning('开发者工具已被禁用');
        return false;
    }
    
    // Ctrl+Shift+I (Chrome开发者工具)
    if (e.ctrlKey && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        showWarning('开发者工具已被禁用');
        return false;
    }
    
    // Ctrl+Shift+J (Chrome控制台)
    if (e.ctrlKey && e.shiftKey && e.key === 'J') {
        e.preventDefault();
        showWarning('开发者工具已被禁用');
        return false;
    }
    
    // Ctrl+U (查看源代码)
    if (e.ctrlKey && e.key === 'U') {
        e.preventDefault();
        showWarning('源代码查看已被禁用');
        return false;
    }
    
    // Ctrl+S (保存页面)
    if (e.ctrlKey && e.key === 'S') {
        e.preventDefault();
        showWarning('页面保存已被禁用');
        return false;
    }
    
    // Ctrl+C (复制)
    if (e.ctrlKey && e.key === 'C' && !e.target.matches('input, textarea')) {
        e.preventDefault();
        showWarning('内容复制已被禁用');
        return false;
    }
});

// 检测开发者工具是否打开
let devtoolsOpened = false;
const threshold = 160;

function checkDevTools() {
    const widthThreshold = window.outerWidth - window.innerWidth > threshold;
    const heightThreshold = window.outerHeight - window.innerHeight > threshold;
    
    if (widthThreshold || heightThreshold) {
        if (!devtoolsOpened) {
            devtoolsOpened = true;
            showWarning('警告：开发者工具已打开，请勿复制代码');
        }
    } else {
        devtoolsOpened = false;
    }
}

// 定期检测开发者工具
setInterval(checkDevTools, 1000);

// 禁用拖拽选择
document.addEventListener('selectstart', function(e) {
    if (!e.target.matches('input, textarea')) {
        e.preventDefault();
        return false;
    }
});

// 禁用拖拽
document.addEventListener('dragstart', function(e) {
    e.preventDefault();
    return false;
});

// ==================== 业务逻辑 ====================

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

// 全局变量
let currentUser = null;
let csrfToken = null;
let siteEventsSource = null; // 网站事件SSE连接

// 连接网站事件SSE（用于监听网站锁定）
function connectSiteEvents() {
    if (typeof EventSource === 'undefined') {
        console.log('浏览器不支持EventSource');
        return;
    }
    
    try {
        siteEventsSource = new EventSource('/api/site-events');
        
        siteEventsSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                // 处理网站锁定事件
                if (data.type === 'site-locked') {
                    // 显示锁定弹窗
                    showSiteLockedModal(data.lockBy, data.lockReason);
                    
                    // 3秒后刷新页面
                    setTimeout(() => {
                        window.location.reload();
                    }, 3000);
                }
            } catch (e) {
                // 忽略解析错误
            }
        };
        
        siteEventsSource.onerror = (e) => {
            // 连接断开后重连
            if (siteEventsSource.readyState === EventSource.CLOSED) {
                setTimeout(() => connectSiteEvents(), 5000);
            }
        };
    } catch (e) {
        console.error('连接网站事件失败:', e);
    }
}

// 显示网站锁定弹窗
function showSiteLockedModal(lockBy, lockReason) {
    // 检查是否已存在弹窗
    if (document.getElementById('site-locked-modal')) {
        return;
    }
    
    const modal = document.createElement('div');
    modal.id = 'site-locked-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 99999;
    `;
    
    modal.innerHTML = `
        <div style="
            background: var(--card-bg, #1e1e1e);
            border-radius: 16px;
            padding: 40px;
            max-width: 500px;
            width: 90%;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        ">
            <div style="font-size: 64px; margin-bottom: 20px;">🔒</div>
            <h2 style="color: var(--text-primary, #fff); margin-bottom: 20px; font-size: 24px;">网站已锁定</h2>
            <p style="color: var(--text-secondary, #888); margin-bottom: 10px; font-size: 16px;">
                <strong style="color: var(--accent-color, #4a9eff);">锁定者：</strong>${escapeHtml(lockBy)}
            </p>
            <p style="color: var(--text-secondary, #888); margin-bottom: 20px; font-size: 16px;">
                <strong style="color: var(--accent-color, #4a9eff);">原因：</strong>${escapeHtml(lockReason)}
            </p>
            <p style="color: var(--error-color, #ef4444); font-size: 14px;">
                您已被强制退出登录，页面将在3秒后刷新
            </p>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// 获取CSRF Token
async function getCSRFToken() {
    try {
        const response = await fetch('/api/csrf-token', { credentials: 'include' });
        if (response.ok) {
            const data = await response.json();
            csrfToken = data.csrfToken;
            return csrfToken;
        }
    } catch (error) {
        console.error('获取CSRF token失败:', error);
    }
    return null;
}

// 封装的fetch函数，处理403错误和CSRF
async function fetchWithAuth(url, options = {}) {
    // 确保发送cookies以维持session
    options.credentials = 'include';
    
    // 对于POST、PUT、DELETE请求，添加CSRF token
    if (options.method && ['POST', 'PUT', 'DELETE'].includes(options.method.toUpperCase())) {
        if (!csrfToken) {
            csrfToken = await getCSRFToken();
        }
        
        if (csrfToken) {
            // 添加CSRF token到header
            options.headers = options.headers || {};
            options.headers['X-CSRF-Token'] = csrfToken;
        }
    }
    
    const response = await fetch(url, options);
    
    // 处理网站锁定状态
    if (response.status === 503) {
        try {
            const error = await response.json();
            if (error.locked) {
                showSiteLockedModal(error.lockBy, error.lockReason);
                throw new Error('SiteLocked');
            }
        } catch (e) {
            if (e.message === 'SiteLocked') throw e;
        }
    }
    
    if (response.status === 403) {
        const error = await response.json();
        // 处理所有403错误，包括封禁、权限不足等
        showMessage(error.error || '访问被拒绝', 'error');
        localStorage.removeItem('user');
        setTimeout(() => {
            window.location.href = '/login';
        }, 2000);
        throw new Error('AccessDenied');
    }
    
    return response;
}

// 显示网站锁定弹窗
function showSiteLockedModal(lockBy, lockReason) {
    // 移除已存在的弹窗
    const existingModal = document.getElementById('site-locked-modal');
    if (existingModal) existingModal.remove();
    
    const modal = document.createElement('div');
    modal.id = 'site-locked-modal';
    modal.innerHTML = `
        <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;">
            <div style="background:#1a1a2e;padding:30px;border-radius:15px;max-width:400px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,0.5);">
                <div style="font-size:50px;margin-bottom:20px;">🔒</div>
                <h2 style="color:#ff6b6b;margin-bottom:15px;">网站已锁定</h2>
                <p style="color:#eee;margin-bottom:10px;">网站暂时无法访问</p>
                <div style="background:rgba(255,107,107,0.1);padding:15px;border-radius:8px;margin:15px 0;">
                    <p style="color:#ffa502;margin:5px 0;"><strong>锁定者:</strong> ${lockBy}</p>
                    <p style="color:#ffa502;margin:5px 0;"><strong>原因:</strong> ${lockReason}</p>
                </div>
                <p style="color:#888;font-size:12px;">请稍后再试或联系管理员</p>
                <button onclick="window.location.href='/login'" style="margin-top:20px;padding:10px 30px;background:#4a9eff;border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:14px;">返回登录页</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
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

// HTML转义函数
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 格式化日期函数
function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    
    if (diff < minute) return '刚刚';
    if (diff < hour) return Math.floor(diff / minute) + '分钟前';
    if (diff < day) return Math.floor(diff / hour) + '小时前';
    if (diff < 7 * day) return Math.floor(diff / day) + '天前';
    
    return date.toLocaleDateString('zh-CN');
}

// 生成用户导航HTML
function generateUserNavHtml(user) {
    let navHtml = `<a href="/user">${escapeHtml(user.username)}</a>`;
    navHtml += ` | <a href="/emails">邮箱</a>`;
    if (user.is_admin) {
        navHtml += ` | <a href="/admin">管理面板</a>`;
    }
    navHtml += ` | <a href="#" onclick="logout()">登出</a>`;
    return navHtml;
}

// 更新导航栏用户信息
function updateNavbarUser(user) {
    const navUser = document.getElementById('nav-user');
    if (navUser) {
        navUser.innerHTML = generateUserNavHtml(user);
    }
    
    // 隐藏首页的登录注册按钮
    const heroButtons = document.getElementById('hero-buttons');
    if (heroButtons) {
        heroButtons.classList.add('hidden');
    }
}

// 检查登录状态并更新导航栏
async function checkLoginStatus() {
    try {
        const response = await fetchWithAuth('/api/user');
        if (response.ok) {
            currentUser = await response.json();
            updateNavbarUser(currentUser);
            return currentUser;
        }
    } catch (error) {
        if (error.message !== 'AccessDenied') {
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
        if (error.message !== 'AccessDenied') {
            showMessage('登出失败', 'error');
        }
    }
}

// 加载任务列表
async function loadTasks() {
    try {
        const response = await fetch('/api/tasks');
        if (response.ok) {
            const result = await response.json();
            const tasks = result.data || [];
            const tasksList = document.getElementById('tasks-list');
            
            if (tasks.length === 0) {
                tasksList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">暂无任务</p>';
                return;
            }

            // 使用缓存的用户信息检查是否是管理员
            const isAdmin = currentUser ? currentUser.is_admin : false;

            tasksList.innerHTML = tasks.map(task => `
                <div class="task-card ${task.pinned ? 'pinned' : ''}" onclick="viewTask(${task.id})">
                    <div class="task-content">
                        <h3 class="task-title">${escapeHtml(task.title)}</h3>
                        <div class="task-meta">
                            <span>👤 ${escapeHtml(task.user ? task.user.username : '匿名')}</span>
                            <span>📅 ${formatDate(task.created_at)}</span>
                            <span class="task-status task-status-${task.status || '备货'}">${task.status || '备货'}</span>
                        </div>
                        ${task.file_name ? `
                            <div class="task-file">
                                <span>📎 ${escapeHtml(task.file_name)}</span>
                                <button class="btn-download-file" onclick="event.stopPropagation(); downloadFile(${task.id})" title="下载文件">⬇️ 下载</button>
                            </div>
                        ` : ''}
                    </div>
                    ${isAdmin ? `<button class="btn-delete-task" onclick="event.stopPropagation(); deleteTask(${task.id})" title="删除任务">🗑️</button>` : ''}
                </div>
            `).join('');
        }
    } catch (error) {
        if (error.message !== 'AccessDenied') {
            console.error('加载任务失败:', error);
            document.getElementById('tasks-list').innerHTML = '<p style="text-align: center; color: var(--error-color);">加载失败</p>';
        }
    }
}

// 查看任务详情
function viewTask(taskId) {
    window.location.href = `/task.html?id=${taskId}`;
}

// 下载任务文件
async function downloadFile(taskId) {
    try {
        const response = await fetch(`/api/tasks/${taskId}/download`);
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = response.headers.get('Content-Disposition')?.split('filename=')[1] || `task_${taskId}_file`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            showMessage('文件下载成功');
        } else {
            const error = await response.json();
            showMessage(error.error || '文件下载失败', 'error');
        }
    } catch (error) {
        showMessage('文件下载失败，请重试', 'error');
    }
}

// 删除任务（管理员）
async function deleteTask(taskId) {
    if (!confirm('确定要删除这个任务吗？')) {
        return;
    }

    try {
        const response = await fetchWithAuth(`/api/tasks/${taskId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showMessage('任务删除成功');
            loadTasks();
        } else {
            const error = await response.json();
            showMessage(error.error || '删除失败', 'error');
        }
    } catch (error) {
        if (error.message !== 'AccessDenied') {
            showMessage('删除失败，请重试', 'error');
        }
    }
}

// 加载留言列表
async function loadMessages() {
    try {
        const response = await fetch('/api/public/messages');
        if (response.ok) {
            const result = await response.json();
            const messages = result.data || [];
            const messagesList = document.getElementById('messages-list');
            
            if (messages.length === 0) {
                messagesList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">暂无留言</p>';
                return;
            }

            messagesList.innerHTML = messages.map(message => `
                <div class="message-item">
                    <div class="message-header">
                        <span>👤 ${escapeHtml(message.user ? message.user.username : '匿名')}</span>
                        <span>📅 ${formatDate(message.created_at)}</span>
                    </div>
                    <div class="message-content">${escapeHtml(message.content)}</div>
                </div>
            `).join('');
        }
    } catch (error) {
        if (error.message !== 'AccessDenied') {
            console.error('加载留言失败:', error);
            document.getElementById('messages-list').innerHTML = '<p style="text-align: center; color: var(--error-color);">加载失败</p>';
        }
    }
}

// 发布留言
async function postMessage() {
    const content = document.getElementById('message-content').value.trim();
    
    if (!content) {
        showMessage('请输入留言内容', 'warning');
        return;
    }

    if (content.length > 500) {
        showMessage('留言内容不能超过500字', 'warning');
        return;
    }

    try {
        const response = await fetchWithAuth('/api/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content })
        });

        if (response.ok) {
            showMessage('留言发布成功');
            document.getElementById('message-content').value = '';
            loadMessages();
        } else {
            const error = await response.json();
            showMessage(error.error || '发布失败', 'error');
        }
    } catch (error) {
        if (error.message !== 'AccessDenied') {
            showMessage('发布失败，请重试', 'error');
        }
    }
}

// 删除留言（管理员）
async function deleteMessage(messageId) {
    if (!confirm('确定要删除这条留言吗？')) {
        return;
    }

    try {
        const response = await fetchWithAuth(`/api/messages/${messageId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showMessage('留言删除成功');
            loadMessages();
        } else {
            const error = await response.json();
            showMessage(error.error || '删除失败', 'error');
        }
    } catch (error) {
        if (error.message !== 'AccessDenied') {
            showMessage('删除失败，请重试', 'error');
        }
    }
}

function calculateUnionDays() {
    const unionStartDate = new Date('2025-01-24');
    const now = new Date();
    const diffTime = Math.abs(now - unionStartDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const element = document.getElementById('union-days');
    if (element) {
        element.textContent = diffDays;
    }
}

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', async () => {
    // 初始化主题
    initTheme();
    
    // 连接网站事件SSE（监听网站锁定）
    connectSiteEvents();
    
    // 计算工会成立天数
    calculateUnionDays();
    
    // 检查登录状态
    const user = await checkLoginStatus();
    
    // 如果已登录，显示留言表单
    if (user) {
        const messageFormContainer = document.getElementById('message-form-container');
        if (messageFormContainer) {
            messageFormContainer.classList.remove('hidden');
        }
    }
    
    // 加载任务和留言
    loadTasks();
    loadMessages();
});