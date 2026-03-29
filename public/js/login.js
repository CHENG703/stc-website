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

// 处理登录
async function handleLogin(event) {
    event.preventDefault();
    
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (!username || !password) {
        showMessage('请填写用户名和密码', 'warning');
        return;
    }

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        if (response.ok) {
            const data = await response.json();
            showMessage(data.message);
            setTimeout(() => {
                window.location.href = '/';
            }, 1000);
        } else {
            const error = await response.json();
            showMessage(error.error || '登录失败', 'error');
        }
    } catch (error) {
        showMessage('登录失败，请重试', 'error');
    }
}

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
    // 检查是否已登录
    fetch('/api/user')
        .then(response => {
            if (response.ok) {
                window.location.href = '/';
            }
        })
        .catch(error => {
            console.error('检查登录状态失败:', error);
        });
});