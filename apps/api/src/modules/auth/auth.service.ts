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
import { WechatLoginDto } from './dto/wechat-login.dto';

interface WechatCodeSessionResponse {
  openid?: unknown;
  session_key?: unknown;
  unionid?: unknown;
  errcode?: unknown;
  errmsg?: unknown;
}

interface WechatIdentity {
  openid: string;
  unionid?: string;
}

@Injectable()
export class AuthService {
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
        merchant: true,
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
          id: staff.merchant.id,
          nameZh: staff.merchant.nameZh,
          status: staff.merchant.status,
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
          select: {
            id: true,
            nameZh: true,
            status: true,
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
          id: staff.merchant.id,
          nameZh: staff.merchant.nameZh,
          status: staff.merchant.status,
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
