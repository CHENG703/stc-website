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
            // 清除本地存储的任何用户信息
            localStorage.removeItem('user');
            setTimeout(() => {
                window.location.href = '/login';
            }, 2000);
            throw new Error('Banned');
        }
    }
    
    return response;
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

// 生成邀请码
async function generateInviteCode() {
    try {
        const response = await fetchWithAuth('/api/invite-codes', {
            method: 'POST'
        });

        if (response.ok) {
            const data = await response.json();
            showMessage(`邀请码 ${data.code} 生成成功`);
            loadInviteCodes();
        } else {
            const error = await response.json();
            showMessage(error.error || '生成失败', 'error');
        }
    } catch (error) {
        if (error.message !== 'Banned') {
            showMessage('生成失败，请重试', 'error');
        }
    }
}

// 删除邀请码
async function deleteInviteCode(codeId) {
    if (!confirm('确定要删除这个邀请码吗？')) {
        return;
    }

    try {
        const response = await fetchWithAuth(`/api/invite-codes/${codeId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showMessage('邀请码删除成功');
            loadInviteCodes();
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

// 加载邀请码列表
async function loadInviteCodes() {
    try {
        const response = await fetchWithAuth('/api/invite-codes');
        if (response.ok) {
            const codes = await response.json();
            const tableContainer = document.getElementById('invite-codes-table');
            
            if (codes.length === 0) {
                tableContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">暂无邀请码</p>';
                return;
            }

            tableContainer.innerHTML = `
                <table>
                    <thead>
                        <tr>
                            <th>邀请码</th>
                            <th>状态</th>
                            <th>创建时间</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${codes.map(code => `
                            <tr>
                                <td><code style="background: var(--bg-secondary); padding: 0.25rem 0.5rem; border-radius: 4px;">${escapeHtml(code.code)}</code></td>
                                <td>
                                    <span class="status-badge ${code.is_used ? 'used' : 'available'}">
                                        ${code.is_used ? '已使用' : '可用'}
                                    </span>
                                </td>
                                <td>${formatDate(code.created_at)}</td>
                                <td>
                                    <button onclick="deleteInviteCode(${code.id})" class="btn btn-primary" style="background: var(--error-color); padding: 0.375rem 0.75rem; font-size: 0.875rem;">删除</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
    } catch (error) {
        if (error.message !== 'Banned') {
            console.error('加载邀请码列表失败:', error);
            document.getElementById('invite-codes-table').innerHTML = '<p style="text-align: center; color: var(--error-color);">加载失败</p>';
        }
    }
}

// 加载成员列表
async function loadMembers() {
    try {
        const response = await fetch('/api/members');
        if (response.ok) {
            const members = await response.json();
            const tableContainer = document.getElementById('members-table');
            
            if (members.length === 0) {
                tableContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">暂无成员</p>';
                return;
            }

            tableContainer.innerHTML = `
                <table>
                    <thead>
                        <tr>
                            <th>用户名</th>
                            <th>邮箱</th>
                            <th>密码状态</th>
                            <th>角色</th>
                            <th>状态</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${members.map(member => `
                            <tr>
                                <td>${escapeHtml(member.username)}</td>
                                <td>${escapeHtml(member.email)}</td>
                                <td><span style="color: var(--success-color);">✓ 已加密</span></td>
                                <td>
                                    <span class="status-badge ${member.is_admin ? 'admin' : 'user'}">
                                        ${member.is_admin ? '管理员' : '普通用户'}
                                    </span>
                                </td>
                                <td>
                                    <span class="status-badge ${member.is_banned ? 'banned' : 'available'}">
                                        ${member.is_banned ? '已封禁' : '正常'}
                                    </span>
                                </td>
                                <td>
                                    <div class="member-actions">
                                        ${member.username !== 'CYJ2025' ? `
                                            <button onclick="toggleBan(${member.id}, ${!member.is_banned})" class="btn ${member.is_banned ? 'btn-secondary' : 'btn-primary'}" style="padding: 0.375rem 0.75rem; font-size: 0.875rem;">
                                                ${member.is_banned ? '解封' : '封禁'}
                                            </button>
                                            <button onclick="toggleAdmin(${member.id}, ${!member.is_admin})" class="btn ${member.is_admin ? 'btn-secondary' : 'btn-primary'}" style="padding: 0.375rem 0.75rem; font-size: 0.875rem;">
                                                ${member.is_admin ? '取消管理员' : '设为管理员'}
                                            </button>
                                        ` : '<span style="color: var(--text-secondary); font-size: 0.875rem;">超级管理员</span>'}
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
    } catch (error) {
        console.error('加载成员列表失败:', error);
        document.getElementById('members-table').innerHTML = '<p style="text-align: center; color: var(--error-color);">加载失败</p>';
    }
}

// 封禁/解封用户（仅超级管理员）
async function toggleBan(userId, isBanned) {
    try {
        const response = await fetchWithAuth(`/api/members/${userId}/ban`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ isBanned })
        });

        if (response.ok) {
            const result = await response.json();
            
            // 如果封禁的是当前登录的用户，立即登出
            if (result.logoutRequired) {
                showMessage('你的账号已被封禁，正在退出登录', 'error');
                setTimeout(() => {
                    window.location.href = '/login';
                }, 2000);
                return;
            }
            
            showMessage(isBanned ? '用户已封禁' : '用户已解封');
            loadMembers();
        } else {
            const error = await response.json();
            showMessage(error.error || '操作失败', 'error');
        }
    } catch (error) {
        if (error.message !== 'Banned') {
            showMessage('操作失败，请重试', 'error');
        }
    }
}

// 设置/取消管理员（仅超级管理员）
async function toggleAdmin(userId, isAdmin) {
    try {
        const response = await fetchWithAuth(`/api/members/${userId}/admin`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ isAdmin })
        });

        if (response.ok) {
            showMessage(isAdmin ? '已设置为管理员' : '已取消管理员权限');
            loadMembers();
        } else {
            const error = await response.json();
            showMessage(error.error || '操作失败', 'error');
        }
    } catch (error) {
        if (error.message !== 'Banned') {
            showMessage('操作失败，请重试', 'error');
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
document.addEventListener('DOMContentLoaded', () => {
    // 检查是否是管理员
    fetch('/api/user')
        .then(response => {
            if (response.ok) {
                return response.json();
            }
            throw new Error('Not logged in');
        })
        .then(user => {
            console.log('当前用户:', user);
            console.log('是否是管理员:', user.isAdmin);
            console.log('用户名:', user.username);
            
            if (!user.isAdmin) {
                showMessage('需要管理员权限', 'error');
                setTimeout(() => {
                    window.location.href = '/user';
                }, 2000);
            } else {
                loadInviteCodes();
                loadTasks();
                loadMessages();
                loadAccounts();
                
                // 只有超级管理员（CYJ2025）才能看到成员管理和账号管理
                if (user.username === 'CYJ2025') {
                    console.log('显示成员管理');
                    loadMembers();
                } else {
                    console.log('隐藏成员管理和账号管理');
                    const membersSection = document.getElementById('members-section');
                    if (membersSection) {
                        membersSection.classList.add('hidden');
                    }
                    const accountsSection = document.getElementById('accounts-section');
                    if (accountsSection) {
                        accountsSection.classList.add('hidden');
                    }
                }
            }
        })
        .catch(error => {
            console.error('错误:', error);
            showMessage('请先登录', 'error');
            setTimeout(() => {
                window.location.href = '/login';
            }, 2000);
        });
});

// 加载任务列表
async function loadTasks() {
    try {
        const response = await fetchWithAuth('/api/tasks');
        if (response.ok) {
            const tasks = await response.json();
            const tableContainer = document.getElementById('tasks-table');
            
            if (tasks.length === 0) {
                tableContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">暂无任务</p>';
                return;
            }

            tableContainer.innerHTML = `
                <table>
                    <thead>
                        <tr>
                            <th>标题</th>
                            <th>作者</th>
                            <th>发布时间</th>
                            <th>状态</th>
                            <th>文件</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tasks.map(task => `
                            <tr>
                                <td>${escapeHtml(task.title)}</td>
                                <td>${escapeHtml(task.author_name)}</td>
                                <td>${formatDate(task.created_at)}</td>
                                <td>
                                    <select onchange="updateTaskStatus(${task.id}, this.value)" class="task-status-select" ${user.username !== 'CYJ2025' ? 'disabled' : ''}>
                                        <option value="备货" ${task.status === '备货' ? 'selected' : ''}>备货</option>
                                        <option value="正在建" ${task.status === '正在建' ? 'selected' : ''}>正在建</option>
                                        <option value="已完成" ${task.status === '已完成' ? 'selected' : ''}>已完成</option>
                                    </select>
                                </td>
                                <td>
                                    ${task.file_name ? `
                                        <a href="/api/tasks/${task.id}/download" target="_blank" style="color: var(--primary-color); text-decoration: none;">
                                            📎 ${escapeHtml(task.file_name)}
                                        </a>
                                    ` : '<span style="color: var(--text-secondary);">无文件</span>'}
                                </td>
                                <td>
                                    <div class="member-actions">
                                        ${task.is_pinned ? '<span class="status-badge pinned">置顶</span>' : '<span class="status-badge available">普通</span>'}
                                        <button onclick="deleteTask(${task.id})" class="btn btn-primary" style="background: var(--error-color); padding: 0.375rem 0.75rem; font-size: 0.875rem;">删除</button>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
    } catch (error) {
        if (error.message !== 'Banned') {
            console.error('加载任务列表失败:', error);
            document.getElementById('tasks-table').innerHTML = '<p style="text-align: center; color: var(--error-color);">加载失败</p>';
        }
    }
}

// 加载留言列表
async function loadMessages() {
    try {
        const response = await fetchWithAuth('/api/messages');
        if (response.ok) {
            const messages = await response.json();
            const tableContainer = document.getElementById('messages-table');
            
            if (messages.length === 0) {
                tableContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">暂无留言</p>';
                return;
            }

            tableContainer.innerHTML = `
                <table>
                    <thead>
                        <tr>
                            <th>内容</th>
                            <th>作者</th>
                            <th>发布时间</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${messages.map(message => `
                            <tr>
                                <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(message.content)}</td>
                                <td>${escapeHtml(message.author_name)}</td>
                                <td>${formatDate(message.created_at)}</td>
                                <td>
                                    <button onclick="deleteMessage(${message.id})" class="btn btn-primary" style="background: var(--error-color); padding: 0.375rem 0.75rem; font-size: 0.875rem;">删除</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
    } catch (error) {
        if (error.message !== 'Banned') {
            console.error('加载留言列表失败:', error);
            document.getElementById('messages-table').innerHTML = '<p style="text-align: center; color: var(--error-color);">加载失败</p>';
        }
    }
}

// 删除任务
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

// 更新任务状态（仅管理员）
async function updateTaskStatus(taskId, newStatus) {
    try {
        const response = await fetchWithAuth(`/api/tasks/${taskId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: newStatus })
        });

        if (response.ok) {
            showMessage('任务状态更新成功');
        } else {
            const error = await response.json();
            showMessage(error.error || '更新失败', 'error');
            // 恢复原来的选择
            loadTasks();
        }
    } catch (error) {
        if (error.message !== 'Banned') {
            showMessage('更新失败，请重试', 'error');
            loadTasks();
        }
    }
}

// 删除留言
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

// 加载账号列表
async function loadAccounts() {
    try {
        const response = await fetchWithAuth('/api/user');
        if (response.ok) {
            const currentUser = await response.json();
            const membersResponse = await fetchWithAuth('/api/members');
            
            if (membersResponse.ok) {
                const accounts = await membersResponse.json();
                const tableContainer = document.getElementById('accounts-table');
                
                if (accounts.length === 0) {
                    tableContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">暂无账号</p>';
                    return;
                }

                tableContainer.innerHTML = `
                    <table>
                        <thead>
                            <tr>
                                <th>用户名</th>
                                <th>邮箱</th>
                                <th>角色</th>
                                <th>状态</th>
                                <th>注册时间</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${accounts.map(account => `
                                <tr>
                                    <td>${escapeHtml(account.username)}</td>
                                    <td>${escapeHtml(account.email)}</td>
                                    <td>
                                        <span class="status-badge ${account.is_admin ? 'admin' : 'user'}">
                                            ${account.is_admin ? '管理员' : '普通用户'}
                                        </span>
                                    </td>
                                    <td>
                                        <span class="status-badge ${account.is_banned ? 'banned' : 'available'}">
                                            ${account.is_banned ? '已封禁' : '正常'}
                                        </span>
                                    </td>
                                    <td>${formatDate(account.created_at)}</td>
                                    <td>
                                        ${account.username === 'CYJ2025' ? 
                                            '<span style="color: var(--text-secondary); font-size: 0.875rem;">超级管理员</span>' : 
                                            account.username === currentUser.username ?
                                            '<span style="color: var(--text-secondary); font-size: 0.875rem;">当前账号</span>' :
                                            `<button onclick="deleteAccount(${account.id}, '${escapeHtml(account.username)}')" class="btn btn-primary" style="background: var(--error-color); padding: 0.375rem 0.75rem; font-size: 0.875rem;">删除账号</button>`
                                        }
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            }
        }
    } catch (error) {
        if (error.message !== 'Banned') {
            console.error('加载账号列表失败:', error);
            document.getElementById('accounts-table').innerHTML = '<p style="text-align: center; color: var(--error-color);">加载失败</p>';
        }
    }
}

// 删除账号
async function deleteAccount(accountId, username) {
    if (!confirm(`确定要删除账号 "${username}" 吗？\n\n此操作将永久删除该账号及其所有相关数据（任务、留言等），无法恢复！`)) {
        return;
    }

    try {
        const response = await fetchWithAuth(`/api/accounts/${accountId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showMessage(`账号 "${username}" 删除成功`);
            loadAccounts();
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