package top.stcwork.filemanager.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// 灰阶头像底色：与整体灰色主题保持一致，不再使用彩色
private val AvatarPalette = listOf(
    Color(0xFF7A7A7A),
    Color(0xFF8E8E8E),
    Color(0xFF6B6B6B),
    Color(0xFF9A9A9A),
    Color(0xFF808080),
    Color(0xFF707070)
)

/** 首字母头像：比加载真实图标省内存，列表滚动也更顺 */
@Composable
fun LetterAvatar(text: String, size: Int = 40) {
    val idx = Math.floorMod(text.hashCode(), AvatarPalette.size)
    val color = AvatarPalette[idx]
    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(color.copy(alpha = 0.22f)),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text.take(1).uppercase(),
            color = color,
            fontWeight = FontWeight.SemiBold,
            fontSize = (size * 0.42).sp
        )
    }
}

@Composable
fun SectionHeader(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 6.dp)
    )
}

/** 空列表提示：按需求「软件内不要图标」，纯文字 */
@Composable
fun EmptyHint(text: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
    }
}
