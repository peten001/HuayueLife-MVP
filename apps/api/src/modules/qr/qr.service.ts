import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class QrService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(token: string) {
    const table = await this.prisma.diningTable.findUnique({
      where: { qrToken: token },
      include: { merchant: true },
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
    if (!table.merchant.dineInEnabled) {
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
}
