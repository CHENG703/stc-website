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
            
            // 显示GitHub绑定状态
            const githubStatus = document.getElementById('user-github');
            const githubBtn = document.getElementById('bind-github-btn');
            if (user.githubId) {
                githubStatus.textContent = '已绑定';
                githubStatus.style.color = '#10b981';
                githubBtn.style.display = 'none';
            } else {
                githubStatus.textContent = '未绑定';
                githubStatus.style.color = '#9ca3af';
                githubBtn.style.display = 'inline-block';
            }
            
            // 显示Microsoft绑定状态
            const microsoftStatus = document.getElementById('user-microsoft');
            const microsoftBtn = document.getElementById('bind-microsoft-btn');
            if (user.microsoftId) {
                microsoftStatus.textContent = '已绑定';
                microsoftStatus.style.color = '#10b981';
                microsoftBtn.style.display = 'none';
            } else {
                microsoftStatus.textContent = '未绑定';
                microsoftStatus.style.color = '#9ca3af';
                microsoftBtn.style.display = 'inline-block';
            }

            // 加载头像
                       loadAvatar();

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
        if (error.message !== 'AccessDenied') {
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
        if (error.message !== 'AccessDenied') {
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
        if (error.message !== 'AccessDenied') {
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
        if (error.message !== 'AccessDenied') {
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
async function loadAvatar() {
    try {
        const response = await fetch('/api/user');
        if (response.ok) {
            const user = await response.json();
            const avatarPreview = document.getElementById('avatar-preview');
            const avatarPlaceholder = document.getElementById('avatar-placeholder');
            const avatarStatusText = document.getElementById('avatar-status-text');
            
            if (user.avatar) {
                avatarPreview.innerHTML = '<img src="/avatars/' + user.avatar + '" alt="用户头像">';
                avatarStatusText.textContent = '当前头像：已设置';
            } else {
                avatarPreview.innerHTML = '<span id="avatar-placeholder">👤</span>';
                avatarStatusText.textContent = '当前头像：无';
            }
            
            
        }
    } catch (error) {
        console.error('加载头像失败:', error);
    }
}

async function handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
        showMessage('请选择图片文件', 'error');
        return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
        showMessage('图片大小不能超过5MB', 'error');
        return;
    }
    
    const formData = new FormData();
    formData.append('avatar', file);
    
    try {
        const response = await fetchWithAuth('/api/avatar/upload', {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            const result = await response.json();
            showMessage(result.message, 'success');
            loadAvatar();
        } else {
            const error = await response.json();
            showMessage(error.error || '上传失败', 'error');
        }
    } catch (error) {
        if (error.message !== 'AccessDenied') {
            showMessage('上传失败，请重试', 'error');
        }
    }
    
    event.target.value = '';
}

// 绑定GitHub账号
function bindGitHub() {
    window.location.href = '/auth/github?mode=bind';
}

// 绑定Microsoft账号
function bindMicrosoft() {
    // 保存当前页面URL，用于回调后跳转回来
    sessionStorage.setItem('bindRedirect', '/user');
    window.location.href = '/auth/microsoft';
}

// 注销账号
async function handleDeleteAccount(event) {
    event.preventDefault();

    const password = document.getElementById('delete-password').value;

    if (!password) {
        showMessage('请输入密码', 'warning');
        return;
    }

    if (!confirm('确定要永久注销账号吗？此操作将删除您的所有数据且无法恢复！')) {
        return;
    }

    if (!confirm('再次确认：您确定要永久注销账号吗？')) {
        return;
    }

    try {
        const response = await fetchWithAuth('/api/user/delete', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password })
        });

        if (response.ok) {
            showMessage('账号已成功注销');
            setTimeout(() => {
                window.location.href = '/login';
            }, 2000);
        } else {
            const error = await response.json();
            showMessage(error.error || '注销失败', 'error');
        }
    } catch (error) {
        if (error.message !== 'AccessDenied') {
            showMessage('注销失败，请重试', 'error');
        }
    }
}

// 检查绑定结果
  function checkBindResult() {
      const urlParams = new URLSearchParams(window.location.search);
      
      // 检查session中的绑定结果
      fetch('/api/bind-result')
          .then(response => response.json())
          .then(data => {
              if (data.githubBindSuccess) {
                  showMessage(data.githubBindSuccess);
              }
              if (data.githubBindError) {
                  showMessage(data.githubBindError, 'error');
              }
              if (data.microsoftBindSuccess) {
                  showMessage(data.microsoftBindSuccess);
              }
              if (data.microsoftBindError) {
                  showMessage(data.microsoftBindError, 'error');
              }
          })
          .catch(error => {
              console.error('检查绑定结果失败:', error);
          });
  }
  
  // 检查OAuth配置是否有效
  async function checkOAuthConfig() {
      try {
          const response = await fetch('/api/oauth-config');
          const config = await response.json();
          
          // 如果GitHub配置无效，禁用绑定按钮
          if (!config.githubConfigured) {
              const githubBtn = document.getElementById('bind-github-btn');
              if (githubBtn) {
                  githubBtn.disabled = true;
                  githubBtn.textContent = '未配置';
                  githubBtn.title = '管理员未配置GitHub OAuth';
              }
          }
          
          // 如果Microsoft配置无效，禁用绑定按钮
          if (!config.microsoftConfigured) {
              const microsoftBtn = document.getElementById('bind-microsoft-btn');
              if (microsoftBtn) {
                  microsoftBtn.disabled = true;
                  microsoftBtn.textContent = '未配置';
                  microsoftBtn.title = '管理员未配置Microsoft OAuth';
              }
          }
      } catch (error) {
          console.error('检查OAuth配置失败:', error);
      }
  }

  document.addEventListener('DOMContentLoaded', () => {
      loadUserInfo();
      checkBindResult();
      checkOAuthConfig();
  });