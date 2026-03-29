// 简化版admin.js用于测试
console.log('简化版admin.js已加载');

function showMessage(message, type = 'success') {
    console.log('showMessage:', message, type);
    const toast = document.createElement('div');
    toast.className = `message-toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

async function fetchWithAuth(url, options = {}) {
    console.log('fetchWithAuth:', url);
    options.credentials = 'include';
    const response = await fetch(url, options);
    console.log('Response status:', response.status);
    if (response.status === 401) {
        throw new Error('Unauthorized');
    }
    if (response.status === 403) {
        const error = await response.json();
        showMessage(error.error || '访问被拒绝', 'error');
        throw new Error('AccessDenied');
    }
    return response;
}

// 页面加载
document.addEventListener('DOMContentLoaded', function() {
    console.log('管理面板页面加载完成');
    
    document.getElementById('login-status-content').innerHTML = '页面已加载';
    
    fetchWithAuth('/api/user')
        .then(function(response) {
            console.log('API响应状态:', response.status);
            if (response.ok) {
                return response.json();
            }
            throw new Error('Not logged in');
        })
        .then(function(user) {
            console.log('当前用户:', user);
            if (!user.isAdmin) {
                showMessage('需要管理员权限', 'error');
                setTimeout(function() {
                    window.location.href = '/user';
                }, 2000);
            } else {
                showMessage('欢迎回来，' + user.username, 'success');
                document.getElementById('login-status-content').innerHTML = `
                    <p>✓ 已登录</p>
                    <p>用户名: ${user.username}</p>
                    <p>管理员: 是</p>
                `;
            }
        })
        .catch(function(error) {
            console.error('错误:', error);
            showMessage('请先登录: ' + error.message, 'error');
        });
});