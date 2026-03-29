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

// 发送邮箱验证码
async function sendEmailCode() {
    const email = document.getElementById('email').value.trim();
    const captcha = document.getElementById('captcha').value.trim();
    const sendBtn = document.getElementById('send-code-btn');
    
    // 验证邮箱
    if (!email) {
        showMessage('请先输入邮箱', 'warning');
        return;
    }
    
    const emailRegex = /^[1-9]\d{4,10}@qq\.com$/i;
    if (!emailRegex.test(email)) {
        showMessage('请输入有效的QQ邮箱', 'warning');
        return;
    }
    
    // 验证图形验证码
    if (!captcha) {
        showMessage('请先输入图形验证码', 'warning');
        return;
    }
    
    try {
        // 先验证图形验证码
        const captchaResponse = await fetch('/api/verify-captcha', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ captcha })
        });
        
        const captchaResult = await captchaResponse.json();
        if (!captchaResult.valid) {
            showMessage('图形验证码错误', 'error');
            refreshCaptcha();
            document.getElementById('captcha').value = '';
            return;
        }
        
        // 发送邮箱验证码
        sendBtn.disabled = true;
        sendBtn.textContent = '发送中...';
        
        const response = await fetch('/api/send-email-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showMessage('验证码已发送，请查收邮件');
            // 倒计时60秒
            let countdown = 60;
            sendBtn.textContent = `${countdown}秒后重新获取`;
            
            const timer = setInterval(() => {
                countdown--;
                if (countdown <= 0) {
                    clearInterval(timer);
                    sendBtn.disabled = false;
                    sendBtn.textContent = '获取验证码';
                } else {
                    sendBtn.textContent = `${countdown}秒后重新获取`;
                }
            }, 1000);
        } else {
            showMessage(result.error || '发送失败', 'error');
            sendBtn.disabled = false;
            sendBtn.textContent = '获取验证码';
        }
    } catch (error) {
        console.error('发送验证码失败:', error);
        showMessage('发送失败，请重试', 'error');
        sendBtn.disabled = false;
        sendBtn.textContent = '获取验证码';
    }
}

// 显示服务条款和隐私协议
function showTerms(type) {
    const termsWindow = window.open('/terms.html?type=' + type, 'terms', 'width=800,height=600,scrollbars=yes,resizable=yes');
    if (!termsWindow) {
        // 如果弹窗被阻止，使用当前页面
        window.location.href = '/terms.html?type=' + type;
    }
}

// 刷新图形验证码
function refreshCaptcha() {
    const captchaImage = document.getElementById('captcha-image');
    captchaImage.src = '/api/captcha?' + new Date().getTime();
}

// 验证图形验证码
async function verifyCaptcha() {
    const captcha = document.getElementById('captcha').value.trim();
    
    if (!captcha) {
        showMessage('请输入验证码', 'warning');
        return false;
    }
    
    try {
        const response = await fetch('/api/verify-captcha', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ captcha })
        });
        
        const result = await response.json();
        return result.valid;
    } catch (error) {
        console.error('验证码验证失败:', error);
        return false;
    }
}

// 处理注册
async function handleRegister(event) {
    event.preventDefault();

    const username = document.getElementById('username').value.trim();
    const email = document.getElementById('email').value.trim();
    const inviteCode = document.getElementById('invite-code').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const emailCode = document.getElementById('email-code').value.trim();

    console.log('注册数据:', { username, email, inviteCode, passwordLength: password.length });

    // 验证输入
    if (!username || !email || !inviteCode || !password || !confirmPassword || !emailCode) {
        showMessage('请填写所有字段', 'warning');
        return;
    }

    // 验证QQ邮箱格式
    const emailRegex = /^[1-9]\d{4,10}@qq\.com$/i;
    if (!emailRegex.test(email)) {
        showMessage('请输入有效的QQ邮箱', 'warning');
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

    // 验证邮箱验证码格式
    if (emailCode.length !== 6 || isNaN(emailCode)) {
        showMessage('请输入6位数字验证码', 'warning');
        return;
    }

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ username, email, password, inviteCode, emailCode })
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
            // 如果是验证码错误，刷新图形验证码
            if (error.error && error.error.includes('验证码')) {
                refreshCaptcha();
                document.getElementById('captcha').value = '';
                document.getElementById('email-code').value = '';
            }
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