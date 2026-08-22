import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { AuthService } from '../auth/auth.service';

type CachedLaunchTarget = {
  target: string;
  refreshAt: number;
  expiresAt: number;
};

type WechatSchemeResponse = {
  errcode?: unknown;
  errmsg?: unknown;
  openlink?: unknown;
};

const MINI_PROGRAM_PATH = 'pages/scan/resolve';
const SCHEME_VALID_DAYS = 30;
const REFRESH_AHEAD_MS = 24 * 60 * 60 * 1000;
const REFRESH_RETRY_MS = 5 * 60 * 1000;

@Injectable()
export class WechatMiniProgramLaunchService {
  private readonly targetCache = new Map<string, CachedLaunchTarget>();
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly config: ConfigService,
    private readonly authService: AuthService,
  ) {}

  async getLaunchTarget(token: string) {
    const now = Date.now();
    const cacheKey = createHash('sha256').update(token).digest('hex');
    const cached = this.targetCache.get(cacheKey);
    if (cached && cached.refreshAt > now) {
      return cached.target;
    }

    const existingRequest = this.inFlight.get(cacheKey);
    if (existingRequest) {
      return this.awaitWithCachedFallback(existingRequest, cached, now);
    }

    const request = this.generateOfficialScheme(token);
    this.inFlight.set(cacheKey, request);
    try {
      const target = await request;
      const generatedAt = Date.now();
      const expiresAt = generatedAt + SCHEME_VALID_DAYS * 24 * 60 * 60 * 1000;
      this.targetCache.set(cacheKey, {
        target,
        expiresAt,
        refreshAt: expiresAt - REFRESH_AHEAD_MS,
      });
      this.pruneExpiredTargets(now);
      return target;
    } catch {
      if (cached && cached.expiresAt > now) {
        cached.refreshAt = Math.min(now + REFRESH_RETRY_MS, cached.expiresAt);
        return cached.target;
      }
      throw new ServiceUnavailableException('微信小程序官方唤起能力暂不可用');
    } finally {
      if (this.inFlight.get(cacheKey) === request) {
        this.inFlight.delete(cacheKey);
      }
    }
  }

  private async awaitWithCachedFallback(
    request: Promise<string>,
    cached: CachedLaunchTarget | undefined,
    now: number,
  ) {
    try {
      return await request;
    } catch {
      if (cached && cached.expiresAt > now) {
        return cached.target;
      }
      throw new ServiceUnavailableException('微信小程序官方唤起能力暂不可用');
    }
  }

  private async generateOfficialScheme(token: string) {
    const appId = this.config.get<string>('WECHAT_APP_ID')?.trim();
    const appSecret = this.config.get<string>('WECHAT_APP_SECRET')?.trim();
    if (!appId || !appSecret) {
      throw new ServiceUnavailableException('微信小程序配置缺失');
    }

    const accessToken = await this.authService.getWechatAccessToken(appId, appSecret);
    const response = await fetch(
      `https://api.weixin.qq.com/wxa/generatescheme?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jump_wxa: {
            path: MINI_PROGRAM_PATH,
            query: `token=${token}`,
            env_version: 'release',
          },
          is_expire: true,
          expire_type: 1,
          expire_interval: SCHEME_VALID_DAYS,
        }),
      },
    );

    let payload: WechatSchemeResponse;
    try {
      payload = (await response.json()) as WechatSchemeResponse;
    } catch {
      throw new ServiceUnavailableException('微信小程序官方唤起接口响应无效');
    }

    const openLink = typeof payload.openlink === 'string' ? payload.openlink.trim() : '';
    if (
      !response.ok ||
      payload.errcode !== 0 ||
      !this.isOfficialEncryptedScheme(openLink, token)
    ) {
      throw new ServiceUnavailableException('微信小程序官方唤起接口调用失败');
    }

    return openLink;
  }

  private isOfficialEncryptedScheme(target: string, token: string) {
    if (!target || target.includes(token)) return false;
    try {
      const parsed = new URL(target);
      return (
        parsed.protocol === 'weixin:' &&
        parsed.hostname === 'dl' &&
        parsed.pathname === '/business/' &&
        Boolean(parsed.searchParams.get('t')) &&
        [...parsed.searchParams.keys()].every((key) => key === 't')
      );
    } catch {
      return false;
    }
  }

  private pruneExpiredTargets(now: number) {
    for (const [cacheKey, cached] of this.targetCache) {
      if (cached.expiresAt <= now) {
        this.targetCache.delete(cacheKey);
      }
    }
  }
}
