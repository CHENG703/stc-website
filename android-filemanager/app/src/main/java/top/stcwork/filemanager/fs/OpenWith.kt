package top.stcwork.filemanager.fs

import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.OpenableColumns
import java.io.File
import java.io.FileOutputStream

/**
 * 「用其它应用打开」：QQ、微信、系统下载等把文件丢过来时，
 * 把 Uri 定位成手机里真实的那份文件，好让文件管理器直接跳到它所在的文件夹。
 *
 * 策略依次是：
 *   1. file:// 直接用路径
 *   2. content:// 先按文件名（+大小）去 QQ / 微信 / 下载 等常见目录里找真实文件
 *   3. 找不到就把内容复制到本应用缓存目录，至少能定位到这份内容
 */
object OpenWith {

    /** 外部 App 收文件常用的目录（相对内部存储根） */
    private val CANDIDATE_DIRS = listOf(
        "Tencent/QQfile_recv",
        "Android/data/com.tencent.mobileqq/Tencent/QQfile_recv",
        "Download",
        "Download/Tencent/QQfile_recv",
        "Tencent/MicroMsg/Download",
        "Documents",
        "Pictures",
        "Movies",
        "Music",
        "DCIM"
    )

    fun resolve(context: Context, uri: Uri): File? {
        return when (uri.scheme?.lowercase()) {
            "file" -> uri.path?.let { File(it) }?.takeIf { it.exists() }
            "content" -> resolveContent(context, uri)
            else -> null
        }
    }

    private fun resolveContent(context: Context, uri: Uri): File? {
        val (name, size) = meta(context, uri)
        if (!name.isNullOrBlank()) {
            findByName(name, size)?.let { return it }
        }
        return if (!name.isNullOrBlank()) copyToCache(context, uri, name) else null
    }

    /** 从 content:// 里读显示名和大小（拿不到就返回 null / -1） */
    private fun meta(context: Context, uri: Uri): Pair<String?, Long> {
        return try {
            context.contentResolver.query(uri, null, null, null, null)?.use { c ->
                if (!c.moveToFirst()) return null to -1L
                val ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val si = c.getColumnIndex(OpenableColumns.SIZE)
                val n = if (ni >= 0) c.getString(ni) else null
                val s = if (si >= 0) c.getLong(si) else -1L
                n to s
            } ?: (null to -1L)
        } catch (e: Exception) {
            null to -1L
        }
    }

    private fun findByName(name: String, size: Long): File? {
        val root = Environment.getExternalStorageDirectory()
        for (rel in CANDIDATE_DIRS) {
            val dir = File(root, rel)
            if (!dir.isDirectory) continue
            val direct = File(dir, name)
            if (direct.isFile && (size <= 0 || direct.length() == size)) return direct
            // 常见情形：QQ 会再按日期/会话分一层子目录
            val kids = dir.listFiles() ?: continue
            for (k in kids) {
                if (!k.isDirectory) continue
                val f = File(k, name)
                if (f.isFile && (size <= 0 || f.length() == size)) return f
            }
        }
        return null
    }

    private fun copyToCache(context: Context, uri: Uri, name: String): File? {
        return try {
            val dir = File(context.cacheDir, "收到")
            if (!dir.exists() && !dir.mkdirs()) return null
            val safe = name.replace("/", "_").replace("\\", "_")
            val target = Fs.uniqueTarget(dir, safe)
            context.contentResolver.openInputStream(uri)?.use { ins ->
                FileOutputStream(target).use { out -> ins.copyTo(out) }
            } ?: return null
            if (target.length() <= 0) {
                target.delete()
                return null
            }
            target
        } catch (e: Exception) {
            null
        }
    }
}
