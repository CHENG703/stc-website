package top.stcwork.filemanager.net

import org.json.JSONArray
import org.json.JSONObject
import top.stcwork.filemanager.util.Fmt
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.security.SecureRandom
import java.util.Collections
import java.util.concurrent.Executors
import kotlin.concurrent.thread

/**
 * 手机互传的「发送方」：本机起一个极简 HTTP 服务（端口 8766，只在局域网内用）。
 *
 * 不引第三方库，自己解析 HTTP（只服务自家客户端，够用且可控）：
 *   POST /api/pair       6 位配对码换 24 字节令牌（令牌 12 小时有效）
 *   GET  /api/info       本机设备名 / 分享数量
 *   GET  /api/list       分享的文件清单
 *   GET  /api/download   下载（支持 Range 续传）
 *
 * 安全：配对码连错 5 次锁 5 分钟；除 /api/pair 外的接口都要带 x-phone-token；
 * 只能下载发起分享时选定的那些文件，不做目录遍历。
 */
class PhoneServer(
    private val port: Int = PORT,
    private val deviceName: String = "STC手机"
) {
    companion object {
        const val PORT = 8766
        private const val TOKEN_TTL = 12 * 60 * 60 * 1000L
        private const val MAX_FAILS = 5
        private const val LOCK_MS = 5 * 60 * 1000L
        private const val TOKEN_HEADER = "x-phone-token"
    }

    @Volatile
    var running = false
        private set

    /** 当前 6 位配对码 */
    @Volatile
    var code: String = ""
        private set

    @Volatile
    var fileCount = 0
        private set

    @Volatile
    var totalBytes = 0L
        private set

    var onLog: ((String) -> Unit)? = null

    private var serverSocket: ServerSocket? = null
    private var files: List<File> = emptyList()
    private val tokens: MutableMap<String, Long> = Collections.synchronizedMap(HashMap())
    private val random = SecureRandom()
    private var fails = 0
    private var lockUntil = 0L
    private var pool = Executors.newCachedThreadPool()

    /** 开始分享（已经在了就换一批文件） */
    fun start(list: List<File>): Boolean {
        files = list.filter { it.isFile && it.canRead() }
        fileCount = files.size
        totalBytes = files.sumOf { it.length() }
        if (code.isBlank()) code = newCode()
        if (running) return true
        return try {
            serverSocket = ServerSocket(port).also { it.reuseAddress = true }
            running = true
            thread(name = "stc-phone-server", isDaemon = true) { loop() }
            onLog?.invoke("已开始分享，等待对方连接")
            true
        } catch (e: Exception) {
            running = false
            onLog?.invoke("启动失败：${e.message ?: "端口 $port 可能被占用"}")
            false
        }
    }

    fun stop() {
        running = false
        runCatching { serverSocket?.close() }
        serverSocket = null
        synchronized(tokens) { tokens.clear() }
        fails = 0
        lockUntil = 0L
        files = emptyList()
        fileCount = 0
        totalBytes = 0L
    }

    /** 重新生成配对码（换一个码，旧的令牌立刻失效） */
    fun rotateCode(): String {
        synchronized(tokens) { tokens.clear() }
        code = newCode()
        return code
    }

    private fun newCode(): String = buildString {
        repeat(6) { append(random.nextInt(10)) }
    }

    private fun newToken(): String {
        val b = ByteArray(24)
        random.nextBytes(b)
        return b.joinToString("") { "%02x".format(it) }
    }

    private fun valid(token: String?): Boolean {
        if (token.isNullOrBlank()) return false
        val expire = tokens[token] ?: return false
        if (expire < System.currentTimeMillis()) {
            tokens.remove(token)
            return false
        }
        return true
    }

    // ------------------------------------------------------------------ 主循环

    private fun loop() {
        val ss = serverSocket ?: return
        while (running) {
            val sock = try {
                ss.accept()
            } catch (_: Exception) {
                break
            }
            try {
                pool.submit { handle(sock) }
            } catch (_: Exception) {
                runCatching { sock.close() }
            }
        }
    }

    private fun handle(sock: Socket) {
        try {
            sock.soTimeout = 30_000
            val input = BufferedInputStream(sock.getInputStream())
            val requestLine = readLine(input) ?: return
            val parts = requestLine.split(" ")
            val method = parts.getOrNull(0).orEmpty()
            val target = parts.getOrNull(1).orEmpty()

            val headers = HashMap<String, String>()
            while (true) {
                val line = readLine(input) ?: break
                if (line.isEmpty()) break
                val i = line.indexOf(':')
                if (i > 0) headers[line.substring(0, i).trim().lowercase()] = line.substring(i + 1).trim()
            }
            val len = headers["content-length"]?.toIntOrNull() ?: 0
            val body = if (len > 0 && len <= 64 * 1024) ByteArray(len).also { readFully(input, it) } else null

            val path = target.substringBefore('?')
            val args = parseQuery(target.substringAfter('?', ""))
            val out = sock.getOutputStream()
            val token = headers[TOKEN_HEADER]

            when {
                method == "POST" && path == "/api/pair" -> doPair(body, out)
                method == "GET" && path == "/api/info" -> doInfo(token, out)
                method == "GET" && path == "/api/list" -> doList(token, out)
                method == "GET" && path == "/api/download" -> doDownload(token, args, headers, out)
                else -> respondJson(out, 404, JSONObject().put("ok", false).put("message", "not found"))
            }
            runCatching { out.flush() }
        } catch (_: Exception) {
            // 对方断开 / 读超时等，忽略
        } finally {
            runCatching { sock.close() }
        }
    }

    private fun readLine(input: BufferedInputStream): String? {
        val sb = StringBuilder()
        while (true) {
            val b = input.read()
            if (b < 0) return if (sb.isEmpty()) null else sb.toString()
            if (b == '\n'.code) break
            if (b != '\r'.code) sb.append(b.toChar())
        }
        return sb.toString()
    }

    private fun readFully(input: BufferedInputStream, buf: ByteArray) {
        var off = 0
        while (off < buf.size) {
            val n = input.read(buf, off, buf.size - off)
            if (n < 0) break
            off += n
        }
    }

    private fun parseQuery(q: String): Map<String, String> {
        if (q.isBlank()) return emptyMap()
        val map = HashMap<String, String>()
        for (pair in q.split("&")) {
            if (pair.isBlank()) continue
            val kv = pair.split("=", limit = 2)
            val k = kv.getOrNull(0) ?: continue
            val v = kv.getOrNull(1) ?: ""
            map[URLDecoder.decode(k, "UTF-8")] = URLDecoder.decode(v, "UTF-8")
        }
        return map
    }

    // ------------------------------------------------------------------ 接口

    private fun doPair(body: ByteArray?, out: OutputStream) {
        val now = System.currentTimeMillis()
        if (now < lockUntil) {
            val left = (lockUntil - now) / 1000 + 1
            respondJson(out, 429, JSONObject().put("ok", false).put("message", "配对码错误次数过多，请 ${left} 秒后再试"))
            return
        }
        val j = runCatching { JSONObject(String(body ?: ByteArray(0), Charsets.UTF_8)) }.getOrNull()
        val given = j?.optString("code").orEmpty().trim()
        if (given.isEmpty() || given != code) {
            fails++
            if (fails >= MAX_FAILS) {
                fails = 0
                lockUntil = now + LOCK_MS
                onLog?.invoke("配对码连续错误，已锁定 5 分钟")
            }
            respondJson(out, 401, JSONObject().put("ok", false).put("message", "配对码不正确"))
            return
        }
        fails = 0
        val token = newToken()
        tokens[token] = now + TOKEN_TTL
        onLog?.invoke("设备「${j?.optString("name").orEmpty().ifBlank { "对方手机" }}」已连接")
        respondJson(
            out, 200, JSONObject()
                .put("ok", true)
                .put("token", token)
                .put("name", deviceName)
                .put("count", files.size)
        )
    }

    private fun doInfo(token: String?, out: OutputStream) {
        if (!valid(token)) return respondJson(out, 401, JSONObject().put("ok", false).put("message", "配对已失效"))
        respondJson(
            out, 200, JSONObject()
                .put("ok", true)
                .put("name", deviceName)
                .put("count", files.size)
                .put("bytes", totalBytes)
        )
    }

    private fun doList(token: String?, out: OutputStream) {
        if (!valid(token)) return respondJson(out, 401, JSONObject().put("ok", false).put("message", "配对已失效"))
        val arr = JSONArray()
        files.forEachIndexed { i, f ->
            arr.put(
                JSONObject()
                    .put("i", i)
                    .put("name", f.name)
                    .put("size", f.length())
                    .put("mime", Fmt.mime(f))
            )
        }
        respondJson(out, 200, JSONObject().put("ok", true).put("files", arr))
    }

    private fun doDownload(token: String?, args: Map<String, String>, headers: Map<String, String>, out: OutputStream) {
        if (!valid(token)) return respondJson(out, 401, JSONObject().put("ok", false).put("message", "配对已失效"))
        val index = args["i"]?.toIntOrNull()
        val file = index?.let { files.getOrNull(it) }
        if (file == null || !file.exists()) {
            return respondJson(out, 404, JSONObject().put("ok", false).put("message", "文件不存在"))
        }
        val size = file.length()
        var start = 0L
        var end = size - 1
        var partial = false
        val range = headers["range"]
        if (!range.isNullOrBlank() && range.startsWith("bytes=")) {
            val spec = range.removePrefix("bytes=").substringBefore(',')
            val s = spec.substringBefore('-')
            val e = spec.substringAfter('-', "")
            if (s.isNotBlank()) {
                start = s.toLongOrNull() ?: 0L
                partial = true
            }
            if (e.isNotBlank()) end = (e.toLongOrNull() ?: end).coerceAtMost(size - 1)
        }
        if (start < 0 || start > size || (partial && end < start)) {
            val head = "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */$size\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            out.write(head.toByteArray(Charsets.US_ASCII))
            return
        }
        val length = end - start + 1
        onLog?.invoke("正在发送 ${file.name}（${Fmt.size(length)}）")
        val head = buildString {
            append(if (partial) "HTTP/1.1 206 Partial Content\r\n" else "HTTP/1.1 200 OK\r\n")
            append("Content-Type: application/octet-stream\r\n")
            append("Content-Length: $length\r\n")
            append("Accept-Ranges: bytes\r\n")
            if (partial) append("Content-Range: bytes $start-$end/$size\r\n")
            append("Content-Disposition: attachment; filename=\"${file.name.replace("\"", "")}\"\r\n")
            append("Cache-Control: no-store\r\n")
            append("Connection: close\r\n\r\n")
        }
        out.write(head.toByteArray(Charsets.US_ASCII))
        FileInputStream(file).use { ins ->
            if (start > 0) {
                var skip = start
                while (skip > 0) {
                    val s = ins.skip(skip)
                    if (s <= 0) break
                    skip -= s
                }
            }
            val buf = ByteArray(64 * 1024)
            var remain = length
            while (remain > 0) {
                val n = ins.read(buf, 0, minOf(buf.size.toLong(), remain).toInt())
                if (n <= 0) break
                out.write(buf, 0, n)
                remain -= n
            }
        }
        out.flush()
    }

    // ------------------------------------------------------------------ 响应

    private fun respondJson(out: OutputStream, status: Int, obj: JSONObject) {
        val body = obj.toString().toByteArray(Charsets.UTF_8)
        val head = "HTTP/1.1 $status ${statusText(status)}\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            "Content-Length: ${body.size}\r\n" +
            "Cache-Control: no-store\r\n" +
            "Connection: close\r\n\r\n"
        out.write(head.toByteArray(Charsets.US_ASCII))
        out.write(body)
        out.flush()
    }

    private fun statusText(status: Int): String = when (status) {
        200 -> "OK"
        206 -> "Partial Content"
        401 -> "Unauthorized"
        404 -> "Not Found"
        416 -> "Range Not Satisfiable"
        429 -> "Too Many Requests"
        500 -> "Internal Server Error"
        else -> "OK"
    }
}
