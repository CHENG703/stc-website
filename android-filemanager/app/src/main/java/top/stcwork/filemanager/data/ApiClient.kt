package top.stcwork.filemanager.data

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * 与 STC 网站（server.js）通信的最小客户端。
 *
 * 登录流程必须与网站一致（见 server.js）：
 *   1. GET  /api/csrf-token  —— 拿一次性 CSRF token，同时服务端下发 connect.sid（session 绑定 CSRF）
 *   2. POST /api/login       —— 必须带 X-CSRF-Token + X-Request-Nonce，否则 403
 *   3. 响应体里带 token（因为没有 Origin 头 ⇒ 服务端视为跨域脚本客户端，shouldExposeTokenInBody 返回 true）
 *      后续请求用 Authorization: Bearer <token>；cookie 也会保留作为兜底。
 *
 * 只依赖 HttpURLConnection + org.json（Android 平台自带），不引第三方网络库。
 */
object Api {

    private const val TIMEOUT_CONNECT = 15_000
    private const val TIMEOUT_READ = 25_000

    /**
     * 声明自己是 App 客户端。
     * 服务端据此跳过 SVG 图形验证码（安卓端无法渲染 SVG），
     * 改由邮箱验证码 + IP 限流兜底；网页端不受影响。
     * 见 server.js 的 requireCaptchaApp / APP_CLIENT_ID。
     */
    private const val APP_CLIENT = "stc-filemanager"

    private val cookies = ConcurrentHashMap<String, String>()

    data class Response(val code: Int, val body: String)

    data class LoginResult(
        val success: Boolean,
        val message: String,
        val username: String = "",
        val email: String = "",
        val token: String = "",
        val isAdmin: Boolean = false,
        val role: String = "",
        val roleLabel: String = "",
        /** 账号被封禁（服务端拒绝登录） */
        val banned: Boolean = false
    )

    /** 邮箱验证码发送结果 */
    data class SendCodeResult(val success: Boolean, val message: String)

    private fun nonce(): String = UUID.randomUUID().toString().replace("-", "")

    private fun cookieHeader(): String? =
        if (cookies.isEmpty()) null else cookies.entries.joinToString("; ") { "${it.key}=${it.value}" }

    private fun rememberCookies(conn: HttpURLConnection) {
        val headers = try {
            conn.headerFields?.get("Set-Cookie")
        } catch (e: Exception) {
            null
        } ?: return
        for (raw in headers) {
            val first = raw.substringBefore(';')
            val idx = first.indexOf('=')
            if (idx <= 0) continue
            val name = first.substring(0, idx).trim()
            val value = first.substring(idx + 1).trim()
            val expired = raw.contains("Max-Age=0", true)
            if (expired || value.isEmpty()) cookies.remove(name) else cookies[name] = value
        }
    }

    /** 统一请求入口；返回 HTTP 状态码与响应体文本 */
    private fun request(
        baseUrl: String,
        path: String,
        method: String,
        jsonBody: String? = null,
        csrf: String? = null,
        nonce: String? = null,
        bearer: String? = null,
        timeoutRead: Int = TIMEOUT_READ
    ): Response {
        val url = URL(baseUrl.trimEnd('/') + path)
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = TIMEOUT_CONNECT
            readTimeout = timeoutRead
            instanceFollowRedirects = true
            useCaches = false
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9")
            setRequestProperty("User-Agent", "STCFileManager/1.0 (Android)")
            cookieHeader()?.let { setRequestProperty("Cookie", it) }
            if (csrf != null) setRequestProperty("X-CSRF-Token", csrf)
            if (nonce != null) setRequestProperty("X-Request-Nonce", nonce)
            if (bearer != null && bearer.isNotBlank()) {
                setRequestProperty("Authorization", "Bearer $bearer")
                setRequestProperty("X-Auth-Token", bearer)
            }
            if (jsonBody != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
        }

        try {
            if (jsonBody != null) {
                val out: OutputStream = conn.outputStream
                out.write(jsonBody.toByteArray(Charsets.UTF_8))
                out.flush()
                out.close()
            }
            val code = conn.responseCode
            rememberCookies(conn)
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.use { s ->
                BufferedReader(InputStreamReader(s, Charsets.UTF_8)).readText()
            } ?: ""
            return Response(code, body)
        } finally {
            conn.disconnect()
        }
    }

    /** 探测服务器是否可用（顺带拿一个 CSRF token，不消耗） */
    fun probe(baseUrl: String): Response = request(baseUrl, "/api/csrf-token", "GET")

    private fun fetchCsrf(baseUrl: String): String {
        val resp = request(baseUrl, "/api/csrf-token", "GET")
        return runCatching { JSONObject(resp.body).optString("csrfToken") }.getOrDefault("")
    }

    /**
     * 用网站账号登录。
     * 第一个参数既可以是用户名，也可以是注册时用的邮箱（服务端两者都认，见 server.js 的
     * `/api/login`：`u.username === username || u.email === username`），
     * 所以直接填 QQ 邮箱也能登录。
     */
    fun login(baseUrl: String, username: String, password: String): LoginResult {
        val csrf = fetchCsrf(baseUrl)
        if (csrf.isBlank()) {
            return LoginResult(false, "无法获取安全令牌，请检查网络或服务器地址")
        }
        val payload = JSONObject()
            .put("username", username)
            .put("password", password)
            .put("loginType", "password")
            .put("app_client", APP_CLIENT)
            .toString()

        return parseLogin(request(baseUrl, "/api/login", "POST", payload, csrf, nonce()))
    }

