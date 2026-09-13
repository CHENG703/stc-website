package top.stcwork.filemanager.data

import android.content.Context
import android.content.SharedPreferences

/**
 * 本地偏好存储：登录会话、服务器地址。
 * token 只存在应用私有目录（非 root 设备其他应用读不到）。
 */
object Prefs {
    private const val NAME = "stc_file_manager"

    /** 默认服务器地址，可在登录页修改 */
    const val DEFAULT_BASE_URL = "https://www.stcwork.top"

    private var sp: SharedPreferences? = null

    fun init(context: Context) {
        if (sp == null) {
            sp = context.applicationContext.getSharedPreferences(NAME, Context.MODE_PRIVATE)
        }
    }

    private fun p(): SharedPreferences = sp ?: error("Prefs 未初始化")

    var baseUrl: String
        get() = p().getString("base_url", DEFAULT_BASE_URL)?.ifBlank { DEFAULT_BASE_URL } ?: DEFAULT_BASE_URL
        set(value) = p().edit().putString("base_url", value.trim().trimEnd('/')).apply()

    var token: String
        get() = p().getString("token", "") ?: ""
        set(value) = p().edit().putString("token", value).apply()

    var username: String
        get() = p().getString("username", "") ?: ""
        set(value) = p().edit().putString("username", value).apply()

    var email: String
        get() = p().getString("email", "") ?: ""
        set(value) = p().edit().putString("email", value).apply()

    var isAdmin: Boolean
        get() = p().getBoolean("is_admin", false)
        set(value) = p().edit().putBoolean("is_admin", value).apply()

    /** 是否跳过登录（仅本地文件功能） */
    var skipLogin: Boolean
        get() = p().getBoolean("skip_login", false)
        set(value) = p().edit().putBoolean("skip_login", value).apply()

    val loggedIn: Boolean
        get() = token.isNotBlank() || username.isNotBlank()

    fun saveSession(token: String, username: String, email: String, isAdmin: Boolean) {
        p().edit()
            .putString("token", token)
            .putString("username", username)
            .putString("email", email)
            .putBoolean("is_admin", isAdmin)
            .putBoolean("skip_login", false)
            .apply()
    }

    fun clearSession() {
        p().edit()
            .remove("token")
            .remove("username")
            .remove("email")
            .remove("is_admin")
            .apply()
    }
}
