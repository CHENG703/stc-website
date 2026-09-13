package top.stcwork.filemanager

import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.sp
import top.stcwork.filemanager.data.Prefs
import top.stcwork.filemanager.ui.AppsScreen
import top.stcwork.filemanager.ui.EditorScreen
import top.stcwork.filemanager.ui.FilesScreen
import top.stcwork.filemanager.ui.LoginScreen
import top.stcwork.filemanager.ui.PcScreen
import top.stcwork.filemanager.ui.Perm
import top.stcwork.filemanager.ui.ProfileScreen
import top.stcwork.filemanager.ui.STCTheme
import java.io.File

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            STCTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    RootScreen()
                }
            }
        }
    }
}

@Composable
fun RootScreen() {
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }

    var loggedIn by remember { mutableStateOf(Prefs.loggedIn) }
    var skipped by remember { mutableStateOf(Prefs.skipLogin) }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var hasAccess by remember { mutableStateOf(Perm.hasStorageAccess(context)) }
    // 文本编辑器：非空时全屏打开，盖住底部导航
    var editing by remember { mutableStateOf<File?>(null) }

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
            onSuccess = { loggedIn = true },
            onSkip = {
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
                    onOpenText = { editing = it }
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
                label = { Text("我的") }
            )
        }
    }
}
