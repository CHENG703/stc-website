package top.stcwork.filemanager.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// 主题：整体灰阶（无彩色）。用户明确要求「整体颜色是灰色」，
// 因此 primary/secondary 均为中性灰，不使用任何品牌色/紫蓝色。
private val Gray = Color(0xFF8C8C8C)
private val Graphite = Color(0xFF4A4A4A)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFD0D0D0),
    onPrimary = Color(0xFF1C1C1C),
    primaryContainer = Color(0xFF3A3A3A),
    onPrimaryContainer = Color(0xFFE8E8E8),
    secondary = Color(0xFF9E9E9E),
    onSecondary = Color(0xFF1C1C1C),
    secondaryContainer = Color(0xFF333333),
    onSecondaryContainer = Color(0xFFDCDCDC),
    tertiary = Color(0xFFB0B0B0),
    onTertiary = Color(0xFF1C1C1C),
    background = Color(0xFF121212),
    onBackground = Color(0xFFE4E4E4),
    surface = Color(0xFF1C1C1C),
    onSurface = Color(0xFFE4E4E4),
    surfaceVariant = Color(0xFF2A2A2A),
    onSurfaceVariant = Color(0xFFB5B5B5),
    surfaceContainerHighest = Color(0xFF2E2E2E),
    outline = Color(0xFF4D4D4D),
    outlineVariant = Color(0xFF383838),
    error = Color(0xFFD9A0A0),
    onError = Color(0xFF2A1414)
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
    background = Color(0xFFF2F2F2),
    onBackground = Color(0xFF1A1A1A),
    surface = Color(0xFFFAFAFA),
    onSurface = Color(0xFF1A1A1A),
    surfaceVariant = Color(0xFFE6E6E6),
    onSurfaceVariant = Color(0xFF5A5A5A),
    surfaceContainerHighest = Color(0xFFEDEDED),
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
