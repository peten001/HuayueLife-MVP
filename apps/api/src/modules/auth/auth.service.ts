import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { AuthUser } from '../../common/types/auth-user.type';
import { MerchantLoginDto } from './dto/merchant-login.dto';
import { WechatLoginDto } from './dto/wechat-login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async loginWithWechat(dto: WechatLoginDto) {
    const openid = this.resolveDevelopmentOpenid(dto.code);
    const user = await this.prisma.user.upsert({
      where: { openid },
      update: {
        nickname: dto.nickname,
        lastLoginAt: new Date(),
      },
      create: {
        openid,
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
          status: {
            in: ['ACTIVE', 'CLOSED'],
          },
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
        merchant: {
          id: staff.merchant.id,
          nameZh: staff.merchant.nameZh,
          status: staff.merchant.status,
        },
      },
    };
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

  private resolveDevelopmentOpenid(code: string): string {
    if (this.configService.get<string>('NODE_ENV') === 'production') {
      throw new NotImplementedException(
        'Production WeChat code exchange is not configured',
      );
    }

    return `mock_${createHash('sha256').update(code).digest('hex').slice(0, 48)}`;
  }
}
