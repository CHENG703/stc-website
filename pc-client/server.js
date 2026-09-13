'use strict';

/**
 * STC 电脑端 —— 手机 ⇄ 电脑 局域网互传文件
 * ------------------------------------------------------------------
 * 特点：
 *   1. 零依赖：只用 Node 内置模块，双击 start.cmd 就能跑，不用 npm install。
 *   2. 两种手机接入方式，走的是同一套接口：
 *        ① 手机浏览器打开「手机访问地址」，输入 6 位配对码（无需装 App）；
 *        ② 安卓 App「电脑」页填地址 + 配对码，直连传输。
 *   3. 配对码 + 令牌：所有文件接口都要令牌；配对码错了会限速锁定。
 *   4. 管理接口（配对码、设备、记录、设置）只允许本机回环地址访问。
 *
 * 用法：node server.js  [--port 8765] [--no-write]
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const VERSION = '1.0.0';
const APP_NAME = 'STC 电脑端';
const CONFIG_FILE = path.join(__dirname, 'config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const MAX_TRANSFERS = 200;        // 传输记录保留条数
const MAX_PAIR_FAILS = 5;         // 连续配对失败次数
const PAIR_LOCK_MS = 5 * 60 * 1000;
const PAIR_CODE_ROTATE_MS = 30 * 60 * 1000;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_COOKIE = 'stc_pc_token';
const TOKEN_HEADER = 'x-pc-token';

// ---------------------------------------------------------------- 配置

const defaultInbox = path.join(os.homedir(), 'Downloads', 'STC手机传输');

const config = {
  port: 8765,
  allowWrite: true,
  inbox: defaultInbox,
  roots: []            // 空数组 = 自动枚举本机磁盘
};

function loadConfig() {
  const argv = process.argv.slice(2);
  const portArg = argv.indexOf('--port');
  try {
    Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
  } catch (_) { /* 首次运行：没有配置文件 */ }

  if (portArg >= 0 && argv[portArg + 1]) config.port = parseInt(argv[portArg + 1], 10);
  if (argv.includes('--no-write')) config.allowWrite = false;

  if (!Array.isArray(config.roots)) config.roots = [];
  config.roots = config.roots.filter(r => typeof r === 'string' && r.trim());
  if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) config.port = 8765;
  if (typeof config.allowWrite !== 'boolean') config.allowWrite = true;
  if (typeof config.inbox !== 'string' || !config.inbox.trim()) config.inbox = defaultInbox;

  try { fs.mkdirSync(config.inbox, { recursive: true }); } catch (_) {}
  saveConfig();
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (_) { /* 没权限写就算了，不影响运行 */ }
}

// ------------------------------------------------------- 磁盘 / 路径安全

function detectRoots() {
  const list = [];
  if (process.platform === 'win32') {
    for (let i = 67; i <= 90; i++) {            // C: ~ Z:
      const drive = String.fromCharCode(i) + ':\\';
      try { if (fs.existsSync(drive)) list.push(drive); } catch (_) {}
    }
    if (!list.length) list.push('C:\\');
  } else {
    list.push('/');
  }
  return list;
}

function effectiveRoots() {
  const list = config.roots.length ? config.roots.slice() : detectRoots();
  return list.map(r => path.resolve(r));
}

function rootList() {
  return effectiveRoots().map(r => ({
    path: r,
    label: process.platform === 'win32' ? r.replace(/\\$/, '') : r
  }));
}

function insideRoot(abs) {
  const a = process.platform === 'win32' ? abs.toLowerCase() : abs;
  return effectiveRoots().some(root => {
    const r = process.platform === 'win32' ? root.toLowerCase() : root;
    return a === r || a.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
  });
}

/** 把外部传来的路径解析成绝对路径，并确认它落在允许的根目录里（防 ../ 穿越） */
function safePath(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/\0/g, '').trim();
  if (!cleaned) return null;
  let abs;
  try { abs = path.resolve(cleaned); } catch (_) { return null; }
  return insideRoot(abs) ? abs : null;
}

/** 清洗文件名：去掉路径分隔符与 Windows 非法字符 */
function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  return name
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+$/, '')
    .trim()
    .slice(0, 180);
}

/** 同名时自动加 (1)(2)… */
function uniqueTarget(dir, name) {
  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  let target = path.join(dir, name);
  let i = 1;
  while (fs.existsSync(target)) {
    target = path.join(dir, `${base}(${i})${ext}`);
    i++;
    if (i > 9999) break;
  }
  return target;
}

