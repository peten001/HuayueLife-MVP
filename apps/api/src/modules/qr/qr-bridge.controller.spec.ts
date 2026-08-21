import { GoneException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { QrBridgeController } from './qr-bridge.controller';
import { QrService } from './qr.service';

describe('QrBridgeController', () => {
  const token = 'a'.repeat(64);
  const resolve = jest.fn();
  const config = {
    get: jest.fn((key: string) => (
      key === 'WECHAT_APP_ID' ? 'wx-test-app-id' : undefined
    )),
  };
  let controller: QrBridgeController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new QrBridgeController(
      { resolve } as unknown as QrService,
      config as unknown as ConfigService,
    );
  });

  it('resolves a valid token before returning the existing mini-program bridge', async () => {
    resolve.mockResolvedValue({
      merchant: { id: 4n, nameZh: '测试餐厅', nameVi: null },
      table: { id: 18n, tableNo: 'A01', tableName: '靠窗桌' },
      orderType: 'DINE_IN',
      tableToken: token,
    });
    const response = responseHarness();

    await controller.bridge(token, response.value);

    expect(resolve).toHaveBeenCalledWith({ token });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.body()).toContain('weixin://dl/business/');
    expect(response.body()).toContain('pages/scan/resolve');
    expect(response.body()).toContain(token);
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
