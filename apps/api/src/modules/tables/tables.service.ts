import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';

type WechatAccessTokenCache = {
  token: string;
  expiresAt: number;
};

type WechatMiniProgramEnvVersion = 'release' | 'trial' | 'develop';

@Injectable()
export class TablesService {
  private accessTokenCache: WechatAccessTokenCache | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  list(merchantId: bigint) {
    return this.prisma.diningTable.findMany({
      where: { merchantId },
      orderBy: [{ tableNo: 'asc' }, { id: 'asc' }],
    });
  }

  create(merchantId: bigint, dto: CreateTableDto) {
    return this.prisma.diningTable.create({
      data: {
        merchantId,
        tableNo: dto.tableNo,
        tableName: dto.tableName,
        qrToken: this.generateToken(),
      },
    });
  }

  async update(merchantId: bigint, id: bigint, dto: UpdateTableDto) {
    await this.requireOwnedTable(merchantId, id);
    return this.prisma.diningTable.update({
      where: { id },
      data: dto,
    });
  }

  async disable(merchantId: bigint, id: bigint) {
    await this.requireOwnedTable(merchantId, id);
    return this.prisma.diningTable.update({
      where: { id },
      data: { status: 'DISABLED' },
    });
  }

  async enable(merchantId: bigint, id: bigint) {
    await this.requireOwnedTable(merchantId, id);
    return this.prisma.diningTable.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });
  }

  async rotateQr(merchantId: bigint, id: bigint) {
    await this.requireOwnedTable(merchantId, id);
    return this.prisma.diningTable.update({
      where: { id },
      data: {
        qrToken: this.generateToken(),
        qrVersion: { increment: 1 },
      },
    });
  }

  async qrImage(merchantId: bigint, id: bigint) {
    const table = await this.requireOwnedTable(merchantId, id);
    const image = await this.buildWechatMiniProgramCode(table);
    return { table, image };
  }

  buildScene(table: { id: bigint; qrVersion: number }) {
    return `t${table.id.toString()}v${table.qrVersion}`;
  }

  private async buildWechatMiniProgramCode(table: {
    id: bigint;
    qrVersion: number;
  }) {
    const appId = this.config.get<string>('WECHAT_APP_ID')?.trim();
    const appSecret = this.config.get<string>('WECHAT_APP_SECRET')?.trim();
    const envVersion = this.resolveMiniappQrEnvVersion();
    if (!appId || !appSecret) {
      throw new BadGatewayException('微信小程序配置缺失');
    }

    const accessToken = await this.getWechatAccessToken(appId, appSecret);
    const scene = this.buildScene(table);
    const response = await fetch(
      `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scene,
          page: 'pages/scan/resolve',
          check_path: false,
          env_version: envVersion,
          is_hyaline: false,
        }),
      },
    );

    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || contentType.includes('application/json')) {
      const message = await this.readWechatError(response);
      throw new BadGatewayException(message || '微信小程序码生成失败');
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private resolveMiniappQrEnvVersion(): WechatMiniProgramEnvVersion {
    const qrEnvVersion = this.normalizeMiniappEnvVersion(
      this.config.get<string>('WECHAT_MINIAPP_QR_ENV_VERSION')?.trim(),
    );
    if (qrEnvVersion) {
      return qrEnvVersion;
    }

    if (this.isProductionRuntime()) {
      return 'release';
    }

    return (
      this.normalizeMiniappEnvVersion(
        this.config.get<string>('WECHAT_MINIAPP_ENV_VERSION')?.trim(),
      ) ?? 'release'
    );
  }

  private normalizeMiniappEnvVersion(
    value?: string,
  ): WechatMiniProgramEnvVersion | null {
    if (value === 'release' || value === 'trial' || value === 'develop') {
      return value;
    }

    return null;
  }

  private isProductionRuntime() {
    const nodeEnv = this.config.get<string>('NODE_ENV')?.trim().toLowerCase();
    return (
      nodeEnv === 'production' ||
      nodeEnv === 'prod' ||
      nodeEnv === 'release'
    );
  }

  private async getWechatAccessToken(appId: string, appSecret: string) {
    const cached = this.accessTokenCache;
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const response = await fetch(
      'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' +
        encodeURIComponent(appId) +
        '&secret=' +
        encodeURIComponent(appSecret),
    );
    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      errcode?: number;
      errmsg?: string;
    };
    if (!response.ok || !payload.access_token) {
      throw new BadGatewayException(
        payload.errmsg || '微信 access_token 获取失败',
      );
    }

    const expiresIn = Math.max(0, Number(payload.expires_in ?? 7200));
    this.accessTokenCache = {
      token: payload.access_token,
      expiresAt: Date.now() + (expiresIn - 300) * 1000,
    };
    return payload.access_token;
  }

  private async readWechatError(response: Response) {
    const text = await response.text();
    try {
      const payload = JSON.parse(text) as { errmsg?: string; errcode?: number };
      return payload.errmsg || text;
    } catch {
      return text;
    }
  }

  private async requireOwnedTable(merchantId: bigint, id: bigint) {
    const table = await this.prisma.diningTable.findFirst({
      where: { id, merchantId },
    });
    if (!table) {
      throw new NotFoundException('Dining table not found');
    }
    return table;
  }

  private generateToken() {
    return randomBytes(32).toString('hex');
  }
}
