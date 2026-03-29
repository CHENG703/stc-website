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

// 加载用户信息
async function loadUserInfo() {
    try {
        const response = await fetchWithAuth('/api/user');
        if (response.ok) {
            const user = await response.json();
            document.getElementById('user-username').textContent = user.username;
            document.getElementById('user-email').textContent = user.email;
            document.getElementById('user-created').textContent = formatDate(user.createdAt);
            document.getElementById('user-role').textContent = user.isAdmin ? '管理员' : '普通用户';

            // 如果不是管理员，隐藏管理员功能
            if (!user.isAdmin) {
                const inviteCodeCard = document.getElementById('invite-code-card');
                if (inviteCodeCard) {
                    inviteCodeCard.classList.add('hidden');
                }
                const publishTaskCard = document.getElementById('publish-task-card');
                if (publishTaskCard) {
                    publishTaskCard.classList.add('hidden');
                }
            }
        } else {
            showMessage('获取用户信息失败', 'error');
            setTimeout(() => {
                window.location.href = '/login';
            }, 2000);
        }
    } catch (error) {
        if (error.message !== 'Banned') {
            showMessage('获取用户信息失败', 'error');
            setTimeout(() => {
                window.location.href = '/login';
            }, 2000);
        }
    }
}

// 修改密码
async function handleChangePassword(event) {
    event.preventDefault();

    const oldPassword = document.getElementById('old-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmNewPassword = document.getElementById('confirm-new-password').value;

    if (!oldPassword || !newPassword || !confirmNewPassword) {
        showMessage('请填写所有字段', 'warning');
        return;
    }

    if (newPassword.length < 6) {
        showMessage('新密码长度至少6位', 'warning');
        return;
    }

    if (newPassword !== confirmNewPassword) {
        showMessage('两次输入的新密码不一致', 'warning');
        return;
    }

    if (oldPassword === newPassword) {
        showMessage('新密码不能与旧密码相同', 'warning');
        return;
    }

    try {
        const response = await fetchWithAuth('/api/user/password', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                oldPassword,
                newPassword
            })
        });

        if (response.ok) {
            showMessage('密码修改成功，请重新登录');
            document.getElementById('password-form').reset();
            setTimeout(() => {
                logout();
            }, 1500);
        } else {
            const error = await response.json();
            showMessage(error.error || '修改失败', 'error');
        }
    } catch (error) {
        if (error.message !== 'Banned') {
            showMessage('修改失败，请重试', 'error');
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
            const resultDiv = document.getElementById('invite-code-result');
            resultDiv.textContent = data.code;
            resultDiv.style.display = 'block';
            showMessage('邀请码生成成功');
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

// 发布任务
async function handlePublishTask(event) {
    event.preventDefault();

    const title = document.getElementById('task-title').value.trim();
    const content = document.getElementById('task-content').value.trim();
    const isPinned = document.getElementById('task-pinned').checked;
    const status = document.getElementById('task-status').value;
    const fileInput = document.getElementById('task-file');

    if (!title || !content) {
        showMessage('请填写任务标题和内容', 'warning');
        return;
    }

    try {
        // 检查文件大小（最大1.5GB）
        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const maxSize = 1.5 * 1024 * 1024 * 1024; // 1.5GB
            if (file.size > maxSize) {
                showMessage('文件大小不能超过1.5GB', 'warning');
                return;
            }
        }

        // 使用FormData处理文件上传
        const formData = new FormData();
        formData.append('title', title);
        formData.append('content', content);
        formData.append('isPinned', isPinned);
        formData.append('status', status);
        if (fileInput.files.length > 0) {
            formData.append('file', fileInput.files[0]);
        }

        const response = await fetchWithAuth('/api/tasks', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            showMessage('任务发布成功');
            document.getElementById('task-form').reset();
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

// 格式化日期
function formatDate(dateString) {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
    loadUserInfo();
});