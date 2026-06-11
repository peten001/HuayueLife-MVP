import {
  BadGatewayException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';

describe('AuthService WeChat login', () => {
  const appId = 'wx-test-app-id';
  const appSecret = 'super-secret-app-value';
  const code = 'valid-one-time-code';
  const sessionKey = 'private-session-key';
  const user = {
    id: 1n,
    openid: 'openid-001',
    unionid: 'unionid-001',
    nickname: '微信用户',
    avatarUrl: null,
    phone: null,
  };
  const prisma = {
    user: {
      upsert: jest.fn(),
    },
  };
  const jwtService = {
    sign: jest.fn().mockReturnValue('project-jwt'),
  };
  const config = new Map<string, string>();
  const configService = {
    get: jest.fn((key: string) => config.get(key)),
  };
  let service: AuthService;
  let originalFetch: typeof global.fetch;
  let consoleLog: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    config.clear();
    config.set('NODE_ENV', 'production');
    config.set('WECHAT_APP_ID', appId);
    config.set('WECHAT_APP_SECRET', appSecret);
    prisma.user.upsert.mockResolvedValue(user);
    consoleLog = jest.spyOn(console, 'log').mockImplementation();
    consoleError = jest.spyOn(console, 'error').mockImplementation();
    service = new AuthService(
      prisma as never,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
    );
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('exchanges a real code and never returns session_key', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse({
        openid: user.openid,
        unionid: user.unionid,
        session_key: sessionKey,
      }),
    );
    global.fetch = fetchMock;

    const result = await service.loginWithWechat({ code });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.origin + calledUrl.pathname).toBe(
      'https://api.weixin.qq.com/sns/jscode2session',
    );
    expect(calledUrl.searchParams.get('appid')).toBe(appId);
    expect(calledUrl.searchParams.get('secret')).toBe(appSecret);
    expect(calledUrl.searchParams.get('js_code')).toBe(code);
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { openid: user.openid },
        update: expect.objectContaining({ unionid: user.unionid }),
      }),
    );
    expect(serialize(result)).not.toContain(sessionKey);
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(result.accessToken).toBe('project-jwt');
  });

  it('rejects WeChat errcode as an invalid or expired code', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse({ errcode: 40029, errmsg: 'invalid code' }),
      );

    await expect(service.loginWithWechat({ code: 'invalid-code' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it('rejects failed or incomplete WeChat responses', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network failed'));
    await expect(service.loginWithWechat({ code })).rejects.toBeInstanceOf(
      BadGatewayException,
    );

    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ openid: user.openid }));
    await expect(service.loginWithWechat({ code })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('forbids mock codes in production without calling WeChat', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    await expect(
      service.loginWithWechat({ code: 'mock_test_code' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps development mock login without exposing sensitive values', async () => {
    config.set('NODE_ENV', 'development');
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const result = await service.loginWithWechat({ code: 'dev-code' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { openid: expect.stringMatching(/^mock_[a-f0-9]{48}$/) },
      }),
    );
    const serialized = serialize(result);
    expect(serialized).not.toContain(appSecret);
    expect(serialized).not.toContain('dev-code');
    expect(serialized).not.toContain(sessionKey);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function serialize(value: unknown) {
  return JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
}
