package top.stcwork.filemanager.data

import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * 全局会话事件（Compose 可观察）。
 *
 * 服务端对「已封禁账号」的鉴权响应统一是
 *   403 { banned: true, message: "账号已被封禁…（原因…，解封时间…）", bannedUntil, banReason }
 * （见 server.js 的 authFailure / banMessage / getBanState）。
 *
 * [Api.checkSession] 一旦判定「账号被封禁」或「token 已失效」，就调用 [kick] 广播出去；
 * 界面（RootScreen）观察到后**立刻**清空本地会话并回到登录页 —— 不必等 24 小时的 token 过期。
 */
object Session {

    /** 是否被服务端踢出（封禁 / 会话失效） */
    var kicked by mutableStateOf(false)
        private set

    /** 踢出原因（直接用服务端的 message，内含封禁原因与解封时间） */
    var message by mutableStateOf("")
        private set

    private val main = Handler(Looper.getMainLooper())

    /** 由任意线程调用（Api 在 IO 线程），内部切回主线程写 Compose 状态 */
    fun kick(reason: String) {
        val text = reason.ifBlank { "登录状态已失效，请重新登录" }
        main.post {
            message = text
            kicked = true
        }
    }

    /** 界面处理完踢出（已退出登录）后复位，避免重复触发 */
    fun consume() {
        kicked = false
        message = ""
    }
}
