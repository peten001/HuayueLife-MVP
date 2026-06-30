import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { AuthUser } from '../../common/types/auth-user.type';
import { ChangeMerchantPasswordDto } from './dto/change-merchant-password.dto';
import { MerchantLoginDto } from './dto/merchant-login.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { WechatPhoneDto } from './dto/wechat-phone.dto';
import { WechatLoginDto } from './dto/wechat-login.dto';

interface WechatCodeSessionResponse {
  openid?: unknown;
  session_key?: unknown;
  unionid?: unknown;
  errcode?: unknown;
  errmsg?: unknown;
}

interface WechatAccessTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  errcode?: unknown;
  errmsg?: unknown;
}

interface WechatPhoneResponse {
  errcode?: unknown;
  errmsg?: unknown;
  phone_info?: {
    phoneNumber?: unknown;
    purePhoneNumber?: unknown;
    countryCode?: unknown;
  };
}

interface WechatIdentity {
  openid: string;
  unionid?: string;
}

@Injectable()
export class AuthService {
  private wechatAccessTokenCache: { token: string; expiresAt: number } | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async loginWithWechat(dto: WechatLoginDto) {
    const identity = await this.resolveWechatIdentity(dto.code);
    const user = await this.prisma.user.upsert({
      where: { openid: identity.openid },
      update: {
        unionid: identity.unionid,
        nickname: dto.nickname,
        lastLoginAt: new Date(),
      },
      create: {
        openid: identity.openid,
        unionid: identity.unionid,
        nickname: dto.nickname ?? '微信用户',
        lastLoginAt: new Date(),
      },
    });

    const payload: AuthUser = {
      sub: user.id.toString(),
      accountType: 'USER',
      openid: user.openid,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        phone: user.phone,
      },
    };
  }

  async loginMerchant(dto: MerchantLoginDto) {
    const candidates = await this.prisma.merchantStaff.findMany({
      where: {
        username: dto.username,
        status: 'ACTIVE',
        merchant: {
          status: 'ACTIVE',
        },
      },
      include: {
        merchant: {
          include: {
            capabilities: { include: { capability: true } },
          },
        },
      },
      take: 2,
    });

    if (candidates.length !== 1) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const staff = candidates[0];
    const passwordMatches = await bcrypt.compare(dto.password, staff.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.merchantStaff.update({
      where: { id: staff.id },
      data: { lastLoginAt: new Date() },
    });

    const payload: AuthUser = {
      sub: staff.id.toString(),
      accountType: 'MERCHANT_STAFF',
      merchantId: staff.merchantId.toString(),
      role: staff.role,
      username: staff.username,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      staff: {
        id: staff.id,
        displayName: staff.displayName,
        role: staff.role,
        mustChangePassword: staff.mustChangePassword,
        merchant: {
          ...this.serializeMerchantForSession(staff.merchant),
        },
      },
    };
  }

  async getMerchantProfile(user: AuthUser) {
    if (user.accountType !== 'MERCHANT_STAFF') {
      throw new ForbiddenException('Merchant staff account required');
    }
    const staff = await this.prisma.merchantStaff.findUnique({
      where: { id: BigInt(user.sub) },
      include: {
        merchant: {
          include: {
            capabilities: { include: { capability: true } },
          },
        },
      },
    });
    if (!staff) {
      throw new NotFoundException('Merchant staff not found');
    }
    return {
      user: {
        sub: staff.id.toString(),
        accountType: 'MERCHANT_STAFF' as const,
        merchantId: staff.merchantId.toString(),
        role: staff.role,
        username: staff.username,
        mustChangePassword: staff.mustChangePassword,
        merchant: {
          ...this.serializeMerchantForSession(staff.merchant),
        },
      },
    };
  }

  async changeMerchantPassword(user: AuthUser, dto: ChangeMerchantPasswordDto) {
    if (user.accountType !== 'MERCHANT_STAFF') {
      throw new ForbiddenException('Merchant staff account required');
    }
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const staff = await this.prisma.merchantStaff.findUnique({
      where: { id: BigInt(user.sub) },
      select: {
        id: true,
        passwordHash: true,
      },
    });
    if (!staff) {
      throw new NotFoundException('Merchant staff not found');
    }

    const passwordMatches = await bcrypt.compare(
      dto.currentPassword,
      staff.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.merchantStaff.update({
      where: { id: staff.id },
      data: {
        passwordHash,
        mustChangePassword: false,
      },
    });

    return { mustChangePassword: false };
  }

  async getUserProfile(user: AuthUser) {
    if (user.accountType !== 'USER') {
      throw new ForbiddenException('User account required');
    }
    const profile = await this.prisma.user.findUnique({
      where: { id: BigInt(user.sub) },
      select: {
        id: true,
        nickname: true,
        avatarUrl: true,
        phone: true,
        status: true,
        lastLoginAt: true,
      },
    });
    if (!profile) {
      throw new NotFoundException('User not found');
    }
    return profile;
  }

  async updateUserProfile(user: AuthUser, dto: UpdateMeDto) {
    if (user.accountType !== 'USER') {
      throw new ForbiddenException('User account required');
    }

    const data = stripUndefined({
      nickname: trimOrUndefined(dto.nickname),
      avatarUrl: trimOrUndefined(dto.avatarUrl),
      phone: trimOrUndefined(dto.phone),
    });

    if (Object.keys(data).length === 0) {
      return this.getUserProfile(user);
    }

    const updated = await this.prisma.user.update({
      where: { id: BigInt(user.sub) },
      data,
      select: {
        id: true,
        nickname: true,
        avatarUrl: true,
        phone: true,
        status: true,
        lastLoginAt: true,
      },
    });

    return updated;
  }

  async bindWechatPhone(user: AuthUser, dto: WechatPhoneDto) {
    if (user.accountType !== 'USER') {
      throw new ForbiddenException('User account required');
    }
    if (!dto.code.trim()) {
      throw new BadRequestException('Phone code is required');
    }

    if (this.configService.get<string>('NODE_ENV') !== 'production' && /^mock[_-]/i.test(dto.code)) {
      throw new BadRequestException('生产环境不允许使用 mock 手机号 code');
    }

    if (dto.encryptedData || dto.iv) {
      // Keep compatibility for callers that still pass legacy fields, but the
      // backend binds via the new phone code flow.
    }

    const phone = await this.resolveWechatPhoneNumber(dto.code);
    const updated = await this.prisma.user.update({
      where: { id: BigInt(user.sub) },
      data: { phone },
      select: {
        id: true,
        nickname: true,
        avatarUrl: true,
        phone: true,
        status: true,
        lastLoginAt: true,
      },
    });

    return {
      phone: updated.phone,
      user: updated,
    };
  }

  private async resolveWechatIdentity(code: string): Promise<WechatIdentity> {
    if (this.configService.get<string>('NODE_ENV') !== 'production') {
      return {
        openid: `mock_${createHash('sha256')
          .update(code)
          .digest('hex')
          .slice(0, 48)}`,
      };
    }

    if (/^mock[_-]/i.test(code)) {
      throw new BadRequestException('生产环境不允许使用 mock 微信登录 code');
    }

    const appId = this.configService.get<string>('WECHAT_APP_ID')?.trim();
    const appSecret = this.configService
      .get<string>('WECHAT_APP_SECRET')
      ?.trim();
    if (!appId || !appSecret) {
      throw new ServiceUnavailableException('微信登录服务尚未配置');
    }

    const query = new URLSearchParams({
      appid: appId,
      secret: appSecret,
      js_code: code,
      grant_type: 'authorization_code',
    });

    let response: Response;
    try {
      response = await fetch(
        `https://api.weixin.qq.com/sns/jscode2session?${query.toString()}`,
        {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        },
      );
    } catch {
      throw new BadGatewayException('微信登录服务暂时不可用');
    }
    if (!response.ok) {
      throw new BadGatewayException('微信登录服务返回异常');
    }

    let result: WechatCodeSessionResponse;
    try {
      result = (await response.json()) as WechatCodeSessionResponse;
    } catch {
      throw new BadGatewayException('微信登录服务返回无效数据');
    }

    if (typeof result.errcode === 'number' && result.errcode !== 0) {
      throw new UnauthorizedException('微信登录 code 无效或已过期');
    }
    if (
      typeof result.openid !== 'string' ||
      !result.openid.trim() ||
      typeof result.session_key !== 'string' ||
      !result.session_key.trim()
    ) {
      throw new BadGatewayException('微信登录响应缺少必要字段');
    }
    if (
      result.unionid !== undefined &&
      (typeof result.unionid !== 'string' || !result.unionid.trim())
    ) {
      throw new BadGatewayException('微信登录响应 unionid 无效');
    }

    return {
      openid: result.openid,
      unionid:
        typeof result.unionid === 'string' ? result.unionid : undefined,
    };
  }

  private async resolveWechatPhoneNumber(code: string) {
    const appId = this.configService.get<string>('WECHAT_APP_ID')?.trim();
    const appSecret = this.configService.get<string>('WECHAT_APP_SECRET')?.trim();
    if (!appId || !appSecret) {
      throw new ServiceUnavailableException('微信手机号绑定服务尚未配置');
    }

    const accessToken = await this.getWechatAccessToken(appId, appSecret);
    let response: Response;
    try {
      response = await fetch(
        `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(
          accessToken,
        )}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code }),
          signal: AbortSignal.timeout(5000),
        },
      );
    } catch {
      throw new BadGatewayException('微信手机号绑定服务暂时不可用');
    }

    let payload: WechatPhoneResponse;
    try {
      payload = (await response.json()) as WechatPhoneResponse;
    } catch {
      throw new BadGatewayException('微信手机号绑定服务返回无效数据');
    }

    if (!response.ok || (typeof payload.errcode === 'number' && payload.errcode !== 0)) {
      throw new BadGatewayException(payload.errmsg || '微信手机号绑定失败');
    }

    const phoneInfo = payload.phone_info;
    const phoneNumber =
      typeof phoneInfo?.phoneNumber === 'string'
        ? phoneInfo.phoneNumber.trim()
        : '';
    const purePhoneNumber =
      typeof phoneInfo?.purePhoneNumber === 'string'
        ? phoneInfo.purePhoneNumber.trim()
        : '';
    const countryCode =
      typeof phoneInfo?.countryCode === 'string'
        ? phoneInfo.countryCode.trim()
        : '';

    const resolvedPhone = phoneNumber || purePhoneNumber;
    if (!resolvedPhone) {
      throw new BadGatewayException('微信手机号绑定响应缺少手机号');
    }

    return countryCode && resolvedPhone === purePhoneNumber
      ? `${countryCode}${resolvedPhone}`
      : resolvedPhone;
  }

  private async getWechatAccessToken(appId: string, appSecret: string) {
    const cached = this.wechatAccessTokenCache;
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const response = await fetch(
      'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' +
        encodeURIComponent(appId) +
        '&secret=' +
        encodeURIComponent(appSecret),
    );
    let payload: WechatAccessTokenResponse;
    try {
      payload = (await response.json()) as WechatAccessTokenResponse;
    } catch {
      throw new BadGatewayException('微信 access_token 获取失败');
    }

    if (!response.ok || !payload.access_token) {
      throw new BadGatewayException(
        (typeof payload.errmsg === 'string' && payload.errmsg) || '微信 access_token 获取失败',
      );
    }

    const expiresIn = Math.max(0, Number(payload.expires_in ?? 7200));
    this.wechatAccessTokenCache = {
      token: String(payload.access_token),
      expiresAt: Date.now() + (expiresIn - 300) * 1000,
    };
    return String(payload.access_token);
  }

  private serializeMerchantForSession(merchant: {
    id: bigint;
    nameZh: string;
    status: string;
    merchantMode?: string;
    reportFeatureEnabled?: boolean;
    dineInEnabled?: boolean;
    pickupEnabled?: boolean;
    deliveryEnabled?: boolean;
    capabilities?: Array<{
      isEnabled: boolean;
      capability: {
        code: string;
        nameZh: string;
        groupCode?: string;
      };
    }>;
  }) {
    const explicitCapabilities = (merchant.capabilities ?? []).map((item) => ({
      code: item.capability.code,
      nameZh: item.capability.nameZh,
      groupCode: item.capability.groupCode,
      isEnabled: item.isEnabled,
    }));
    const capabilities = explicitCapabilities.length
      ? explicitCapabilities
      : fallbackCapabilitiesFromLegacyFields(merchant);
    return {
      id: merchant.id,
      nameZh: merchant.nameZh,
      status: merchant.status,
      merchantMode: merchant.merchantMode,
      reportFeatureEnabled: Boolean(merchant.reportFeatureEnabled),
      capabilities,
    };
  }
}

function fallbackCapabilitiesFromLegacyFields(merchant: {
  dineInEnabled?: boolean;
  pickupEnabled?: boolean;
  deliveryEnabled?: boolean;
  reportFeatureEnabled?: boolean;
}) {
  const dineInEnabled = Boolean(merchant.dineInEnabled);
  const pickupEnabled = Boolean(merchant.pickupEnabled);
  const deliveryEnabled = Boolean(merchant.deliveryEnabled);
  const hasOrder = dineInEnabled || pickupEnabled || deliveryEnabled;
  return [
    { code: 'phoneEnabled', nameZh: '电话', groupCode: 'DISPLAY', isEnabled: true },
    { code: 'navigationEnabled', nameZh: '导航', groupCode: 'DISPLAY', isEnabled: true },
    { code: 'imageGalleryEnabled', nameZh: '图片/相册展示', groupCode: 'DISPLAY', isEnabled: true },
    { code: 'productDisplayEnabled', nameZh: '商品展示', groupCode: 'PRODUCT', isEnabled: hasOrder },
    { code: 'onlineOrderEnabled', nameZh: '在线下单（兼容）', groupCode: 'ORDER', isEnabled: pickupEnabled || deliveryEnabled },
    { code: 'pickupEnabled', nameZh: '到店自取', groupCode: 'ORDER', isEnabled: pickupEnabled },
    { code: 'deliveryEnabled', nameZh: '商家配送', groupCode: 'ORDER', isEnabled: deliveryEnabled },
    { code: 'qrOrderEnabled', nameZh: '到店扫码点餐', groupCode: 'RESTAURANT', isEnabled: dineInEnabled },
    { code: 'tableManagementEnabled', nameZh: '桌台管理', groupCode: 'RESTAURANT', isEnabled: dineInEnabled },
    { code: 'printerEnabled', nameZh: '打印机', groupCode: 'RESTAURANT', isEnabled: hasOrder },
    { code: 'zaloReportEnabled', nameZh: 'Zalo 日报', groupCode: 'OPERATION', isEnabled: Boolean(merchant.reportFeatureEnabled) },
    { code: 'chatEnabled', nameZh: '订单聊天', groupCode: 'ORDER', isEnabled: hasOrder },
    { code: 'voiceNotifyEnabled', nameZh: '语音播报', groupCode: 'RESTAURANT', isEnabled: hasOrder },
  ];
}

function trimOrUndefined(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}
