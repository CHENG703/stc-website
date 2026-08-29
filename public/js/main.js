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
    
    // Vercel 环境: 从 localStorage 读取 token 添加到 header
    const token = localStorage.getItem('stc_auth_token');
    if (token) {
        options.headers = options.headers || {};
        options.headers['Authorization'] = 'Bearer ' + token;
    }
    
    // 对于写请求（POST、PUT、DELETE、PATCH）：
    // 1. 每次都获取新的一次性 CSRF token（防重放，服务器端单次使用后删除）
    // 2. 生成唯一 nonce（防抓包重放）
    const method = (options.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        // 每次写请求都拿新 token（CSRF token 是一次性的）
        try {
            const newToken = await getCSRFToken();
            csrfToken = newToken;
        } catch (e) {
            console.warn('[CSRF] 刷新token失败:', e);
        }
        if (csrfToken) {
            options.headers = options.headers || {};
            options.headers['X-CSRF-Token'] = csrfToken;
        }
        // 生成请求 nonce：时间戳(ms) + 8位随机十六进制
        const nonce = Date.now().toString(36) + Math.random().toString(16).slice(2, 10);
        options.headers = options.headers || {};
        options.headers['X-Request-Nonce'] = nonce;
        // 用过后清空本地缓存 token，强制下次请求再取
        csrfToken = null;
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
    
    if (response.status === 401) {
        console.log('[AUTH] 收到 401 未授权响应');
        throw new Error('Unauthorized');
    }
    
    if (response.status === 403) {
        const error = await response.json();
        const errorMsg = error.error || '';
        // 不强制跳转，让调用者决定如何处理
        throw new Error('PermissionDenied');
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
        // checkLoginStatus 不应该强制跳转，只是返回 null
        console.log('[AUTH] checkLoginStatus:', error.message);
    }
    return null;
}

// 登出函数
async function logout() {
    try {
        const response = await fetchWithAuth('/api/logout', {
            method: 'POST'
        });
        // 无论成功与否，都清除本地 token
        localStorage.removeItem('stc_auth_token');
        if (response.ok) {
            showMessage('登出成功');
            setTimeout(() => {
                window.location.href = '/';
            }, 1000);
        } else {
            showMessage('登出失败', 'error');
        }
    } catch (error) {
        // 清除本地 token，即使请求失败
        localStorage.removeItem('stc_auth_token');
        if (error.message !== 'AccessDenied' && error.message !== 'Unauthorized') {
            showMessage('登出失败', 'error');
        } else {
            // 401/403 也视为登出成功（token 已失效）
            showMessage('登出成功');
            setTimeout(() => {
                window.location.href = '/';
            }, 1000);
        }
    }
}

// 任务状态映射
const STATUS_MAP = {
    'pending': '备货中',
    'planning': '建设中',
    'in_progress': '进行中',
    'completed': '已完成',
    'idle': '一笔未动'
};

const STATUS_COLORS = {
    'pending': '#f59e0b',
    'planning': '#3b82f6',
    'in_progress': '#8b5cf6',
    'completed': '#10b981',
    'idle': '#6b7280'
};

function getDisplayStatus(status) {
    if (!status) return '一笔未动';
    return STATUS_MAP[status] || status;
}

function getStatusColor(status) {
    return STATUS_COLORS[status] || '#6b7280';
}

