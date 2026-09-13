package top.stcwork.filemanager.fs

import android.os.Build
import android.os.Environment
import top.stcwork.filemanager.util.Fmt
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/**
 * 文件系统操作。全部走 java.io.File（配合"所有文件访问"权限即全盘可读写）。
 * 每个方法都在 IO 线程被调用，自身不做线程切换。
 */
object Fs {

    /** 内部存储根目录：/storage/emulated/0 */
    val storageRoot: File
        get() = Environment.getExternalStorageDirectory()

    fun hasAllFilesAccess(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Environment.isExternalStorageManager() else true

    /** 进度回调（节流，避免 UI 被刷爆） */
    class Progress(val total: Long, private val onUpdate: (done: Long, total: Long, current: String) -> Unit) {
        var done: Long = 0L
            private set
        private var lastEmit = 0L

        fun add(bytes: Long, current: String) {
            done += bytes
            val now = System.currentTimeMillis()
            if (now - lastEmit > 120) {
                lastEmit = now
                onUpdate(done, total, current)
            }
        }

        fun emit(current: String) = onUpdate(done, total, current)
    }

    fun list(dir: File, showHidden: Boolean): List<File> {
        val children = dir.listFiles() ?: return emptyList()
        return children.asSequence()
            .filter { showHidden || !it.name.startsWith(".") }
            .sortedWith(compareByDescending<File> { it.isDirectory }.thenBy { it.name.lowercase() })
            .toList()
    }

    fun totalBytes(file: File): Long {
        if (!file.exists()) return 0
        if (file.isFile) return file.length()
        var sum = 0L
        val stack = ArrayDeque<File>()
        stack.addLast(file)
        while (stack.isNotEmpty()) {
            val dir = stack.removeLast()
            val kids = dir.listFiles() ?: continue
            for (k in kids) {
                if (k.isDirectory) stack.addLast(k) else sum += k.length()
            }
        }
        return sum
    }

    fun childCount(dir: File): Int = dir.listFiles()?.size ?: 0

    /** 目标重名时自动加 (1)(2)... */
    fun uniqueTarget(dir: File, name: String): File {
        var target = File(dir, name)
        if (!target.exists()) return target
        val dot = name.lastIndexOf('.')
        val hasExt = dot > 0
        val base = if (hasExt) name.substring(0, dot) else name
        val ext = if (hasExt) name.substring(dot) else ""
        var i = 1
        while (target.exists()) {
            target = File(dir, "$base ($i)$ext")
            i++
        }
        return target
    }

    fun isInside(candidate: File, parent: File): Boolean {
        return try {
            val p = parent.canonicalPath.trimEnd(File.separatorChar)
            val c = candidate.canonicalPath
            c == p || c.startsWith(p + File.separator)
        } catch (e: Exception) {
            false
        }
    }

    // ---------------- 复制 ----------------

    fun copyInto(sources: List<File>, destDir: File, progress: Progress): List<String> {
        val errors = mutableListOf<String>()
        for (src in sources) {
            try {
                if (!src.exists()) {
                    errors += "${src.name}：源文件不存在"
                    continue
                }
                val dest = uniqueTarget(destDir, src.name)
                if (isInside(dest, src)) {
                    errors += "${src.name}：不能复制到自身内部"
                    continue
                }
                copyRecursive(src, dest, progress)
            } catch (e: Exception) {
                errors += "${src.name}：${e.message ?: "复制失败"}"
            }
        }
        return errors
    }

    fun copyRecursive(src: File, dest: File, progress: Progress) {
        if (src.isDirectory) {
            if (!dest.exists() && !dest.mkdirs()) throw IOException("无法创建目录 ${dest.name}")
            val kids = src.listFiles() ?: emptyArray()
            for (k in kids) copyRecursive(k, File(dest, k.name), progress)
        } else {
            dest.parentFile?.let { if (!it.exists()) it.mkdirs() }
            FileInputStream(src).use { input ->
                FileOutputStream(dest).use { output -> pipe(input, output, progress, src.name) }
            }
            dest.setLastModified(src.lastModified())
        }
    }

    private fun pipe(input: InputStream, output: OutputStream, progress: Progress, name: String) {
        val buf = ByteArray(64 * 1024)
        while (true) {
            val n = input.read(buf)
            if (n <= 0) break
            output.write(buf, 0, n)
            progress.add(n.toLong(), name)
        }
    }

    // ---------------- 移动 ----------------

    fun moveInto(sources: List<File>, destDir: File, progress: Progress): List<String> {
        val errors = mutableListOf<String>()
        for (src in sources) {
            try {
                if (!src.exists()) {
                    errors += "${src.name}：源文件不存在"
                    continue
                }
                val dest = uniqueTarget(destDir, src.name)
                if (isInside(dest, src)) {
                    errors += "${src.name}：不能移动到自身内部"
                    continue
                }
                if (!src.renameTo(dest)) {
                    copyRecursive(src, dest, progress)
                    if (!deleteRecursive(src)) errors += "${src.name}：已复制但源文件删除失败"
                }
            } catch (e: Exception) {
                errors += "${src.name}：${e.message ?: "移动失败"}"
            }
        }
        return errors
    }

    // ---------------- 删除 / 重命名 / 新建 ----------------

    fun deleteRecursive(file: File): Boolean {
        if (file.isDirectory) {
            val kids = file.listFiles() ?: emptyArray()
            for (k in kids) deleteRecursive(k)
        }
        return file.delete()
    }

    fun deleteAll(targets: List<File>): List<String> {
        val errors = mutableListOf<String>()
        for (t in targets) {
            if (!deleteRecursive(t)) errors += "${t.name}：删除失败（可能无权限）"
        }
        return errors
    }

    fun rename(target: File, newName: String): Result<File> {
        val clean = newName.trim().replace("/", "_")
        if (clean.isBlank()) return Result.failure(IOException("名称不能为空"))
        if (clean == target.name) return Result.success(target)
        val dest = File(target.parentFile, clean)
        if (dest.exists()) return Result.failure(IOException("已存在同名项"))
        return if (target.renameTo(dest)) Result.success(dest)
        else Result.failure(IOException("重命名失败（可能无权限）"))
    }

    fun mkdir(parent: File, name: String): Result<File> {
        val clean = name.trim().replace("/", "_")
        if (clean.isBlank()) return Result.failure(IOException("名称不能为空"))
        val dest = File(parent, clean)
        if (dest.exists()) return Result.failure(IOException("已存在同名项"))
        return if (dest.mkdirs()) Result.success(dest) else Result.failure(IOException("创建失败（可能无权限）"))
    }

    // ---------------- 详细信息 ----------------

    data class Details(val title: String, val rows: List<Pair<String, String>>)

    fun details(file: File): Details {
        val rows = mutableListOf<Pair<String, String>>()
        rows += "名称" to file.name
        rows += "路径" to file.absolutePath
        if (file.isDirectory) {
            rows += "类型" to "文件夹"
            rows += "子项数量" to "${childCount(file)} 项"
            rows += "总大小" to Fmt.size(totalBytes(file))
        } else {
            rows += "类型" to Fmt.mime(file)
            rows += "大小" to "${Fmt.size(file.length())}（${file.length()} 字节）"
        }
        rows += "修改时间" to Fmt.time(file.lastModified())
        rows += "权限" to Fmt.permissionText(file)
        rows += "可读" to if (file.canRead()) "是" else "否"
        rows += "可写" to if (file.canWrite()) "是" else "否"
        rows += "隐藏" to if (file.name.startsWith(".")) "是" else "否"
        if (file.name.startsWith(".")) rows += "隐藏" to "是"
        if (file.isFile && file.extension.isNotEmpty()) rows += "扩展名" to file.extension.lowercase()
        return Details(file.name, rows)
    }

    /** 常用入口目录，存在才显示 */
    fun shortcuts(): List<Pair<String, File>> {
        val candidates = listOf(
            "内部存储" to storageRoot,
            "下载" to File(storageRoot, "Download"),
            "图片" to File(storageRoot, "Pictures"),
            "相机" to File(storageRoot, "DCIM"),
            "文档" to File(storageRoot, "Documents"),
            "音乐" to File(storageRoot, "Music"),
            "影片" to File(storageRoot, "Movies"),
            "蓝牙" to File(storageRoot, "Bluetooth"),
            "安装包" to File(storageRoot, "Download/提取的安装包")
        )
        return candidates.filter { it.second.exists() }
    }
}
