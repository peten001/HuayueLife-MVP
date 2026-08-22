import {
  GoneException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Response } from 'express';
import { QrBridgeController } from './qr-bridge.controller';
import { QrService } from './qr.service';
import { WechatMiniProgramLaunchService } from './wechat-mini-program-launch.service';

describe('QrBridgeController', () => {
  const token = 'a'.repeat(64);
  const officialScheme = 'weixin://dl/business/?t=OfficialTicket_123';
  const resolve = jest.fn();
  const getLaunchTarget = jest.fn();
  let controller: QrBridgeController;

  beforeEach(() => {
    jest.clearAllMocks();
    getLaunchTarget.mockResolvedValue(officialScheme);
    controller = new QrBridgeController(
      { resolve } as unknown as QrService,
      { getLaunchTarget } as unknown as WechatMiniProgramLaunchService,
    );
  });

  it('resolves a valid token before returning the official mini-program bridge', async () => {
    resolve.mockResolvedValue({
      merchant: { id: 4n, nameZh: '测试餐厅', nameVi: null },
      table: { id: 18n, tableNo: 'A01', tableName: '靠窗桌' },
      orderType: 'DINE_IN',
      tableToken: token,
    });
    const response = responseHarness();

    await controller.bridge(token, response.value);

    expect(resolve).toHaveBeenCalledWith({ token });
    expect(getLaunchTarget).toHaveBeenCalledWith(token);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.body()).toContain(officialScheme);
    expect(response.body().split(officialScheme)).toHaveLength(3);
    expect(response.body()).not.toContain('appid=');
    expect(response.body()).not.toContain('path=pages/scan/resolve');
    expect(response.body()).not.toContain('/api/v1/qr/resolve');
    expect(response.body()).not.toContain(token);
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it.each([
    ['invalid token', new NotFoundException('二维码无效或已换码'), 404],
    ['gray gate off', new GoneException('平台经营能力总开关已关闭'), 410],
  ])('returns a non-sensitive unavailable page for %s', async (_label, error, status) => {
    resolve.mockRejectedValue(error);
    const response = responseHarness();

    await controller.bridge(token, response.value);

    expect(response.status).toHaveBeenCalledWith(status);
    expect(response.body()).toContain('二维码暂不可用');
    expect(response.body()).not.toContain(token);
    expect(response.body()).not.toContain('测试餐厅');
    expect(response.body()).not.toContain('A01');
    expect(getLaunchTarget).not.toHaveBeenCalled();
  });

  it('returns a non-sensitive unavailable page when the official launch API fails', async () => {
    resolve.mockResolvedValue({
      merchant: { id: 4n, nameZh: '测试餐厅', nameVi: null },
      table: { id: 18n, tableNo: 'A01', tableName: '靠窗桌' },
      orderType: 'DINE_IN',
      tableToken: token,
    });
    getLaunchTarget.mockRejectedValue(
      new ServiceUnavailableException('微信小程序官方唤起能力暂不可用'),
    );
    const response = responseHarness();

    await controller.bridge(token, response.value);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.body()).toContain('二维码暂不可用');
    expect(response.body()).not.toContain(token);
    expect(response.body()).not.toContain('测试餐厅');
    expect(response.body()).not.toContain('A01');
    expect(response.body()).not.toContain('/api/v1/qr/resolve');
  });
});

function responseHarness() {
  const headers = new Map<string, string>();
  let sentBody = '';
  const status = jest.fn();
  const send = jest.fn((body: string) => {
    sentBody = body;
  });
  const value = {
    setHeader: jest.fn((name: string, value: string) => {
      headers.set(name, value);
    }),
    status,
    send,
  };
  status.mockReturnValue(value);

  return {
    value: value as unknown as Response,
    status,
    headers,
    body: () => sentBody,
  };
}