// 加载任务列表
async function loadTasks() {
    try {
        const response = await fetch('/api/tasks');
        if (response.ok) {
            const result = await response.json();
            const tasks = result.data || [];
            const tasksList = document.getElementById('tasks-list');
            const taskStats = document.getElementById('task-stats');

            // 更新任务统计
            if (taskStats) {
                const total = result.total || tasks.length;
                const statusCounts = {};
                tasks.forEach(t => {
                    const s = t.status || 'idle';
                    statusCounts[s] = (statusCounts[s] || 0) + 1;
                });
                taskStats.innerHTML = `
                    <div class="stat-card"><span class="stat-num">${total}</span><span class="stat-label">总任务</span></div>
                    <div class="stat-card"><span class="stat-num">${statusCounts.pending || 0}</span><span class="stat-label">备货中</span></div>
                    <div class="stat-card"><span class="stat-num">${statusCounts.planning || 0}</span><span class="stat-label">建设中</span></div>
                    <div class="stat-card"><span class="stat-num">${statusCounts.in_progress || 0}</span><span class="stat-label">进行中</span></div>
                    <div class="stat-card"><span class="stat-num">${statusCounts.completed || 0}</span><span class="stat-label">已完成</span></div>
                `;
            }

            if (tasks.length === 0) {
                tasksList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">暂无任务</p>';
                return;
            }

            const isAdmin = currentUser ? currentUser.is_admin : false;

            tasksList.innerHTML = tasks.map(task => {
                const displayStatus = getDisplayStatus(task.status);
                const statusColor = getStatusColor(task.status);
                const canModifyStatus = currentUser && (currentUser.id === task.author_id || isAdmin);
                
                return `
                <div class="task-card ${task.pinned ? 'pinned' : ''}" onclick="viewTask(${task.id})">
                    <div class="task-content">
                        <h3 class="task-title">${escapeHtml(task.title)}</h3>
                        <div class="task-meta">
                            <span>👤 ${escapeHtml(task.user ? task.user.username : '匿名')}</span>
                            <span>📅 ${formatDate(task.created_at)}</span>
                            <span class="task-status" style="background:${statusColor}20;color:${statusColor};border:1px solid ${statusColor}40;padding:2px 8px;border-radius:10px;font-size:11px;">${displayStatus}</span>
                        </div>
                        ${task.file_name ? `
                            <div class="task-file">
                                <span>📎 ${escapeHtml(task.file_name)}</span>
                                <button class="btn-download-file" onclick="event.stopPropagation(); downloadFile(${task.id})" title="下载文件">⬇️ 下载</button>
                            </div>
                        ` : ''}
                        ${canModifyStatus ? `
                            <div class="task-status-actions" onclick="event.stopPropagation();">
                                <select onchange="updateTaskStatus(${task.id}, this.value)" style="margin-top:8px;padding:4px 8px;background:#161b22;border:1px solid #30363d;border-radius:4px;color:#f0f6fc;font-size:12px;">
                                    <option value="${task.status || 'idle'}" selected>${displayStatus}</option>
                                    <option value="idle">一笔未动</option>
                                    <option value="pending">备货中</option>
                                    <option value="planning">建设中</option>
                                    <option value="in_progress">进行中</option>
                                    <option value="completed">已完成</option>
                                </select>
                            </div>
                        ` : ''}
                    </div>
                    ${(isAdmin || (currentUser && currentUser.id === task.author_id)) ? `<button class="btn-delete-task" onclick="event.stopPropagation(); deleteTask(${task.id})" title="删除任务">🗑️</button>` : ''}
                </div>
            `}).join('');
            
            // 任务加载后初始化滚动动画
            if (window.reinitScrollAnimations) window.reinitScrollAnimations();
        }
    } catch (error) {
        if (error.message !== 'AccessDenied') {
            console.error('加载任务失败:', error);
            document.getElementById('tasks-list').innerHTML = '<p style="text-align: center; color: var(--error-color);">加载失败</p>';
        }
    }
}

