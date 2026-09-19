package top.stcwork.filemanager.net

import org.json.JSONObject
import top.stcwork.filemanager.fs.Fs
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * 手机互传的「接收方」客户端：连另一台手机上跑着的 [PhoneServer]（端口 8766）。
 *
 *   POST /api/pair       用 6 位配对码换令牌
 *   GET  /api/info       对方设备名 / 分享数量
 *   GET  /api/list       对方分享的文件清单
 *   GET  /api/download   下载（支持 Range 续传）
 *
 * 与电脑端互传一致：令牌只在本次配对有效，对方重新生成配对码就要重新输入。
 */
object PhoneClient {

    data class Entry(val index: Int, val name: String, val size: Long, val mime: String)

    data class Res<out T>(val ok: Boolean, val message: String, val data: T? = null, val needPair: Boolean = false)

    /** "192.168.1.23" / "192.168.1.23:8766" / "http://192.168.1.23:8766/" → "http://192.168.1.23:8766" */
    fun normalizeBase(raw: String): String {
        var s = raw.trim().replace(" ", "")
        if (s.isEmpty()) return ""
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://$s"
        while (s.endsWith("/")) s = s.dropLast(1)
        if (!s.substringAfter("://").contains(":")) s = "$s:${PhoneServer.PORT}"
        return s
    }

    private fun open(base: String, path: String, method: String, token: String?): HttpURLConnection {
        val c = URL(base + path).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 8000
        c.readTimeout = 60000
        c.useCaches = false
        c.setRequestProperty("Accept", "application/json")
        if (!token.isNullOrBlank()) c.setRequestProperty("x-phone-token", token)
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
            401 -> "配对码不正确或已失效"
            429 -> "尝试次数过多，请稍后再试"
            else -> "$fallback（HTTP $code）"
        }
        return Res(false, text, null, code == 401)
    }

    private fun netError(e: Exception, what: String): Res<Nothing> =
        Res(false, "$what 失败：${e.message ?: e.javaClass.simpleName}（确认两台手机连的是同一个 WiFi）")

    fun pair(base: String, code: String): Res<String> {
        val b = normalizeBase(base)
        if (b.isEmpty()) return Res(false, "请先填写对方地址，例如 192.168.1.23")
        if (code.trim().length != 6) return Res(false, "配对码是 6 位数字")
        return try {
            val c = open(b, "/api/pair", "POST", null)
            val body = JSONObject()
                .put("code", code.trim())
                .put("name", android.os.Build.MODEL ?: "手机")
                .toString().toByteArray(Charsets.UTF_8)
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            c.setFixedLengthStreamingMode(body.size)
            c.outputStream.use { it.write(body) }
            if (c.responseCode != 200) return fail(c, "配对失败")
            val j = runCatching { JSONObject(textOf(c)) }.getOrNull()
            val token = j?.optString("token").orEmpty()
            if (j?.optBoolean("ok") == true && token.isNotBlank()) Res(true, "已连接对方手机", token)
            else Res(false, "配对失败，请核对配对码")
        } catch (e: Exception) {
            netError(e, "配对")
        }
    }

    fun list(base: String, token: String): Res<List<Entry>> {
        return try {
            val c = open(normalizeBase(base), "/api/list", "GET", token)
            if (c.responseCode != 200) return fail(c, "读取对方分享失败")
            val j = runCatching { JSONObject(textOf(c)) }.getOrNull() ?: return Res(false, "对方返回异常")
            val arr = j.optJSONArray("files")
            val list = ArrayList<Entry>()
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    list += Entry(
                        index = o.optInt("i", i),
                        name = o.optString("name"),
                        size = o.optLong("size"),
                        mime = o.optString("mime")
                    )
                }
            }
            Res(true, "共 ${list.size} 个文件", list)
        } catch (e: Exception) {
            netError(e, "读取对方分享")
        }
    }

    /** 下载对方分享的第 index 个文件到 destDir；同名自动改名，已有半成品则续传 */
    fun download(
        base: String,
        token: String,
        entry: Entry,
        destDir: File,
        progress: Fs.Progress
    ): Res<File> {
        return try {
            if (!destDir.exists() && !destDir.mkdirs()) return Res(false, "无法写入存储目录")
            val target = Fs.uniqueTarget(destDir, entry.name.ifBlank { "收到文件" })
            val done0 = if (target.exists()) target.length() else 0L
            val c = open(
                normalizeBase(base),
                "/api/download?i=" + URLEncoder.encode(entry.index.toString(), "UTF-8"),
                "GET",
                token
            )
            if (done0 > 0 && done0 < entry.size) c.setRequestProperty("Range", "bytes=$done0-")
            c.connect()
            val code = c.responseCode
            if (code != 200 && code != 206) return fail(c, "下载失败")
            val append = code == 206
            val total = entry.size.takeIf { it > 0 } ?: 0L
            var done = if (append) done0 else 0L
            c.inputStream.use { ins ->
                FileOutputStream(target, append).use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = ins.read(buf)
                        if (n <= 0) break
                        out.write(buf, 0, n)
                        done += n
                        progress.add(n.toLong(), entry.name)
                    }
                    out.flush()
                }
            }
            if (total > 0 && done < total) return Res(false, "传输中断，已保存 ${target.name}（可重新接收续传）")
            Res(true, "已保存到「${destDir.name}/${target.name}」", target)
        } catch (e: Exception) {
            netError(e, "下载")
        }
    }
}
