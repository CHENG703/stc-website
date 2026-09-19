package top.stcwork.filemanager.transfer

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import top.stcwork.filemanager.net.PhoneServer
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 手机互传的共享状态：界面（Compose）和前台服务（ShareService）都在同一个进程，
 * 通过这个单例同步「正在分享哪些文件 / 配对码 / 日志」。
 */
object ShareHub {

    data class State(
        val running: Boolean = false,
        val code: String = "",
        val count: Int = 0,
        val bytes: Long = 0L,
        val logs: List<String> = emptyList()
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    /** 待分享的文件，由界面在开始分享前设置 */
    @Volatile
    var files: List<File> = emptyList()

    private var server: PhoneServer? = null

    private fun stamp(): String =
        SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())

    fun log(message: String) {
        val next = (listOf("${stamp()} $message") + _state.value.logs).take(20)
        _state.value = _state.value.copy(logs = next)
    }

    fun start(deviceName: String): Boolean {
        if (server == null) {
            server = PhoneServer(PhoneServer.PORT, deviceName).apply { onLog = { log(it) } }
        }
        val s = server ?: return false
        val ok = s.start(files)
        _state.value = _state.value.copy(
            running = ok && s.running,
            code = s.code,
            count = s.fileCount,
            bytes = s.totalBytes
        )
        if (!ok) log("启动失败，请检查是否连上 WiFi")
        return ok
    }

    fun stop() {
        server?.stop()
        server = null
        _state.value = _state.value.copy(running = false, code = "", count = 0, bytes = 0L)
        log("已停止分享")
    }

    /** 重新生成配对码：旧令牌立即失效 */
    fun rotateCode(): String {
        val s = server ?: return ""
        val c = s.rotateCode()
        _state.value = _state.value.copy(code = c)
        log("已重新生成配对码")
        return c
    }
}
