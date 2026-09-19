package top.stcwork.filemanager.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * 界面动效集合。整体是灰阶、无图标的风格，所以动效只做「轻量的位移 / 渐显 / 呼吸」，
 * 不引入颜色变化，也不改变现有布局结构。
 */

/** 进场：向上淡入（列表项、卡片逐个出现时用，delayMs 做错落） */
fun Modifier.enterFadeSlide(delayMs: Int = 0, distanceDp: Float = 18f): Modifier = composed {
    val alpha = remember { Animatable(0f) }
    val offsetY = remember { Animatable(distanceDp) }
    LaunchedEffect(Unit) {
        if (delayMs > 0) kotlinx.coroutines.delay(delayMs.toLong())
        launch { alpha.animateTo(1f, tween(240, easing = FastOutSlowInEasing)) }
        launch { offsetY.animateTo(0f, tween(260, easing = FastOutSlowInEasing)) }
    }
    this.graphicsLayer {
        this.alpha = alpha.value
        this.translationY = offsetY.value
    }
}

/** 呼吸：轻微的明暗缩放循环（用于「正在分享」之类的进行中状态） */
fun Modifier.breathe(scaleTo: Float = 1.03f, durationMs: Int = 1600): Modifier = composed {
    val infinite = androidx.compose.animation.core.rememberInfiniteTransition(label = "breathe")
    val s by infinite.animateFloat(
        initialValue = 1f,
        targetValue = scaleTo,
        animationSpec = infiniteRepeatable(tween(durationMs, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "breatheScale"
    )
    val a by infinite.animateFloat(
        initialValue = 1f,
        targetValue = 0.72f,
        animationSpec = infiniteRepeatable(tween(durationMs, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "breatheAlpha"
    )
    this.graphicsLayer {
        scaleX = s
        scaleY = s
        this.alpha = a
    }
}

/** 按下反馈：轻微缩小再弹回（用 spring，不需要额外依赖） */
fun Modifier.pressScale(
    interactionSource: androidx.compose.foundation.interaction.MutableInteractionSource,
    scale: Float = 0.97f
): Modifier = composed {
    val pressed by interactionSource.collectIsPressedAsState()
    val s by animateFloatAsState(
        targetValue = if (pressed) scale else 1f,
        animationSpec = spring(stiffness = 700f),
        label = "pressScale"
    )
    this.graphicsLayer {
        scaleX = s
        scaleY = s
    }
}

/** 加载占位：一条来回扫过的微光（灰阶，不刺眼） */
@Composable
fun ShimmerList(count: Int = 6) {
    val infinite = androidx.compose.animation.core.rememberInfiniteTransition(label = "shimmer")
    val x by infinite.animateFloat(
        initialValue = -260f,
        targetValue = 900f,
        animationSpec = infiniteRepeatable(tween(1300, easing = LinearEasing), RepeatMode.Restart),
        label = "shimmerX"
    )
    val brush = Brush.linearGradient(
        colors = listOf(
            MaterialTheme.colorScheme.onSurface.copy(alpha = 0.04f),
            MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f),
            MaterialTheme.colorScheme.onSurface.copy(alpha = 0.04f)
        ),
        start = Offset(x, 0f),
        end = Offset(x + 240f, 0f)
    )
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        repeat(count) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .padding(vertical = 4.dp)
                    .background(brush, RoundedCornerShape(12.dp))
            )
            Spacer(Modifier.height(2.dp))
        }
    }
}
