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

// 处理注册
async function handleRegister(event) {
    event.preventDefault();

    const username = document.getElementById('username').value.trim();
    const email = document.getElementById('email').value.trim();
    const inviteCode = document.getElementById('invite-code').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    console.log('注册数据:', { username, email, inviteCode, passwordLength: password.length });

    // 验证输入
    if (!username || !email || !inviteCode || !password || !confirmPassword) {
        showMessage('请填写所有字段', 'warning');
        console.log('缺少字段:', { 
            username: !!username, 
            email: !!email, 
            inviteCode: !!inviteCode, 
            password: !!password, 
            confirmPassword: !!confirmPassword 
        });
        return;
    }

    // 验证QQ邮箱格式（放宽规则，只要是@qq.com结尾）
    const emailRegex = /^.+@qq\.com$/i;
    if (!emailRegex.test(email)) {
        showMessage('请使用QQ邮箱（以@qq.com结尾）', 'warning');
        return;
    }

    // 验证密码
    if (password.length < 6) {
        showMessage('密码长度至少6位', 'warning');
        return;
    }

    if (password !== confirmPassword) {
        showMessage('两次输入的密码不一致', 'warning');
        return;
    }

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username,
                email,
                password,
                inviteCode
            })
        });

        if (response.ok) {
            showMessage('注册成功！正在跳转到登录页面...');
            setTimeout(() => {
                window.location.href = '/login';
            }, 2000);
        } else {
            const error = await response.json();
            console.error('注册失败:', error);
            showMessage(error.error || '注册失败', 'error');
        }
    } catch (error) {
        console.error('注册请求失败:', error);
        showMessage('注册失败，请重试', 'error');
    }
}

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
    // 检查是否已登录
    fetch('/api/user')
        .then(response => {
            if (response.ok) {
                window.location.href = '/user';
            }
        })
        .catch(error => {
            console.error('检查登录状态失败:', error);
        });
});