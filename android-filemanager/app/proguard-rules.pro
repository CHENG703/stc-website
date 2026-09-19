# 保留 org.json 反射相关（Android 平台自带，无需额外规则）
-dontwarn org.json.**

# ---------- 加固：R8 代码压缩 + 混淆（release 构建生效） ----------
-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod
# 崩溃堆栈还能定位到源文件行号（配合 mapping.txt 反混淆）
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Kotlin 元数据 / when 映射（R8 处理枚举分支需要）
-keepclassmembers class kotlin.Metadata { public <methods>; }
-keepclassmembers class **$WhenMappings { <fields>; }

# Compose：保留被 @Composable 标注的方法
-keepclassmembers class * {
    @androidx.compose.runtime.Composable <methods>;
}
-dontwarn androidx.compose.**

# 互传用的极简 HTTP 服务与客户端（纯 java.net，无反射，但保留类名便于排查）
-keep class top.stcwork.filemanager.net.** { *; }
-keep class top.stcwork.filemanager.transfer.ShareService { *; }
