package top.stcwork.filemanager.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// 主题：整体灰阶（无彩色）。用户明确要求「整体颜色是灰色」，
// 因此 primary/secondary 均为中性灰，不使用任何品牌色/紫蓝色。
// 2026-09-13 用户要求「颜色改成亮一点的淡灰色」：深色方案整体提亮成中灰，不再近黑。
private val Gray = Color(0xFF8C8C8C)
private val Graphite = Color(0xFF4A4A4A)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFE6E6E6),
    onPrimary = Color(0xFF2B2B2F),
    primaryContainer = Color(0xFF4E4E56),
    onPrimaryContainer = Color(0xFFF0F0F2),
    secondary = Color(0xFFC2C2C8),
    onSecondary = Color(0xFF2B2B2F),
    secondaryContainer = Color(0xFF4A4A52),
    onSecondaryContainer = Color(0xFFEDEDF0),
    tertiary = Color(0xFFCFCFD4),
    onTertiary = Color(0xFF2B2B2F),
    background = Color(0xFF2F2F35),
    onBackground = Color(0xFFF2F2F4),
    surface = Color(0xFF3D3D44),
    onSurface = Color(0xFFF2F2F4),
    surfaceVariant = Color(0xFF48484F),
    onSurfaceVariant = Color(0xFFC6C6CE),
    surfaceContainerHighest = Color(0xFF525259),
    outline = Color(0xFF6A6A73),
    outlineVariant = Color(0xFF5A5A62),
    error = Color(0xFFF0B0AA),
    onError = Color(0xFF3A1A18)
)

private val LightColors = lightColorScheme(
    primary = Graphite,
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFDEDEDE),
    onPrimaryContainer = Color(0xFF1A1A1A),
    secondary = Color(0xFF6E6E6E),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFE4E4E4),
    onSecondaryContainer = Color(0xFF232323),
    tertiary = Gray,
    onTertiary = Color(0xFFFFFFFF),
    background = Color(0xFFF5F5F6),
    onBackground = Color(0xFF1A1A1A),
    surface = Color(0xFFFBFBFC),
    onSurface = Color(0xFF1A1A1A),
    surfaceVariant = Color(0xFFEAEAEC),
    onSurfaceVariant = Color(0xFF5A5A5A),
    surfaceContainerHighest = Color(0xFFF0F0F2),
    outline = Color(0xFFBDBDBD),
    outlineVariant = Color(0xFFDCDCDC),
    error = Color(0xFF8C3A3A),
    onError = Color(0xFFFFFFFF)
)

@Composable
fun STCTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content
    )
}
