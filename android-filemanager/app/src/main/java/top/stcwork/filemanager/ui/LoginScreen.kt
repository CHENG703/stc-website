package top.stcwork.filemanager.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
 * 软件内注册的账号一律是「访客」身份（服务端强制），可被管理员在网站后台限时封禁。
 */
@Composable
fun LoginScreen(
    onSuccess: () -> Unit,
    onSkip: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var registerMode by rememberSaveable { mutableStateOf(false) }
    var username by rememberSaveable { mutableStateOf(Prefs.username) }
    var email by rememberSaveable { mutableStateOf("") }
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
                if (registerMode) "注册后为「访客」身份，登录即可使用全部功能" else "使用 STC 网站账号登录",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(20.dp))

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
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

                    if (registerMode) {
                        OutlinedTextField(
                            value = email,
                            onValueChange = { email = it },
                            label = { Text("邮箱（用于接收验证码）") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Email,
                                imeAction = ImeAction.Next
                            ),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }

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
                            imeAction = if (registerMode) ImeAction.Next else ImeAction.Done
                        ),
                        trailingIcon = {
                            TextButton(onClick = { passwordVisible = !passwordVisible }) {
                                Text(if (passwordVisible) "隐藏" else "显示")
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    )

                    if (registerMode) {
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
                                onClick = {
                                    val url = resolvedUrl()
                                    sending = true
                                    error = ""
                                    notice = ""
                                    scope.launch {
                                        val r = withContext(Dispatchers.IO) {
                                            runCatching { Api.sendCode(url, email.trim()) }
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
                                },
                                enabled = !sending && countdown == 0 && email.contains("@") && username.isNotBlank(),
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
                                val result = withContext(Dispatchers.IO) {
                                    runCatching {
                                        if (registerMode) {
                                            Api.register(url, name, email.trim(), password, code.trim())
                                        } else {
                                            Api.login(url, name, password)
                                        }
                                    }.getOrElse {
                                        Api.LoginResult(false, "网络异常：${it.message ?: "无法连接服务器"}")
                                    }
                                }
                                loading = false
                                if (result.success) {
                                    applyLogin(result, url, name)
                                } else {
                                    error = result.message
                                }
                            }
                        },
                        enabled = !loading && username.isNotBlank() && password.isNotBlank() &&
                            (!registerMode || (email.contains("@") && code.isNotBlank())),
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
                    "密码仅在本次登录时发送到服务器，不会被保存在本机。",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
        }
    }
}
