package top.stcwork.filemanager.fs

import java.io.File

/** 剪贴板（应用内）：跨目录/跨标签页保留 */
object FileClipboard {
    var sources: List<File> = emptyList()
        private set

    var isCut: Boolean = false
        private set

    val isEmpty: Boolean get() = sources.isEmpty()

    val count: Int get() = sources.size

    fun set(files: List<File>, cut: Boolean) {
        sources = files.toList()
        isCut = cut
    }

    fun clear() {
        sources = emptyList()
        isCut = false
    }
}