// 更新任务状态
async function updateTaskStatus(taskId, newStatus) {
    try {
        const response = await fetchWithAuth(`/api/tasks/${taskId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        
        if (response.ok) {
            showMessage('状态更新成功');
            loadTasks();
        } else {
            const error = await response.json();
            showMessage(error.message || '状态更新失败', 'error');
        }
    } catch (error) {
        showMessage('状态更新失败', 'error');
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
            a.download = getFilenameFromHeaders(response.headers, taskId);
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

function getFilenameFromHeaders(headers, taskId) {
    const cd = headers.get('Content-Disposition');
    if (!cd) return `task_${taskId}_file`;
    
    const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match && utf8Match[1]) {
        try {
            return decodeURIComponent(utf8Match[1]);
        } catch (e) {
            return utf8Match[1];
        }
    }
    
    const asciiMatch = cd.match(/filename="?([^"]+)"?/i);
    if (asciiMatch && asciiMatch[1]) {
        return asciiMatch[1];
    }
    
    return `task_${taskId}_file`;
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

async function publishTask() {
    const btn = document.getElementById('btn-publish-task');
    let origBtnText = '';
    if (btn) {
        origBtnText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '⏳ 检查中...';
    }
    
    const restoreBtn = () => {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origBtnText || '➕ 发布任务';
        }
    };
    
    try {
        const userResp = await fetchWithAuth('/api/user');
        if (!userResp.ok) {
            restoreBtn();
            showConfirmModal('发布任务需要先登录，是否前往登录页？', () => {
                window.location.href = '/login';
            });
            return;
        }
        const user = await userResp.json();
        currentUser = user;
        updateNavbarUser(user);
        
        const limitResp = await fetchWithAuth('/api/tasks/daily-limit');
        const limitData = await limitResp.json();
        
        if (!limitData.success) {
            restoreBtn();
            showMessage(limitData.message || '获取限制失败', 'error');
            return;
        }
        
        const { is_admin, used, limit, remaining } = limitData.data;
        
        if (!is_admin && remaining <= 0) {
            restoreBtn();
            showMessage(`您今日已发布 ${used} 个任务，达到每日上限 ${limit} 个，请明天再来`, 'error');
            return;
        }
        
        restoreBtn();
        
        let limitInfo = '';
        if (!is_admin) {
            limitInfo = `<div style="color:#8b949e; font-size:12px; margin-bottom:12px;">今日已发布 ${used}/${limit} 个，剩余 ${remaining} 个</div>`;
        } else {
            limitInfo = `<div style="color:#2ea043; font-size:12px; margin-bottom:12px;">管理员无发布限制</div>`;
        }
        
        const modal = document.createElement('div');
        modal.id = 'publish-task-modal';
        modal.innerHTML = `
            <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;">
                <div style="background:#0d1117;padding:30px;border-radius:15px;width:520px;max-width:90vw;max-height:90vh;overflow-y:auto;border:1px solid #30363d;">
                    <h2 style="color:#f0f6fc;margin-bottom:20px;">📝 发布新任务</h2>
                    ${limitInfo}
                    <input type="text" id="task-title" placeholder="任务标题" style="width:100%;padding:10px;background:#161b22;border:1px solid #30363d;border-radius:6px;color:#f0f6fc;margin-bottom:10px;box-sizing:border-box;">
                    <textarea id="task-description" placeholder="任务详细描述" rows="5" style="width:100%;padding:10px;background:#161b22;border:1px solid #30363d;border-radius:6px;color:#f0f6fc;margin-bottom:10px;box-sizing:border-box;resize:vertical;"></textarea>
                    <div style="display:flex;gap:10px;margin-bottom:10px;">
                        <input type="number" id="task-reward" placeholder="悬赏金额" style="flex:1;padding:10px;background:#161b22;border:1px solid #30363d;border-radius:6px;color:#f0f6fc;box-sizing:border-box;">
                        <input type="date" id="task-deadline" style="flex:1;padding:10px;background:#161b22;border:1px solid #30363d;border-radius:6px;color:#f0f6fc;box-sizing:border-box;">
                    </div>
                    <div style="margin-bottom:10px;">
                        <label style="display:block;color:#8b949e;font-size:12px;margin-bottom:6px;">任务进度</label>
                        <select id="task-status" style="width:100%;padding:10px;background:#161b22;border:1px solid #30363d;border-radius:6px;color:#f0f6fc;box-sizing:border-box;">
                            <option value="idle">一笔未动</option>
                            <option value="pending">备货中</option>
                            <option value="planning">建设中</option>
                            <option value="in_progress">进行中</option>
                            <option value="completed">已完成</option>
                        </select>
                    </div>
                    <div style="margin-bottom:15px;">
                        <label style="display:block;color:#8b949e;font-size:12px;margin-bottom:6px;">附件（可选，最大 2GB，支持所有类型）</label>
                        <input type="file" id="task-file" style="width:100%;padding:8px;background:#161b22;border:1px dashed #30363d;border-radius:6px;color:#f0f6fc;box-sizing:border-box;font-size:12px;" onchange="window._taskFile=this.files[0];window._taskFileSizeText=this.files[0]?'已选 '+this.files[0].name+' ('+formatSize(this.files[0].size)+')':'';">
                        <div id="task-file-info" style="color:#8b949e;font-size:11px;margin-top:4px;"></div>
                    </div>
                    <div style="display:flex;gap:10px;">
                        <button onclick="closePublishModal()" style="flex:1;padding:10px;background:#21262d;color:#f0f6fc;border:1px solid #30363d;border-radius:6px;cursor:pointer;">取消</button>
                        <button onclick="submitTask()" style="flex:1;padding:10px;background:#238636;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">发布</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        window._taskFile = null;
        window.formatSize = (bytes) => {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
            if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
            return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        };
        
        window.closePublishModal = () => {
            const m = document.getElementById('publish-task-modal');
            if (m) m.remove();
            window._taskFile = null;
        };
        
        window.submitTask = async () => {
            const title = document.getElementById('task-title').value.trim();
            const description = document.getElementById('task-description').value.trim();
            const reward = document.getElementById('task-reward').value;
            const deadline = document.getElementById('task-deadline').value;
            const status = document.getElementById('task-status').value;
            const fileInput = document.getElementById('task-file');
            const file = fileInput && fileInput.files[0];
            
            if (!title || !description) {
                showMessage('请填写标题和描述', 'error');
                return;
            }
            
            if (file && file.size > 2 * 1024 * 1024 * 1024) {
                showMessage('文件大小超过 2GB 限制', 'error');
                return;
            }
            
            const btn = modal.querySelector('button[onclick^="submitTask"]');
            if (btn) {
                btn.disabled = true;
                btn.textContent = '发布中...';
            }
            
            try {
                const formData = new FormData();
                formData.append('title', title);
                formData.append('description', description);
                if (reward) formData.append('reward', reward);
                if (deadline) formData.append('deadline', deadline);
                if (status) formData.append('status', status);
                if (file) formData.append('file', file);
                
                if (!csrfToken) {
                    const tkResp = await fetch('/api/csrf-token', { credentials: 'include' });
                    if (tkResp.ok) {
                        const tkData = await tkResp.json();
                        csrfToken = tkData.csrfToken;
                    }
                }

                // 使用 fetchWithAuth 确保 Vercel 环境下带上 Authorization 头
                const response = await fetchWithAuth('/api/tasks', {
                    method: 'POST',
                    body: formData
                });
                
                if (response.ok) {
                    showMessage('任务发布成功');
                    closePublishModal();
                    loadTasks();
                } else {
                    const error = await response.json().catch(() => ({}));
                    showMessage(error.message || error.error || '发布失败', 'error');
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = '发布';
                    }
                }
            } catch (err) {
                if (err.message === 'AccessDenied') {
                    closePublishModal();
                    showConfirmModal('登录已过期，是否前往登录页？', () => {
                        window.location.href = '/login';
                    });
                } else if (err.message !== 'PermissionDenied') {
                    showMessage('发布失败：' + (err.message || '请重试'), 'error');
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = '发布';
                    }
                }
            }
        };
        
    } catch (error) {
        restoreBtn();
        // 401 未授权 / 未登录，引导用户登录
        if (error.message === 'Unauthorized' || error.message === 'AccessDenied') {
            showConfirmModal('登录状态已失效，是否前往登录页？', () => {
                window.location.href = '/login';
            });
        } else if (error.message !== 'PermissionDenied' && error.message !== 'SiteLocked') {
            console.error('[publishTask] 错误:', error);
            showMessage('发布功能暂时不可用：' + (error.message || '请重试'), 'error');
        }
    }
}

