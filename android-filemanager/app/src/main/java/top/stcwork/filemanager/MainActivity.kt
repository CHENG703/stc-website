package top.stcwork.filemanager

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.stcwork.filemanager.data.Api
import top.stcwork.filemanager.data.Prefs
import top.stcwork.filemanager.data.Session
import top.stcwork.filemanager.fs.OpenWith
import top.stcwork.filemanager.ui.AppsScreen
import top.stcwork.filemanager.ui.EditorScreen
import top.stcwork.filemanager.ui.FilesScreen
import top.stcwork.filemanager.ui.LoginScreen
import top.stcwork.filemanager.ui.PcScreen
import top.stcwork.filemanager.ui.Perm
import top.stcwork.filemanager.ui.PhoneScreen
import top.stcwork.filemanager.ui.ProfileScreen
import top.stcwork.filemanager.ui.STCTheme
import top.stcwork.filemanager.util.Hardening
import java.io.File

class MainActivity : ComponentActivity() {
    /** 前台会话轮询：管理员封禁账号后，App 最多 1 分钟内自动退出登录 */
    private var sessionPoll: Job? = null

    /** 外部（QQ/微信/浏览器等）用「其它应用打开」送进来的文件 */
    private val incomingUri = MutableStateFlow<Uri?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIncoming(intent)
        // 加固：改包 / 正式包被改成可调试 → 直接拦下，不进主界面
        val integrity = Hardening.check(this)
        setContent {
            STCTheme {
                if (integrity.blocked) {
                    BlockedScreen(integrity.reason)
                    return@STCTheme
                }
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val uri by incomingUri.collectAsState()
                    RootScreen(openUri = uri)
                }
            }
        }
    }

    /** 应用已经在后台时，用「其它应用打开」会走这里而不是 onCreate */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIncoming(intent)
    }

    private fun handleIncoming(i: Intent?) {
        if (i?.action == Intent.ACTION_VIEW) incomingUri.value = i.data
    }

    /** 回到前台立刻校验一次会话（封禁即时生效） */
    override fun onResume() {
        super.onResume()
        checkSessionNow()
    }

    /** 可见期间每 30 秒校验一次；不可见就停掉，避免后台耗电 */
    override fun onStart() {
        super.onStart()
        sessionPoll?.cancel()
        sessionPoll = lifecycleScope.launch(Dispatchers.IO) {
            while (isActive) {
                delay(30_000)
                val token = runCatching { Prefs.token }.getOrDefault("")
                // 未登录（含被踢出后 / 只读模式）不校验：没有 token 时 403「请先登录」不能当成封禁
                if (token.isBlank()) continue
                runCatching { Api.checkSession(Prefs.baseUrl, token) }
            }
        }
    }

    override fun onStop() {
        sessionPoll?.cancel()
        sessionPoll = null
        super.onStop()
    }

    private fun checkSessionNow() {
        val token = runCatching { Prefs.token }.getOrDefault("")
        if (token.isBlank()) return
        lifecycleScope.launch(Dispatchers.IO) {
            runCatching { Api.checkSession(Prefs.baseUrl, token) }
        }
    }
}

