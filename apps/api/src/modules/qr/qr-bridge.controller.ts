import { Controller, Get, Param, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { QrService } from './qr.service';

@Controller()
export class QrBridgeController {
  constructor(
    private readonly service: QrService,
    private readonly config: ConfigService,
  ) {}

  @Get('t/:token')
  async bridge(@Param('token') token: string, @Res() response: Response) {
    const resolved = await this.service.resolve(token);
    const appId = this.config.get<string>('WECHAT_APP_ID')?.trim() ?? '';
    const fallbackUrl =
      this.config.get<string>('MINIAPP_QR_ENTRY_URL')?.trim() ??
      `https://api.huayueyouxuan.com/api/v1/qr/resolve?token=${encodeURIComponent(token)}`;
    const miniProgramScheme = this.buildMiniProgramScheme(appId, token);

    const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate" />
    <title>${this.escapeHtml(resolved.merchant.nameZh)}</title>
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: #f6f3ef;
        color: #2f241f;
      }
      .wrap {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        box-sizing: border-box;
      }
      .card {
        width: min(92vw, 420px);
        padding: 28px 24px;
        border-radius: 20px;
        background: #fff;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
        text-align: center;
      }
      h1 { margin: 0 0 10px; font-size: 20px; }
      p { margin: 8px 0; line-height: 1.6; color: #6d625a; }
      .primary {
        display: inline-block;
        margin-top: 16px;
        padding: 12px 20px;
        border-radius: 999px;
        background: #c43b2f;
        color: #fff;
        text-decoration: none;
        font-weight: 600;
      }
      .secondary {
        display: inline-block;
        margin-top: 10px;
        color: #a83228;
        text-decoration: none;
      }
      .hint { margin-top: 12px; font-size: 13px; color: #8c7f75; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>${this.escapeHtml(resolved.merchant.nameZh)}</h1>
        <p>桌号：${this.escapeHtml(resolved.table.tableName || resolved.table.tableNo)}</p>
        <p>正在打开点餐小程序...</p>
        <a id="launch" class="primary" href="${this.escapeAttr(miniProgramScheme)}">打开小程序</a>
        <div><a class="secondary" href="${this.escapeAttr(fallbackUrl)}">若未自动打开，请点击此处继续</a></div>
        <div class="hint">如果自动跳转失败，请在微信内打开并手动点击上方按钮。</div>
      </div>
    </div>
    <script>
      (function () {
        var launchUrl = ${JSON.stringify(miniProgramScheme)};
        var fallbackUrl = ${JSON.stringify(fallbackUrl)};
        var timer = window.setTimeout(function () {
          window.location.replace(fallbackUrl);
        }, 1800);
        document.addEventListener('visibilitychange', function () {
          if (document.hidden) {
            window.clearTimeout(timer);
          }
        });
        var anchor = document.getElementById('launch');
        if (anchor) {
          anchor.addEventListener('click', function () {
            window.clearTimeout(timer);
          });
        }
        window.location.href = launchUrl;
      })();
    </script>
  </body>
</html>`;

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).send(html);
  }

  private buildMiniProgramScheme(appId: string, token: string) {
    if (!appId) {
      return `https://api.huayueyouxuan.com/api/v1/qr/resolve?token=${encodeURIComponent(token)}`;
    }
    const query = encodeURIComponent(`token=${token}`);
    return `weixin://dl/business/?appid=${encodeURIComponent(appId)}&path=pages/scan/resolve&query=${query}`;
  }

  private escapeHtml(value: string) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  private escapeAttr(value: string) {
    return this.escapeHtml(value);
  }
}
