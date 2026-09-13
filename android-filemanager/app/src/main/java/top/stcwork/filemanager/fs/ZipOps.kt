package top.stcwork.filemanager.fs

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.zip.Deflater
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/** 打包（ZIP）与解压。进度总量按未压缩字节估算。 */
object ZipOps {

    fun zip(sources: List<File>, target: File, progress: Fs.Progress): Result<Int> {
        return try {
            var count = 0
            ZipOutputStream(BufferedOutputStream(FileOutputStream(target))).use { zos ->
                zos.setLevel(Deflater.DEFAULT_COMPRESSION)
                for (src in sources) {
                    if (src.isDirectory) {
                        count += addRecursive(zos, src, src.name, progress, true)
                    } else {
                        addFile(zos, src, src.name, progress)
                        count++
                    }
                }
            }
            Result.success(count)
        } catch (e: Exception) {
            runCatching { target.delete() }
            Result.failure(e)
        }
    }

    /** root = true 表示这是顶层目录本身（要写成 "名字/" 条目） */
    private fun addRecursive(
        zos: ZipOutputStream,
        file: File,
        entryName: String,
        progress: Fs.Progress,
        root: Boolean
    ): Int {
        var count = 0
        if (file.isDirectory) {
            val kids = file.listFiles()
            if (kids.isNullOrEmpty()) {
                zos.putNextEntry(ZipEntry(if (entryName.endsWith("/")) entryName else "$entryName/"))
                zos.closeEntry()
                count++
            } else {
                for (k in kids) count += addRecursive(zos, k, "$entryName/${k.name}", progress, false)
            }
        } else {
            addFile(zos, file, entryName, progress)
            count++
        }
        return count
    }

    private fun addFile(zos: ZipOutputStream, file: File, entryName: String, progress: Fs.Progress) {
        zos.putNextEntry(ZipEntry(entryName))
        FileInputStream(file).use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n <= 0) break
                zos.write(buf, 0, n)
                progress.add(n.toLong(), file.name)
            }
        }
        zos.closeEntry()
    }

    fun unzip(zipFile: File, destDir: File, progress: Fs.Progress): Result<Int> {
        return try {
            if (!destDir.exists()) destDir.mkdirs()
            val destRoot = destDir.canonicalPath.trimEnd(File.separatorChar)
            var count = 0
            ZipInputStream(BufferedInputStream(FileInputStream(zipFile))).use { zis ->
                while (true) {
                    val entry = zis.nextEntry ?: break
                    val outFile = File(destDir, entry.name)
                    // 防 zip slip：解压路径必须落在目标目录内
                    if (!outFile.canonicalPath.startsWith(destRoot)) {
                        zis.closeEntry()
                        continue
                    }
                    if (entry.isDirectory) {
                        outFile.mkdirs()
                    } else {
                        outFile.parentFile?.let { if (!it.exists()) it.mkdirs() }
                        FileOutputStream(outFile).use { out ->
                            val buf = ByteArray(64 * 1024)
                            while (true) {
                                val n = zis.read(buf)
                                if (n <= 0) break
                                out.write(buf, 0, n)
                                progress.add(n.toLong(), entry.name)
                            }
                        }
                    }
                    count++
                    zis.closeEntry()
                }
            }
            Result.success(count)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** 压缩包基础名（去掉扩展名） */
    fun baseName(zipFile: File): String {
        val n = zipFile.name
        val dot = n.lastIndexOf('.')
        return if (dot > 0) n.substring(0, dot) else n
    }
}
