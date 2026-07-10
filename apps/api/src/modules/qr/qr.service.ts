import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AppConfigService } from '../app-config/app-config.service';
import type { ResolveQrQueryDto } from './dto/resolve-qr-query.dto';

@Injectable()
export class QrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appConfig: AppConfigService,
  ) {}

  async resolve(query: ResolveQrQueryDto) {
    this.appConfig.assertOrderingEnabled();
    const resolved = this.normalizeResolveQuery(query);
    if ('scene' in resolved) {
      return this.resolveByScene(resolved.scene);
    }
    return this.resolveByToken(resolved.token);
  }

  private async resolveByToken(token: string) {
    const table = await this.prisma.diningTable.findUnique({
      where: { qrToken: token },
      include: {
        merchant: {
          include: { capabilities: { include: { capability: true } } },
        },
      },
    });
    if (!table) {
      throw new NotFoundException('二维码无效或已换码');
    }
    if (table.status !== 'ACTIVE') {
      throw new GoneException('该桌台已停用');
    }
    if (
      table.merchant.status !== 'ACTIVE' ||
      table.merchant.merchantType !== 'RESTAURANT'
    ) {
      throw new GoneException('商家当前不可用');
    }
    if (!qrOrderEnabled(table.merchant)) {
      throw new GoneException('商家当前未开启堂食');
    }

    return {
      merchant: {
        id: table.merchant.id,
        nameZh: table.merchant.nameZh,
        nameVi: table.merchant.nameVi,
      },
      table: {
        id: table.id,
        tableNo: table.tableNo,
        tableName: table.tableName,
      },
      orderType: 'DINE_IN',
      tableToken: table.qrToken,
    };
  }

  private async resolveByScene(scene: string) {
    const matched = scene.match(/^t(\d+)v(\d+)$/);
    if (!matched) {
      throw new BadRequestException('二维码格式不正确');
    }
    const tableId = BigInt(matched[1]);
    const qrVersion = Number(matched[2]);
    const table = await this.prisma.diningTable.findUnique({
      where: { id: tableId },
      include: {
        merchant: {
          include: { capabilities: { include: { capability: true } } },
        },
      },
    });
    if (!table) {
      throw new NotFoundException('桌台不存在');
    }
    if (table.qrVersion !== qrVersion) {
      throw new GoneException('二维码已失效，请重新打印');
    }
    if (table.status !== 'ACTIVE') {
      throw new GoneException('该桌台已停用');
    }
    if (
      table.merchant.status !== 'ACTIVE' ||
      table.merchant.merchantType !== 'RESTAURANT'
    ) {
      throw new GoneException('商家当前不可用');
    }
    if (!qrOrderEnabled(table.merchant)) {
      throw new GoneException('商家当前未开启堂食');
    }

    return {
      merchant: {
        id: table.merchant.id,
        nameZh: table.merchant.nameZh,
        nameVi: table.merchant.nameVi,
      },
      table: {
        id: table.id,
        tableNo: table.tableNo,
        tableName: table.tableName,
      },
      orderType: 'DINE_IN',
      tableToken: table.qrToken,
    };
  }

  private normalizeResolveQuery(query: ResolveQrQueryDto):
    | { token: string }
    | { scene: string } {
    const token = this.normalizeToken(query.token);
    if (token) return { token };

    const scene = this.normalizeScene(query.scene);
    if (scene) return { scene };

    const fromQ = this.extractFromQ(query.q);
    if ('token' in fromQ && fromQ.token) return { token: fromQ.token };
    if ('scene' in fromQ && fromQ.scene) return { scene: fromQ.scene };

    throw new BadRequestException('二维码缺少参数');
  }

  private extractFromQ(q?: string): { token?: string; scene?: string } {
    const raw = this.decodeMaybe(q);
    if (!raw) return {};
    const token = this.matchToken(raw);
    if (token) return { token };
    const scene = this.matchScene(raw);
    if (scene) return { scene };
    return {};
  }

  private normalizeToken(token?: string) {
    const value = this.decodeMaybe(token);
    return value && this.matchToken(value);
  }

  private normalizeScene(scene?: string) {
    const value = this.decodeMaybe(scene);
    return value && this.matchScene(value);
  }

  private matchToken(value: string) {
    return /^[a-f0-9]{64}$/i.test(value) ? value : '';
  }

  private matchScene(value: string) {
    return /^t\d+v\d+$/.test(value) ? value : '';
  }

  private decodeMaybe(value?: string) {
    const raw = value?.trim();
    if (!raw) return '';
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
}

function qrOrderEnabled(merchant: {
  dineInEnabled: boolean;
  capabilities?: Array<{
    isEnabled: boolean;
    capability: { code: string };
  }>;
}) {
  if (merchant.capabilities?.length) {
    return merchant.capabilities.some(
      (item) => item.capability.code === 'qrOrderEnabled' && item.isEnabled,
    );
  }
  return merchant.dineInEnabled;
}
