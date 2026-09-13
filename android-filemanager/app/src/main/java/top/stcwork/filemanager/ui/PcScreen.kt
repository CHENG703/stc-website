package top.stcwork.filemanager.ui

import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.OpenableColumns
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.stcwork.filemanager.data.PcClient
import top.stcwork.filemanager.data.Prefs
import top.stcwork.filemanager.fs.Fs
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 「电脑」页：局域网直连电脑端（pc-client），浏览电脑文件、上传手机文件、下载电脑文件。
 * 电脑端面板上会显示「手机访问地址」和 6 位配对码，填进来配对一次即可长期使用。
 */
@Composable
fun PcScreen(
    snackbar: SnackbarHostState,
    hasAccess: Boolean,
    onRequestAccess: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var paired by remember { mutableStateOf(Prefs.pcPaired) }
    var baseInput by remember { mutableStateOf(Prefs.pcUrl.ifBlank { "" }) }
    var codeInput by remember { mutableStateOf("") }
    var pairing by remember { mutableStateOf(false) }

    var path by remember { mutableStateOf("") }
    var parent by remember { mutableStateOf("") }
    var entries by remember { mutableStateOf<List<PcClient.Entry>>(emptyList()) }
    var roots by remember { mutableStateOf<List<PcClient.Root>>(emptyList()) }
    var allowWrite by remember { mutableStateOf(true) }
    var loading by remember { mutableStateOf(false) }

    var busy by remember { mutableStateOf<BusyState?>(null) }
    var confirmDelete by remember { mutableStateOf<PcClient.Entry?>(null) }
    var newFolder by remember { mutableStateOf(false) }
    var showRoots by remember { mutableStateOf(false) }
    var confirmUnpair by remember { mutableStateOf(false) }

    fun toast(msg: String) {
        scope.launch { snackbar.showSnackbar(msg) }
    }

    fun load(target: String) {
        if (!Prefs.pcPaired) return
        loading = true
        scope.launch {
            val r = withContext(Dispatchers.IO) { PcClient.list(Prefs.pcUrl, Prefs.pcToken, target) }
            loading = false
            val data = r.data
            if (r.ok && data != null) {
                path = data.path
                parent = data.parent
                entries = data.entries
                allowWrite = data.allowWrite
            } else {
                toast(r.message)
                if (r.needPair) {
                    Prefs.clearPcPair()
                    paired = false
                }
            }
        }
    }

    fun connect() {
        val base = PcClient.normalizeBase(baseInput)
        val code = codeInput.trim()
        if (base.isEmpty()) { toast("请填写电脑端面板上的「手机访问地址」"); return }
        if (code.length != 6) { toast("请输入 6 位配对码"); return }
        pairing = true
        scope.launch {
            val r = withContext(Dispatchers.IO) { PcClient.pair(base, code) }
            pairing = false
            if (!r.ok || r.data == null) { toast(r.message); return@launch }
            Prefs.pcUrl = base
            Prefs.pcToken = r.data
            codeInput = ""
            toast("已连接电脑：$base")
            paired = true          // 由下面的 LaunchedEffect(paired) 拉取磁盘列表和第一个目录
        }
    }

    /** 电脑 → 手机：下载到「下载/来自电脑」 */
    fun download(entry: PcClient.Entry) {
        if (!hasAccess) { onRequestAccess(); return }
        val dest = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "来自电脑")
        busy = BusyState("正在下载", 0, entry.size, entry.name)
        scope.launch {
            val progress = Fs.Progress(entry.size) { done, total, current ->
                busy = BusyState("正在下载", done, total, current)
            }
            val r = withContext(Dispatchers.IO) {
                PcClient.download(Prefs.pcUrl, Prefs.pcToken, entry.path, dest, progress)
            }
            busy = null
            toast(r.message)
            if (r.needPair) { Prefs.clearPcPair(); paired = false }
        }
    }

    fun remove(entry: PcClient.Entry) {
        busy = BusyState("正在删除", 0, 0, entry.name)
        scope.launch {
            val r = withContext(Dispatchers.IO) { PcClient.delete(Prefs.pcUrl, Prefs.pcToken, entry.path) }
            busy = null
            toast(r.message)
            load(path)
        }
    }

    fun mkdir(name: String) {
        val sep = if (path.contains("/")) "/" else "\\"
        val target = path + (if (path.endsWith(sep)) "" else sep) + name.trim()
        busy = BusyState("正在新建文件夹", 0, 0, name)
        scope.launch {
            val r = withContext(Dispatchers.IO) { PcClient.mkdir(Prefs.pcUrl, Prefs.pcToken, target) }
            busy = null
            toast(r.message)
            load(path)
        }
    }

    // 手机 → 电脑：系统文件选择器（可多选），直接流式上传到当前浏览的文件夹
    val picker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        if (!allowWrite) { toast("电脑端当前是只读模式，无法上传"); return@rememberLauncherForActivityResult }
        val sizes = uris.map { mediaSize(context, it) }
        val total = sizes.sum()
        var doneBase = 0L
        val dir = path
        busy = BusyState("正在上传到电脑", 0, total, "")
        scope.launch {
            var okCount = 0
            val fails = ArrayList<String>()
            uris.forEachIndexed { index, uri ->
                val name = mediaName(context, uri)
                val size = sizes[index]
                val base = doneBase
                val progress = Fs.Progress(total) { done, all, current ->
                    busy = BusyState("正在上传到电脑", base + done, all, current)
                }
                val stream = withContext(Dispatchers.IO) {
                    runCatching { context.contentResolver.openInputStream(uri) }.getOrNull()
                }
                if (stream == null) {
                    fails += name
                    doneBase += size
                    return@forEachIndexed
                }
                val r = withContext(Dispatchers.IO) {
                    PcClient.upload(Prefs.pcUrl, Prefs.pcToken, dir, name, stream, size, progress)
                }
                if (r.ok) okCount++ else fails += "$name（${r.message}）"
                doneBase += size
            }
            busy = null
            if (fails.isEmpty()) toast("已上传 $okCount 个文件到电脑")
            else toast("上传完成 $okCount 个，${fails.size} 个失败：${fails.first()}")
            load(dir)
        }
    }

    LaunchedEffect(paired) {
        if (paired) {
            val rs = withContext(Dispatchers.IO) { PcClient.roots(Prefs.pcUrl, Prefs.pcToken) }
            if (rs.ok) roots = rs.data ?: emptyList()
            load("")
        }
    }

    BackHandler(enabled = paired && parent.isNotBlank()) { load(parent) }

    if (!paired) {
        PairView(
            base = baseInput,
            code = codeInput,
            pairing = pairing,
            onBase = { baseInput = it },
            onCode = { codeInput = it.filter { c -> c.isDigit() }.take(6) },
            onConnect = { connect() }
        )
    } else {
        Column(Modifier.fillMaxSize()) {
            // 顶部：地址 + 操作
            Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 6.dp)) {
                Text(
                    "已连接 " + Prefs.pcUrl,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    path.ifBlank { "浏览电脑文件" } + (if (allowWrite) "" else "（电脑端只读）"),
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { if (parent.isNotBlank()) load(parent) else toast("已经在最顶层了") }) { Text("上级") }
                    TextButton(onClick = { load(path) }) { Text(if (loading) "刷新中…" else "刷新") }
                    TextButton(onClick = { if (roots.isEmpty()) toast("没取到磁盘列表，点刷新试试") else showRoots = true }) { Text("切换磁盘") }
                    TextButton(onClick = { confirmUnpair = true }) { Text("断开") }
                }
                HorizontalDivider()
            }

            if (!hasAccess) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { onRequestAccess() }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        "还没拿到存储权限：下载到手机需要一个权限，点这里开启",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.weight(1f)
                    )
                    Text("去开启")
                }
                HorizontalDivider()
            }

            Box(Modifier.weight(1f)) {
                when {
                    entries.isEmpty() && loading -> EmptyHint("正在读取电脑上的文件…")
                    entries.isEmpty() -> EmptyHint("这个文件夹是空的\n点下面的「上传手机文件」把手机里的文件传上来")
                    else -> LazyColumn(Modifier.fillMaxSize()) {
                        items(entries, key = { it.path }) { e ->
                            EntryRow(
                                entry = e,
                                onOpen = { if (e.dir) load(e.path) else download(e) },
                                onDownload = { download(e) },
                                onDelete = { confirmDelete = e }
                            )
                        }
                    }
                }
            }

            HorizontalDivider()
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = {
                        if (!allowWrite) toast("电脑端当前是只读模式")
                        else picker.launch(arrayOf("*/*"))
                    },
                    modifier = Modifier.weight(1f)
                ) { Text("上传手机文件") }
                OutlinedButton(
                    onClick = {
                        if (!allowWrite) toast("电脑端当前是只读模式")
                        else newFolder = true
                    }
                ) { Text("新建文件夹") }
            }
        }
    }

    busy?.let { BusyDialog(it) }

    confirmDelete?.let { e ->
        ConfirmDialog(
            title = "删除电脑上的文件",
            message = "确定删除「${e.name}」？删除后在电脑的回收站里找不到，无法恢复。",
            confirmText = "删除",
            onConfirm = {
                confirmDelete = null
                remove(e)
            },
            onDismiss = { confirmDelete = null }
        )
    }

    if (newFolder) {
        InputDialog(
            title = "在电脑上新建文件夹",
            label = "文件夹名称",
            onConfirm = { value ->
                newFolder = false
                if (value.isNotBlank()) mkdir(value)
            },
            onDismiss = { newFolder = false }
        )
    }

    if (showRoots) {
        AlertDialog(
            onDismissRequest = { showRoots = false },
            confirmButton = { TextButton(onClick = { showRoots = false }) { Text("关闭") } },
            title = { Text("选择磁盘 / 目录") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    roots.forEach { r ->
                        Text(
                            r.label,
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    showRoots = false
                                    load(r.path)
                                }
                                .padding(vertical = 12.dp)
                        )
                    }
                }
            }
        )
    }

    if (confirmUnpair) {
        ConfirmDialog(
            title = "断开与电脑的连接",
            message = "断开后需要重新输入配对码才能连接。电脑上的文件不会受影响。",
            confirmText = "断开",
            onConfirm = {
                confirmUnpair = false
                scope.launch {
                    withContext(Dispatchers.IO) { PcClient.unpair(Prefs.pcUrl, Prefs.pcToken) }
                    Prefs.clearPcPair()
                    paired = false
                    entries = emptyList()
                    path = ""
                    parent = ""
                    toast("已断开，可以关闭电脑端的传输记录了")
                }
            },
            onDismiss = { confirmUnpair = false }
        )
    }
}

