# 微信 CIMBAR 文件接收器

一个只做 **cimbar 解码** 的原生微信小程序，目标平台为 Android 和 iPhone。使用手机相机读取发送端的动态码图，在本机完成定位、纠错、文件重组和解压；完成后提示用户命名，并保存到本机的小程序文件目录。

已包含实际编译的解码 WASM，不需要配置服务端、云开发或上传接口。运行时没有 npm 依赖，也没有示例数据冒充接收成功的逻辑。

源码与问题反馈：[lejw0925/wechat-libcimbar](https://github.com/lejw0925/wechat-libcimbar)。如果这个工具对你有帮助，欢迎点一个 **Star**。小程序底部也提供复制源码链接和 Star 提示，不会自动代用户 Star 或上传文件。

## 直接运行

1. 在微信开发者工具中导入本项目根目录。`project.config.json` 已配置 `miniprogramRoot`。
2. 将 `project.config.json` 的 `appid` 换成你自己的小程序 AppID。游客模式可用于查看界面；手机预览、权限和隐私流程需要真实 AppID。不要提交 AppSecret 或其他凭据。
3. 选择基础库 **3.7.0 或更新版本**，使用当前稳定版微信进行预览。无需“构建 npm”，无需重新编译 WASM。
4. 在小程序管理后台补充相机相关的用户隐私保护指引。代码会在开始接收时请求隐私授权与 `scope.camera`。
5. 另一台设备打开 [cimbar.org](https://cimbar.org)，选择文件并播放码图。两端选择相同模式，默认是 **B · 标准 / Mode B**。
6. 小程序点击“开始接收”，对准完整码图，等待还原文件；确认文件名及扩展名后点击保存。

首次建议用几十 KiB 的文件，以较慢的发送帧率开始。保持四个角标可见，屏幕和镜头尽量平行。如果标准模式在低分辨率相机帧上难以识别，可同时把发送端和接收端切到 Mini 或 Micro。

## “保存到手机本地”的范围

这里的持久化位置是 `wx.env.USER_DATA_PATH/cimbar-received/`，即手机上的小程序专属目录；文件可跨页面、跨小程序重启读取，不是临时相机文件。

微信手机端没有通用的“选择系统下载目录并写入任意文件”接口。[官方 `saveFileToDisk` 定义](https://developers.weixin.qq.com/miniprogram/dev/api/file/wx.saveFileToDisk.html)明确仅支持 PC。因此提供以下出口：

| 文件／平台 | 保存或使用方式 |
| --- | --- |
| Android / iPhone 的普通文件 | 小程序本地保存；用户主动选择“转发文件到微信聊天”，后续在聊天文件菜单中按客户端能力打开或另存 |
| JPG / PNG 图片、MP4 视频 | 额外提供“保存到手机相册”，需要相应权限和有效媒体格式 |
| 微信支持的文档 | `openDocument` 预览并显示菜单 |
| 电脑端打开已有文件 | 在支持时提供 `saveFileToDisk` |

转发成功不会显示为“已保存到系统下载目录”。任意文件直接写入 Android 公共目录或 iOS“文件”App 的功能不在此版本中；平台允许的方式如上。清理小程序数据、存储回收或删除对应文件后，专属目录中的内容可能丢失，重要文件请导出。

## 已实现的流程

- 原生 `camera` 实时 RGBA 帧，Worker 内运行实际的 libcimbar 解码。
- 单帧在途、最高每 250 ms 解码一帧。iPhone 优先在实验 Worker 内直接获取相机帧，只跨线程传递尺寸和结果；接口不可用时自动回退。
- Android 和兼容路径在收到一帧后停止相机帧监听，解码结束后再开启下一次采样，避免持续生成和复制大块帧数据。相机预览保持可见。
- 模式 B、B Mini、B Micro、旧版 4 色、旧版 8 色；手动选择与发送端一致的模式。
- 相机定位与透视校正、Reed–Solomon 纠错、Wirehair 重组、Zstandard 解压。
- 去重和进度显示；切后台暂停，回前台可继续当前会话。
- 实时有效接收速度（B/s、KiB/s、MiB/s）：由去重后的 fountain 数据字节计数计算，使用约 3 秒滑动窗口，每 500 ms 刷新；重复帧不增加速度，无新数据会回落到零，暂停时间不计入恢复后的窗口。
- 正方形取景框及居中正方形解码，不拉伸像素；显示相机原始尺寸与实际解码尺寸。裁剪直接复制进复用的 WASM 缓冲，不新建整张 JS 位图。
- 完成后以 256 KiB 小块落盘，随后显示命名界面；完整内容落盘前不会列为已接收文件。
- 文件名过滤、防路径穿越、同名自动加序号；命名失败或未完成时保留待命名文件。
- 本地文件列表、再次命名、预览、用户主动导出、确认后删除。
- WASM 加载失败、相机权限失败、线程终止、存储不足和解压失败的明确反馈。
- 接收中的首次内存警告关闭相机并保留进度；重复警告或 Android 严重警告释放整个 Worker，明确提示需要重新接收。系统仍可能来不及发送警告就回收小程序，这不是不闪退的保证。
- 页面底部可复制接收诊断；仅在本机保留一份小型快照（机型、微信版本、帧尺寸、WASM 堆大小、进度等），每 5 秒及重要事件更新，不含文件内容、不自动上传。

当前每次接收一个文件。压缩数据上限为 **16 MiB**，解压后上限为 **64 MiB**，WASM 内存上限为 **256 MiB**。这些是拒绝超限输入的边界，**不代表手机一定能接收此大小的文件**；整个微信进程还包含相机、JS、界面等内存，实际可用资源与速度取决于设备。释放帧缓冲可供 WASM 后续复用，但不能缩小已经增长的 WASM 线性内存；结束会话时销毁 Worker。进度依据收到的不同 fountain 数据块估算，实际完成以重组和完整解压成功为准。协议不提供发送者身份认证或文件的端到端签名。

## 相机分辨率与速度口径

微信 [camera 官方说明](https://developers.weixin.qq.com/miniprogram/dev/component/camera.html)只提供 `small / medium / large` 期望帧尺寸，实际像素由系统决定；预览尺寸不等于 `onCameraFrame` 原始帧尺寸。本项目已请求 `frame-size="large"`、`resolution="high"`，**无法强制指定 1080p、4K 或原生正方形传感器输出**。

若手机回调为 720×1280，页面显示“相机 720×1280 · 解码 720×720”，实际使用原始画面中间的 720×720；若系统提供 1080×1920，则自动使用 1080×1080。不会将 720 像素放大冒充更高分辨率。请将完整码图放入正方形框，四个角标都留在框内。不同设备的预览与帧数据可能存在视野差异，需真机确认取景对齐。

“有效接收速度”统计去重后的有效 fountain 载荷，包括不同的修复包，不含 RGBA 相机像素、重复包和协议／RS 开销；它不是 Wi-Fi 速度，也不是解压后文件大小除以时间。发送端内容压缩率及纠错冗余会影响其与文件大小的对应关系。

## 目录与数据流

```text
miniprogram/
  pages/receive/             相机、进度、命名与保存界面
  pages/files/               本地文件列表
  pages/licenses/            随包开源许可
  components/open-source-footer/ GitHub 源码与 Star 入口
  services/decoder-client.js Worker 消息与单帧在途控制
  services/camera-source.js  按需采样与 iOS Worker 直接取帧
  services/receive-diagnostics.js 本地有界诊断快照
  services/file-store.js     分块写入、持久化、重命名、恢复
  workers/decode.js          后台线程入口
  workers/decoder-runtime.js RGBA 与 C ABI 适配
  workers/generated/        已编译的 Emscripten 加载器
  wasm/cimbar.wasm.br        已编译的真实解码核心
native/                     C++ 解码桥接、测试专用编码器、构建配置
scripts/                    可重复构建及验证脚本
tests/                      文件存储、Worker、导出与生命周期测试
third_party/                构建时获取的固定版本源码（不打入小程序）
```

相机 RGBA → Worker 中居中正方形裁剪 → 定位／透视变换 → 符号与颜色解码 → RS 纠错 → Wirehair 去重与重组 → Zstd 解压 → 分块落盘 → 用户命名。

解码算法来自 [libcimbar](https://github.com/sz3/libcimbar)，相机接收流程参考 [CFC](https://github.com/sz3/cfc)。没有移植 Android UI/JNI，也不需要 OpenGL、GLFW 或浏览器 DOM。

WASM 放在 `workers/` **外部**，符合微信 Worker 仅打包 JS 的要求。加载走 `WXWebAssembly.instantiate`，支持 `.wasm.br`；不依赖 `fetch`、DOM、`TextDecoder` 或浏览器计时 API。没有导出 iOS 暂不支持的 WASM Global，也不使用 SIMD 或共享内存。参见 [微信 WXWebAssembly 文档](https://developers.weixin.qq.com/miniprogram/dev/framework/performance/wasm.html)。

微信的普通 Worker 消息会[复制数据](https://developers.weixin.qq.com/miniprogram/dev/framework/workers.html)。iOS 的 [Worker.getCameraFrameData](https://developers.weixin.qq.com/miniprogram/dev/api/worker/Worker.getCameraFrameData.html) 必须搭配实验 Worker 及 `CameraFrameListener.start({ worker })`；本项目先采一帧取得尺寸，再绑定直接通道。初始化、绑定或持续取帧不可用均有兼容回退。内存警告策略依据[微信运行内存说明](https://developers.weixin.qq.com/miniprogram/dev/framework/performance/tips/runtime_memory.html)实现。

## 从源码重建

已验证构建环境：Node.js 22、CMake 4、Emscripten 6.0.9，macOS arm64。Node.js 最低要求为 22.15（完整测试使用 Node 的 Zstd 接口）。源码重建还需要 Git、C/C++ 构建工具，以及首次下载依赖的网络连接。

```sh
npm run build:wasm
npm run check
npm test
npm run test:wasm
npm run test:memory
```

`build:wasm` 自动获取并验证以下固定版本，构建 OpenCV 的 core/imgproc 和解码依赖，生成 JS、Brotli WASM、构建哈希与许可证。已有 checkout 的版本不符时会停止，不会覆盖你的源码。

- libcimbar：`bfb0c8e471820ae493cd3694ea6bed5d5ac06c37`
- OpenCV 4.11.0：`31b0eeea0b44b370fd0712312df4214d4ae1b158`
- CFC 参考版本：`e143ebd16154f3db17fbfdf8d0da71b1b50678a4`

Emscripten 缓存位于 `.cache/emscripten/`，构建输出位于 `build/`。可用 `CIMBAR_JOBS=4` 调整并发。测试专用编码器只在 `build/decoder/` 中，**不进入小程序代码包**。

若要额外运行官方 PNG 样本回归，安装 FFmpeg，并获取上游样本：

```sh
git -C third_party/libcimbar submodule update --init samples
npm run test:wasm
```

## 验证状态

已在当前机器通过：

- 真实 WASM 加载与解码；官方 Mode B 样本还原为 7,538 字节。
- 官方样本构造的 720×1280 合成相机帧，居中裁为 720×720 后完整恢复相同文件；这不是手机拍摄测试。
- 上游四张真实拍摄 JPG 均成功定位并解出有效数据块，覆盖不同分辨率与拍摄角度。
- 五种模式对 60,000 字节二进制数据的往返测试，覆盖丢帧、乱序、重复帧，恢复结果 SHA-256 与原始数据一致。
- 1 MiB 难压缩数据在 1024×1024、1080×1920 两种画面尺寸下长时间重复帧测试，包含约 15% 进度时释放帧缓冲后继续；两组 SHA-256 一致，WASM 堆保持 32 MiB。这不是微信进程总内存测量。
- 重置后再次接收；无效压缩数据、截断、解压膨胀超过 64 MiB、压缩数据超过 16 MiB 的拒绝测试。
- 缺少 DOM、fetch、TextDecoder、performance 的 Worker 隔离环境测试。
- 文件写入、进程重建后的待命名恢复、文件名校验、重名、存储失败与 Worker 消息测试。
- iOS 直接通道只传元数据、实验 Worker 初始化回退、采样启停、晚到回调、内存警告及诊断持久化测试。
- 横竖画面逐像素裁剪、缓冲复用、吞吐统计去重／衰减／暂停恢复、源码和 Star 链接复制测试。
- 项目 JS/JSON/WASM 与主包体积检查；微信开发者工具自带 WXML/WXSS 编译器检查。

**用户已反馈 iPhone 可接收十几 KiB 文件，但旧版接收约 1 MB 文件在 15% 左右因内存不足退出。** 当前 `square-speed-3` 修订包含内存保护、正方形裁剪及速度显示，尚待 iPhone 复测；Android 仍待真机验收。未取得真机内存剖析，不能仅凭桌面测试断言具体泄漏位置或已彻底解决闪退。本机微信开发者工具的自动化服务端口关闭，未运行完整模拟器自动化，也未上传或发布微信小程序、未修改该安全设置。桌面 Node 测试的耗时不代表手机吞吐率。具体双端测试步骤见 [docs/device-testing.md](docs/device-testing.md)。

## 后续发布配置

填入真实 AppID，完成后台隐私声明，并按双端验收清单测试相机与文件出口。正式分发前保留开源声明，并提供与所分发 WASM 对应的 MPL 源码和本项目桥接层源码获取方式；说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 开源许可

本项目自有源码采用 [Mozilla Public License 2.0](LICENSE)。This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

第三方组件保留各自的许可及版权声明，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和随包许可全文。编译产物的对应源码、固定依赖版本与重建脚本均可从本仓库获取。GitHub 源码发布不代表微信小程序已上传、审核或正式发布。
