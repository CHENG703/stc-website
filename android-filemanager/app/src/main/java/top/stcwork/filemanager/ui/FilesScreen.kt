package top.stcwork.filemanager.ui

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
import top.stcwork.filemanager.fs.FileClipboard
import top.stcwork.filemanager.fs.Fs
import top.stcwork.filemanager.fs.ZipOps
import top.stcwork.filemanager.util.Fmt
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

enum class SortMode(val label: String) {
    NAME("名称"), SIZE("大小"), TIME("时间")
}

private enum class FileAction {
    COPY, CUT, RENAME, ZIP, UNZIP, DELETE, DETAILS, INSTALL, OPEN_WITH, SHARE
}

private val ZIP_EXTS = setOf("zip", "jar", "apks", "xapk")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilesScreen(
    hasAccess: Boolean,
    onRequestAccess: () -> Unit,
    snackbar: SnackbarHostState
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var currentDir by remember { mutableStateOf(Fs.storageRoot) }
    var entries by remember { mutableStateOf<List<File>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var showHidden by remember { mutableStateOf(false) }
    var sortMode by remember { mutableStateOf(SortMode.NAME) }
    var selection by remember { mutableStateOf<Set<String>>(emptySet()) }
    var busy by remember { mutableStateOf<BusyState?>(null) }
    var details by remember { mutableStateOf<Fs.Details?>(null) }
    var renaming by remember { mutableStateOf<File?>(null) }
    var newFolder by remember { mutableStateOf(false) }
    var pendingDelete by remember { mutableStateOf<List<File>>(emptyList()) }
    var sortMenu by remember { mutableStateOf(false) }
    var overflow by remember { mutableStateOf(false) }
    var lastExport by remember { mutableStateOf("") }
    var clipboardTick by remember { mutableIntStateOf(0) }

    val clipCount = remember(clipboardTick) { FileClipboard.count }
    val clipIsCut = remember(clipboardTick) { FileClipboard.isCut }
    val isRoot = currentDir.absolutePath == Fs.storageRoot.absolutePath

    fun toast(msg: String) {
        scope.launch { snackbar.showSnackbar(msg) }
    }

    fun bumpClipboard() {
        clipboardTick++
    }

    fun refresh() {
        loading = true
        scope.launch {
            val list = withContext(Dispatchers.IO) {
                val raw = Fs.list(currentDir, showHidden)
                when (sortMode) {
                    SortMode.NAME -> raw
                    SortMode.SIZE -> raw.sortedWith(
                        compareByDescending<File> { it.isDirectory }
                            .thenByDescending { if (it.isDirectory) 0L else it.length() }
                    )
                    SortMode.TIME -> raw.sortedWith(
                        compareByDescending<File> { it.isDirectory }
                            .thenByDescending { it.lastModified() }
                    )
                }
            }
            entries = list
            loading = false
        }
    }

    LaunchedEffect(currentDir, showHidden, sortMode) { refresh() }

    BackHandler(enabled = selection.isNotEmpty() || !isRoot) {
        if (selection.isNotEmpty()) {
            selection = emptySet()
        } else {
            currentDir = currentDir.parentFile ?: Fs.storageRoot
        }
    }

    /** 通用耗时任务：跑在 IO 线程并展示进度 */
    fun runTask(title: String, total: Long, block: (Fs.Progress) -> List<String>) {
        busy = BusyState(title, 0, total, "")
        scope.launch {
            val lastTitle = title
            val progress = Fs.Progress(total) { done, _, current ->
                busy = BusyState(lastTitle, done, total, current)
            }
            val errors = withContext(Dispatchers.IO) { block(progress) }
            busy = null
            bumpClipboard() // 粘贴/移动成功后剪贴板会被清空，需要刷新 FAB
            if (errors.isEmpty()) toast("$title 完成") else toast("$title 完成，${errors.size} 项失败：${errors.first()}")
            refresh()
        }
    }

    fun pasteHere() {
        val src = FileClipboard.sources
        if (src.isEmpty()) return
        val cut = FileClipboard.isCut
        runTask(if (cut) "正在移动" else "正在复制", src.fold(0L) { acc, f -> acc + Fs.totalBytes(f) }) { progress ->
            val errors = if (cut) Fs.moveInto(src, currentDir, progress) else Fs.copyInto(src, currentDir, progress)
            if (errors.isEmpty()) {
                FileClipboard.clear()
            }
            errors
        }
    }

    fun zipFiles(files: List<File>) {
        if (files.isEmpty()) return
        val name = if (files.size == 1) {
            files[0].name + ".zip"
        } else {
            "打包_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date()) + ".zip"
        }
        val target = Fs.uniqueTarget(currentDir, name)
        runTask("正在打包", files.fold(0L) { acc, f -> acc + Fs.totalBytes(f) }) { progress ->
            ZipOps.zip(files, target, progress).fold(
                onSuccess = { emptyList<String>() },
                onFailure = { listOf(it.message ?: "打包失败") }
            )
        }
    }

    fun unzipFile(zip: File) {
        val dest = Fs.uniqueTarget(currentDir, ZipOps.baseName(zip))
        runTask("正在解压", zip.length()) { progress ->
            ZipOps.unzip(zip, dest, progress).fold(
                onSuccess = { emptyList<String>() },
                onFailure = { listOf(it.message ?: "解压失败") }
            )
        }
    }

    fun deleteFiles(files: List<File>) {
        if (files.isEmpty()) return
        busy = BusyState("正在删除", 0, 0, "")
        scope.launch {
            val errors = withContext(Dispatchers.IO) { Fs.deleteAll(files) }
            busy = null
            selection = emptySet()
            if (errors.isEmpty()) toast("已删除 ${files.size} 项") else toast("${errors.size} 项失败：${errors.first()}")
            refresh()
        }
    }

    fun loadDetails(file: File) {
        busy = BusyState("正在读取信息", 0, 0, "")
        scope.launch {
            val d = withContext(Dispatchers.IO) { Fs.details(file) }
            busy = null
            details = d
        }
    }

    fun installApk(file: File) {
        if (!Perm.canInstall(context)) {
            toast("请先允许「安装未知应用」，授权后重试")
            Perm.startUnknownSourcesSettings(context)
            return
        }
        try {
            context.startActivity(Apks.installIntent(context, file))
        } catch (e: Exception) {
            toast("无法调起安装器：${e.message ?: "未知错误"}")
        }
    }

    fun openWith(file: File) {
        try {
            val uri = androidx.core.content.FileProvider.getUriForFile(
                context, context.packageName + ".fileprovider", file
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, Fmt.mime(file))
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(Intent.createChooser(intent, "打开方式"))
        } catch (e: Exception) {
            toast("没有可打开此文件的应用")
        }
    }

    fun shareFile(file: File) {
        try {
            val uri = androidx.core.content.FileProvider.getUriForFile(
                context, context.packageName + ".fileprovider", file
            )
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = Fmt.mime(file)
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(Intent.createChooser(intent, "分享"))
        } catch (e: Exception) {
            toast("分享失败：${e.message ?: "未知错误"}")
        }
    }

    fun handleAction(action: FileAction, target: File) {
        when (action) {
            FileAction.COPY -> {
                FileClipboard.set(listOf(target), false)
                bumpClipboard()
                toast("已复制：${target.name}")
            }
            FileAction.CUT -> {
                FileClipboard.set(listOf(target), true)
                bumpClipboard()
                toast("已剪切：${target.name}")
            }
            FileAction.RENAME -> renaming = target
            FileAction.ZIP -> zipFiles(listOf(target))
            FileAction.UNZIP -> unzipFile(target)
            FileAction.DELETE -> pendingDelete = listOf(target)
            FileAction.DETAILS -> loadDetails(target)
            FileAction.INSTALL -> installApk(target)
            FileAction.OPEN_WITH -> openWith(target)
            FileAction.SHARE -> shareFile(target)
        }
    }

    // ---------------- 无权限：直接引导授权 ----------------
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
                "Android 11 及以上需要「所有文件访问」权限才能管理整机文件。\n点击下方按钮，在系统设置中打开「允许管理所有文件」。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(18.dp))
            androidx.compose.material3.Button(
                onClick = onRequestAccess,
                modifier = Modifier.fillMaxWidth()
            ) { Text("立即授权") }
        }
        return
    }

    val selectedFiles = entries.filter { selection.contains(it.absolutePath) }
    val shortcuts = remember(currentDir, clipboardTick) {
        if (isRoot) Fs.shortcuts() else emptyList()
    }

    Column(Modifier.fillMaxSize()) {
        if (selection.isEmpty()) {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            currentDir.name.ifBlank { "内部存储" },
                            style = MaterialTheme.typography.titleMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            currentDir.absolutePath,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                },
                navigationIcon = {
                    if (!isRoot) {
                        IconButton(onClick = {
                            currentDir = currentDir.parentFile ?: Fs.storageRoot
                            selection = emptySet()
                        }) { Text("←", fontSize = 22.sp) }
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = { sortMenu = true }) { Text("⇅", fontSize = 18.sp) }
                        DropdownMenu(expanded = sortMenu, onDismissRequest = { sortMenu = false }) {
                            for (m in SortMode.entries) {
                                DropdownMenuItem(
                                    text = { Text("按${m.label}排序") },
                                    onClick = { sortMode = m; sortMenu = false }
                                )
                            }
                        }
                    }
                    Box {
                        IconButton(onClick = { overflow = true }) { Text("⋮", fontSize = 20.sp) }
                        DropdownMenu(expanded = overflow, onDismissRequest = { overflow = false }) {
                            DropdownMenuItem(
                                text = { Text("新建文件夹") },
                                onClick = { overflow = false; newFolder = true }
                            )
                            DropdownMenuItem(
                                text = { Text(if (showHidden) "隐藏隐藏文件" else "显示隐藏文件") },
                                onClick = { overflow = false; showHidden = !showHidden }
                            )
                            DropdownMenuItem(
                                text = { Text("全选") },
                                onClick = {
                                    overflow = false
                                    selection = entries.map { it.absolutePath }.toSet()
                                }
                            )
                            if (clipCount > 0) {
                                DropdownMenuItem(
                                    text = { Text("清空剪贴板（$clipCount 项）") },
                                    onClick = {
                                        overflow = false
                                        FileClipboard.clear()
                                        bumpClipboard()
                                    }
                                )
                            }
                            if (lastExport.isNotBlank()) {
                                DropdownMenuItem(
                                    text = { Text("上次复制：$lastExport") },
                                    onClick = { overflow = false },
                                    enabled = false
                                )
                            }
                        }
                    }
                }
            )
        } else {
            TopAppBar(
                title = { Text("已选 ${selection.size} 项") },
                navigationIcon = {
                    IconButton(onClick = { selection = emptySet() }) { Text("✕", fontSize = 18.sp) }
                },
                actions = {
                    TextButton(onClick = { selection = entries.map { it.absolutePath }.toSet() }) {
                        Text("全选")
                    }
                }
            )
        }

        if (loading) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
        }

        Box(Modifier.weight(1f)) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 100.dp)
            ) {
                if (isRoot && shortcuts.isNotEmpty()) {
                    item(key = "hdr_shortcuts") { SectionHeader("常用位置") }
                    items(shortcuts, key = { "sc_" + it.second.absolutePath }) { pair ->
                        ShortcutRow(pair.first, pair.second.absolutePath) {
                            currentDir = pair.second
                            selection = emptySet()
                        }
                    }
                    item(key = "hdr_files") { SectionHeader("内部存储") }
                }

                if (entries.isEmpty() && !loading) {
                    item(key = "empty") { EmptyHint("此文件夹是空的，或者没有读取权限") }
                }

                items(entries, key = { it.absolutePath }) { file ->
                    val selected = selection.contains(file.absolutePath)
                    FileRow(
                        file = file,
                        selected = selected,
                        selectionMode = selection.isNotEmpty(),
                        onClick = {
                            when {
                                selection.isNotEmpty() -> {
                                    selection = if (selected) {
                                        selection - file.absolutePath
                                    } else {
                                        selection + file.absolutePath
                                    }
                                }
                                file.isDirectory -> {
                                    currentDir = file
                                    selection = emptySet()
                                }
                                file.extension.lowercase() == "apk" -> installApk(file)
                                else -> loadDetails(file)
                            }
                        },
                        onLongClick = {
                            selection = if (selected) {
                                selection - file.absolutePath
                            } else {
                                selection + file.absolutePath
                            }
                        },
                        onAction = { action -> handleAction(action, file) }
                    )
                    HorizontalDivider(
                        color = MaterialTheme.colorScheme.outline.copy(alpha = 0.25f),
                        thickness = 0.6.dp
                    )
                }
            }

            Column(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(16.dp),
                horizontalAlignment = Alignment.End
            ) {
                if (clipCount > 0) {
                    ExtendedFloatingActionButton(
                        onClick = { pasteHere() },
                        text = { Text(if (clipIsCut) "移动到此处 ($clipCount)" else "粘贴 ($clipCount)") },
                        icon = { Text("\uD83D\uDCCB") }
                    )
                    Spacer(Modifier.height(10.dp))
                }
                FloatingActionButton(onClick = { newFolder = true }) {
                    Text("＋", fontSize = 24.sp)
                }
            }
        }

        if (selection.isNotEmpty()) {
            Surface(tonalElevation = 4.dp) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 6.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    BarAction("复制") {
                        FileClipboard.set(selectedFiles, false)
                        bumpClipboard()
                        selection = emptySet()
                        toast("已复制 ${selectedFiles.size} 项")
                    }
                    BarAction("剪切") {
                        FileClipboard.set(selectedFiles, true)
                        bumpClipboard()
                        selection = emptySet()
                        toast("已剪切 ${selectedFiles.size} 项")
                    }
                    BarAction("打包") {
                        val files = selectedFiles
                        selection = emptySet()
                        zipFiles(files)
                    }
                    BarAction("删除") {
                        pendingDelete = selectedFiles
                    }
                    BarAction("详情") {
                        if (selectedFiles.size == 1) loadDetails(selectedFiles.first())
                    }
                }
            }
        }
    }

    // ---------------- 对话框 ----------------
    busy?.let { BusyDialog(it) }

    pendingDelete.takeIf { it.isNotEmpty() }?.let { targets ->
        ConfirmDialog(
            title = "确认删除",
            message = "将删除 ${targets.size} 项（${targets.take(3).joinToString("、") { it.name }}" +
                (if (targets.size > 3) " 等" else "") + "），此操作不可恢复。",
            confirmText = "删除",
            onConfirm = {
                pendingDelete = emptyList()
                deleteFiles(targets)
            },
            onDismiss = { pendingDelete = emptyList() }
        )
    }

    details?.let { d ->
        DetailsDialog(
            details = d,
            onCopyPath = { path ->
                lastExport = path
                toast("已复制路径")
                copyToClipboard(context, path)
            },
            onDismiss = { details = null }
        )
    }

    renaming?.let { target ->
        InputDialog(
            title = "重命名",
            label = "新名称",
            initial = target.name,
            onConfirm = { newName ->
                renaming = null
                scope.launch {
                    val result = withContext(Dispatchers.IO) { Fs.rename(target, newName) }
                    result.fold(
                        onSuccess = { toast("已重命名为 ${it.name}") },
                        onFailure = { toast(it.message ?: "重命名失败") }
                    )
                    refresh()
                }
            },
            onDismiss = { renaming = null }
        )
    }

    if (newFolder) {
        InputDialog(
            title = "新建文件夹",
            label = "文件夹名称",
            initial = "",
            onConfirm = { name ->
                newFolder = false
                scope.launch {
                    val result = withContext(Dispatchers.IO) { Fs.mkdir(currentDir, name) }
                    result.fold(
                        onSuccess = { toast("已创建 ${it.name}") },
                        onFailure = { toast(it.message ?: "创建失败") }
                    )
                    refresh()
                }
            },
            onDismiss = { newFolder = false }
        )
    }
}