/** 未配对时：填地址 + 配对码 */
@Composable
private fun PairView(
    base: String,
    code: String,
    pairing: Boolean,
    onBase: (String) -> Unit,
    onCode: (String) -> Unit,
    onConnect: () -> Unit
) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp)
    ) {
        Text("手机 ⇄ 电脑 互传", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(6.dp))
        Text(
            "先在电脑上运行「电脑端」程序（pc-client/start.cmd），电脑端面板上会显示：\n" +
                "① 手机访问地址（形如 192.168.1.5:8765）\n" +
                "② 6 位配对码\n" +
                "手机和电脑要在同一个 WiFi 下。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.height(18.dp))

        OutlinedTextField(
            value = base,
            onValueChange = onBase,
            label = { Text("电脑地址（IP:端口）") },
            placeholder = { Text("192.168.1.5:8765") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = code,
            onValueChange = onCode,
            label = { Text("6 位配对码") },
            placeholder = { Text("000000") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            textStyle = MaterialTheme.typography.headlineSmall.copy(fontFamily = FontFamily.Monospace)
        )
        Spacer(Modifier.height(18.dp))
        Button(onClick = onConnect, enabled = !pairing, modifier = Modifier.fillMaxWidth()) {
            Text(if (pairing) "正在连接…" else "连接电脑")
        }
        Spacer(Modifier.height(18.dp))
        Text(
            "连上以后可以：浏览电脑上的文件夹、把电脑文件下载到手机（保存在「下载/来自电脑」）、" +
                "把手机里的文件上传到电脑当前打开的这个文件夹。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/** 文件行：目录点击进入，文件点击下载，右侧可删除 */
@Composable
private fun EntryRow(
    entry: PcClient.Entry,
    onOpen: () -> Unit,
    onDownload: () -> Unit,
    onDelete: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onOpen() }
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        LetterAvatar(if (entry.dir) "文件夹" else extLabel(entry.name), size = 40)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                entry.name,
                style = MaterialTheme.typography.bodyLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                if (entry.dir) "文件夹" else sizeText(entry.size) + " · " + timeText(entry.mtime),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        if (entry.dir) {
            Text("进入", style = MaterialTheme.typography.labelLarge)
        } else {
            Text(
                "下载",
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier
                    .clickable { onDownload() }
                    .padding(horizontal = 10.dp, vertical = 6.dp)
            )
        }
        Text(
            "删除",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier
                .clickable { onDelete() }
                .padding(start = 6.dp, end = 4.dp, top = 6.dp, bottom = 6.dp)
        )
    }
    HorizontalDivider()
}

// ------------------------------------------------------------------ 小工具

private fun extLabel(name: String): String {
    val dot = name.lastIndexOf('.')
    if (dot <= 0 || dot == name.length - 1) return "文件"
    val ext = name.substring(dot + 1).uppercase(Locale.ROOT)
    return if (ext.length in 1..4) ext else "文件"
}

private fun sizeText(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    var v = bytes.toDouble()
    var i = 0
    while (v >= 1024 && i < units.size - 1) { v /= 1024; i++ }
    return if (i == 0) "${bytes} B" else String.format(Locale.ROOT, "%.2f %s", v, units[i])
}

private fun timeText(ms: Long): String {
    if (ms <= 0) return "-"
    return SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.ROOT).format(Date(ms))
}

private fun mediaName(context: Context, uri: Uri): String {
    var name = uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() } ?: "手机文件"
    runCatching {
        context.contentResolver.query(uri, null, null, null, null)?.use { c ->
            val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (idx >= 0 && c.moveToFirst()) {
                val v = c.getString(idx)
                if (!v.isNullOrBlank()) name = v
            }
        }
    }
    return name
}

private fun mediaSize(context: Context, uri: Uri): Long {
    var size = 0L
    runCatching {
        context.contentResolver.query(uri, null, null, null, null)?.use { c ->
            val idx = c.getColumnIndex(OpenableColumns.SIZE)
            if (idx >= 0 && c.moveToFirst() && !c.isNull(idx)) size = c.getLong(idx)
        }
    }
    return size
}
