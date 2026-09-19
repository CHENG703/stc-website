# STC 文件管理器（Android）

一个简洁的安卓文件管理器，Kotlin + Jetpack Compose Material3，纯灰阶界面、无图标。
**开源协议：MIT**（见 `LICENSE`），除 AndroidX / Compose 外不依赖任何第三方 SDK，也不含任何统计、广告或埋点。

## 功能

- **文件**：浏览 / 复制 / 剪切粘贴 / 重命名 / 删除 / 新建文件与文件夹 / 详情；长按文件出操作菜单，长按顶部路径复制路径；ZIP 打包与解压；APK 提取与安装；内置文本编辑器（UTF-8 / GBK，5MB 以内）。
- **应用**：已安装应用列表、提取 APK。
- **电脑**：局域网直连电脑端（`pc-client/`，端口 8765），配对码鉴权，浏览 / 上传 / 下载 / 新建 / 重命名 / 删除。
- **手机**：两台手机之间互传文件（端口 8766，局域网直连，不经过服务器）。
  - 发送方选好文件后「开始分享」，页面显示**本机地址 + 6 位配对码**；
  - 接收方填地址和配对码，勾选文件即可接收，保存到 `Download/STC互传`；
  - 支持断点续传，发送方由前台服务保活，锁屏也能继续传；配对码连错 5 次锁 5 分钟，令牌 12 小时有效。
- **我的**：网站账号登录（密码 / 验证码 / 访客注册），封禁即时踢出，退出登录。

## 「用其它应用打开」

在 QQ、微信、系统下载等 App 里点文件 → 「用其它应用打开」，列表里会出现 **STC 文件管理器**，
点击后直接进入文件所在文件夹并选中该文件（content:// 会先去 QQ / 微信 / 下载目录定位真实文件，
实在定位不到才复制到本应用缓存目录）。

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `MANAGE_EXTERNAL_STORAGE` / 读写存储 | 全盘浏览与操作文件 |
| `READ_MEDIA_*` | Android 13+ 读取媒体文件信息 |
| `INTERNET` / `ACCESS_NETWORK_STATE` | 网站账号登录 |
| `ACCESS_WIFI_STATE` | 取本机局域网 IP（互传时显示给对方） |
| `FOREGROUND_SERVICE(_DATA_SYNC)` / `POST_NOTIFICATIONS` | 手机互传前台服务与常驻通知 |
| `QUERY_ALL_PACKAGES` / `REQUEST_INSTALL_PACKAGES` | 列出应用、提取并安装 APK |

所有文件传输都在**局域网内点对点**完成，不上传任何服务器。

## 编译

要求 JDK 17、Android SDK（compileSdk 36、minSdk 24）、Gradle 8.13。

```bash
gradle.bat --no-daemon --console=plain -x lint assembleDebug
```

产物在 `app/build/outputs/apk/debug/`。低内存机器建议加 `-Dorg.gradle.jvmargs=-Xmx1024m` 与 `workers.max=1`。

## 目录结构

```
app/src/main/java/top/stcwork/filemanager/
├─ MainActivity.kt        底部五个页签（文件 / 应用 / 电脑 / 手机 / 我的）
├─ data/                  Prefs、网站 API、电脑端与手机端客户端
├─ fs/                    Fs（文件操作）、ApkOps、ZipOps、OpenWith（外部打开定位）
├─ net/                   手机互传：PhoneServer（本机 HTTP 服务）、PhoneClient、Net
├─ transfer/              ShareService（前台服务）、ShareHub（共享状态）
└─ ui/                    各页面 Compose 实现
```
