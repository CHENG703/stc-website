package top.stcwork.filemanager.data

import android.os.Build
import org.json.JSONObject
import top.stcwork.filemanager.fs.Fs
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * 与「STC 电脑端」（仓库里的 pc-client/）通信的局域网客户端。
 *
 * 电脑端在同一个 WiFi 下监听 http://<电脑IP>:8765，手机侧用配对码换一个令牌，
 * 之后所有文件操作都带着令牌走 HTTP：
 *   POST /api/pair      配对换令牌
 *   GET  /api/roots     可访问的磁盘
 *   GET  /api/list      列目录
 *   GET  /api/download  下载
 *   PUT  /api/upload    上传（原始字节流，不套 multipart）
 *   POST /api/mkdir     新建文件夹
 *   POST /api/delete    删除
 */
object PcClient {

    data class Entry(val name: String, val path: String, val dir: Boolean, val size: Long, val mtime: Long)

    data class Listing(val path: String, val parent: String, val entries: List<Entry>, val allowWrite: Boolean)

    data class Root(val label: String, val path: String)

    data class Res<out T>(val ok: Boolean, val message: String, val data: T? = null, val needPair: Boolean = false)

    val deviceName: String
        get() = Build.MODEL?.takeIf { it.isNotBlank() } ?: "安卓手机"

    /** 把 "192.168.1.5:8765"、"http://192.168.1.5:8765/" 统一成 "http://192.168.1.5:8765" */
    fun normalizeBase(raw: String): String {
        var s = raw.trim().replace(" ", "")
        if (s.isEmpty()) return ""
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://$s"
        while (s.endsWith("/")) s = s.dropLast(1)
        return s
    }

    private fun open(base: String, path: String, method: String, token: String?): HttpURLConnection {
        val c = URL(base + path).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 8000
        c.readTimeout = 30000
        c.useCaches = false
        c.setRequestProperty("Accept", "application/json")
        if (!token.isNullOrBlank()) c.setRequestProperty("x-pc-token", token)
        return c
    }

    private fun textOf(c: HttpURLConnection): String {
        val stream = try { c.inputStream } catch (_: Exception) { c.errorStream }
        val text = runCatching { stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty() }.getOrDefault("")
        runCatching { c.disconnect() }
        return text
    }

    private fun fail(c: HttpURLConnection, fallback: String): Res<Nothing> {
        val code = runCatching { c.responseCode }.getOrDefault(0)
        val j = runCatching { JSONObject(textOf(c)) }.getOrNull()
        val msg = j?.optString("message")?.takeIf { it.isNotBlank() }
        val text = msg ?: when (code) {
            401 -> "与电脑端的配对已失效，请重新配对"
            403 -> "电脑端拒绝了这次操作"
            else -> "$fallback（HTTP $code）"
        }
        return Res(false, text, null, code == 401)
    }

    private fun netError(e: Exception, what: String): Res<Nothing> =
        Res(false, "$what 失败：${e.message ?: e.javaClass.simpleName}（确认手机和电脑连的是同一个 WiFi）")

    // ------------------------------------------------------------ 配对 / 会话

    fun pair(base: String, code: String): Res<String> {
        val b = normalizeBase(base)
        if (b.isEmpty()) return Res(false, "请先填写电脑地址，例如 192.168.1.5:8765")
        return try {
            val c = open(b, "/api/pair", "POST", null)
            val body = JSONObject()
                .put("code", code)
                .put("name", deviceName)
                .put("kind", "app")
                .toString().toByteArray(Charsets.UTF_8)
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            c.setFixedLengthStreamingMode(body.size)
            c.outputStream.use { it.write(body) }
            if (c.responseCode != 200) return fail(c, "配对失败")
            val j = runCatching { JSONObject(textOf(c)) }.getOrNull()
            val token = j?.optString("token").orEmpty()
            if (j?.optBoolean("ok") == true && token.isNotBlank()) Res(true, "已连接电脑", token)
            else Res(false, "配对失败，请核对配对码")
        } catch (e: Exception) {
            netError(e, "配对")
        }
    }

    fun session(base: String, token: String): Res<String> {
        return try {
            val c = open(normalizeBase(base), "/api/session", "GET", token)
            if (c.responseCode != 200) return fail(c, "读取连接状态失败")
            val j = runCatching { JSONObject(textOf(c)) }.getOrNull()
            Res(true, "已连接", j?.optJSONObject("device")?.optString("name").orEmpty())
        } catch (e: Exception) {
            netError(e, "连接")
        }
    }

    fun unpair(base: String, token: String) {
        runCatching {
            val c = open(normalizeBase(base), "/api/unpair", "POST", token)
            c.doOutput = true
            c.setFixedLengthStreamingMode(0)
            c.outputStream.close()
            textOf(c)
        }
    }

    // ------------------------------------------------------------ 目录

