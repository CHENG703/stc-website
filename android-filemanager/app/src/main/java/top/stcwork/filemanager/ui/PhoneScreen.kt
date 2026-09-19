package top.stcwork.filemanager.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.stcwork.filemanager.data.Prefs
import top.stcwork.filemanager.fs.Fs
import top.stcwork.filemanager.net.Net
import top.stcwork.filemanager.net.PhoneClient
import top.stcwork.filemanager.net.PhoneServer
import top.stcwork.filemanager.transfer.ShareHub
import top.stcwork.filemanager.transfer.ShareService
import top.stcwork.filemanager.util.Fmt
import java.io.File

/**
 * 「手机」页：两台手机之间互传文件（局域网直连，不经过服务器）。
 *
 *   发送：选文件 → 开始分享 → 把「地址 + 6 位配对码」给对方
 *   接收：填对方地址和配对码 → 勾选文件 → 接收（保存到 Download/STC互传）
 *
 * 前提是两台手机连同一个 WiFi；传输过程前台服务保活，锁屏也能继续。
 */
@Composable
fun PhoneScreen(
    snackbar: SnackbarHostState,
    hasAccess: Boolean,
    onRequestAccess: () -> Unit
) {
    var mode by remember { mutableStateOf(0) }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            ModeButton("发送给手机", mode == 0) { mode = 0 }
            ModeButton("从手机接收", mode == 1) { mode = 1 }
        }
        HorizontalDivider()
        Box(Modifier.weight(1f)) {
            if (mode == 0) SendPane(snackbar, hasAccess, onRequestAccess)
            else ReceivePane(snackbar)
        }
    }
}

@Composable
private fun ModeButton(text: String, selected: Boolean, onClick: () -> Unit) {
    val bg = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
    val fg = if (selected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
    Box(
        modifier = Modifier
            .weight(1f)
            .clip(RoundedCornerShape(12.dp))
            .background(bg)
            .clickable { onClick() }
            .padding(vertical = 10.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(text, color = fg, fontSize = 14.sp)
    }
}

@Composable
private fun LabelValue(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.width(10.dp))
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
    }
}

// ------------------------------------------------------------------ 发送

