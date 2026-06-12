import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthUser } from '../../common/types/auth-user.type';
import { PlatformLoginDto } from './dto/platform-login.dto';

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(dto: PlatformLoginDto) {
    const username = this.getPlatformUsername();
    if (dto.username.trim() !== username) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const passwordHash = this.getPlatformPasswordHash();
    const passwordMatches = await bcrypt.compare(dto.password, passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: AuthUser = {
      sub: username,
      accountType: 'PLATFORM_ADMIN',
      username,
    };
    return {
      accessToken: this.jwtService.sign(payload),
      admin: {
        username,
      },
    };
  }

  private getPlatformUsername() {
    const username = this.configService.get<string>('SUPER_ADMIN_USERNAME')?.trim();
    if (!username) {
      throw new ServiceUnavailableException('平台管理员未配置');
    }
    return username;
  }

  private getPlatformPasswordHash() {
    const passwordHash = this.configService
      .get<string>('SUPER_ADMIN_PASSWORD_HASH')
      ?.trim();
    if (!passwordHash) {
      throw new ServiceUnavailableException('平台管理员未配置');
    }
    if (!passwordHash.startsWith('$2')) {
      throw new BadRequestException('平台管理员密码哈希无效');
    }
    return passwordHash;
  }
}