@Composable
fun RootScreen(openUri: Uri?) {
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }

    var loggedIn by remember { mutableStateOf(Prefs.loggedIn) }
    var skipped by remember { mutableStateOf(Prefs.skipLogin) }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var hasAccess by remember { mutableStateOf(Perm.hasStorageAccess(context)) }
    // 文本编辑器：非空时全屏打开，盖住底部导航
    var editing by remember { mutableStateOf<File?>(null) }
    // 被服务端踢出时在登录页顶部显示的提示（封禁原因 / 解封时间）
    var loginNotice by remember { mutableStateOf("") }
    // 从 QQ / 微信 等「用其它应用打开」送进来的文件：跳到它所在文件夹并选中
    var focusFile by remember { mutableStateOf<File?>(null) }

    // 外部送进来的 Uri → 真实文件 → 定位
    LaunchedEffect(openUri) {
        val uri = openUri ?: return@LaunchedEffect
        val file = withContext(Dispatchers.IO) { OpenWith.resolve(context, uri) }
        if (file != null) {
            focusFile = file
            tab = 0
            snackbar.showSnackbar("已定位到「${file.name}」")
        } else {
            snackbar.showSnackbar("没能定位这个文件的位置")
        }
    }

    // 账号被封禁 / token 失效：服务端一判定，立刻清空本地会话并退回登录页
    LaunchedEffect(Session.kicked) {
        if (!Session.kicked) return@LaunchedEffect
        loginNotice = Session.message.ifBlank { "登录状态已失效，请重新登录" }
        Prefs.clearSession()
        loggedIn = false
        skipped = false
        tab = 0
        editing = null
        Session.consume()
    }

    // 进入「我的」页时顺手校验一次，不用等下一次轮询
    LaunchedEffect(tab, loggedIn) {
        if (tab != 4 || !loggedIn) return@LaunchedEffect
        val token = Prefs.token
        if (token.isBlank()) return@LaunchedEffect
        runCatching { withContext(Dispatchers.IO) { Api.checkSession(Prefs.baseUrl, token) } }
    }

    val settingsLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { hasAccess = Perm.hasStorageAccess(context) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { hasAccess = Perm.hasStorageAccess(context) }

    val requestAccess: () -> Unit = {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val launched = runCatching {
                settingsLauncher.launch(Perm.allFilesIntent(context))
            }.isSuccess
            if (!launched) Perm.startAllFilesSettings(context)
        } else {
            permissionLauncher.launch(Perm.legacyStoragePermissions)
        }
    }

    // 首次进入自动申请权限：Android 11+ 直接打开「所有文件访问」设置页
    LaunchedEffect(Unit) {
        if (!Perm.hasStorageAccess(context)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                runCatching { settingsLauncher.launch(Perm.allFilesIntent(context)) }
            } else {
                permissionLauncher.launch(Perm.legacyStoragePermissions)
            }
        }
    }

    if (!loggedIn && !skipped) {
        LoginScreen(
            noticeText = loginNotice,
            onSuccess = {
                loginNotice = ""
                loggedIn = true
            },
            onSkip = {
                loginNotice = ""
                Prefs.skipLogin = true
                skipped = true
            }
        )
        return
    }

    val editingTarget = editing
    if (editingTarget != null) {
        EditorScreen(
            file = editingTarget,
            onClose = { editing = null },
            snackbar = snackbar
        )
        return
    }

    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) {
            when (tab) {
                0 -> FilesScreen(
                    hasAccess = hasAccess,
                    onRequestAccess = requestAccess,
                    snackbar = snackbar,
                    onOpenText = { editing = it },
                    focusFile = focusFile
                )
                1 -> AppsScreen(
                    snackbar = snackbar,
                    hasAccess = hasAccess,
                    onRequestAccess = requestAccess
                )
                2 -> PcScreen(
                    snackbar = snackbar,
                    hasAccess = hasAccess,
                    onRequestAccess = requestAccess
                )
                3 -> PhoneScreen(
                    snackbar = snackbar,
                    hasAccess = hasAccess,
                    onRequestAccess = requestAccess
                )
                else -> ProfileScreen(
                    onLogout = {
                        Prefs.clearSession()
                        loggedIn = false
                        tab = 0
                    },
                    // 从「我的」点登录：清掉「跳过登录」标记，回到登录页
                    onLogin = {
                        Prefs.skipLogin = false
                        loggedIn = false
                        skipped = false
                    },
                    onRequestAccess = requestAccess,
                    hasAccess = hasAccess
                )
            }
        }

        SnackbarHost(snackbar) { Snackbar(it) }

        // 按需求「软件内不要图标」：底部导航仅保留文字
        NavigationBar {
            NavigationBarItem(
                selected = tab == 0,
                onClick = { tab = 0 },
                icon = {},
                label = { Text("文件") }
            )
            NavigationBarItem(
                selected = tab == 1,
                onClick = { tab = 1 },
                icon = {},
                label = { Text("应用") }
            )
            NavigationBarItem(
                selected = tab == 2,
                onClick = { tab = 2 },
                icon = {},
                label = { Text("电脑") }
            )
            NavigationBarItem(
                selected = tab == 3,
                onClick = { tab = 3 },
                icon = {},
                label = { Text("手机") }
            )
            NavigationBarItem(
                selected = tab == 4,
                onClick = { tab = 4 },
                icon = {},
                label = { Text("我的") }
            )
        }
    }
}

/** 加固：完整性校验失败时的占位页——不给任何功能入口 */
@Composable
private fun BlockedScreen(reason: String) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("STC 文件管理器", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(18.dp))
            Text(reason, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
            Text(
                "请从官方渠道重新安装本应用。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
        }
    }
}
