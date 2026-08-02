import {
  BadGatewayException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
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
      update: jest.fn(),
    },
    merchantStaff: {
      findMany: jest.fn(),
      update: jest.fn(),
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
    prisma.user.update.mockResolvedValue(user);
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

  it('signs merchant staff sessions for 30 days without changing user sessions', async () => {
    const merchantStaff = {
      id: 9n,
      merchantId: 7n,
      username: 'cashier',
      passwordHash: await bcrypt.hash('merchant-password', 4),
      displayName: 'Cashier',
      role: 'CASHIER',
      mustChangePassword: false,
      merchant: { id: 7n, status: 'ACTIVE', capabilities: [] },
    };
    prisma.merchantStaff.findMany.mockResolvedValue([merchantStaff]);
    prisma.merchantStaff.update.mockResolvedValue(merchantStaff);

    await service.loginMerchant({ username: 'cashier', password: 'merchant-password' });

    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({ accountType: 'MERCHANT_STAFF' }),
      { expiresIn: '30d' },
    );
  });

  it('issues merchant JWT claims with a 30-day iat-to-exp interval', async () => {
    const merchantStaff = {
      id: 10n,
      merchantId: 8n,
      username: 'cashier-30d',
      passwordHash: await bcrypt.hash('merchant-password', 4),
      displayName: 'Cashier 30d',
      role: 'CASHIER',
      mustChangePassword: false,
      merchant: { id: 8n, nameZh: 'Test', status: 'ACTIVE', capabilities: [] },
    };
    prisma.merchantStaff.findMany.mockResolvedValue([merchantStaff]);
    prisma.merchantStaff.update.mockResolvedValue(merchantStaff);
    const realJwtService = new JwtService({ secret: 'test-merchant-session-secret' });
    const realService = new AuthService(
      prisma as never,
      realJwtService,
      configService as unknown as ConfigService,
    );

    const result = await realService.loginMerchant({
      username: 'cashier-30d',
      password: 'merchant-password',
    });
    const claims = realJwtService.decode(result.accessToken) as { iat: number; exp: number };

    expect(claims.exp - claims.iat).toBe(30 * 24 * 60 * 60);
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

  it('binds phone from WeChat phone code and stores it on the current user', async () => {
    const phone = '84912345678';
    const purePhone = '912345678';
    const accessToken = 'access-token-123';
    const updatedUser = { ...user, phone };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: accessToken, expires_in: 7200 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          errcode: 0,
          phone_info: {
            phoneNumber: phone,
            purePhoneNumber: purePhone,
            countryCode: '84',
          },
        }),
      );
    global.fetch = fetchMock;
    prisma.user.update.mockResolvedValueOnce(updatedUser);

    const result = await service.bindWechatPhone(
      { sub: '1', accountType: 'USER', openid: user.openid },
      { code: 'phone-code' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(fetchMock.mock.calls[0][0]).origin + new URL(fetchMock.mock.calls[0][0]).pathname).toBe(
      'https://api.weixin.qq.com/cgi-bin/token',
    );
    expect(new URL(fetchMock.mock.calls[1][0]).origin + new URL(fetchMock.mock.calls[1][0]).pathname).toBe(
      'https://api.weixin.qq.com/wxa/business/getuserphonenumber',
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1n },
        data: { phone },
      }),
    );
    expect(result.phone).toBe(phone);
    expect(serialize(result)).not.toContain('session_key');
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
