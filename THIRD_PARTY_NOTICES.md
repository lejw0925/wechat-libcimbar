# 第三方组件与源码

本项目的解码器链接下列开源组件。构建脚本会把许可全文汇集到 `miniprogram/licenses/THIRD_PARTY_NOTICES.txt`，随小程序分发，可从“已接收文件 → 开源组件与许可”查看。

| 组件 | 来源 | 许可 |
| --- | --- | --- |
| libcimbar | https://github.com/sz3/libcimbar | MPL-2.0 |
| OpenCV | https://github.com/opencv/opencv | Apache-2.0 |
| Wirehair | libcimbar 内置版本 | BSD-3-Clause |
| libcorrect | libcimbar 内置版本 | BSD |
| Zstandard | libcimbar 内置版本 | BSD-3-Clause（采用此许可选项） |
| fmt、intx | libcimbar 内置版本 | MIT |
| libpopcnt | libcimbar 内置版本 | BSD-2-Clause |
| stb_image | libcimbar 内置版本 | MIT / Public Domain |
| base91 | libcimbar 内置版本 | zlib 及源码头部的附加 BSD 声明 |
| zlib | OpenCV 内置版本 | zlib |
| Emscripten、musl、libc++、libc++abi、compiler-rt | 构建工具链 | 各自 MIT / NCSA / LLVM 等许可，见汇集文件 |

版本与 WASM 哈希记录在 `miniprogram/wasm/build-info.json`。算法源码按构建脚本中的固定 commit 获取；未修改上游源码文件。新建的 `native/decoder.cpp`、`native/fixture_encoder.cpp` 以 MPL-2.0 标注。

[CFC](https://github.com/sz3/cfc) 作为相机接收工作流参考，其 Android UI/JNI 代码没有复制进入本项目。

本项目自有源码采用 MPL-2.0，完整许可见根目录 `LICENSE`。对应源码、桥接层、构建脚本及固定的上游版本可从公开仓库获取：https://github.com/lejw0925/wechat-libcimbar 。小程序底部也提供此源码地址。

分发修改后的 WASM 时，请同时提供与其匹配的 MPL 对应源码（包括适用的桥接层及构建说明），或提供有效源码获取地址。第三方文件继续遵循各自许可，不因根目录许可证而改变。
