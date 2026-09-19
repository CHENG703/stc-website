package top.stcwork.filemanager.util

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import top.stcwork.filemanager.BuildConfig
import java.security.MessageDigest

/**
 * 客户端加固：能挡住「解包改代码再打包」和「正式包被改成可调试」这两类最常见的破解。
 *
 * 说明：任何客户端校验都能被逆向绕过，目标是抬高门槛、让改包成本高于收益；
 * 真正的防线在服务端（令牌、权限、签名校验）。
 */
object Hardening {

    /**
     * 正式包的签名指纹（SHA-256，小写十六进制，冒号可选）。
     * 填了才会做签名校验：被人换签名重新打包后，App 直接拒绝启动。
     * 取值方式（任选其一）：
     *   keytool -list -v -keystore your.jks -alias your-alias
     *   apksigner verify --print-certs app-release.apk
     * 留空 = 不校验（自己拿 debug 包、或还没配置签名时不会被误伤）。
     */
    private const val EXPECTED_SIGNATURE_SHA256 = ""

    data class Report(val blocked: Boolean, val reason: String)

    fun check(context: Context): Report {
        // 正式包却被标成可调试 ⇒ 几乎一定是被解包改过（或被人装了改版）
        val debuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (debuggable && !BuildConfig.DEBUG) {
            return Report(true, "应用完整性校验失败（调试标志异常），请安装官方版本")
        }

        val expected = EXPECTED_SIGNATURE_SHA256.replace(":", "").trim().lowercase()
        if (expected.isEmpty()) return Report(false, "")

        val actual = signatureSha256(context)
        if (actual.isBlank()) return Report(false, "") // 取不到签名就不拦，避免误伤
        if (actual != expected) {
            return Report(true, "应用签名校验失败，可能已被重新打包")
        }
        return Report(false, "")
    }

    /** 当前安装包的签名 SHA-256（十六进制小写） */
    fun signatureSha256(context: Context): String {
        return try {
            val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val pi = context.packageManager.getPackageInfo(
                    context.packageName, PackageManager.GET_SIGNING_CERTIFICATES
                )
                pi.signingInfo?.apkContentsSigners
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(
                    context.packageName, PackageManager.GET_SIGNATURES
                ).signatures
            }
            val sig = signatures?.firstOrNull() ?: return ""
            MessageDigest.getInstance("SHA-256").digest(sig.toByteArray())
                .joinToString("") { "%02x".format(it) }
        } catch (e: Exception) {
            ""
        }
    }
}
