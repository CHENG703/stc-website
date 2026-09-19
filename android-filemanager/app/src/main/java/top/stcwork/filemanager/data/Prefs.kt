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

    /** 角色：guest(访客) / member(成员) / admin / superadmin，由服务端下发 */
    var role: String
        get() = p().getString("role", "") ?: ""
        set(value) = p().edit().putString("role", value).apply()

    var roleLabel: String
        get() = p().getString("role_label", "") ?: ""
        set(value) = p().edit().putString("role_label", value).apply()

    /** 是否跳过登录（仅本地文件功能） */
    var skipLogin: Boolean
        get() = p().getBoolean("skip_login", false)
        set(value) = p().edit().putBoolean("skip_login", value).apply()

    val loggedIn: Boolean
        get() = token.isNotBlank() || username.isNotBlank()

    /** 是否访客身份（非工会人员，软件注册默认） */
    val isGuest: Boolean
        get() = role == "guest"

    /**
     * 功能权限：只有登录用户才能改名/删除/新建/打包/解压/粘贴/提取安装包。
     * 未登录（含「暂不登录」）只能浏览、打开、复制、查看详情。
     */
    val canWrite: Boolean
        get() = loggedIn

    /** 电脑端互传：电脑端地址（形如 http://192.168.1.5:8765） */
    var pcUrl: String
        get() = p().getString("pc_url", "") ?: ""
        set(value) = p().edit().putString("pc_url", value.trim().trimEnd('/')).apply()

    /** 电脑端互传：配对成功后拿到的令牌 */
    var pcToken: String
        get() = p().getString("pc_token", "") ?: ""
        set(value) = p().edit().putString("pc_token", value).apply()

    /** 「电脑」页是否已配对 */
    val pcPaired: Boolean
        get() = pcToken.isNotBlank() && pcUrl.isNotBlank()

    fun clearPcPair() {
        p().edit().remove("pc_token").apply()
    }

    /**
     * App 请求签名密钥：登录时服务端下发（HMAC(APP_HMAC_KEY, token) 的 base64），
     * 之后每个带令牌的请求都用它对「方法/路径/时间戳/随机数/body」签名，
     * 服务端可凭令牌复算校验 —— 防篡改、防重放。未配置时为空串（不签名）。
     */
    var signKey: String
        get() = p().getString("sign_key", "") ?: ""
        set(value) = p().edit().putString("sign_key", value).apply()

    /** 手机互传：对方手机地址（形如 http://192.168.1.23:8766） */
    var phoneHost: String
        get() = p().getString("phone_host", "") ?: ""
        set(value) = p().edit().putString("phone_host", value.trim().trimEnd('/')).apply()

    /** 手机互传：配对成功后拿到的令牌 */
    var phoneToken: String
        get() = p().getString("phone_token", "") ?: ""
        set(value) = p().edit().putString("phone_token", value).apply()

    /** 「手机」页是否已连上对方 */
    val phonePaired: Boolean
        get() = phoneHost.isNotBlank() && phoneToken.isNotBlank()

    fun clearPhonePair() {
        p().edit().remove("phone_token").apply()
    }

    fun saveSession(
        token: String,
        username: String,
        email: String,
        isAdmin: Boolean,
        role: String = "",
        roleLabel: String = ""
    ) {
        p().edit()
            .putString("token", token)
            .putString("username", username)
            .putString("email", email)
            .putBoolean("is_admin", isAdmin)
            .putString("role", role)
            .putString("role_label", roleLabel)
            .putBoolean("skip_login", false)
            .apply()
    }

    fun clearSession() {
        p().edit()
            .remove("token")
            .remove("username")
            .remove("email")
            .remove("is_admin")
            .remove("role")
            .remove("role_label")
            .remove("sign_key")
            .apply()
    }
}
