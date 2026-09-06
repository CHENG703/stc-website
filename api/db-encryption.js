/**
 * 数据库静态加密模块（AES-256-GCM）
 * ============================================================================
 * 用途：
 *   在"持久化边界"对数据库内容加密。database.json 落盘、Vercel KV 写入、
 *   KV 备份块存储前，均先加密；读取时解密。加密保护的是【静态数据】——
 *   防止备份文件 / 数据库文件 / KV 数据被拖走后直接泄露明文。
 *   注意：服务运行时内存中仍为明文（否则无法提供查询/展示），
 *   因此本模块无法防御"能执行服务器代码的攻击者"。
 *
 * 密钥管理（优先级从高到低）：
 *   1) 环境变量 DB_KEY  —— 推荐所有部署（尤其 Vercel/Zeabur/KV 场景）
 *   2) 密钥文件 <runtimeDir>/db.key —— 本地首次运行自动生成并持久化
 *   若既无 DB_KEY 又无法持久化密钥（临时文件系统且无写权限），
 *   自动关闭加密并告警，避免因密钥丢失导致数据自我锁死。
 *
 * 数据格式：
 *   密文 = DB_ENC_MAGIC + base64( iv(12) + authTag(16) + ciphertext )
 *   以 DB_ENC_MAGIC 前缀区分密文与历史明文，实现平滑迁移。
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_ENC_MAGIC = 'STCDB1:';
const KEY_ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

let dbCryptoKey = null;        // 32 字节 AES 密钥
let dbCryptoEnabled = false;   // 是否启用静态加密

function deriveKey(raw) {
    return crypto.createHash('sha256').update(String(raw)).digest();
}

/**
 * 初始化/解析加密密钥。在数据库首次加载前调用一次即可。
 * @param {Object} opts
 * @param {string} opts.runtimeDir  运行目录（用于存放 db.key）
 * @param {boolean} opts.isVercel   是否为 Vercel 环境
 * @param {boolean} opts.isRailway  是否为 Railway 环境
 * @param {string} [opts.envName]   环境变量名，默认 DB_KEY
 */
function initDbEncryption(opts) {
    opts = opts || {};
    const envName = opts.envName || 'DB_KEY';

    // 1) 环境变量优先
    if (process.env[envName]) {
        dbCryptoKey = deriveKey(process.env[envName]);
        dbCryptoEnabled = true;
        console.log('[DB-ENC] 已启用数据库静态加密（密钥来自环境变量 ' + envName + '）');
        return { enabled: true };
    }

    // 2) 复用已有的持久化密钥文件
    const keyPath = opts.runtimeDir
        ? path.join(opts.runtimeDir, 'db.key')
        : path.join(process.cwd(), 'db.key');
    try {
        if (fs.existsSync(keyPath)) {
            const raw = fs.readFileSync(keyPath, 'utf-8').trim();
            if (raw) {
                dbCryptoKey = deriveKey(raw);
                dbCryptoEnabled = true;
                console.log('[DB-ENC] 已启用数据库静态加密（密钥文件: ' + keyPath + '）');
                return { enabled: true };
            }
        }
    } catch (e) {
        console.warn('[DB-ENC] 读取密钥文件失败:', e.message);
    }

    // 3) 本地等可持久化磁盘：自动生成密钥文件
    if (!opts.isVercel && !opts.isRailway) {
        try {
            const raw = crypto.randomBytes(32).toString('hex');
            fs.mkdirSync(path.dirname(keyPath), { recursive: true });
            fs.writeFileSync(keyPath, raw, { mode: 0o600 });
            dbCryptoKey = deriveKey(raw);
            dbCryptoEnabled = true;
            console.log('[DB-ENC] 已启用数据库静态加密（自动生成密钥文件: ' + keyPath + '）');
            return { enabled: true };
        } catch (e) {
            console.warn('[DB-ENC] 生成密钥文件失败:', e.message);
        }
    }

    // 4) 无法持久化密钥（如 Vercel/Railway 未配置 DB_KEY）→ 关闭加密，避免自我锁死
    dbCryptoKey = null;
    dbCryptoEnabled = false;
    console.warn('[DB-ENC] 未配置环境变量 ' + envName + '，且无法持久化密钥，数据库静态加密已关闭。');
    console.warn('[DB-ENC] 请在 Vercel / Railway / Zeabur 等平台配置 ' + envName + '（任意长度随机字符串，各实例必须一致）。');
    return { enabled: false };
}

/** 是否处于加密启用状态 */
function isEncryptionEnabled() {
    return dbCryptoEnabled;
}

/** 判断文本是否为本模块生成的密文 */
function isCipherText(text) {
    return typeof text === 'string' && text.startsWith(DB_ENC_MAGIC);
}

/** 加密任意 Buffer，返回密文文本 */
function encryptBuffer(buf) {
    if (!dbCryptoEnabled) {
        return buf.toString('utf-8');
    }
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(KEY_ALGO, dbCryptoKey, iv);
    const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
    const tag = cipher.getAuthTag();
    return DB_ENC_MAGIC + Buffer.concat([iv, tag, ct]).toString('base64');
}

/**
 * 尝试解密密文文本。
 * @returns {Buffer|null} 解密失败（密钥不符 / 格式错误 / 数据被篡改）返回 null
 */
function decryptBuffer(text) {
    if (!isCipherText(text)) return null;
    try {
        const bin = Buffer.from(text.slice(DB_ENC_MAGIC.length), 'base64');
        if (bin.length < IV_LEN + TAG_LEN) return null;
        const iv = bin.subarray(0, IV_LEN);
        const tag = bin.subarray(IV_LEN, IV_LEN + TAG_LEN);
        const ct = bin.subarray(IV_LEN + TAG_LEN);
        const decipher = crypto.createDecipheriv(KEY_ALGO, dbCryptoKey, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ct), decipher.final()]);
    } catch (e) {
        return null;
    }
}

/** 序列化对象用于持久化（自动加密） */
function serializeDb(obj) {
    return encryptBuffer(Buffer.from(JSON.stringify(obj), 'utf-8'));
}

/**
 * 反序列化持久化文本（兼容密文与历史明文，便于无损迁移）。
 * @returns {{data:Object, migrated:boolean}|null} 解析失败返回 null
 */
function deserializeDbText(text) {
    if (typeof text !== 'string') return null;
    if (isCipherText(text)) {
        const dec = decryptBuffer(text);
        if (!dec) return null; // 密钥不符或数据损坏
        try {
            return { data: JSON.parse(dec.toString('utf-8')), migrated: false };
        } catch (e) {
            return null;
        }
    }
    try {
        // 历史明文：直接解析，由调用方决定是否重写为密文
        return { data: JSON.parse(text), migrated: true };
    } catch (e) {
        return null;
    }
}

module.exports = {
    DB_ENC_MAGIC,
    initDbEncryption,
    isEncryptionEnabled,
    isCipherText,
    encryptBuffer,
    decryptBuffer,
    serializeDb,
    deserializeDbText
};
