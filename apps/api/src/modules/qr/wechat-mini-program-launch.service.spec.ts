import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth/auth.service';
import { WechatMiniProgramLaunchService } from './wechat-mini-program-launch.service';

describe('WechatMiniProgramLaunchService', () => {
  const token = 'a'.repeat(64);
  const officialScheme = 'weixin://dl/business/?t=OfficialTicket_123';
  const getWechatAccessToken = jest.fn();
  const configValues = new Map<string, string>();
  const config = {
    get: jest.fn((key: string) => configValues.get(key)),
  };
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let service: WechatMiniProgramLaunchService;

  beforeEach(() => {
    jest.clearAllMocks();
    configValues.clear();
    configValues.set('WECHAT_APP_ID', 'wx-test-app-id');
    configValues.set('WECHAT_APP_SECRET', 'test-app-secret');
    getWechatAccessToken.mockResolvedValue('test-access-token');
    fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
    service = new WechatMiniProgramLaunchService(
      config as unknown as ConfigService,
      { getWechatAccessToken } as unknown as AuthService,
    );
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('uses the official generateScheme response verbatim with the exact release target', async () => {
    fetchMock.mockResolvedValue(wechatResponse({
      errcode: 0,
      errmsg: 'ok',
      openlink: officialScheme,
    }));

    await expect(service.getLaunchTarget(token)).resolves.toBe(officialScheme);
    await expect(service.getLaunchTarget(token)).resolves.toBe(officialScheme);

    expect(getWechatAccessToken).toHaveBeenCalledWith(
      'wx-test-app-id',
      'test-app-secret',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.weixin.qq.com/wxa/generatescheme?access_token=test-access-token',
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      jump_wxa: {
        path: 'pages/scan/resolve',
        query: `token=${token}`,
        env_version: 'release',
      },
      is_expire: true,
      expire_type: 1,
      expire_interval: 30,
    });
  });

  it('uses a still-valid cached target if an early refresh temporarily fails', async () => {
    const now = 1_800_000_000_000;
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(now);
    fetchMock.mockResolvedValueOnce(wechatResponse({
      errcode: 0,
      errmsg: 'ok',
      openlink: officialScheme,
    }));
    await expect(service.getLaunchTarget(token)).resolves.toBe(officialScheme);

    dateNow.mockReturnValue(now + 29 * 24 * 60 * 60 * 1000 + 1);
    fetchMock.mockRejectedValueOnce(new Error('temporary network failure'));
    await expect(service.getLaunchTarget(token)).resolves.toBe(officialScheme);

    dateNow.mockReturnValue(now + 30 * 24 * 60 * 60 * 1000 + 1);
    fetchMock.mockRejectedValueOnce(new Error('continued network failure'));
    await expect(service.getLaunchTarget(token)).rejects.toMatchObject({
      status: 503,
    });
    dateNow.mockRestore();
  });

  it.each([
    [
      'official API error',
      { errcode: 85407, errmsg: 'no scheme permission' },
    ],
    [
      'hand-crafted scheme',
      {
        errcode: 0,
        errmsg: 'ok',
        openlink:
          'weixin://dl/business/?appid=wx-test-app-id&path=pages/scan/resolve&query=token%3D' +
          token,
      },
    ],
    [
      'direct resolver URL',
      {
        errcode: 0,
        errmsg: 'ok',
        openlink: `https://api.huayueyouxuan.com/api/v1/qr/resolve?token=${token}`,
      },
    ],
  ])('fails closed for %s', async (_label, payload) => {
    fetchMock.mockResolvedValue(wechatResponse(payload));

    await expect(service.getLaunchTarget(token)).rejects.toMatchObject({
      status: 503,
    });
  });

  it('fails closed without calling WeChat when server credentials are incomplete', async () => {
    configValues.delete('WECHAT_APP_SECRET');

    await expect(service.getLaunchTarget(token)).rejects.toMatchObject({
      status: 503,
    });
    expect(getWechatAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function wechatResponse(payload: object) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
