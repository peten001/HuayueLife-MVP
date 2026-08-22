import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../database/prisma.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';

@Injectable()
export class TablesService {
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
    const image = await this.buildStandardQrCode(table);
    return { table, image };
  }

  buildScene(table: { id: bigint; qrVersion: number }) {
    return `t${table.id.toString()}v${table.qrVersion}`;
  }

  buildPublicQrPayload(table: { qrToken: string }) {
    const configuredBase = this.config
      .get<string>('MINIAPP_QR_ENTRY_URL')
      ?.trim();
    if (!configuredBase) {
      throw new BadGatewayException('桌台二维码公网入口配置缺失');
    }

    let entryUrl: URL;
    try {
      entryUrl = new URL(configuredBase);
    } catch {
      throw new BadGatewayException('桌台二维码公网入口配置无效');
    }
    if (
      !['http:', 'https:'].includes(entryUrl.protocol)
      || entryUrl.search
      || entryUrl.hash
      || /\/api\/v1\/qr\/resolve\/?$/i.test(entryUrl.pathname)
    ) {
      throw new BadGatewayException('桌台二维码公网入口配置无效');
    }

    entryUrl.pathname = `${entryUrl.pathname.replace(/\/+$/, '')}/${encodeURIComponent(table.qrToken)}`;
    return entryUrl.toString();
  }

  private async buildStandardQrCode(table: { qrToken: string }) {
    return QRCode.toBuffer(this.buildPublicQrPayload(table), {
      type: 'png',
      width: 1024,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });
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
