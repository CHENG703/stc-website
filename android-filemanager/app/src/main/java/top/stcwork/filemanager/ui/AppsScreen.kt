package top.stcwork.filemanager.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.stcwork.filemanager.fs.Apks
import top.stcwork.filemanager.fs.Fs
import top.stcwork.filemanager.util.Fmt
import java.io.File

/** 应用列表：查看已安装应用并「提取安装包」到 Download/提取的安装包 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppsScreen(
    snackbar: SnackbarHostState,
    hasAccess: Boolean,
    onRequestAccess: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var includeSystem by remember { mutableStateOf(false) }
    var apps by remember { mutableStateOf<List<Apks.Entry>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf<BusyState?>(null) }
    var detail by remember { mutableStateOf<Apks.Entry?>(null) }
    var menuOpen by remember { mutableStateOf(false) }
    var searchOpen by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var confirmAll by remember { mutableStateOf(false) }

    val exportDir = remember { File(Fs.storageRoot, "Download/提取的安装包") }

    fun load() {
        loading = true
        scope.launch {
            val list = withContext(Dispatchers.IO) { Apks.list(context, includeSystem) }
            apps = list
            loading = false
        }
    }

    LaunchedEffect(includeSystem) { load() }

    val filtered = remember(apps, query) {
        if (query.isBlank()) apps
        else apps.filter {
            it.label.contains(query, ignoreCase = true) || it.packageName.contains(query, ignoreCase = true)
        }
    }

    fun export(list: List<Apks.Entry>) {
        if (list.isEmpty()) return
        val total = list.sumOf { it.bytes }
        busy = BusyState("正在提取安装包", 0, total, "")
        scope.launch {
            val progress = Fs.Progress(total) { done, _, current ->
                busy = BusyState("正在提取安装包", done, total, current)
            }
            val result = withContext(Dispatchers.IO) { Apks.export(list, exportDir, progress) }
            busy = null
            val okCount = result.first.size
            val errors = result.second
            snackbar.showSnackbar(
                if (errors.isEmpty()) {
                    "已导出 $okCount 个到 ${exportDir.absolutePath}"
                } else {
                    "导出 $okCount 个，${errors.size} 个失败：${errors.first()}"
                }
            )
        }
    }

    if (!hasAccess) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(28.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text("\uD83D\uDD12", fontSize = 40.sp)
            Spacer(Modifier.height(12.dp))
            Text("需要文件访问权限", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(8.dp))
            Text(
                "提取安装包需要把 APK 写入存储，请先授予「所有文件访问」权限。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(18.dp))
            Button(onClick = onRequestAccess, modifier = Modifier.fillMaxWidth()) { Text("立即授权") }
        }
        return
    }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                if (searchOpen) {
                    OutlinedTextField(
                        value = query,
                        onValueChange = { query = it },
                        placeholder = { Text("搜索应用名或包名") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                } else {
                    Text("应用与安装包", style = MaterialTheme.typography.titleMedium)
                }
            },
            actions = {
                IconButton(onClick = {
                    searchOpen = !searchOpen
                    if (!searchOpen) query = ""
                }) { Text("\uD83D\uDD0D", fontSize = 16.sp) }
                Box {
                    IconButton(onClick = { menuOpen = true }) { Text("⋮", fontSize = 20.sp) }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(
                            text = { Text(if (includeSystem) "只看用户应用" else "显示系统应用") },
                            onClick = { includeSystem = !includeSystem; menuOpen = false }
                        )
                        DropdownMenuItem(
                            text = { Text("重新扫描") },
                            onClick = { menuOpen = false; load() }
                        )
                        DropdownMenuItem(
                            text = { Text("导出全部用户应用") },
                            onClick = { menuOpen = false; confirmAll = true }
                        )
                    }
                }
            }
        )

        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())

        Text(
            "共 ${filtered.size} 个 · 导出到 Download/提取的安装包",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
        )

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 24.dp)
        ) {
            items(filtered, key = { it.packageName }) { app ->
                AppRow(app) {
                    detail = app
                }
                HorizontalDivider(
                    color = MaterialTheme.colorScheme.outline.copy(alpha = 0.25f),
                    thickness = 0.6.dp
                )
            }
        }
    }

    busy?.let { BusyDialog(it) }

    detail?.let { app ->
        AppDetailDialog(
            app = app,
            onCopy = { text ->
                scope.launch { snackbar.showSnackbar("已复制：$text") }
            },
            onExport = {
                detail = null
                export(listOf(app))
            },
            onDismiss = { detail = null }
        )
    }

    if (confirmAll) {
        val userApps = apps.filter { !it.isSystem }
        val totalBytes = userApps.sumOf { it.bytes }
        ConfirmDialog(
            title = "导出全部用户应用",
            message = "将导出 ${userApps.size} 个用户应用，共约 ${Fmt.size(totalBytes)}，可能耗时较久。\n目标目录：${exportDir.absolutePath}",
            confirmText = "开始导出",
            onConfirm = {
                confirmAll = false
                export(userApps)
            },
            onDismiss = { confirmAll = false }
        )
    }
}

@Composable
private fun AppRow(app: Apks.Entry, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        LetterAvatar(app.label)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                app.label,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                app.packageName,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(
                "v${app.versionName.ifBlank { "-" }}",
                style = MaterialTheme.typography.labelSmall
            )
            Text(
                Fmt.size(app.bytes) + if (app.hasSplits) " · 分包" else "",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun AppDetailDialog(
    app: Apks.Entry,
    onCopy: (String) -> Unit,
    onExport: () -> Unit,
    onDismiss: () -> Unit
) {
    val rows = listOf(
        "应用名称" to app.label,
        "包名" to app.packageName,
        "版本" to "${app.versionName}（versionCode ${app.versionCode}）",
        "类型" to if (app.isSystem) "系统应用" else "用户应用",
        "占用大小" to Fmt.size(app.bytes),
        "安装包" to app.baseApk,
        "分包数量" to if (app.hasSplits) "${app.splits.size} 个（将打包为 .apks）" else "无"
    )
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("应用信息", style = MaterialTheme.typography.titleMedium) },
        text = {
            Column(
                Modifier
                    .heightIn(max = 400.dp)
                    .verticalScroll(rememberScrollState())
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    LetterAvatar(app.label, size = 34)
                    Spacer(Modifier.width(10.dp))
                    Text(app.label, fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.height(10.dp))
                for ((k, v) in rows) {
                    Column(Modifier.padding(vertical = 3.dp)) {
                        Text(
                            k,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(v, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onExport) { Text("提取安装包") } },
        dismissButton = {
            TextButton(onClick = { onCopy(app.packageName) }) { Text("复制包名") }
        }
    )
}
