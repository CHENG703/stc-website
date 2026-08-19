// Vercel Edge Function - 在 Edge 层运行，用于清理浏览器中累积的旧 cookie
// 解决 494 REQUEST_HEADER_TOO_LARGE 死锁问题
export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = cookieHeader.split(';').map(c => c.trim()).filter(c => c);

  const clearCookies = [];
  let cleaned = 0;

  cookies.forEach(c => {
    const name = c.split('=')[0];
    // 清除所有 sess_ 开头的分片 cookie 和 connect.sid
    if (name.startsWith('sess_') || name === 'connect.sid') {
      clearCookies.push(`${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; secure; samesite=none`);
      cleaned++;
    }
  });

  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  };

  if (clearCookies.length > 0) {
    headers['Set-Cookie'] = clearCookies.join(', ');
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Cookie 清理完成</title>
  <style>
    body { font-family: -apple-system, sans-serif; text-align: center; padding: 60px 20px; background: #0d1117; color: #f0f6fc; }
    .box { max-width: 500px; margin: 0 auto; padding: 40px; background: #161b22; border-radius: 12px; border: 1px solid #30363d; }
    h2 { color: #2ea043; margin-bottom: 16px; }
    p { color: #8b949e; margin: 8px 0; }
    .count { font-size: 48px; color: #2ea043; margin: 20px 0; }
    a { display: inline-block; margin-top: 24px; padding: 12px 32px; background: #238636; color: #fff; text-decoration: none; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="box">
    <h2>Cookie 清理完成</h2>
    <div class="count">${cleaned}</div>
    <p>已清理 ${cleaned} 个旧 cookie</p>
    <p>现在可以正常访问网站了</p>
    <a href="/">返回首页</a>
  </div>
  <script>setTimeout(function(){ location.href = '/'; }, 3000);</script>
</body>
</html>`;

  return new Response(html, { headers });
}
