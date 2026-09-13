package top.stcwork.filemanager.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColors = darkColorScheme(
    primary = Color(0xFF8AB4FF),
    onPrimary = Color(0xFF0A1A38),
    primaryContainer = Color(0xFF1B2A4A),
    onPrimaryContainer = Color(0xFFD6E3FF),
    secondary = Color(0xFFA8C7FA),
    onSecondary = Color(0xFF0A1A38),
    background = Color(0xFF0B1020),
    onBackground = Color(0xFFE6EAF2),
    surface = Color(0xFF111729),
    onSurface = Color(0xFFE6EAF2),
    surfaceVariant = Color(0xFF1A2136),
    onSurfaceVariant = Color(0xFFB9C2D6),
    outline = Color(0xFF3A4459),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF3B0907)
)

private val LightColors = lightColorScheme(
    primary = Color(0xFF2A5BD7),
    onPrimary = Color(0xFFFFFFFF),
    background = Color(0xFFF6F7FB),
    onBackground = Color(0xFF14161C),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF14161C),
    surfaceVariant = Color(0xFFE7EAF2),
    onSurfaceVariant = Color(0xFF4A5265),
    outline = Color(0xFFC3CAD9),
    error = Color(0xFFB3261E)
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
