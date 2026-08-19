// Vercel Edge Function - 在 Edge 层运行，用于清理浏览器中累积的旧 cookie
// 解决 494 REQUEST_HEADER_TOO_LARGE 问题（在应用代码无法执行时使用）
export const config = {
  runtime: 'edge',
};

export default function handler(req) {
  const cookieHeader = req.headers.get('cookie') || '';
  const cookies = cookieHeader.split(';').map(c => c.trim()).filter(c => c);

  // 清除所有 sess_ 开头的分片 cookie 和 connect.sid
  const clearCookies = [];
  cookies.forEach(c => {
    const name = c.split('=')[0];
    if (name.startsWith('sess_') || name === 'connect.sid') {
      clearCookies.push(`${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; secure; samesite=none`);
    }
  });

  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
  };

  if (clearCookies.length > 0) {
    headers['Set-Cookie'] = clearCookies;
  }

  const cleaned = clearCookies.length;
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>清理 Cookie</title></head><body style="font-family:sans-serif;text-align:center;padding:50px;"><h2>Cookie 清理完成</h2><p>已清理 ${cleaned} 个 cookie</p><p>正在跳转到首页...</p><script>setTimeout(function(){location.href='/'},2000)</script></body></html>`,
    { headers }
  );
}
