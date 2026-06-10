import { Injectable, NotFoundException } from '@nestjs/common';
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
    const entryUrl =
      this.config.get<string>('MINIAPP_QR_ENTRY_URL') ??
      'https://example.invalid/scan';
    const separator = entryUrl.includes('?') ? '&' : '?';
    const content = `${entryUrl}${separator}token=${encodeURIComponent(table.qrToken)}`;
    const image = await QRCode.toBuffer(content, {
      type: 'png',
      width: 800,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    return { table, image };
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
