package top.stcwork.filemanager.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.stcwork.filemanager.data.Api
import top.stcwork.filemanager.data.Prefs

/**
 * 用 STC 网站账号登录 / 注册。
 * 走的是网站真实接口：GET /api/csrf-token → POST /api/login 或 /api/register（带 CSRF + nonce）。
 *
 * 两种登录方式与网站登录页一一对应：
 *   ① 密码登录：账号可填「用户名」或「QQ 邮箱」，服务端两者都认；
 *   ② QQ 邮箱验证码登录：邮箱 → 收 6 位码 → 登录（loginType='code'，不需要用户名）。
 *
 * 身份说明：「访客 / 成员」只是后台用来区分人员（会员 / 非会员），功能完全一致，
 * 登录后即可使用全部功能；管理员可对账号做限时封禁，封禁期间无法登录。
 */
@Composable
fun LoginScreen(
    onSuccess: () -> Unit,
    onSkip: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var registerMode by rememberSaveable { mutableStateOf(false) }
    /** 0 = 密码登录，1 = QQ 邮箱验证码登录 */
    var mode by rememberSaveable { mutableIntStateOf(0) }
    var username by rememberSaveable { mutableStateOf(Prefs.username) }
    var email by rememberSaveable { mutableStateOf(Prefs.email) }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var baseUrl by rememberSaveable { mutableStateOf(Prefs.baseUrl) }
    var showAdvanced by remember { mutableStateOf(false) }
    var passwordVisible by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var countdown by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf("") }

    // 验证码倒计时
    LaunchedEffect(countdown) {
        if (countdown > 0) {
            delay(1000)
            countdown -= 1
        }
    }

    fun resolvedUrl(): String = baseUrl.trim().ifBlank { Prefs.DEFAULT_BASE_URL }

    fun applyLogin(result: Api.LoginResult, url: String, fallbackName: String) {
        Prefs.baseUrl = url
        Prefs.saveSession(
            token = result.token,
            username = result.username.ifBlank { fallbackName },
            email = result.email.ifBlank { email },
            isAdmin = result.isAdmin,
            role = result.role,
            roleLabel = result.roleLabel
        )
        onSuccess()
    }

    fun sendEmailCode() {
        val url = resolvedUrl()
        sending = true
        error = ""
        notice = ""
        scope.launch {
            val type = if (registerMode) "register" else "login"
            val r = withContext(Dispatchers.IO) {
                runCatching { Api.sendCode(url, email.trim(), type) }
                    .getOrElse { Api.SendCodeResult(false, "网络异常：${it.message ?: "无法连接服务器"}") }
            }
            sending = false
            if (r.success) {
                countdown = 60
                notice = r.message.ifBlank { "验证码已发送到邮箱" }
            } else {
                error = r.message
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            // 整体灰色主题：沿用灰阶渐变背景
            .background(
                Brush.verticalGradient(
                    listOf(Color(0xFF161616), Color(0xFF232323), Color(0xFF161616))
                )
            )
            .padding(24.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text("STC 文件管理器", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text(
                when {
                    registerMode -> "注册后为「访客」身份，与成员功能完全一致"
                    mode == 1 -> "用 QQ 邮箱收取验证码登录"
                    else -> "使用 STC 网站账号登录"
                },
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(20.dp))

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {

                    if (!registerMode) {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            ModeButton("密码登录", mode == 0, Modifier.weight(1f)) {
                                mode = 0
                                error = ""
                                notice = ""
                            }
                            ModeButton("QQ邮箱登录", mode == 1, Modifier.weight(1f)) {
                                mode = 1
                                error = ""
                                notice = ""
                                code = ""
                            }
                        }
                    }

                    // ---------- 账号（密码登录） ----------
                    if (!registerMode && mode == 0) {
                        OutlinedTextField(
                            value = username,
                            onValueChange = { username = it },
                            label = { Text("用户名 / QQ邮箱") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Text,
                                imeAction = ImeAction.Next
                            ),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }

                    // ---------- 注册时的用户名 ----------
                    if (registerMode) {
                        OutlinedTextField(
                            value = username,
                            onValueChange = { username = it },
                            label = { Text("用户名") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Text,
                                imeAction = ImeAction.Next
                            ),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }

                    // ---------- 邮箱（注册 或 验证码登录） ----------
                    if (registerMode || mode == 1) {
                        OutlinedTextField(
                            value = email,
                            onValueChange = { email = it },
                            label = { Text("QQ邮箱") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Email,
                                imeAction = ImeAction.Next
                            ),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }

                    // ---------- 密码（注册 或 密码登录） ----------
                    if (registerMode || mode == 0) {
                        OutlinedTextField(
                            value = password,
                            onValueChange = { password = it },
                            label = { Text("密码") },
                            singleLine = true,
                            visualTransformation = if (passwordVisible) {
                                VisualTransformation.None
                            } else {
                                PasswordVisualTransformation()
                            },
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Password,
                                imeAction = if (registerMode || mode == 1) ImeAction.Next else ImeAction.Done
                            ),
                            trailingIcon = {
                                TextButton(onClick = { passwordVisible = !passwordVisible }) {
                                    Text(if (passwordVisible) "隐藏" else "显示")
                                }
                            },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }

                    // ---------- 邮箱验证码（注册 或 验证码登录） ----------
                    if (registerMode || mode == 1) {
                        Column {
                            OutlinedTextField(
                                value = code,
                                onValueChange = { code = it },
                                label = { Text("邮箱验证码（6 位字母数字）") },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(
                                    // 服务端验证码是 0-9a-z 转大写，不是纯数字
                                    keyboardType = KeyboardType.Text,
                                    imeAction = ImeAction.Done
                                ),
                                modifier = Modifier.fillMaxWidth()
                            )
                            Spacer(Modifier.height(6.dp))
                            TextButton(
                                onClick = { sendEmailCode() },
                                enabled = !sending && countdown == 0 && email.contains("@"),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    when {
                                        sending -> "发送中…"
                                        countdown > 0 -> "${countdown} 秒后可重发"
                                        else -> "获取邮箱验证码"
                                    }
                                )
                            }
                        }
                    }

                    if (showAdvanced) {
                        OutlinedTextField(
                            value = baseUrl,
                            onValueChange = { baseUrl = it },
                            label = { Text("服务器地址") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Uri,
                                imeAction = ImeAction.Done
                            ),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }

                    TextButton(onClick = { showAdvanced = !showAdvanced }) {
                        Text(if (showAdvanced) "收起服务器设置" else "服务器：$baseUrl")
                    }

                    if (notice.isNotBlank()) {
                        Text(
                            notice,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }

                    if (error.isNotBlank()) {
                        Text(
                            error,
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }

                    Button(
                        onClick = {
                            loading = true
                            error = ""
                            notice = ""
                            scope.launch {
                                val url = resolvedUrl()
                                val name = username.trim()
                                val mail = email.trim()
                                val result = withContext(Dispatchers.IO) {
                                    runCatching {
                                        when {
                                            registerMode -> Api.register(url, name, mail, password, code.trim())
                                            mode == 1 -> Api.loginWithCode(url, code.trim())
                                            else -> Api.login(url, name, password)
                                        }
                                    }.getOrElse {
                                        Api.LoginResult(false, "网络异常：${it.message ?: "无法连接服务器"}")
                                    }
                                }
                                loading = false
                                if (result.success) {
                                    applyLogin(result, url, name.ifBlank { mail })
                                } else {
                                    error = result.message
                                }
                            }
                        },
                        enabled = !loading && when {
                            registerMode -> username.isNotBlank() && email.contains("@") &&
                                password.isNotBlank() && code.isNotBlank()
                            mode == 1 -> email.contains("@") && code.isNotBlank()
                            else -> username.isNotBlank() && password.isNotBlank()
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp)
                    ) {
                        if (loading) {
                            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        } else {
                            Text(if (registerMode) "注册并登录" else "登录")
                        }
                    }

                    TextButton(
                        onClick = {
                            registerMode = !registerMode
                            error = ""
                            notice = ""
                            code = ""
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(if (registerMode) "已有账号？返回登录" else "没有账号？注册（访客）")
                    }
                }
            }

            Spacer(Modifier.height(12.dp))
            TextButton(onClick = onSkip) { Text("暂不登录，仅使用本地文件功能") }
            Text(
                "未登录：只能查看和复制文件；登录后才能新建、粘贴、删除、打包、解压、提取安装包。\n" +
                    "「访客」与「成员」只是身份区分，登录后功能完全一致。\n" +
                    "密码仅在本次登录时发送到服务器，不会被保存在本机。",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
        }
    }
}

/** 登录方式切换按钮：选中为实心，未选中为描边（无图标，纯灰阶） */
@Composable
private fun ModeButton(
    text: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    if (selected) {
        Button(onClick = onClick, modifier = modifier) { Text(text) }
    } else {
        OutlinedButton(onClick = onClick, modifier = modifier) { Text(text) }
    }
}
