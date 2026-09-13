package top.stcwork.filemanager.fs

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.content.FileProvider
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** 已安装应用枚举 + 提取安装包 */
object Apks {

    data class Entry(
        val label: String,
        val packageName: String,
        val versionName: String,
        val versionCode: Long,
        val isSystem: Boolean,
        val baseApk: String,
        val splits: List<String>,
        val bytes: Long
    ) {
        /** 文件名（不含扩展名） */
        val fileName: String
            get() = buildString {
                append(safe(label))
                if (versionName.isNotBlank()) {
                    append('_')
                    append(safe(versionName))
                }
            }

        val hasSplits: Boolean get() = splits.isNotEmpty()
    }

    private fun safe(s: String): String =
        s.replace(Regex("[\\\\/:*?\"<>|\\s]+"), "_").take(48).ifBlank { "app" }

    @Suppress("DEPRECATION")
    fun list(ctx: Context, includeSystem: Boolean): List<Entry> {
        val pm = ctx.packageManager
        val packages = try {
            pm.getInstalledPackages(PackageManager.GET_META_DATA)
        } catch (e: Exception) {
            emptyList()
        }
        val out = ArrayList<Entry>(packages.size)
        for (p in packages) {
            val ai: ApplicationInfo = p.applicationInfo ?: continue
            val system = (ai.flags and ApplicationInfo.FLAG_SYSTEM) != 0
            if (system && !includeSystem) continue
            val splits = ai.splitSourceDirs?.filter { it.isNotBlank() } ?: emptyList()
            var size = runCatching { File(ai.sourceDir).length() }.getOrDefault(0L)
            for (s in splits) size += runCatching { File(s).length() }.getOrDefault(0L)
            val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                p.longVersionCode
            } else {
                p.versionCode.toLong()
            }
            out += Entry(
                label = runCatching { pm.getApplicationLabel(ai).toString() }.getOrDefault(p.packageName),
                packageName = p.packageName,
                versionName = p.versionName ?: "",
                versionCode = code,
                isSystem = system,
                baseApk = ai.sourceDir ?: "",
                splits = splits,
                bytes = size
            )
        }
        return out.sortedWith(compareBy({ it.isSystem }, { it.label.lowercase() }))
    }

    /** 导出多个应用到 destDir，返回（成功文件, 错误信息） */
    fun export(
        entries: List<Entry>,
        destDir: File,
        progress: Fs.Progress
    ): Pair<List<File>, List<String>> {
        if (!destDir.exists()) destDir.mkdirs()
        val made = mutableListOf<File>()
        val errors = mutableListOf<String>()
        for (e in entries) {
            try {
                made += exportOne(e, destDir, progress)
            } catch (ex: Exception) {
                errors += "${e.label}：${ex.message ?: "导出失败"}"
            }
        }
        return made to errors
    }

    private fun exportOne(e: Entry, destDir: File, progress: Fs.Progress): File {
        val base = File(e.baseApk)
        if (e.baseApk.isBlank() || !base.exists()) {
            throw IllegalStateException("找不到源 APK（系统未开放）")
        }
        return if (!e.hasSplits) {
            val target = Fs.uniqueTarget(destDir, e.fileName + ".apk")
            copyFile(base, target, progress, e.label)
            target
        } else {
            // App Bundle 安装的应用由 base + 多个 split 组成，打成一个 .apks（zip）
            val target = Fs.uniqueTarget(destDir, e.fileName + ".apks")
            ZipOutputStream(BufferedOutputStream(FileOutputStream(target))).use { zos ->
                val all = listOf(e.baseApk) + e.splits
                for ((index, path) in all.withIndex()) {
                    val f = File(path)
                    if (!f.exists()) continue
                    val name = if (index == 0) "base.apk" else "split_$index.apk"
                    zos.putNextEntry(ZipEntry(name))
                    FileInputStream(f).use { input ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n <= 0) break
                            zos.write(buf, 0, n)
                            progress.add(n.toLong(), e.label)
                        }
                    }
                    zos.closeEntry()
                }
            }
            target
        }
    }

    private fun copyFile(src: File, dest: File, progress: Fs.Progress, tag: String) {
        FileInputStream(src).use { input ->
            FileOutputStream(dest).use { output ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n <= 0) break
                    output.write(buf, 0, n)
                    progress.add(n.toLong(), tag)
                }
            }
        }
    }

    /** 调系统安装器安装 APK（需 REQUEST_INSTALL_PACKAGES 授权） */
    fun installIntent(ctx: Context, apk: File): Intent {
        val uri: Uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", apk)
        return Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    }
}
