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
import top.stcwork.filemanager.ui.FilesScreen
import top.stcwork.filemanager.ui.LoginScreen
import top.stcwork.filemanager.ui.Perm
import top.stcwork.filemanager.ui.ProfileScreen
import top.stcwork.filemanager.ui.STCTheme

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

    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) {
            when (tab) {
                0 -> FilesScreen(
                    hasAccess = hasAccess,
                    onRequestAccess = requestAccess,
                    snackbar = snackbar
                )
                1 -> AppsScreen(
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
                    onRequestAccess = requestAccess,
                    hasAccess = hasAccess
                )
            }
        }

        SnackbarHost(snackbar) { Snackbar(it) }

        NavigationBar {
            NavigationBarItem(
                selected = tab == 0,
                onClick = { tab = 0 },
                icon = { Text("\uD83D\uDCC1", fontSize = 16.sp) },
                label = { Text("文件") }
            )
            NavigationBarItem(
                selected = tab == 1,
                onClick = { tab = 1 },
                icon = { Text("\uD83D\uDCE6", fontSize = 16.sp) },
                label = { Text("应用") }
            )
            NavigationBarItem(
                selected = tab == 2,
                onClick = { tab = 2 },
                icon = { Text("\uD83D\uDC64", fontSize = 16.sp) },
                label = { Text("我的") }
            )
        }
    }
}
