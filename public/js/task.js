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
    // 确保发送cookies以维持session
    options.credentials = 'include';
    
    const response = await fetch(url, options);
    
    if (response.status === 403) {
        const error = await response.json();
        const errorMsg = error.error || '';
        if (errorMsg.includes('请先登录') || errorMsg.includes('未登录')) {
            showMessage('登录已过期，请重新登录', 'error');
            localStorage.removeItem('user');
            setTimeout(() => {
                window.location.href = '/login';
            }, 2000);
            throw new Error('AccessDenied');
        } else {
            showMessage(errorMsg || '权限不足', 'error');
            throw new Error('PermissionDenied');
        }
    }
    
    return response;
}

// 全局用户变量
let currentUser = null;
let csrfToken = null;

// 检查登录状态并更新导航栏
async function checkLoginStatus() {
    try {
        const response = await fetchWithAuth('/api/user');
        if (response.ok) {
            const user = await response.json();
            currentUser = user;
            const navUser = document.getElementById('nav-user');
            if (navUser) {
                let navHtml = `<a href="/user">${user.username}</a>`;
                if (user.is_admin || user.is_super_admin) {
                    navHtml += ` | <a href="/admin">管理面板</a>`;
                }
                navHtml += ` | <a href="#" onclick="logout()">登出</a>`;
                navUser.innerHTML = navHtml;
            }
            
            // 获取CSRF token
            try {
                const tkResp = await fetch('/api/csrf-token', { credentials: 'include' });
                if (tkResp.ok) {
                    const tkData = await tkResp.json();
                    csrfToken = tkData.csrfToken;
                    localStorage.setItem('csrfToken', csrfToken);
                }
            } catch (e) {}
            
            return user;
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

        const result = await response.json();
        const task = result.data || result;
        displayTaskDetail(task);
    } catch (error) {
        if (error.message !== 'AccessDenied') {
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
    
    const displayStatus = task.status ? STATUS_MAP[task.status] || task.status : '一笔未动';
    const statusColor = STATUS_COLORS[task.status] || '#6b7280';
    
    let attachmentHtml = '';
    if (task.file_name) {
        const ext = task.file_name.split('.').pop().toLowerCase();
        const icon = getFileIcon(ext);
        attachmentHtml = `
            <div class="task-detail-attachment">
                <h3>附件</h3>
                <div style="display:flex;align-items:center;gap:12px;padding:14px;background:#161b22;border:1px solid #30363d;border-radius:8px;margin-top:10px;">
                    <div style="font-size:28px;">${icon}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="color:#f0f6fc;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(task.file_name)}">${escapeHtml(task.file_name)}</div>
                        <div style="color:#8b949e;font-size:12px;margin-top:2px;">点击右侧按钮下载</div>
                    </div>
                    <a href="/api/tasks/${task.id}/download" download="${escapeHtml(task.file_name)}" style="padding:8px 16px;background:#238636;color:white;border-radius:6px;text-decoration:none;font-weight:500;font-size:13px;">
                        ⬇ 下载
                    </a>
                </div>
            </div>
        `;
    }
    
    let statusUpdateHtml = '';
    if (currentUser && (currentUser.id === task.author_id || currentUser.is_admin || currentUser.is_super_admin)) {
        statusUpdateHtml = `
            <div style="margin-top:15px;padding:15px;background:#161b22;border:1px solid #30363d;border-radius:8px;">
                <div style="color:#8b949e;font-size:12px;margin-bottom:8px;">修改任务进度</div>
                <div style="display:flex;gap:10px;align-items:center;">
                    <select id="task-status-select" onchange="updateTaskStatus(${task.id}, this.value)" style="flex:1;padding:10px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#f0f6fc;">
                        <option value="idle" ${task.status === 'idle' ? 'selected' : ''}>一笔未动</option>
                        <option value="pending" ${task.status === 'pending' ? 'selected' : ''}>备货中</option>
                        <option value="planning" ${task.status === 'planning' ? 'selected' : ''}>建设中</option>
                        <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>进行中</option>
                        <option value="completed" ${task.status === 'completed' ? 'selected' : ''}>已完成</option>
                    </select>
                </div>
            </div>
        `;
    }
    
    taskDetail.innerHTML = `
        <div class="task-detail-header">
            <h1 class="task-detail-title">${escapeHtml(task.title)}</h1>
            ${pinnedBadge}
            <span style="background:${statusColor}20;color:${statusColor};border:1px solid ${statusColor}40;padding:4px 12px;border-radius:12px;font-size:13px;margin-top:10px;display:inline-block;">${displayStatus}</span>
        </div>
        
        <div class="task-detail-meta">
            <span>👤 作者：${escapeHtml(task.author_name)}</span>
            <span>📅 发布时间：${formatDateTime(task.created_at)}</span>
        </div>
        
        <div class="task-detail-content">
            <h3>任务内容</h3>
            <div class="task-detail-text">${content}</div>
        </div>
        
        ${attachmentHtml}
        ${statusUpdateHtml}
    `;
}

// 更新任务状态
async function updateTaskStatus(taskId, newStatus) {
    try {
        const token = localStorage.getItem('csrfToken');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['X-CSRF-Token'] = token;
        
        const response = await fetch(`/api/tasks/${taskId}/status`, {
            method: 'PUT',
            credentials: 'include',
            headers: headers,
            body: JSON.stringify({ status: newStatus })
        });
        
        if (response.ok) {
            showMessage('状态更新成功');
            loadTaskDetail();
        } else {
            const error = await response.json();
            showMessage(error.message || '状态更新失败', 'error');
        }
    } catch (error) {
        showMessage('状态更新失败', 'error');
    }
}

function getFileIcon(ext) {
    const icons = {
        'pdf': '📕',
        'doc': '📘', 'docx': '📘',
        'xls': '📗', 'xlsx': '📗', 'csv': '📗',
        'ppt': '📙', 'pptx': '📙',
        'zip': '📦', 'rar': '📦', '7z': '📦', 'tar': '📦', 'gz': '📦',
        'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'bmp': '🖼️', 'webp': '🖼️',
        'mp3': '🎵', 'wav': '🎵', 'flac': '🎵', 'm4a': '🎵',
        'mp4': '🎬', 'avi': '🎬', 'mkv': '🎬', 'mov': '🎬', 'webm': '🎬',
        'txt': '📝', 'md': '📝', 'log': '📝',
        'py': '🐍', 'js': '📜', 'html': '📜', 'css': '📜', 'json': '📜',
        'exe': '⚙️', 'msi': '⚙️', 'dmg': '⚙️',
        'apk': '📱', 'ipa': '📱'
    };
    return icons[ext] || '📎';
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