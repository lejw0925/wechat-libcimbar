# 界面约定

本项目是微信小程序，不是 UIKit 应用。按用户指定的 iOS 风格采用系统导航、排版和分组列表，用 WXML / WXSS 实现。背景使用固定的轻微混色渐变，导航和抽屉使用实色；不使用模糊滤镜或 Liquid Glass，不引入新的 UI 运行时，不复制 Apple 字体或图标资源。

## 参考来源

查阅日期：2026-10-03。

- GitHub：[Ionic 的 iOS Toolbar](https://github.com/ionic-team/ionic-framework/blob/main/core/src/components/toolbar/toolbar.ios.scss) 与 [iOS 列表行](https://github.com/ionic-team/ionic-framework/blob/main/core/src/components/item/item.ios.scss)。参考工具栏两侧操作、内容层级、列表分隔与交互状态，不引入 Ionic 依赖。
- Apple：[UI Design Dos and Don’ts](https://developer.apple.com/design/tips/) 与 [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)。参考可读性、安全区域、点击区域与颜色层级。
- 微信：[页面配置](https://developers.weixin.qq.com/miniprogram/dev/reference/configuration/page.html)、[窗口信息](https://developers.weixin.qq.com/miniprogram/dev/api/base/system/wx.getWindowInfo.html) 与 [胶囊位置](https://developers.weixin.qq.com/miniprogram/dev/api/ui/menu/wx.getMenuButtonBoundingClientRect.html)。`navigationStyle: custom` 仍保留系统胶囊；本地操作必须与其共享顶部区域，不能遮挡它。坐标换算考虑窗口 `screenTop`。
- GitHub：[微信官方 navigation-bar 实现](https://github.com/wechat-miniprogram/miniprogram-demo/tree/master/miniprogram/component/navigation-bar)。参考状态栏和胶囊避让，不额外在正文添加第二行导航。
- 微信：[DarkMode 适配](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/darkmode.html)与 [WXS 响应事件](https://developers.weixin.qq.com/miniprogram/dev/framework/view/interactive-animation.html)。原生区域使用 `darkmode` / `themeLocation`，样式跟随 `prefers-color-scheme`；连续手势在视图层处理。
- 微信：[scroll-view](https://developers.weixin.qq.com/miniprogram/dev/component/scroll-view.html) 与 [page-meta](https://developers.weixin.qq.com/miniprogram/dev/component/page-meta.html)。滚动区域提供固定高度、增强模式及边界弹性控制；`page-meta` 位于页面首个节点，通过 `page-style` 锁住抽屉后的页面滚动。

## 本项目的具体取舍

- 首页直接扫码；顶部仅保留左侧“更多”和“扫码”标题，为微信系统胶囊留空。历史合并到扫码页底部，默认折叠，不再使用顶部历史按钮或独立页面。不使用欢迎页、宣传口号或英文副标题。
- 系统字体栈。更多页主要文本、导航和列表按钮统一 17px，辅助说明、模式档位、网址和开源行尾文字统一 13px；大字号仅用于进度、抽屉标题或文件完成状态。
- 背景轻微混合冷灰蓝与暖灰，深色对应石墨灰与蓝灰。渐变放在固定视口层，列表滚动不带动背景；分组与抽屉为实色，使用细分隔线。操作色统一为蓝色，深色下提高文字与操作色亮度。
- 页面、导航、分组、开源组件及抽屉均不使用 `filter` / `backdrop-filter`。折叠预览仅用透明度及渐变遮罩。不做相机图像采样或离屏位图，不新增相机像素副本。
- 取景框移除上方两个装饰角；暂停时显示圆形暂停图标，浅色为蓝灰底，深色为比页面更亮的石墨灰底，与外部背景有明确区分。
- 按钮点击区域至少 44px 高。扫码导航按胶囊位置放在状态栏下方同一行，窄屏标题稍向左让位；更多和许可页继续使用微信原生顶部标题和返回按钮。
- 模式保留用户要求的五档滑块；同时允许点选标签。这是离散协议选择，不表示连续速度等级。
- 查看更多时暂停相机，保留解码状态。拖动历史时保持运行中的相机，完全展开后才暂停；轻拉后收回无需停启。完全收起后只恢复展开前正在进行的接收；手动暂停、内存警告、后台切换或已解码完成时不自动恢复。从更多返回仍需手动继续。切换模式先保护已有进度，已解码文件始终保留。

## 深色模式与历史手势

主题自动跟随微信外观，不增加独立开关。`theme.json` 覆盖原生导航、状态栏和窗口背景，页面与隔离组件分别提供深色 CSS；模式滑块的原生颜色属性通过 `wx.onThemeChange` 更新，离开更多页时解除监听。

历史面板固定在扫码页底部，折叠高度为 116px 加底部安全区域，保留标题、文件数和一小段列表预览。展开上限停在微信顶部导航下方，文件使用普通 `view` 列表行和细分隔线，无原生按钮外观。原有文件目录、索引和命名规则保持兼容。

拖动使用 WXS 直接更新位移、透明度和渐变遮罩。开始拖动只记录历史状态，运行中的相机不会卸载、释放帧缓冲或同步写入暂停诊断。松手根据距离及速度执行 240ms 吸附动画，视图层在动画时长加 32ms 后才通知逻辑层暂停／恢复相机；重新抓住面板会取消这个通知，并从当前可见位置继续。页面隐藏、尺寸变化或解码完成导致的状态变化也会取消过期通知。

标题区可直接拖动；内容区正常响应列表滚动，到顶部向下拉时将后续位移交给抽屉，不会把此前列表滚动的距离叠加到抽屉上。空列表和内容空白处同样可下拉。列表拖动不触发文件操作，点按文件仍可正常打开操作菜单。展开状态使用首节点 `page-meta` 的 `overflow: hidden` 锁住页面，遮罩消费触摸移动，滚动区域开启 `enhanced` 并关闭边界弹性。点按标题保留无障碍激活。

面板不读取文件内容、图片缩略图或相机像素。写入／保存期间限制文件操作；布局或页面可见性变化取消进行中的手势，晚到的授权、解码和文件列表回调不能重新挂载隐藏的相机或覆盖更新的记录。

## 微信按钮宽度修正

开发者工具随附的 `WAWebview.js` 中，新版组件默认样式包含 `wx-button:not([size=mini]) { margin-left:auto; margin-right:auto; width:184px }`。其优先级高于单独的类选择器，导致“更多”和“历史接收”列表按钮变窄、居中，看似左右边距异常；模式档位与操作按钮也会受影响。

保留 `style: v2`，使用双类选择器明确覆盖其余按钮的宽度、边距和 `box-sizing`，不使用全局 `!important`。开源组件有样式隔离，因此在组件内部独立修正。更多分组外边距 16px、行内水平留白 16px；底部历史面板通栏，列表水平留白 24px，文件行不再使用原生 `button`。

## 验证边界

WXML / WXS / WXSS 编译、Node 生命周期测试和浏览器检查不能替代微信真机。浏览器复用编译后的 WXML、页面样式、真实手势代码及上述微信按钮默认规则，覆盖 18 组浅色／深色布局，验证相机状态通知在吸附后发生、内容区下拉带动抽屉、长列表只滚动自身、更多背景保持固定以及统一字号。相机和系统导航为占位，并不验证 iOS 原生相机、系统字体缩放或微信实际渲染；WXS 与原生滚动组件的配合仍需双端确认。双端检查见 [device-testing.md](device-testing.md)。
