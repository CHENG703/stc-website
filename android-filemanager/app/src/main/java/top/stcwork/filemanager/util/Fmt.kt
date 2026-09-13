package top.stcwork.filemanager.util

import android.webkit.MimeTypeMap
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object Fmt {

    private val units = arrayOf("B", "KB", "MB", "GB", "TB", "PB")

    fun size(bytes: Long): String {
        if (bytes < 0) return "-"
        if (bytes < 1024) return "$bytes B"
        var value = bytes.toDouble()
        var i = 0
        while (value >= 1024 && i < units.size - 1) {
            value /= 1024.0
            i++
        }
        return String.format(Locale.US, "%.2f %s", value, units[i])
    }

    private val df = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault())

    fun time(ms: Long): String = if (ms <= 0) "-" else df.format(Date(ms))

    fun mime(file: File): String {
        val ext = file.extension.lowercase(Locale.US)
        if (ext.isEmpty()) return if (file.isDirectory) "inode/directory" else "application/octet-stream"
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
    }

    /** 用 emoji 当图标，避免引入图标库、也更省内存 */
    fun iconFor(file: File): String {
        if (file.isDirectory) return "\uD83D\uDCC1" // 文件夹
        return when (file.extension.lowercase(Locale.US)) {
            "apk", "apks", "xapk", "aab" -> "\uD83D\uDCE6" // 安装包
            "zip", "rar", "7z", "tar", "gz", "bz2", "xz" -> "\uD83D\uDDDC\uFE0F" // 压缩包
            "jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "svg" -> "\uD83D\uDDBC\uFE0F"
            "mp4", "mkv", "avi", "mov", "webm", "flv", "3gp" -> "\uD83C\uDFA5"
            "mp3", "wav", "flac", "aac", "ogg", "m4a" -> "\uD83C\uDFB5"
            "txt", "md", "log", "json", "xml", "yml", "yaml", "ini", "conf" -> "\uD83D\uDCC4"
            "pdf" -> "\uD83D\uDCD5"
            "doc", "docx" -> "\uD83D\uDCD8"
            "xls", "xlsx", "csv" -> "\uD83D\uDCD7"
            "ppt", "pptx" -> "\uD83D\uDCD9"
            "html", "htm" -> "\uD83C\uDF10"
            "js", "ts", "kt", "java", "py", "c", "cpp", "go", "rs", "sh", "ps1" -> "\uD83D\uDCBB"
            "exe", "msi", "bat", "cmd", "dll", "so" -> "\u2699\uFE0F"
            "db", "sqlite", "sql" -> "\uD83D\uDDC3\uFE0F"
            "" -> "\uD83D\uDCC4"
            else -> "\uD83D\uDCC4"
        }
    }

    fun permissionText(file: File): String {
        val sb = StringBuilder()
        sb.append(if (file.canRead()) 'r' else '-')
        sb.append(if (file.canWrite()) 'w' else '-')
        sb.append(if (file.canExecute()) 'x' else '-')
        return sb.toString()
    }
}
