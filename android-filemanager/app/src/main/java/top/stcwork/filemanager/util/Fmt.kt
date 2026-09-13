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

    /** 扩展名（小写，不含点）；目录返回 "文件夹" */
    fun extLabel(file: File): String {
        if (file.isDirectory) return "文件夹"
        val ext = file.extension.lowercase(Locale.US)
        return if (ext.isEmpty()) "文件" else ext.uppercase(Locale.US)
    }

    fun permissionText(file: File): String {
        val sb = StringBuilder()
        sb.append(if (file.canRead()) 'r' else '-')
        sb.append(if (file.canWrite()) 'w' else '-')
        sb.append(if (file.canExecute()) 'x' else '-')
        return sb.toString()
    }
}