private fun copyToClipboard(context: android.content.Context, text: String) {
    try {
        val cm = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE)
            as android.content.ClipboardManager
        cm.setPrimaryClip(android.content.ClipData.newPlainText("STC", text))
    } catch (e: Exception) {
        // 忽略
    }
}

@Composable
private fun BarAction(label: String, onClick: () -> Unit) {
    TextButton(onClick = onClick) { Text(label, style = MaterialTheme.typography.labelLarge) }
}

@Composable
private fun ShortcutRow(label: String, path: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .combinedClickableCompat(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text("\uD83D\uDCCC", fontSize = 18.sp)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            Text(
                path,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.combinedClickableCompat(onClick: () -> Unit): Modifier =
    this.combinedClickable(onClick = onClick)

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
private fun FileRow(
    file: File,
    selected: Boolean,
    selectionMode: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    onAction: (FileAction) -> Unit
) {
    var menu by remember { mutableStateOf(false) }

    val subtitle = when {
        file.isDirectory -> "${Fs.childCount(file)} 项 · ${Fmt.time(file.lastModified())}"
        else -> "${Fmt.size(file.length())} · ${Fmt.time(file.lastModified())}"
    }

    Box {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .combinedClickable(onClick = onClick, onLongClick = onLongClick)
                .padding(start = 16.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (selectionMode) {
                Checkbox(checked = selected, onCheckedChange = null)
                Spacer(Modifier.width(6.dp))
            }
            Box(
                modifier = Modifier
                    .size(38.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)),
                contentAlignment = Alignment.Center
            ) {
                Text(Fmt.iconFor(file), fontSize = 19.sp)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    file.name,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    subtitle,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            if (!selectionMode) {
                IconButton(onClick = { menu = true }) { Text("⋮", fontSize = 18.sp) }
            }
        }

        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(text = { Text("复制") }, onClick = { menu = false; onAction(FileAction.COPY) })
            DropdownMenuItem(text = { Text("剪切") }, onClick = { menu = false; onAction(FileAction.CUT) })
            DropdownMenuItem(text = { Text("重命名") }, onClick = { menu = false; onAction(FileAction.RENAME) })
            DropdownMenuItem(text = { Text("详细信息") }, onClick = { menu = false; onAction(FileAction.DETAILS) })
            DropdownMenuItem(
                text = { Text(if (file.isDirectory) "打包为 ZIP" else "压缩为 ZIP") },
                onClick = { menu = false; onAction(FileAction.ZIP) }
            )
            if (!file.isDirectory && file.extension.lowercase(Locale.US) in ZIP_EXTS) {
                DropdownMenuItem(
                    text = { Text("解压到此处") },
                    onClick = { menu = false; onAction(FileAction.UNZIP) }
                )
            }
            if (!file.isDirectory && file.extension.lowercase(Locale.US) == "apk") {
                DropdownMenuItem(
                    text = { Text("安装") },
                    onClick = { menu = false; onAction(FileAction.INSTALL) }
                )
            }
            if (!file.isDirectory) {
                DropdownMenuItem(
                    text = { Text("用其他应用打开") },
                    onClick = { menu = false; onAction(FileAction.OPEN_WITH) }
                )
                DropdownMenuItem(
                    text = { Text("分享") },
                    onClick = { menu = false; onAction(FileAction.SHARE) }
                )
            }
            DropdownMenuItem(
                text = { Text("删除", color = MaterialTheme.colorScheme.error) },
                onClick = { menu = false; onAction(FileAction.DELETE) }
            )
        }
    }
}