const MIME = {
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.mov': 'video/quicktime',
  '.zip': 'application/zip', '.rar': 'application/vnd.rar', '.7z': 'application/x-7z-compressed',
  '.apk': 'application/vnd.android.package-archive', '.pdf': 'application/pdf',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function contentTypeOf(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/** 中文文件名必须用 RFC 5987 的 filename* */
function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// ---------------------------------------------------------------- 运行状态

const state = {
  pairCode: newPairCode(),
  pairCodeAt: Date.now(),
  devices: new Map(),          // token -> device
  transfers: [],               // 最新在前
  pairFails: new Map(),        // ip -> {count, until}
  startedAt: Date.now(),
  server: null
};

function newPairCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function rotatePairCode() {
  state.pairCode = newPairCode();
  state.pairCodeAt = Date.now();
}

function addTransfer(rec) {
  state.transfers.unshift(Object.assign({ id: crypto.randomBytes(6).toString('hex'), time: Date.now() }, rec));
  if (state.transfers.length > MAX_TRANSFERS) state.transfers.length = MAX_TRANSFERS;
}

function clientIp(req) {
  let ip = (req.socket && req.socket.remoteAddress) || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

function isLoopback(req) {
  const ip = clientIp(req);
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

const VIRTUAL_KEYWORDS = ['vmware', 'virtualbox', 'vethernet', 'hyper-v', 'loopback',
  'bluetooth', 'wsl', 'docker', 'tap', 'vpn', 'tailscale', 'zerotier', 'radmin', 'npcap'];

function localAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      if (ni.address.startsWith('169.254.')) continue;          // 没连上的自动地址，没用
      const lower = name.toLowerCase();
      const virtual = VIRTUAL_KEYWORDS.some(k => lower.includes(k));
      out.push({ name, ip: ni.address, virtual });
    }
  }
  // 真实网卡排前面（WiFi / 以太网），虚拟网卡排后面
  out.sort((a, b) => (a.virtual === b.virtual ? 0 : (a.virtual ? 1 : -1)));
  return out;
}

// ---------------------------------------------------------------- HTTP 工具

function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let len = 0;
    req.on('data', c => {
      len += c.length;
      if (len > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  try {
    const buf = await readBody(req, 256 * 1024);
    const text = buf.toString('utf8').trim();
    return text ? JSON.parse(text) : {};
  } catch (_) {
    return {};
  }
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

/** 取出并校验设备令牌 */
function deviceFromReq(req) {
  const header = req.headers[TOKEN_HEADER];
  const token = (typeof header === 'string' && header.trim())
    ? header.trim()
    : (parseCookies(req)[SESSION_COOKIE] || '');
  if (!token) return null;
  const dev = state.devices.get(token);
  if (!dev) return null;
  if (Date.now() - dev.lastSeen > TOKEN_TTL_MS) { state.devices.delete(token); return null; }
  dev.lastSeen = Date.now();
  return dev;
}

function deviceView(dev) {
  return {
    token: dev.token.slice(0, 8),
    name: dev.name,
    ip: dev.ip,
    kind: dev.kind,
    createdAt: dev.createdAt,
    lastSeen: dev.lastSeen
  };
}

// ---------------------------------------------------------------- 文件操作

async function readEntries(dir) {
  const dirents = await fsp.readdir(dir, { withFileTypes: true });
  const out = [];
  const CONC = 64;
  for (let i = 0; i < dirents.length; i += CONC) {
    const chunk = dirents.slice(i, i + CONC);
    const stats = await Promise.all(chunk.map(async d => {
      try { return await fsp.stat(path.join(dir, d.name)); } catch (_) { return null; }
    }));
    chunk.forEach((d, k) => {
      const st = stats[k];
      const isDir = d.isDirectory() || (st ? st.isDirectory() : false);
      if (!isDir && !st) return;                     // 读不到的条目直接跳过
      out.push({
        name: d.name,
        path: path.join(dir, d.name),
        dir: isDir,
        size: isDir ? 0 : (st ? st.size : 0),
        mtime: st ? Math.round(st.mtimeMs) : 0
      });
    });
  }
  out.sort((a, b) => a.dir === b.dir
    ? a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
    : (a.dir ? -1 : 1));
  return out;
}

function parentOf(dir) {
  const p = path.dirname(dir);
  if (p === dir) return '';
  return insideRoot(p) ? p : '';
}

// ------------------------------------------------------------- 接口：配对

async function apiPair(req, res) {
  const ip = clientIp(req);
  const lock = state.pairFails.get(ip);
  if (lock && lock.until > Date.now()) {
    const mins = Math.ceil((lock.until - Date.now()) / 60000);
    json(res, 429, { ok: false, message: `配对尝试次数过多，请 ${mins} 分钟后再试` });
    return;
  }

  const body = await readJsonBody(req);
  const code = String(body.code || '').replace(/\D/g, '');
  if (!code || code !== state.pairCode) {
    const rec = state.pairFails.get(ip) || { count: 0, until: 0 };
    rec.count++;
    if (rec.count >= MAX_PAIR_FAILS) { rec.until = Date.now() + PAIR_LOCK_MS; rec.count = 0; }
    state.pairFails.set(ip, rec);
    json(res, 403, { ok: false, message: '配对码不正确，请在电脑端面板上核对' });
    return;
  }

  state.pairFails.delete(ip);
  const token = crypto.randomBytes(24).toString('hex');
  const dev = {
    token,
    name: sanitizeName(body.name) || (body.kind === 'app' ? '安卓手机' : '手机浏览器'),
    ip,
    ua: String(req.headers['user-agent'] || '').slice(0, 160),
    kind: body.kind === 'app' ? 'app' : 'web',
    createdAt: Date.now(),
    lastSeen: Date.now()
  };
  state.devices.set(token, dev);

  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${Math.floor(TOKEN_TTL_MS / 1000)}; SameSite=Lax`);
  json(res, 200, {
    ok: true,
    token,
    name: dev.name,
    inbox: config.inbox,
    allowWrite: config.allowWrite,
    roots: rootList()
  });
}

// ---------------------------------------------------- 接口：文件（需令牌）

async function apiRoots(req, res) {
  json(res, 200, {
    ok: true,
    roots: rootList(),
    inbox: config.inbox,
    allowWrite: config.allowWrite,
    home: os.homedir(),
    platform: process.platform
  });
}

async function apiList(req, res, url) {
  const raw = url.searchParams.get('path') || '';
  const start = raw ? safePath(raw) : effectiveRoots()[0];
  if (!start || !insideRoot(start)) { json(res, 400, { ok: false, message: '路径不在允许范围内' }); return; }
  let st;
  try { st = await fsp.stat(start); } catch (_) { json(res, 404, { ok: false, message: '目录不存在' }); return; }
  if (!st.isDirectory()) { json(res, 400, { ok: false, message: '不是文件夹' }); return; }
  let entries;
  try { entries = await readEntries(start); } catch (e) { json(res, 403, { ok: false, message: '无法读取该目录：' + e.code }); return; }
  json(res, 200, {
    ok: true,
    path: start,
    parent: parentOf(start),
    entries,
    allowWrite: config.allowWrite
  });
}

async function apiStat(req, res, url) {
  const p = safePath(url.searchParams.get('path') || '');
  if (!p) { json(res, 400, { ok: false, message: '路径不在允许范围内' }); return; }
  try {
    const st = await fsp.stat(p);
    json(res, 200, {
      ok: true,
      path: p,
      name: path.basename(p) || p,
      dir: st.isDirectory(),
      size: st.isDirectory() ? 0 : st.size,
      mtime: Math.round(st.mtimeMs)
    });
  } catch (_) {
    json(res, 404, { ok: false, message: '文件不存在' });
  }
}

async function apiMkdir(req, res, dev) {
  if (!config.allowWrite) { json(res, 403, { ok: false, message: '电脑端已设置为只读' }); return; }
  const body = await readJsonBody(req);
  const target = safePath(body.path);
  if (!target) { json(res, 400, { ok: false, message: '路径不在允许范围内' }); return; }
  if (fs.existsSync(target)) { json(res, 409, { ok: false, message: '同名文件或文件夹已存在' }); return; }
  try {
    await fsp.mkdir(target, { recursive: true });
    addTransfer({ dir: 'mkdir', name: path.basename(target), size: 0, path: target, device: dev.name, ip: dev.ip });
    json(res, 200, { ok: true, path: target });
  } catch (e) {
    json(res, 500, { ok: false, message: '新建失败：' + e.message });
  }
}

async function apiRename(req, res, dev) {
  if (!config.allowWrite) { json(res, 403, { ok: false, message: '电脑端已设置为只读' }); return; }
  const body = await readJsonBody(req);
  const src = safePath(body.path);
  const name = sanitizeName(body.name);
  if (!src || !name) { json(res, 400, { ok: false, message: '参数不正确' }); return; }
  const dir = path.dirname(src);
  const target = safePath(path.join(dir, name));
  if (!target) { json(res, 400, { ok: false, message: '目标路径不合法' }); return; }
  if (fs.existsSync(target)) { json(res, 409, { ok: false, message: '同名文件已存在' }); return; }
  try {
    await fsp.rename(src, target);
    addTransfer({ dir: 'rename', name: `${path.basename(src)} → ${name}`, size: 0, path: target, device: dev.name, ip: dev.ip });
    json(res, 200, { ok: true, path: target });
  } catch (e) {
    json(res, 500, { ok: false, message: '重命名失败：' + e.message });
  }
}

async function apiDelete(req, res, dev) {
  if (!config.allowWrite) { json(res, 403, { ok: false, message: '电脑端已设置为只读' }); return; }
  const body = await readJsonBody(req);
  const list = Array.isArray(body.paths) ? body.paths : (body.path ? [body.path] : []);
  const targets = list.map(safePath).filter(Boolean);
  if (!targets.length) { json(res, 400, { ok: false, message: '没有可删除的路径' }); return; }

  const failed = [];
  for (const t of targets) {
    if (effectiveRoots().some(r => path.resolve(t) === r)) { failed.push(path.basename(t) + '（不允许删除磁盘根目录）'); continue; }
    try {
      await fsp.rm(t, { recursive: true, force: true });
      addTransfer({ dir: 'del', name: path.basename(t), size: 0, path: t, device: dev.name, ip: dev.ip });
    } catch (e) {
      failed.push(path.basename(t) + '（' + e.code + '）');
    }
  }
  if (failed.length) json(res, 200, { ok: false, message: '部分删除失败：' + failed.join('、') });
  else json(res, 200, { ok: true, message: '已删除 ' + targets.length + ' 项' });
}

async function apiUpload(req, res, url, dev) {
  if (!config.allowWrite) { json(res, 403, { ok: false, message: '电脑端已设置为只读，请在本机面板打开写入开关' }); return; }

  const dirRaw = url.searchParams.get('dir') || '';
  const dir = dirRaw ? safePath(dirRaw) : safePath(config.inbox);
  if (!dir) { json(res, 400, { ok: false, message: '目标目录不在允许范围内' }); return; }

  let name = sanitizeName(url.searchParams.get('name') || '');
  if (!name) name = '手机文件_' + Date.now();

  try { await fsp.mkdir(dir, { recursive: true }); } catch (_) {}

  const overwrite = url.searchParams.get('mode') === 'overwrite';
  const target = overwrite ? path.join(dir, name) : uniqueTarget(dir, name);
  if (!insideRoot(target)) { json(res, 400, { ok: false, message: '目标路径不合法' }); return; }

  try {
    const st = await fsp.stat(target);
    if (st.isDirectory()) { json(res, 400, { ok: false, message: '目标是一个文件夹，无法覆盖' }); return; }
  } catch (_) { /* 不存在，正常 */ }

  const tmp = target + '.stcpart';
  let written = 0;
  try {
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(tmp);
      req.on('data', c => { written += c.length; });
      req.on('aborted', () => { ws.destroy(); reject(new Error('客户端已断开')); });
      req.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
      req.pipe(ws);
    });
    await fsp.rename(tmp, target);
  } catch (e) {
    try { await fsp.rm(tmp, { force: true }); } catch (_) {}
    if (!res.writableEnded) json(res, 500, { ok: false, message: '保存失败：' + e.message });
    return;
  }

  addTransfer({ dir: 'up', name: path.basename(target), size: written, path: target, device: dev.name, ip: dev.ip });
  json(res, 200, { ok: true, path: target, name: path.basename(target), size: written });
}

async function apiDownload(req, res, url, dev) {
  const p = safePath(url.searchParams.get('path') || '');
  if (!p) { json(res, 400, { ok: false, message: '路径不在允许范围内' }); return; }

  let st;
  try { st = await fsp.stat(p); } catch (_) { json(res, 404, { ok: false, message: '文件不存在' }); return; }
  if (st.isDirectory()) { json(res, 400, { ok: false, message: '文件夹不能直接下载，请先在电脑端打包' }); return; }

  const name = path.basename(p);
  let start = 0;
  let end = st.size - 1;
  let code = 200;
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      if (m[1]) start = parseInt(m[1], 10);
      if (m[2]) end = parseInt(m[2], 10);
      if (Number.isNaN(start) || start < 0) start = 0;
      if (Number.isNaN(end) || end >= st.size) end = st.size - 1;
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
      code = 206;
    }
  }

  const headers = {
    'Content-Type': contentTypeOf(p),
    'Content-Disposition': contentDisposition(name),
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  };
  if (code === 206) headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  res.writeHead(code, headers);

  const rs = fs.createReadStream(p, { start, end });
  rs.on('error', () => { try { res.destroy(); } catch (_) {} });
  rs.on('end', () => {
    if (start === 0) addTransfer({ dir: 'down', name, size: st.size, path: p, device: dev.name, ip: dev.ip });
  });
  rs.pipe(res);
}

// -------------------------------------------------- 接口：本机管理（回环）

function apiPcStatus(req, res) {
  json(res, 200, {
    ok: true,
    name: APP_NAME,
    version: VERSION,
    port: config.port,
    startedAt: state.startedAt,
    pairCode: state.pairCode,
    pairCodeAt: state.pairCodeAt,
    pairCodeTtlMs: PAIR_CODE_ROTATE_MS,
    addresses: localAddresses(),
    devices: Array.from(state.devices.values()).map(deviceView),
    transfers: state.transfers.slice(0, 50),
    config: {
      allowWrite: config.allowWrite,
      inbox: config.inbox,
      roots: rootList(),
      autoRoots: config.roots.length === 0
    },
    platform: process.platform,
    hostname: os.hostname(),
    node: process.version
  });
}

async function apiPcConfig(req, res) {
  const body = await readJsonBody(req);
  if (typeof body.allowWrite === 'boolean') config.allowWrite = body.allowWrite;
  if (typeof body.inbox === 'string' && body.inbox.trim()) {
    const p = path.resolve(body.inbox.trim());
    config.inbox = p;
    try { fs.mkdirSync(p, { recursive: true }); } catch (_) {}
  }
  if (Array.isArray(body.roots)) config.roots = body.roots.filter(r => typeof r === 'string' && r.trim());
  saveConfig();
  json(res, 200, { ok: true, config: { allowWrite: config.allowWrite, inbox: config.inbox, roots: rootList() } });
}

function apiPcOpen(req, res, url) {
  const p = safePath(url.searchParams.get('path') || config.inbox) || config.inbox;
  try { fs.mkdirSync(p, { recursive: true }); } catch (_) {}
  const opener = process.platform === 'win32' ? ['explorer.exe', [p]]
    : process.platform === 'darwin' ? ['open', [p]]
      : ['xdg-open', [p]];
  execFile(opener[0], opener[1], () => {});
  json(res, 200, { ok: true, path: p });
}

// ---------------------------------------------------------------- 路由

async function handleApi(req, res, url) {
  const p = url.pathname;

  // 1) 手机侧接口 ------------------------------------------------------
  if (p === '/api/pair' && req.method === 'POST') return apiPair(req, res);

  const dev = deviceFromReq(req);
  if (!dev) return json(res, 401, { ok: false, needPair: true, message: '尚未配对或配对已失效，请重新输入配对码' });

  if (p === '/api/roots' && req.method === 'GET') return apiRoots(req, res);
  if (p === '/api/session' && req.method === 'GET') {
    return json(res, 200, { ok: true, device: deviceView(dev), inbox: config.inbox, allowWrite: config.allowWrite, roots: rootList() });
  }
  if (p === '/api/list' && req.method === 'GET') return apiList(req, res, url);
  if (p === '/api/stat' && req.method === 'GET') return apiStat(req, res, url);
  if (p === '/api/download' && req.method === 'GET') return apiDownload(req, res, url, dev);
  if (p === '/api/upload' && (req.method === 'PUT' || req.method === 'POST')) return apiUpload(req, res, url, dev);
  if (p === '/api/mkdir' && req.method === 'POST') return apiMkdir(req, res, dev);
  if (p === '/api/rename' && req.method === 'POST') return apiRename(req, res, dev);
  if (p === '/api/delete' && req.method === 'POST') return apiDelete(req, res, dev);
  if (p === '/api/unpair' && req.method === 'POST') {
    state.devices.delete(dev.token);
    return json(res, 200, { ok: true, message: '已断开与本电脑的连接' });
  }

  return json(res, 404, { ok: false, message: '接口不存在' });
}

function handlePcApi(req, res, url) {
  // 管理接口只允许本机回环访问，局域网里的手机碰不到
  if (!isLoopback(req)) return json(res, 403, { ok: false, message: '该接口仅限本机访问' });
  const p = url.pathname;

  if (p === '/api/pc/status' && req.method === 'GET') return apiPcStatus(req, res);
  if (p === '/api/pc/pair-code' && req.method === 'POST') {
    rotatePairCode();
    return json(res, 200, { ok: true, pairCode: state.pairCode });
  }
  if (p === '/api/pc/config' && req.method === 'POST') return apiPcConfig(req, res);
  if (p === '/api/pc/open' && req.method === 'GET') return apiPcOpen(req, res, url);
  if (p === '/api/pc/device/remove' && req.method === 'POST') {
    return readJsonBody(req).then(body => {
      const token = String(body.token || '');
      let hit = 0;
      for (const [tk, dv] of Array.from(state.devices.entries())) {
        if (tk === token || tk.startsWith(token)) { state.devices.delete(tk); hit++; }
      }
      json(res, 200, { ok: hit > 0, message: hit ? '已断开该设备' : '设备不存在' });
    });
  }
  if (p === '/api/pc/transfers/clear' && req.method === 'POST') {
    state.transfers.length = 0;
    return json(res, 200, { ok: true });
  }
  if (p === '/api/pc/quit' && req.method === 'POST') {
    json(res, 200, { ok: true, message: '电脑端已退出' });
    setTimeout(() => process.exit(0), 200);
    return undefined;
  }
  return json(res, 404, { ok: false, message: '接口不存在' });
}

const STATIC = {
  '/': 'pc.html',
  '/pc': 'pc.html',
  '/pc.html': 'pc.html',
  '/m': 'mobile.html',
  '/mobile': 'mobile.html',
  '/mobile.html': 'mobile.html'
};

function serveStatic(req, res, url) {
  const file = STATIC[url.pathname];
  if (!file) {
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  fs.readFile(path.join(PUBLIC_DIR, file), (err, buf) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('页面文件缺失：' + file);
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  });
}

// ---------------------------------------------------------------- 启动

function createServer() {
  return http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (_) { res.writeHead(400); res.end(); return; }

    // 允许局域网页面跨站调用（手机浏览器 / App 直连都用得上）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, ' + TOKEN_HEADER);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const done = (fn) => {
      Promise.resolve()
        .then(fn)
        .catch(e => { if (!res.writableEnded) json(res, 500, { ok: false, message: '服务器异常：' + e.message }); });
    };

    if (url.pathname.startsWith('/api/pc/')) { done(() => handlePcApi(req, res, url)); return; }
    if (url.pathname.startsWith('/api/')) { done(() => handleApi(req, res, url)); return; }
    serveStatic(req, res, url);
  });
}

function banner(port, addresses) {
  const lines = [];
  lines.push('');
  lines.push('  ================================');
  lines.push('   ' + APP_NAME + ' v' + VERSION);
  lines.push('  ================================');
  lines.push('');
  lines.push('   本机面板 : http://127.0.0.1:' + port);
  lines.push('   手机访问 : 手机浏览器打开下面任意一个地址，再输入配对码');
  if (addresses.length) {
    addresses.forEach(a => lines.push('              http://' + a.ip + ':' + port + '   （' + a.name + '）'));
  } else {
    lines.push('              （没检测到局域网地址，请先连上 WiFi / 网线）');
  }
  lines.push('');
  lines.push('   配对码   : ' + state.pairCode);
  lines.push('   接收目录 : ' + config.inbox);
  lines.push('   写入权限 : ' + (config.allowWrite ? '允许手机上传/修改' : '只读（手机只能下载）'));
  lines.push('');
  lines.push('   按 Ctrl + C 退出');
  lines.push('');
  console.log(lines.join('\n'));
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]];
  execFile(cmd[0], cmd[1], () => {});
}

loadConfig();

state.server = createServer();
state.server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  端口 ${config.port} 已被占用。\n  可以换端口启动：node server.js --port 8766\n`);
  } else {
    console.error('\n  启动失败：' + err.message + '\n');
  }
  process.exit(1);
});

state.server.listen(config.port, '0.0.0.0', () => {
  const addrs = localAddresses();
  banner(config.port, addrs);
  if (process.argv.includes('--no-open')) return;
  openBrowser('http://127.0.0.1:' + config.port + '/');
});

// 每 30 分钟自动换一次配对码（已配对的手机不受影响）
setInterval(() => {
  rotatePairCode();
  console.log('  配对码已自动更新：' + state.pairCode);
}, PAIR_CODE_ROTATE_MS).unref?.();

process.on('SIGINT', () => { console.log('\n  已退出。'); process.exit(0); });
