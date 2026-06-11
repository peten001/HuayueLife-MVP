# 微信小程序导入与配置

## 1. 构建小程序

在项目根目录执行：

```bash
corepack pnpm install --frozen-lockfile
VITE_API_BASE_URL="https://api.example.com/api/v1" \
  corepack pnpm --filter @huayue-life/miniapp build
```

构建目录：

```text
apps/miniapp/dist/build/mp-weixin
```

## 2. 导入微信开发者工具

1. 打开微信开发者工具，选择“小程序”。
2. 点击“导入项目”。
3. 项目目录选择 `apps/miniapp/dist/build/mp-weixin`。
4. 填写已申请的小程序 AppID。
5. 项目名称填写 `HuayueLife-MVP`。
6. 导入后确认 `app.json` 中首页、订单、我的三个 TabBar 均存在。

开发阶段可以在开发者工具中临时关闭合法域名校验。体验版和正式版不能依赖该选项。

## 3. AppID 和隐私权限

发布前在 `apps/miniapp/src/manifest.json` 的 `mp-weixin.appid` 中填写真实 AppID。

当前声明：

- `scope.userLocation`：展示附近餐厅。
- `getLocation`：获取当前位置。
- `chooseLocation`：配送地址可选定位。

需要在微信公众平台补充隐私保护指引，说明位置数据用途。用户拒绝定位后，首页按北宁或北江城市展示商家；配送地址可以手填并由商家电话确认。

## 4. TabBar 和扫码

TabBar 固定为：

- 首页：`pages/home/index`
- 订单：`pages/orders/index`
- 我的：`pages/profile/index`

首页使用 `uni.scanCode` 扫描二维码。二维码内容可以是：

- 64 位 `qr_token`。
- 带 `token` 查询参数的 HTTPS 地址。

小程序调用 `/api/v1/qr/resolve?token=` 由服务端解析商家和桌号，不信任二维码中的 `merchantId` 或 `tableId`。

## 5. 合法域名

在微信公众平台的“开发管理 / 开发设置 / 服务器域名”中配置：

- request 合法域名：`https://api.example.com`

要求：

- 必须使用 HTTPS。
- 域名证书有效且证书链完整。
- 不能使用 IP、localhost 或带端口的测试地址。
- `VITE_API_BASE_URL` 应设置为 `https://api.example.com/api/v1`。
- 域名变更后必须重新构建并上传小程序。

如果菜品图片使用独立对象存储或 CDN，还需按实际组件和下载方式配置相应合法域名。

## 6. 上线前限制

当前开发环境支持 mock code 登录。`NODE_ENV=production` 时，真实微信 `code2Session` 交换尚未实现，正式提交微信审核前必须完成该服务端接入并验证 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`。