@Composable
private fun SendPane(
    snackbar: SnackbarHostState,
    hasAccess: Boolean,
    onRequestAccess: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val share by ShareHub.state.collectAsState()
    var picking by remember { mutableStateOf(false) }
    var chosen by remember { mutableStateOf<List<File>>(emptyList()) }

    val notifLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    fun toast(msg: String) {
        scope.launch { snackbar.showSnackbar(msg) }
    }

    fun startShare() {
        if (chosen.isEmpty()) {
            toast("请先选择要发送的文件")
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.POST_NOTIFICATIONS
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        ShareHub.files = chosen
        val intent = Intent(context, ShareService::class.java).setAction(ShareService.ACTION_START)
        runCatching { ContextCompat.startForegroundService(context, intent) }
            .onFailure { toast("启动失败：${it.message ?: "未知错误"}") }
    }

    fun stopShare() {
        runCatching {
            context.startService(Intent(context, ShareService::class.java).setAction(ShareService.ACTION_STOP))
        }
    }

    if (picking) {
        FilePicker(
            onDone = { chosen = it; picking = false },
            onCancel = { picking = false }
        )
        return
    }

    Column(
        Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        if (!hasAccess) {
            Text("需要「所有文件访问」权限才能选择手机里的文件")
            Button(onClick = onRequestAccess) { Text("去授权") }
            return@Column
        }

        if (!share.running) {
            Button(onClick = { picking = true }) { Text("选择要发送的文件") }
            if (chosen.isNotEmpty()) {
                val total = chosen.sumOf { it.length() }
                Text("已选 ${chosen.size} 个文件 · 共 ${Fmt.size(total)}", fontWeight = FontWeight.SemiBold)
                LazyColumn(Modifier.heightIn(max = 200.dp)) {
                    items(chosen, key = { it.absolutePath }) { f ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
                            Text(
                                "· ${f.name}",
                                style = MaterialTheme.typography.bodySmall,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f)
                            )
                            Text(
                                Fmt.size(f.length()),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                Button(onClick = { startShare() }) { Text("开始分享") }
            } else {
                EmptyHint("还没有选择文件。选好后点「开始分享」，把显示的地址和配对码告诉对方就行。")
            }
        } else {
            val ip = remember { Net.localIp() }
            Text("正在分享 ${share.count} 个文件（${Fmt.size(share.bytes)}）", fontWeight = FontWeight.SemiBold)
            LabelValue("对方要填的地址", if (ip.isBlank()) "未连接 WiFi" else "$ip:${PhoneServer.PORT}")
            Text(
                "配对码",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                share.code,
                fontSize = 36.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 10.sp
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(onClick = { ShareHub.rotateCode() }) { Text("换个配对码") }
                OutlinedButton(onClick = { stopShare() }) { Text("停止分享") }
            }
            Text(
                "对方填完地址和配对码就能看到文件；换配对码后之前的连接会失效。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (share.logs.isNotEmpty()) {
                Text("记录", style = MaterialTheme.typography.labelMedium)
                LazyColumn(Modifier.weight(1f, fill = false)) {
                    items(share.logs) { line ->
                        Text(line, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

// ------------------------------------------------------------------ 接收

@Composable
private fun ReceivePane(snackbar: SnackbarHostState) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var host by remember { mutableStateOf(Prefs.phoneHost) }
    var code by remember { mutableStateOf("") }
    var token by remember { mutableStateOf(Prefs.phoneToken) }
    var entries by remember { mutableStateOf<List<PhoneClient.Entry>>(emptyList()) }
    var selected by remember { mutableStateOf<Set<Int>>(emptySet()) }
    var connecting by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf<BusyState?>(null) }

    fun toast(msg: String) {
        scope.launch { snackbar.showSnackbar(msg) }
    }

    fun loadList() {
        scope.launch {
            val r = withContext(Dispatchers.IO) { PhoneClient.list(Prefs.phoneHost, Prefs.phoneToken) }
            if (r.ok && r.data != null) {
                entries = r.data!!
                selected = emptySet()
            } else {
                toast(r.message)
                if (r.needPair) {
                    Prefs.clearPhonePair()
                    token = ""
                    entries = emptyList()
                }
            }
        }
    }

    fun connect() {
        if (host.isBlank()) {
            toast("请填写对方显示的地址")
            return
        }
        if (code.trim().length != 6) {
            toast("配对码是 6 位数字")
            return
        }
        connecting = true
        scope.launch {
            val r = withContext(Dispatchers.IO) { PhoneClient.pair(host, code) }
            connecting = false
            if (r.ok && r.data != null) {
                Prefs.phoneHost = PhoneClient.normalizeBase(host)
                Prefs.phoneToken = r.data!!
                token = r.data!!
                code = ""
                toast(r.message)
                loadList()
            } else {
                toast(r.message)
            }
        }
    }

    fun receive() {
        val picked = entries.filter { selected.contains(it.index) }
        if (picked.isEmpty()) {
            toast("先勾选要接收的文件")
            return
        }
        val total = picked.sumOf { it.size }
        busy = BusyState("正在接收", 0, total, "")
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                val dest = File(Environment.getExternalStorageDirectory(), "Download/STC互传")
                val errors = mutableListOf<String>()
                var done = 0L
                for (e in picked) {
                    val base = done
                    val progress = Fs.Progress(e.size) { d, _, current ->
                        busy = BusyState("正在接收", base + d, total, current)
                    }
                    val r = PhoneClient.download(Prefs.phoneHost, Prefs.phoneToken, e, dest, progress)
                    if (r.ok) done += e.size else errors += "${e.name}：${r.message}"
                }
                errors to dest
            }
            val (errors, dest) = result
            busy = null
            selected = emptySet()
            if (errors.isEmpty()) toast("接收完成，已保存到 ${dest.absolutePath}")
            else toast("接收完成，${errors.size} 个失败：${errors.first()}")
        }
    }

    LaunchedEffect(token) {
        if (Prefs.phonePaired && entries.isEmpty()) loadList()
    }

    Column(
        Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        if (token.isBlank()) {
            Text("填对方「发送」页面上显示的地址和配对码")
            OutlinedTextField(
                value = host,
                onValueChange = { host = it },
                label = { Text("对方地址") },
                placeholder = { Text("例如 192.168.1.23") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = code,
                onValueChange = { code = it.filter { c -> c.isDigit() }.take(6) },
                label = { Text("配对码") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Button(onClick = { connect() }, enabled = !connecting) { Text(if (connecting) "连接中…" else "连接") }
            val myIp = remember { Net.localIp() }
            if (myIp.isNotBlank()) {
                Text(
                    "本机地址：$myIp（同一 WiFi 下才能互相找到）",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        } else {
            LabelValue("已连接", host)
            OutlinedButton(onClick = {
                Prefs.clearPhonePair()
                token = ""
                entries = emptyList()
                selected = emptySet()
            }) { Text("断开") }

            if (entries.isEmpty()) {
                EmptyHint("对方还没有分享文件，或者分享已经停止。")
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("共 ${entries.size} 个文件", fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.weight(1f))
                    OutlinedButton(onClick = {
                        selected = if (selected.size == entries.size) emptySet() else entries.map { it.index }.toSet()
                    }) { Text(if (selected.size == entries.size) "取消全选" else "全选") }
                }
                LazyColumn(Modifier.weight(1f, fill = false)) {
                    items(entries, key = { it.index }) { e ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable {
                                    selected = if (selected.contains(e.index)) selected - e.index else selected + e.index
                                }
                                .padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Checkbox(
                                checked = selected.contains(e.index),
                                onCheckedChange = { on ->
                                    selected = if (on) selected + e.index else selected - e.index
                                }
                            )
                            Spacer(Modifier.width(6.dp))
                            Column(Modifier.weight(1f)) {
                                Text(e.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(
                                    Fmt.size(e.size),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
                Button(onClick = { receive() }) { Text("接收选中的 ${selected.size} 个文件") }
                Text(
                    "保存到 Download/STC互传",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }

    busy?.let { BusyDialog(it) }
    Unit
}

// ------------------------------------------------------------------ 选文件

/**
 * 极简文件选择器：文件夹点进去，文件打勾，可以跨文件夹累计选择。
 * 只支持选文件（发文件夹请先打包）。
 */
@Composable
private fun FilePicker(onDone: (List<File>) -> Unit, onCancel: () -> Unit) {
    var dir by remember { mutableStateOf(Fs.storageRoot) }
    var items by remember { mutableStateOf<List<File>>(emptyList()) }
    val checked = remember { mutableStateListOf<String>() }

    LaunchedEffect(dir) {
        items = withContext(Dispatchers.IO) { Fs.list(dir, false) }
    }

    val isRoot = dir.absolutePath == Fs.storageRoot.absolutePath
    BackHandler {
        if (isRoot) onCancel() else dir = dir.parentFile ?: Fs.storageRoot
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                if (isRoot) "内部存储" else dir.name,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            OutlinedButton(onClick = { checked.clear() }) { Text("清空") }
            Spacer(Modifier.width(8.dp))
            Button(onClick = { onDone(checked.map { File(it) }.filter { it.isFile }) }) {
                Text("确定（${checked.size}）")
            }
        }
        HorizontalDivider()
        if (!isRoot) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable { dir = dir.parentFile ?: Fs.storageRoot }
                    .padding(horizontal = 16.dp, vertical = 10.dp)
            ) {
                Text("… 返回上级", color = MaterialTheme.colorScheme.primary)
            }
            HorizontalDivider()
        }
        LazyColumn(Modifier.weight(1f)) {
            items(items, key = { it.absolutePath }) { f ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable {
                            if (f.isDirectory) dir = f
                            else {
                                val p = f.absolutePath
                                if (checked.contains(p)) checked.remove(p) else checked.add(p)
                            }
                        }
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (!f.isDirectory) {
                        Checkbox(
                            checked = checked.contains(f.absolutePath),
                            onCheckedChange = { on ->
                                val p = f.absolutePath
                                if (on) {
                                    if (!checked.contains(p)) checked.add(p)
                                } else checked.remove(p)
                            }
                        )
                        Spacer(Modifier.width(6.dp))
                    }
                    Column(Modifier.weight(1f)) {
                        Text(
                            f.name,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            color = if (f.isDirectory) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            if (f.isDirectory) "文件夹" else Fmt.size(f.length()),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(12.dp)) {
            OutlinedButton(onClick = onCancel) { Text("取消") }
        }
    }
}
