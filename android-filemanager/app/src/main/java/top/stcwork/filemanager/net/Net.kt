package top.stcwork.filemanager.net

import java.net.Inet4Address
import java.net.NetworkInterface

/** 局域网小工具：拿到本机在 WiFi 下的 IPv4 地址（手机互传要显示给对方填） */
object Net {

    /** 形如 192.168.1.23；取不到返回空串 */
    fun localIp(): String {
        return try {
            val all = NetworkInterface.getNetworkInterfaces() ?: return ""
            while (all.hasMoreElements()) {
                val nif = all.nextElement()
                if (!nif.isUp || nif.isLoopback || nif.isVirtual) continue
                val addrs = nif.inetAddresses
                while (addrs.hasMoreElements()) {
                    val a = addrs.nextElement()
                    if (a is Inet4Address && !a.isLoopbackAddress && a.isSiteLocalAddress) {
                        return a.hostAddress ?: ""
                    }
                }
            }
            ""
        } catch (e: Exception) {
            ""
        }
    }
}