    fun roots(base: String, token: String): Res<List<Root>> {
        return try {
            val c = open(normalizeBase(base), "/api/roots", "GET", token)
            if (c.responseCode != 200) return fail(c, "读取磁盘列表失败")
            val j = runCatching { JSONObject(textOf(c)) }.getOrNull() ?: return Res(false, "电脑端返回异常")
            val arr = j.optJSONArray("roots")
            val list = ArrayList<Root>()
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    val p = o.optString("path")
                    if (p.isNotBlank()) list += Root(o.optString("label").ifBlank { p }, p)
                }
            }
            Res(true, "共 ${list.size} 个磁盘", list)
        } catch (e: Exception) {
            netError(e, "读取磁盘列表")
        }
    }

    fun list(base: String, token: String, path: String): Res<Listing> {
        return try {
            val q = if (path.isBlank()) "" else "?path=" + URLEncoder.encode(path, "UTF-8")
            val c = open(normalizeBase(base), "/api/list$q", "GET", token)
            if (c.responseCode != 200) return fail(c, "打开文件夹失败")
            val j = runCatching { JSONObject(textOf(c)) }.getOrNull() ?: return Res(false, "电脑端返回异常")
            val arr = j.optJSONArray("entries")
            val entries = ArrayList<Entry>()
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    entries += Entry(
                        name = o.optString("name"),
                        path = o.optString("path"),
                        dir = o.optBoolean("dir"),
                        size = o.optLong("size"),
                        mtime = o.optLong("mtime")
                    )
                }
            }
            Res(true, "", Listing(j.optString("path"), j.optString("parent"), entries, j.optBoolean("allowWrite", true)))
        } catch (e: Exception) {
            netError(e, "打开文件夹")
        }
    }

    fun mkdir(base: String, token: String, path: String): Res<String> {
        return post(base, token, "/api/mkdir", JSONObject().put("path", path), "新建文件夹")
    }

    fun rename(base: String, token: String, path: String, name: String): Res<String> {
        val body = JSONObject().put("path", path).put("name", name)
        return post(base, token, "/api/rename", body, "重命名")
    }

    fun delete(base: String, token: String, path: String): Res<String> {
        val body = JSONObject().put("paths", org.json.JSONArray().put(path))
        return post(base, token, "/api/delete", body, "删除")
    }

    private fun post(base: String, token: String, path: String, body: JSONObject, what: String): Res<String> {
        return try {
            val c = open(normalizeBase(base), path, "POST", token)
            val bytes = body.toString().toByteArray(Charsets.UTF_8)
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            c.setFixedLengthStreamingMode(bytes.size)
            c.outputStream.use { it.write(bytes) }
            if (c.responseCode != 200) return fail(c, "$what 失败")
            val j = runCatching { JSONObject(textOf(c)) }.getOrNull()
            if (j?.optBoolean("ok") == true) Res(true, j.optString("message").ifBlank { "$what 成功" })
            else Res(false, j?.optString("message")?.ifBlank { null } ?: "$what 失败")
        } catch (e: Exception) {
            netError(e, what)
        }
    }

    // ------------------------------------------------------------ 传输

    /** 下载电脑上的文件到 destDir，返回实际保存的文件 */
    fun download(
        base: String,
        token: String,
        remotePath: String,
        destDir: File,
        progress: Fs.Progress
    ): Res<File> {
        return try {
            val c = open(normalizeBase(base), "/api/download?path=" + URLEncoder.encode(remotePath, "UTF-8"), "GET", token)
            if (c.responseCode != 200) return fail(c, "下载失败")
            if (!destDir.exists() && !destDir.mkdirs()) return Res(false, "无法写入手机存储目录")
            val name = remotePath.substringAfterLast('\\').substringAfterLast('/')
            val target = Fs.uniqueTarget(destDir, name.ifBlank { "电脑文件" })
            val total = c.contentLengthLong.takeIf { it > 0 } ?: 0L
            var done = 0L
            c.inputStream.use { ins ->
                FileOutputStream(target).use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = ins.read(buf)
                        if (n <= 0) break
                        out.write(buf, 0, n)
                        done += n
                        progress.add(n.toLong(), name)
                        if (total > 0 && done >= total) break
                    }
                    out.flush()
                }
            }
            Res(true, "已保存到「${destDir.name}/${target.name}」", target)
        } catch (e: Exception) {
            netError(e, "下载")
        }
    }

    /** 上传一个字节流到电脑上的 dir 文件夹 */
    fun upload(
        base: String,
        token: String,
        dir: String,
        name: String,
        source: InputStream,
        size: Long,
        progress: Fs.Progress
    ): Res<String> {
        return try {
            val url = "/api/upload?dir=" + URLEncoder.encode(dir, "UTF-8") + "&name=" + URLEncoder.encode(name, "UTF-8")
            val c = open(normalizeBase(base), url, "PUT", token)
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/octet-stream")
            if (size > 0) c.setFixedLengthStreamingMode(size) else c.setChunkedStreamingMode(64 * 1024)
            source.use { ins ->
                c.outputStream.use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = ins.read(buf)
                        if (n <= 0) break
                        out.write(buf, 0, n)
                        progress.add(n.toLong(), name)
                    }
                    out.flush()
                }
            }
            if (c.responseCode != 200) return fail(c, "上传失败")
            val j = runCatching { JSONObject(textOf(c)) }.getOrNull()
            if (j?.optBoolean("ok") == true) Res(true, "已上传到电脑", j.optString("path"))
            else Res(false, j?.optString("message")?.ifBlank { null } ?: "上传失败")
        } catch (e: Exception) {
            netError(e, "上传")
        }
    }
}
