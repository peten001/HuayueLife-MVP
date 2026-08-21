import { Controller, Get, HttpException, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { QrService } from './qr.service';
import { WechatMiniProgramLaunchService } from './wechat-mini-program-launch.service';

@Controller()
export class QrBridgeController {
  constructor(
    private readonly service: QrService,
    private readonly launchService: WechatMiniProgramLaunchService,
  ) {}

  @Get('t/:token')
  async bridge(@Param('token') token: string, @Res() response: Response) {
    let resolved: Awaited<ReturnType<QrService['resolve']>>;
    try {
      resolved = await this.service.resolve({ token });
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 503;
      this.setSecurityHeaders(response);
      response.status(status).send(this.unavailableHtml());
      return;
    }
    let miniProgramScheme: string;
    try {
      miniProgramScheme = await this.launchService.getLaunchTarget(token);
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 503;
      this.setSecurityHeaders(response);
      response.status(status).send(this.unavailableHtml());
      return;
    }

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
      .hint { margin-top: 12px; font-size: 13px; color: #8c7f75; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>${this.escapeHtml(resolved.merchant.nameZh)}</h1>
        <p>桌号：${this.escapeHtml(resolved.table.tableName || resolved.table.tableNo)}</p>
        <p>正在打开点餐小程序...</p>
        <a id="launch" class="primary" href="${this.escapeAttr(miniProgramScheme)}" rel="noreferrer">打开小程序</a>
        <div class="hint">如果自动跳转失败，请在微信内打开并手动点击上方按钮。</div>
      </div>
    </div>
    <script>
      (function () {
        var launchUrl = ${JSON.stringify(miniProgramScheme)};
        window.location.href = launchUrl;
      })();
    </script>
  </body>
</html>`;

    this.setSecurityHeaders(response);
    response.status(200).send(html);
  }

  private setSecurityHeaders(response: Response) {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    );
  }

  private unavailableHtml() {
    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>二维码暂不可用</title>
    <style>
      body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f6f3ef; color: #2f241f; }
      main { min-height: 100vh; display: grid; place-items: center; padding: 24px; box-sizing: border-box; text-align: center; }
      section { width: min(92vw, 380px); padding: 28px 24px; border-radius: 20px; background: #fff; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08); }
      h1 { margin: 0 0 10px; font-size: 20px; }
      p { margin: 0; line-height: 1.6; color: #6d625a; }
    </style>
  </head>
  <body>
    <main><section><h1>二维码暂不可用</h1><p>请联系餐厅工作人员获取帮助。</p></section></main>
  </body>
</html>`;
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
