package top.stcwork.filemanager.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.stcwork.filemanager.data.Prefs
import top.stcwork.filemanager.fs.Fs
import top.stcwork.filemanager.util.Fmt
import java.io.File

/**
 * 文本编辑器：直接读写本机文件，可编辑 txt / py / nbt / json / md ... 等。
 * nbt 属于二进制格式，这里提供的是「按文本打开」的降级方案：
 * 读取时若发现 NUL 字节会给出警告，保存前二次确认，避免误毁数据。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditorScreen(
    file: File,
    onClose: () -> Unit,
    snackbar: SnackbarHostState
) {
    val scope = rememberCoroutineScope()
    val canWrite = Prefs.canWrite

    var value by remember { mutableStateOf(TextFieldValue("")) }
    var original by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    var binarySuspect by remember { mutableStateOf(false) }
    var errorText by remember { mutableStateOf("") }
    var fileSize by remember { mutableStateOf(0L) }
    var askDiscard by remember { mutableStateOf(false) }
    var askBinarySave by remember { mutableStateOf(false) }

    val dirty = value.text != original
    val lineCount = if (value.text.isEmpty()) 1 else value.text.count { it == '\n' } + 1

    fun toast(msg: String) {
        scope.launch { snackbar.showSnackbar(msg) }
    }

    LaunchedEffect(file.absolutePath) {
        loading = true
        val result = withContext(Dispatchers.IO) { Fs.readText(file) }
        result.fold(
            onSuccess = {
                original = it.text
                value = TextFieldValue(it.text, selection = androidx.compose.ui.text.TextRange(0))
                binarySuspect = it.binarySuspect
                fileSize = it.size
                errorText = ""
            },
            onFailure = { errorText = it.message ?: "无法读取该文件" }
        )
        loading = false
    }

    fun doSave() {
        if (!canWrite) {
            toast("未登录：只读模式，无法保存")
            return
        }
        saving = true
        scope.launch {
            val result = withContext(Dispatchers.IO) { Fs.writeText(file, value.text) }
            saving = false
            result.fold(
                onSuccess = {
                    original = value.text
                    toast("已保存 ${file.name}")
                },
                onFailure = { toast(it.message ?: "保存失败") }
            )
        }
    }

    fun requestSave() {
        if (!dirty) {
            toast("没有修改")
            return
        }
        if (binarySuspect) askBinarySave = true else doSave()
    }

    BackHandler {
        if (dirty && canWrite) askDiscard = true else onClose()
    }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Column {
                    Text(
                        file.name,
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        Fmt.extLabel(file) + " · " + Fmt.size(fileSize) +
                            " · " + lineCount + " 行" + if (dirty) " · 未保存" else "",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            },
            navigationIcon = {
                TextButton(onClick = { if (dirty && canWrite) askDiscard = true else onClose() }) {
                    Text("返回")
                }
            },
            actions = {
                TextButton(onClick = { requestSave() }, enabled = canWrite && dirty && !saving) {
                    Text(if (saving) "保存中" else "保存")
                }
            }
        )

        if (!canWrite) {
            Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
                Text(
                    "未登录 · 只读模式，可查看但无法保存",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 6.dp)
                )
            }
        }

        if (binarySuspect) {
            Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
                Text(
                    "注意：该文件疑似二进制（含 NUL 字节），按文本保存可能损坏它。建议先复制一份再改。",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 6.dp)
                )
            }
        }

        if (loading) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
        }

        if (errorText.isNotBlank()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(28.dp),
                verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text("无法打开", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                Text(
                    errorText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center
                )
            }
        } else {
            OutlinedTextField(
                value = value,
                onValueChange = { if (canWrite) value = it },
                readOnly = !canWrite,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(6.dp),
                textStyle = TextStyle(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 13.sp,
                    lineHeight = 18.sp
                ),
                placeholder = { Text("文件为空，开始输入…", fontSize = 13.sp) }
            )
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 4.dp)
        ) {
            Text(
                "${value.text.length} 字符",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }

    if (askDiscard) {
        ConfirmDialog(
            title = "放弃修改？",
            message = "「${file.name}」有未保存的修改，返回将丢失。",
            confirmText = "放弃",
            onConfirm = {
                askDiscard = false
                onClose()
            },
            onDismiss = { askDiscard = false }
        )
    }

    if (askBinarySave) {
        ConfirmDialog(
            title = "确定保存？",
            message = "「${file.name}」疑似二进制文件，按文本保存可能损坏它。建议先复制一份再改。",
            confirmText = "仍然保存",
            onConfirm = {
                askBinarySave = false
                doSave()
            },
            onDismiss = { askBinarySave = false }
        )
    }
}
