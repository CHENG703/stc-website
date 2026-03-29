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
            
            // 隐藏首页的登录注册按钮
            const heroButtons = document.getElementById('hero-buttons');
            if (heroButtons) {
                heroButtons.classList.add('hidden');
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

// 加载任务列表
async function loadTasks() {
    try {
        const response = await fetchWithAuth('/api/tasks');
        if (response.ok) {
            const tasks = await response.json();
            const tasksList = document.getElementById('tasks-list');
            
            if (tasks.length === 0) {
                tasksList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">暂无任务</p>';
                return;
            }

            // 获取当前用户信息以检查是否是管理员
            const userResponse = await fetchWithAuth('/api/user');
            let isAdmin = false;
            if (userResponse.ok) {
                const user = await userResponse.json();
                isAdmin = user.isAdmin;
            }

            tasksList.innerHTML = tasks.map(task => `
                <div class="task-card ${task.is_pinned ? 'pinned' : ''}" onclick="viewTask(${task.id})">
                    <div class="task-content">
                        <h3 class="task-title">${escapeHtml(task.title)}</h3>
                        <div class="task-meta">
                            <span>👤 ${escapeHtml(task.author_name)}</span>
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
        if (error.message !== 'Banned') {
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
        if (error.message !== 'Banned') {
            showMessage('删除失败，请重试', 'error');
        }
    }
}

// 加载留言列表
async function loadMessages() {
    try {
        const response = await fetchWithAuth('/api/messages');
        if (response.ok) {
            const messages = await response.json();
            const messagesList = document.getElementById('messages-list');
            
            if (messages.length === 0) {
                messagesList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">暂无留言</p>';
                return;
            }

            // 获取当前用户信息以检查是否是管理员
            const userResponse = await fetchWithAuth('/api/user');
            let isAdmin = false;
            if (userResponse.ok) {
                const user = await userResponse.json();
                isAdmin = user.isAdmin;
            }

            messagesList.innerHTML = messages.map(message => `
                <div class="message-item">
                    <div class="message-header">
                        <span>👤 ${escapeHtml(message.author_name)}</span>
                        <span>📅 ${formatDate(message.created_at)}</span>
                        ${isAdmin ? `<button class="btn-delete-message" onclick="deleteMessage(${message.id})" title="删除留言">🗑️</button>` : ''}
                    </div>
                    <div class="message-content">${escapeHtml(message.content)}</div>
                </div>
            `).join('');
        }
    } catch (error) {
        if (error.message !== 'Banned') {
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
        if (error.message !== 'Banned') {
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
        if (error.message !== 'Banned') {
            showMessage('删除失败，请重试', 'error');
        }
    }
}

// 格式化日期
function formatDate(dateString) {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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