function showConfirmModal(message, onConfirm, onCancel) {
    const existing = document.getElementById('confirm-modal');
    if (existing) existing.remove();
    
    const modal = document.createElement('div');
    modal.id = 'confirm-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:999999;display:flex;align-items:center;justify-content:center;';
    
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#0d1117;padding:30px;border-radius:15px;max-width:400px;width:90%;border:1px solid #30363d;';
    
    const msgEl = document.createElement('div');
    msgEl.style.cssText = 'color:#f0f6fc;margin-bottom:20px;font-size:15px;line-height:1.6;';
    msgEl.textContent = message;
    
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = 'flex:1;padding:10px;background:#21262d;color:#f0f6fc;border:1px solid #30363d;border-radius:6px;cursor:pointer;';
    cancelBtn.onclick = () => { modal.remove(); if (onCancel) onCancel(); };
    
    const okBtn = document.createElement('button');
    okBtn.textContent = '确定';
    okBtn.style.cssText = 'flex:1;padding:10px;background:#238636;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;';
    okBtn.onclick = () => { modal.remove(); if (onConfirm) onConfirm(); };
    
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(okBtn);
    dialog.appendChild(msgEl);
    dialog.appendChild(btnRow);
    modal.appendChild(dialog);
    document.body.appendChild(modal);
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
            
            // 留言加载后初始化滚动动画
            if (window.reinitScrollAnimations) window.reinitScrollAnimations();
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
    // 清理历史遗留的 CookieStore 分片 cookie（避免 494 REQUEST_HEADER_TOO_LARGE）
    try {
        document.cookie.split(';').forEach(c => {
            const name = c.split('=')[0].trim();
            if (name.startsWith('sess_')) {
                document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; secure; samesite=none';
            }
        });
    } catch (e) {}

    // 初始化主题
    initTheme();
    
    // 连接网站事件SSE（监听网站锁定）
    connectSiteEvents();
    
    // 计算工会成立天数
    calculateUnionDays();
    
    // 检查登录状态
    let user = await checkLoginStatus();
    
    // 如果未登录，尝试检查 Logto 认证
    if (!user) {
        try {
            const response = await fetch('/api/auth/logto/check');
            const data = await response.json();
            if (data.authenticated && data.token) {
                localStorage.setItem('stc_auth_token', data.token);
                console.log('[LOGTO] 通过 Logto 登录成功:', data.username);
                // 重新检查登录状态
                user = await checkLoginStatus();
            }
        } catch (e) {
            // Logto 检查失败，静默忽略
        }
    }
    
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