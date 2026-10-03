# 微信 CIMBAR 文件接收器

一个只做 **cimbar 解码** 的原生微信小程序，目标平台为 Android 和 iPhone。使用手机相机读取发送端的动态码图，在本机完成定位、纠错、文件重组和解压；完成后提示用户命名，并保存到本机的小程序文件目录。

已包含实际编译的解码 WASM，不需要配置服务端、云开发或上传接口。运行时没有 npm 依赖，也没有示例数据冒充接收成功的逻辑。

源码与问题反馈：[lejw0925/wechat-libcimbar](https://github.com/lejw0925/wechat-libcimbar)。如果这个工具对你有帮助，欢迎点一个 **Star**。“更多”页面提供复制源码链接和 Star 提示，不会自动代用户 Star 或上传文件。

## 直接运行

1. 在微信开发者工具中导入本项目根目录。`project.config.json` 已配置 `miniprogramRoot`。
2. 将 `project.config.json` 的 `appid` 换成你自己的小程序 AppID。游客模式可用于查看界面；手机预览、权限和隐私流程需要真实 AppID。不要提交 AppSecret 或其他凭据。
3. 选择基础库 **3.7.0 或更新版本**，使用当前稳定版微信进行预览。无需“构建 npm”，无需重新编译 WASM。
4. 在小程序管理后台补充相机相关的用户隐私保护指引。代码会在开始接收时请求隐私授权与 `scope.camera`。
5. 另一台设备打开 [cimbar.org](https://cimbar.org)，选择文件并播放码图。默认模式是 **B · 标准 / Mode B**；修改模式可点小程序左上角“更多”，滑动选择与发送端一致的档位。
6. 打开小程序直接进入扫码页并请求相机授权。对准完整码图，等待还原文件；确认文件名及扩展名后点击“保存文件”。

首次建议用几十 KiB 的文件，以较慢的发送帧率开始。保持四个角标可见，屏幕和镜头尽量平行。如果标准模式在低分辨率相机帧上难以识别，可同时把发送端和接收端切到 Mini 或 Micro。

## 扫码首页与导航

- **首页就是扫码**：启动后直接准备相机，展示方形取景、进度、有效速度和必要操作。完成后在此页命名、保存、导出，或继续扫码。
- **左上角“更多”**：五档模式滑块（标准、Mini、Micro、旧版 4 色、旧版 8 色）、使用说明、诊断复制、开源许可和 GitHub / Star。记住上次选择，不创建第二个相机或 Worker；相机和解码尺寸保留在复制的诊断中，不再单独列出画面选项。
- **扫码页底部“历史接收”**：默认折叠，露出渐变遮罩下的文件预览；手指上滑时面板跟随展开，下滑收起。标题、列表顶部和内容空白处均可下拉收起；长列表正常滚动，滚到顶部后可接续下拉。展开期间锁住底层扫码页。点按文件行可重命名、预览、导出或删除。

打开更多时暂停相机并保留会话，返回后点击“继续接收”。上滑历史期间，正在运行的相机保持接收，待展开吸附动画结束才暂停；轻拉后收回不触发相机停启。历史完全收起后，仅在展开前正在接收、且期间没有内存警告、后台切换或解码完成时自动继续。手动暂停不会被历史手势解除。更换模式会在返回时询问是否清空已有进度，取消则恢复原模式；文件已解码完成时，新模式留到下一次接收，不能丢弃待保存的文件。正在写入／保存时暂时禁用更多和历史操作。关闭整个小程序或系统回收进程后，未完成的接收需要重来；已完整落盘的文件可在历史接收中找回，原有记录无需迁移。

界面采用系统字体、蓝色操作按钮、固定在视口上的轻微混色渐变背景和实色分组容器；页面、导航和抽屉均无模糊滤镜。更多页正文与列表按钮统一 17px，辅助信息统一 13px。暂停取景区使用独立底色和暂停图标；扫码框上方两个装饰角已移除。浅色／深色自动跟随微信外观。设计参考记录在 [docs/design.md](docs/design.md)。扫码页标题和“更多”与微信胶囊共享顶部区域，不额外占用下方一行；更多与许可保留微信原生导航。历史文件使用普通列表行；其余自定义按钮均覆盖微信 v2 固定 184px 宽和自动居中的默认样式。

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
- 单帧在途，8 fps 起步，按 Worker、消息往返与采样处理耗时在 4／8／12／20 fps 间自适应，稳定有余量时逐级升档，负载高时降档。iPhone 优先在实验 Worker 内直接获取相机帧，只跨线程传递尺寸和结果；接口不可用时自动回退。
- Android 和兼容路径在收到一帧后停止相机帧监听，居中裁成正方形后才投递，解码结束后再采样；720×1280 的投递像素量减少 43.75%。只复用一个方形暂存缓冲，暂停／停止时释放。两条通道忙碌时均以 8ms 短延迟重试，无帧队列，相机预览保持可见。
- 模式 B、B Mini、B Micro、旧版 4 色、旧版 8 色；通过更多页的五档滑块选择并记住模式，确认清空已有进度后才切换。
- 相机定位与透视校正、Reed–Solomon 纠错、Wirehair 重组、Zstandard 解压。
- 去重和进度显示；切后台暂停，回前台可继续当前会话。
- 实时有效接收速度（B/s、KiB/s、MiB/s）：由去重后的 fountain 数据字节计数计算，使用约 3 秒滑动窗口，每 500 ms 刷新；重复帧不增加速度，无新数据会回落到零，暂停时间不计入恢复后的窗口。
- 正方形取景框及居中正方形解码，不拉伸像素；诊断保留相机原始尺寸、实际解码尺寸和投递字节数。直连在 Worker 内裁进复用的 WASM 缓冲；兼容通道在主线程复用方形暂存缓冲，减少跨线程复制。
- 完成后以 256 KiB 小块落盘，随后显示命名界面；完整内容落盘前不会列为已接收文件。
- 文件名过滤、防路径穿越、同名自动加序号；命名失败或未完成时保留待命名文件。
- 本地文件列表、再次命名、预览、用户主动导出、确认后删除。
- WASM 加载失败、相机权限失败、线程终止、存储不足和解压失败的明确反馈。
- 接收中的首次内存警告关闭相机并保留进度，恢复后的本次会话最高限制为 4 fps；重复警告或 Android 严重警告释放整个 Worker，明确提示需要重新接收。系统仍可能来不及发送警告就回收小程序，这不是不闪退的保证。
- 更多页可复制本次和上次接收诊断。本机最多保留两份小型快照（机型、微信版本、帧尺寸、WASM 堆大小、进度等），当前快照每 5 秒及重要事件更新，不含文件内容、不自动上传。自动启动新接收前保留上次记录，便于排查异常退出。

当前每次接收一个文件。压缩数据上限为 **16 MiB**，解压后上限为 **64 MiB**，WASM 内存上限为 **256 MiB**。这些是拒绝超限输入的边界，**不代表手机一定能接收此大小的文件**；整个微信进程还包含相机、JS、界面等内存，实际可用资源与速度取决于设备。释放帧缓冲可供 WASM 后续复用，但不能缩小已经增长的 WASM 线性内存；结束会话时销毁 Worker。进度依据收到的不同 fountain 数据块估算，实际完成以重组和完整解压成功为准。协议不提供发送者身份认证或文件的端到端签名。

## 相机分辨率与速度口径

微信 [camera 官方说明](https://developers.weixin.qq.com/miniprogram/dev/component/camera.html)只提供 `small / medium / large` 期望帧尺寸，实际像素由系统决定；预览尺寸不等于 `onCameraFrame` 原始帧尺寸。本项目已请求 `frame-size="large"`、`resolution="high"`，**无法强制指定 1080p、4K 或原生正方形传感器输出**。

若手机回调为 720×1280，实际使用原始画面中间的 720×720；若系统提供 1080×1920，则自动使用 1080×1080。可在“更多 → 复制本次接收诊断”查看 `width/height` 与 `decodeWidth/decodeHeight`。不会将 720 像素放大冒充更高分辨率。请将完整码图放入正方形框，四个角标都留在框内。不同设备的预览与帧数据可能存在视野差异，需真机确认取景对齐。

“有效接收速度”统计去重后的有效 fountain 载荷，包括不同的修复包，不含 RGBA 相机像素、重复包和协议／RS 开销；它不是 Wi-Fi 速度，也不是解压后文件大小除以时间。发送端内容压缩率及纠错冗余会影响其与文件大小的对应关系。

针对“比 CFC 安卓端慢约 8 倍”的调查与实现见 [docs/performance.md](docs/performance.md)：固定 250ms 已改为自适应采样，忙碌重试改为 8ms，兼容通道在投递前裁为正方形。`npm run bench:decoder` 可分离桌面原生计算与 JS 裁剪开销；诊断记录目标档位、实测帧间隔、Worker／往返／主线程裁剪耗时和复制字节数。最高 20 fps 是目标档位，实际提速与微信总内存仍需手机测试；本次没有修改 WASM 构建选项。

## 目录与数据流

```text
miniprogram/
  pages/receive/             启动页：扫码、进度、命名与保存
  pages/more/                模式滑块、使用说明、诊断与开源入口
  pages/licenses/            随包开源许可
  components/history-sheet/ 扫码页内历史列表、WXS 拖动与列表滚动衔接
  components/open-source-footer/ GitHub 源码与 Star 入口
  services/decoder-client.js Worker 消息与单帧在途控制
  services/camera-source.js  按需采样与 iOS Worker 直接取帧
  services/adaptive-sampling.js 4／8／12／20 fps 自适应调度与内存恢复限速
  services/frame-cropper.js  兼容通道投递前裁剪及单缓冲复用
  services/receive-diagnostics.js 本地有界诊断快照
  services/file-store.js     分块写入、持久化、重命名、恢复
  services/history-actions.js 历史文件命名、预览、导出和删除确认
  utils/receive-modes.js     滑块档位、协议模式映射与选择记忆
  utils/navigation-layout.js 窗口／胶囊避让及小屏方形取景尺寸
  utils/theme.js             原生模式滑块的实时主题颜色
  theme.json                微信原生区域的浅色／深色主题
  workers/decode.js          后台线程入口
  workers/decoder-runtime.js RGBA 与 C ABI 适配
  workers/generated/        已编译的 Emscripten 加载器
  wasm/cimbar.wasm.br        已编译的真实解码核心
native/                     C++ 解码桥接、测试专用编码器、构建配置
scripts/                    可重复构建及验证脚本
tests/                      文件存储、Worker、导出与生命周期测试
third_party/                构建时获取的固定版本源码（不打入小程序）
```

相机 RGBA → 居中正方形裁剪（直连在 Worker 内完成；兼容通道先裁剪再投递）→ 定位／透视变换 → 符号与颜色解码 → RS 纠错 → Wirehair 去重与重组 → Zstd 解压 → 分块落盘 → 用户命名。

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
- 1 MiB 难压缩数据在 1024×1024、1080×1920 下长时间重复帧测试，并额外覆盖主线程投递前裁剪／消息克隆路径，均含约 15% 进度时释放帧缓冲后继续；三组 SHA-256 一致，WASM 堆保持 32 MiB。新增路径的暂存缓冲仅启动和暂停恢复时各分配一次。这不是微信进程总内存测量。
- 重置后再次接收；无效压缩数据、截断、解压膨胀超过 64 MiB、压缩数据超过 16 MiB 的拒绝测试。
- 缺少 DOM、fetch、TextDecoder、performance 的 Worker 隔离环境测试。
- 文件写入、进程重建后的待命名恢复、文件名校验、重名、存储失败与 Worker 消息测试。
- iOS 直接通道只传元数据、实验 Worker 初始化回退、采样启停、晚到回调、内存警告及诊断持久化测试。
- 横竖画面逐像素裁剪、缓冲复用、吞吐统计去重／衰减／暂停恢复、源码和 Star 链接复制测试。
- 首页自动扫码、更多导航保留进度、五档模式映射与记忆、切换模式确认／取消及已完成文件保护、晚到授权、Worker 释放、双份诊断及窗口安全区测试。
- 历史手势跟手位移与渐变、快速滑动、取消／多指／尺寸变化、重新抓住动画中的面板，以及接收暂停／恢复保护、并发文件操作与主题变更测试。
- 项目 JS/WXS/JSON/WASM 与主包体积检查；微信开发者工具自带 WXML/WXS/WXSS 编译器检查。
- 当前 97 项 Node 测试通过，包括逐级升档、过载降档、慢消息通道、缺帧、8ms 忙碌重试、裁剪像素和缓冲复用、原始尺寸诊断及内存警告后限速。此前通过的 18 组浏览器布局覆盖浅色／深色的扫码、暂停、历史、更多、命名和许可页，以及抽屉内容手势和底层滚动锁定；本次没有修改这些界面。相机和系统区域使用占位，不能替代微信真机。

**用户已反馈 iPhone 可接收十几 KiB 文件，但旧版接收约 1 MB 文件在 15% 左右因内存不足退出。** 当前 `adaptive-sampling-9` 修订启用自适应采样和投递前裁剪，保留单帧限制、内存警告保护及历史界面的暂停时序。尚待 iPhone 复测，Android 仍待真机验收。未取得真机内存剖析，不能仅凭桌面测试断言具体泄漏位置或已彻底解决闪退。本机微信开发者工具的自动化服务端口关闭，未运行完整模拟器自动化，也未上传或发布微信小程序、未修改该安全设置。桌面 Node 测试的耗时不代表手机吞吐率。具体双端测试步骤见 [docs/device-testing.md](docs/device-testing.md)。

## 后续发布配置

填入真实 AppID，完成后台隐私声明，并按双端验收清单测试相机与文件出口。正式分发前保留开源声明，并提供与所分发 WASM 对应的 MPL 源码和本项目桥接层源码获取方式；说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 开源许可

本项目自有源码采用 [Mozilla Public License 2.0](LICENSE)。This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

第三方组件保留各自的许可及版权声明，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和随包许可全文。编译产物的对应源码、固定依赖版本与重建脚本均可从本仓库获取。GitHub 源码发布不代表微信小程序已上传、审核或正式发布。
