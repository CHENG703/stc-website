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

// 获取一次性 CSRF Token
let _csrfCache = null;
async function getCSRFTokenOnce() {
    try {
        const resp = await fetch('/api/csrf-token', { credentials: 'include' });
        if (resp.ok) {
            const data = await resp.json();
            _csrfCache = data.csrfToken;
            return data.csrfToken;
        }
    } catch (e) {
        console.error('获取CSRF token失败:', e);
    }
    return null;
}

// 生成请求 nonce
function genNonce() {
    return Date.now().toString(36) + Math.random().toString(16).slice(2, 10);
}

// 安全 fetch：写请求自动携带一次性 CSRF token + nonce
async function secureFetch(url, options = {}) {
    options.credentials = 'include';
    const method = (options.method || 'GET').toUpperCase();

    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        const token = await getCSRFTokenOnce();
        const nonce = genNonce();
        options.headers = options.headers || {};
        if (token) options.headers['X-CSRF-Token'] = token;
        options.headers['X-Request-Nonce'] = nonce;
        _csrfCache = null;
    }
    return fetch(url, options);
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

// 处理登录
async function handleLogin(event) {
    event.preventDefault();
    
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const captcha = document.getElementById('captcha').value.trim();

    if (!username || !password) {
        showMessage('请填写用户名和密码', 'warning');
        return;
    }
    
    if (!captcha) {
        showMessage('请输入验证码', 'warning');
        return;
    }
    
    // 验证图形验证码
    const captchaValid = await verifyCaptcha();
    if (!captchaValid) {
        showMessage('验证码错误，请重新输入', 'error');
        refreshCaptcha();
        document.getElementById('captcha').value = '';
        return;
    }

    try {
        const response = await secureFetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password, loginType: 'password' })
        });

        if (response.ok) {
            const data = await response.json();
            // 存储 token 到 localStorage（Vercel 环境）
            if (data.token) {
                localStorage.setItem('stc_auth_token', data.token);
                console.log('[LOGIN] token 已存储到 localStorage');
            }
            showMessage(data.message);
            setTimeout(() => {
                window.location.href = '/';
            }, 1000);
        } else {
            const error = await response.json();
            showMessage(error.error || '登录失败', 'error');
            refreshCaptcha();
            document.getElementById('captcha').value = '';
        }
    } catch (error) {
        showMessage('登录失败，请重试', 'error');
    }
}

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
    // 检查URL参数
    const urlParams = new URLSearchParams(window.location.search);
    const reason = urlParams.get('reason');

    if (reason === 'ip_changed') {
        showMessage('IP地址已变更，请重新登录', 'warning');
    }

    // 检查是否已登录
    const token = localStorage.getItem('stc_auth_token');
    const headers = {};
    if (token) {
        headers['Authorization'] = 'Bearer ' + token;
    }
    
    fetch('/api/user', { credentials: 'include', headers })
        .then(response => {
            if (response.ok) {
                window.location.href = '/';
            }
        })
        .catch(error => {
            console.error('检查登录状态失败:', error);
        });
});