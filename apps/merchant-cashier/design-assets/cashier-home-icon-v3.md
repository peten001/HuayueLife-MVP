# 收银手机桌面图标 v3

2026-11-08，已提交并上线。发布记录见 `docs/release/cashier-home-icon-20261108-v1.md`。

旧 Apple touch 图标为圆形 Logo，四角未铺满绿色，手机桌面合成可能出现黑色。新版使用全幅绿色方形底、白色 YQ／厨师帽／餐盘，交给系统裁切圆角。主要图形位于中央约 70% 区域，可保留在 maskable 安全圆内。

由内置图像生成工具根据 `public/yunqiao-cashier-mark.png` 重绘，原始输出存为本目录 `cashier-home-icon-v3.png`。通过 macOS `sips -z SIZE SIZE` 导出 96、144、180、192、256、512 六种尺寸至 `public/icons/cashier-v3-SIZE.png`；180 版本同时复制到根路径 `public/apple-touch-icon.png`。所有尺寸都铺满背景，不预切圆角。

提示词：保留 YunQiao 原白色 YQ 字母、厨师帽、餐盘及圆形轮廓，重新绘制清晰线条；全幅品牌绿色 #008E48、完全不透明方形画布；图形居中占约 68%，不得有黑色／透明四角、阴影、额外文字、嵌套圆角卡片或样机。

收银 HTML 和 manifest 使用 v3 文件名以更新缓存。KDS 构建继续链接旧图标及自己的 manifest，旧资源原样保留。页面内 Logo、启动图及业务逻辑未更改。

上线后，已有桌面快捷方式通常需要删除后重新添加；本次尚未做真机主屏幕安装验收。

安全区域依据：https://web.dev/articles/maskable-icon

验证通过：收银 typecheck、生产 build、2 项既有 Apple 图标元数据测试；系统 Chrome 解码全部六种尺寸后逐像素检查，无透明像素、无黑色像素，白色图形最远半径为画布宽度的 35.3%（小于 maskable 安全半径 40%）。KDS HTML 转换单独检查通过，保留旧图标路径。Playwright 自带浏览器未安装，像素检查改用本机 Chrome 完成。