    /**
     * 邮箱验证码登录（QQ 邮箱等，与网站登录页的「验证码登录」完全同一条链路）：
     *   1. sendCode(url, email, "login") —— 邮箱必须已注册
     *   2. loginWithCode(url, code)     —— loginType='code'，不需要用户名
     */
    fun loginWithCode(baseUrl: String, code: String): LoginResult {
        val csrf = fetchCsrf(baseUrl)
        if (csrf.isBlank()) {
            return LoginResult(false, "无法获取安全令牌，请检查网络或服务器地址")
        }
        val payload = JSONObject()
            .put("code", code)
            .put("loginType", "code")
            .put("app_client", APP_CLIENT)
            .toString()

        return parseLogin(request(baseUrl, "/api/login", "POST", payload, csrf, nonce()))
    }

    /** 解析 /api/login 的响应（密码登录与验证码登录共用） */
    private fun parseLogin(resp: Response): LoginResult {
        val json = runCatching { JSONObject(resp.body) }.getOrNull()
            ?: return LoginResult(false, "服务器返回异常（HTTP ${resp.code}）")

        val ok = json.optBoolean("success")
        val user = json.optJSONObject("user")
        val role = user?.optString("role").orEmpty()
        return LoginResult(
            success = ok,
            message = json.optString("message").ifBlank { if (ok) "登录成功" else "登录失败" },
            username = user?.optString("username").orEmpty(),
            email = user?.optString("email").orEmpty(),
            token = json.optString("token").orEmpty(),
            isAdmin = user?.optBoolean("is_admin") ?: false,
            role = role,
            roleLabel = user?.optString("role_label").orEmpty().ifBlank { roleLabelOf(role) },
            banned = json.optBoolean("banned")
        )
    }

    fun roleLabelOf(role: String): String = when (role) {
        "guest" -> "访客"
        "member" -> "成员"
        "admin" -> "管理员"
        "superadmin" -> "超级管理员"
        else -> "成员"
    }

    /**
     * 注册新账号（访客身份）。
     * 服务端 /api/register 会强制 role='guest'、register_source='app'，
     * 与「工会成员」区分开；随后由管理员在网站后台升级或封禁。
     */
    fun register(
        baseUrl: String,
        username: String,
        email: String,
        password: String,
        verifyCode: String
    ): LoginResult {
        val csrf = fetchCsrf(baseUrl)
        if (csrf.isBlank()) {
            return LoginResult(false, "无法获取安全令牌，请检查网络或服务器地址")
        }
        val payload = JSONObject()
            .put("username", username)
            .put("email", email)
            .put("password", password)
            .put("verify_code", verifyCode)
            .put("app_client", APP_CLIENT)
            .toString()

        val resp = request(baseUrl, "/api/register", "POST", payload, csrf, nonce())
        val json = runCatching { JSONObject(resp.body) }.getOrNull()
            ?: return LoginResult(false, "服务器返回异常（HTTP ${resp.code}）")

        val ok = json.optBoolean("success")
        val msg = json.optString("message").ifBlank { if (ok) "注册成功" else "注册失败" }
        if (!ok) return LoginResult(false, msg)

        // 注册成功后直接登录，省去用户再输一遍密码
        val login = login(baseUrl, username, password)
        return if (login.success) login.copy(message = "注册成功，已自动登录") else login.copy(message = "注册成功，请返回登录")
    }

    /**
     * 发送邮箱验证码（App 通道，跳过图形验证码）。
     * @param type "register"（注册，邮箱不能已存在）或 "login"（登录，邮箱必须已注册）
     */
    fun sendCode(baseUrl: String, email: String, type: String = "register"): SendCodeResult {
        return try {
            val csrf = fetchCsrf(baseUrl)
            if (csrf.isBlank()) return SendCodeResult(false, "无法获取安全令牌，请检查网络")
            val payload = JSONObject()
                .put("email", email)
                .put("type", type)
                .put("app_client", APP_CLIENT)
                .toString()
            val resp = request(baseUrl, "/api/send-code", "POST", payload, csrf, nonce())
            val json = runCatching { JSONObject(resp.body) }.getOrNull()
            SendCodeResult(
                success = json?.optBoolean("success") ?: false,
                message = json?.optString("message").orEmpty()
                    .ifBlank { if (resp.code in 200..299) "验证码已发送" else "发送失败（HTTP ${resp.code}）" }
            )
        } catch (e: Exception) {
            SendCodeResult(false, "发送失败：" + (e.message ?: "网络错误"))
        }
    }

    /** 退出登录（尽力而为，失败不影响本地清空） */
    fun logout(baseUrl: String, bearer: String): Boolean {
        return try {
            val csrf = fetchCsrf(baseUrl)
            val resp = request(baseUrl, "/api/logout", "POST", "{}", csrf, nonce(), bearer)
            cookies.clear()
            resp.code in 200..299
        } catch (e: Exception) {
            cookies.clear()
            false
        }
    }

    /** 校验当前 token 是否仍有效 */
    fun checkSession(baseUrl: String, bearer: String): Boolean {
        return try {
            val resp = request(baseUrl, "/api/user", "GET", bearer = bearer)
            resp.code in 200..299
        } catch (e: Exception) {
            false
        }
    }
}
