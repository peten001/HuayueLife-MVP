import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PaperWidth,
  PrinterEncoding,
  PrintLanguage,
  PrintLogOperator,
  PrintLogStatus,
  PrinterSetting,
  PrinterUsageType,
  Prisma,
} from '@prisma/client';
import { Socket } from 'node:net';
import { PrismaService } from '../../database/prisma.service';
import { PrintingFeatureFlagsService } from '../printing/services/printing-feature-flags.service';
import { CreatePrinterDto } from './dto/create-printer.dto';
import { UpdatePrinterDto } from './dto/update-printer.dto';

export interface PrintResult {
  success: boolean;
  errorMessage?: string;
}

export interface OrderPrintResult {
  skipped?: boolean;
  total: number;
  successCount: number;
  failedCount: number;
  results: Array<{
    printerId: bigint;
    printerName: string;
    success: boolean;
    errorMessage?: string;
  }>;
}

const PRINT_LABELS: Record<
  PrintLanguage,
  {
    brand: string;
    titles: Record<PrinterUsageType, string>;
    orderNo: string;
    orderType: string;
    tableName: string;
    time: string;
    itemRemark: string;
    orderRemark: string;
    testTitle: string;
    testBody: string;
    none: string;
    orderTypes: Record<string, string>;
  }
> = {
  zh: {
    brand: '云桥 Life',
    titles: {
      KITCHEN: '厨房订单',
      FRONT_DESK: '前台小票',
      BAR: '吧台订单',
      GENERAL: '订单小票',
    },
    orderNo: '订单号',
    orderType: '类型',
    tableName: '桌号',
    time: '时间',
    itemRemark: '备注',
    orderRemark: '订单备注',
    testTitle: '测试打印',
    testBody: '打印机连接正常',
    none: '无',
    orderTypes: {
      DINE_IN: '堂食',
      PICKUP: '自取',
      DELIVERY: '配送',
    },
  },
  vi: {
    brand: '云桥 Life',
    titles: {
      KITCHEN: 'Đơn Bếp',
      FRONT_DESK: 'Phiếu Thu Ngân',
      BAR: 'Đơn Quầy Bar',
      GENERAL: 'Phiếu Đơn Hàng',
    },
    orderNo: 'Mã đơn',
    orderType: 'Loại',
    tableName: 'Bàn',
    time: 'Thời gian',
    itemRemark: 'Ghi chú',
    orderRemark: 'Ghi chú đơn',
    testTitle: 'In thử',
    testBody: 'Máy in kết nối bình thường',
    none: 'Không có',
    orderTypes: {
      DINE_IN: 'Ăn tại bàn',
      PICKUP: 'Tự lấy',
      DELIVERY: 'Giao hàng',
    },
  },
  en: {
    brand: 'Yunqiao Life',
    titles: {
      KITCHEN: 'Kitchen Order',
      FRONT_DESK: 'Front Desk Receipt',
      BAR: 'Bar Order',
      GENERAL: 'Order Receipt',
    },
    orderNo: 'Order No.',
    orderType: 'Type',
    tableName: 'Table',
    time: 'Time',
    itemRemark: 'Remark',
    orderRemark: 'Order Remark',
    testTitle: 'Test Print',
    testBody: 'Printer connection is OK',
    none: 'None',
    orderTypes: {
      DINE_IN: 'Dine in',
      PICKUP: 'Pickup',
      DELIVERY: 'Delivery',
    },
  },
};

@Injectable()
export class PrintersService {
  private readonly logger = new Logger(PrintersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly printingFlags: PrintingFeatureFlagsService,
  ) {}

  async createPrinter(merchantId: bigint, dto: CreatePrinterDto) {
    this.printingFlags.assertLegacyPrintingEnabled();
    if (dto.isDefault ?? true) {
      await this.clearDefaultPrinters(merchantId);
    }
    return this.prisma.printerSetting.create({
      data: {
        merchantId,
        name: dto.name,
        usageType: dto.usageType ?? 'GENERAL',
        encoding: dto.encoding ?? 'UTF8',
        ipAddress: dto.ipAddress,
        port: dto.port ?? 9100,
        paperWidth: this.toPaperWidth(dto.paperWidth),
        copies: dto.copies ?? 1,
        language: dto.language ?? 'zh',
        autoPrintEnabled: dto.autoPrintEnabled ?? true,
        isDefault: dto.isDefault ?? true,
      },
    });
  }

  async updatePrinter(merchantId: bigint, id: bigint, dto: UpdatePrinterDto) {
    this.printingFlags.assertLegacyPrintingEnabled();
    await this.requirePrinter(merchantId, id);
    if (dto.isDefault === true) {
      await this.clearDefaultPrinters(merchantId, id);
    }
    return this.prisma.printerSetting.update({
      where: { id },
      data: {
        name: dto.name,
        usageType: dto.usageType,
        encoding: dto.encoding,
        ipAddress: dto.ipAddress,
        port: dto.port,
        paperWidth:
          dto.paperWidth === undefined ? undefined : this.toPaperWidth(dto.paperWidth),
        copies: dto.copies,
        language: dto.language,
        autoPrintEnabled: dto.autoPrintEnabled,
        isDefault: dto.isDefault,
      },
    });
  }

  async deletePrinter(merchantId: bigint, id: bigint) {
    this.printingFlags.assertLegacyPrintingEnabled();
    await this.requirePrinter(merchantId, id);
    await this.prisma.printerSetting.delete({ where: { id } });
    return { deleted: true };
  }

  getPrintersByMerchant(merchantId: bigint) {
    this.printingFlags.assertLegacyPrintingEnabled();
    return this.prisma.printerSetting.findMany({
      where: { merchantId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  getDefaultPrinter(merchantId: bigint) {
    this.printingFlags.assertLegacyPrintingEnabled();
    return this.prisma.printerSetting.findFirst({
      where: { merchantId, isDefault: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  getAutoPrintPrinters(merchantId: bigint) {
    this.printingFlags.assertLegacyPrintingEnabled();
    return this.prisma.printerSetting.findMany({
      where: { merchantId, autoPrintEnabled: true, status: { not: 'OFFLINE' } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async testPrint(merchantId: bigint, printerId: bigint) {
    this.printingFlags.assertLegacyPrintingEnabled();
    const printer = await this.requirePrinter(merchantId, printerId);
    const log = await this.createPrintLog({
      merchantId,
      printerId,
      status: 'PENDING',
      printedBy: 'MERCHANT',
    });
    return this.printWithLog(log.id, printer, this.buildTestTicket(printer));
  }

  async printOrder(
    merchantId: bigint,
    orderId: bigint,
    printedBy: PrintLogOperator = 'SYSTEM',
    printerIds?: bigint[],
  ): Promise<OrderPrintResult> {
    this.printingFlags.assertLegacyPrintingEnabled();
    const [order, printers] = await Promise.all([
      this.prisma.order.findFirst({
        where: { id: orderId, merchantId },
        include: {
          table: { select: { tableNo: true, tableName: true } },
          items: { orderBy: { id: 'asc' } },
        },
      }),
      this.resolveOrderPrinters(merchantId, printedBy, printerIds),
    ]);
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (!printers.length) {
      return { skipped: true, total: 0, successCount: 0, failedCount: 0, results: [] };
    }

    const results: OrderPrintResult['results'] = [];
    for (const printer of printers) {
      const log = await this.createPrintLog({
        merchantId,
        orderId,
        printerId: printer.id,
        status: 'PENDING',
        printedBy,
      });
      const result = await this.printWithLog(
        log.id,
        printer,
        this.buildKitchenTicket(printer, order),
      );
      results.push({
        printerId: printer.id,
        printerName: printer.name,
        success: result.success,
        errorMessage: result.errorMessage,
      });
    }

    return {
      total: results.length,
      successCount: results.filter((result) => result.success).length,
      failedCount: results.filter((result) => !result.success).length,
      results,
    };
  }

  reprintOrder(merchantId: bigint, orderId: bigint, printerIds?: bigint[]) {
    return this.printOrder(merchantId, orderId, 'MERCHANT', printerIds);
  }

  createPrintLog(data: {
    merchantId: bigint;
    orderId?: bigint;
    printerId?: bigint;
    status: PrintLogStatus;
    errorMessage?: string;
    printedBy: PrintLogOperator;
  }) {
    this.printingFlags.assertLegacyPrintingEnabled();
    return this.prisma.printLog.create({ data });
  }

  private async printWithLog(
    logId: bigint,
    printer: PrinterSetting,
    ticket: Buffer,
  ): Promise<PrintResult> {
    await this.prisma.printLog.update({
      where: { id: logId },
      data: { status: 'PRINTING' },
    });

    const copies = Math.max(1, printer.copies);
    for (let copyIndex = 0; copyIndex < copies; copyIndex += 1) {
      const result = await this.sendTcp(printer, ticket);
      if (!result.success) {
        const errorMessage =
          copies > 1
            ? `第 ${copyIndex + 1}/${copies} 份打印失败：${result.errorMessage ?? '打印失败'}`
            : result.errorMessage ?? '打印失败';
        await this.markPrintFailed(logId, printer.id, errorMessage);
        return { success: false, errorMessage };
      }
    }

    await this.prisma.$transaction([
      this.prisma.printLog.update({
        where: { id: logId },
        data: { status: 'SUCCESS', errorMessage: null },
      }),
      this.prisma.printerSetting.update({
        where: { id: printer.id },
        data: { status: 'ONLINE' },
      }),
    ]);
    return { success: true };
  }

  private async markPrintFailed(
    logId: bigint,
    printerId: bigint,
    errorMessage: string,
  ) {
    this.logger.warn(`Printer ${printerId.toString()} failed: ${errorMessage}`);
    await this.prisma.$transaction([
      this.prisma.printLog.update({
        where: { id: logId },
        data: {
          status: 'FAILED',
          errorMessage: errorMessage.slice(0, 500),
        },
      }),
      this.prisma.printerSetting.update({
        where: { id: printerId },
        data: { status: 'OFFLINE' },
      }),
    ]);
  }

  private sendTcp(printer: PrinterSetting, payload: Buffer): Promise<PrintResult> {
    return new Promise((resolve) => {
      const socket = new Socket();
      let settled = false;

      const finish = (result: PrintResult) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(4000);
      socket.once('timeout', () => finish({ success: false, errorMessage: '连接打印机超时' }));
      socket.once('error', (error) =>
        finish({ success: false, errorMessage: error.message }),
      );
      socket.connect(printer.port, printer.ipAddress, () => {
        socket.write(payload, (error) => {
          if (error) {
            finish({ success: false, errorMessage: error.message });
            return;
          }
          socket.end(() => finish({ success: true }));
        });
      });
    });
  }

  private buildTestTicket(printer: PrinterSetting) {
    const labels = PRINT_LABELS[printer.language];
    return this.toEscPosBuffer(printer, [
      labels.brand,
      labels.testTitle,
      this.line(printer.paperWidth),
      labels.testBody,
      '云桥 Life',
      '厨房订单',
      '前台小票',
      'Kitchen Order',
      'Front Desk Receipt',
      'Đơn Bếp',
      'Phiếu Thu Ngân',
      'Đơn Quầy Bar',
      'Phiếu Đơn Hàng',
      new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    ]);
  }

  private buildKitchenTicket(
    printer: PrinterSetting,
    order: Prisma.OrderGetPayload<{
      include: {
        table: { select: { tableNo: true; tableName: true } };
        items: true;
      };
    }>,
  ) {
    const labels = PRINT_LABELS[printer.language];
    const tableName =
      order.table?.tableName || order.tableNoSnapshot || order.table?.tableNo || labels.none;
    const lines = [
      labels.brand,
      labels.titles[printer.usageType],
      this.line(printer.paperWidth),
      `${labels.orderNo}：${order.orderNo}`,
      `${labels.orderType}：${labels.orderTypes[order.orderType] ?? order.orderType}`,
      `${labels.tableName}：${tableName}`,
      `${labels.time}：${order.createdAt.toLocaleString('zh-CN', {
        timeZone: 'Asia/Ho_Chi_Minh',
      })}`,
      '',
      this.dash(printer.paperWidth),
      '',
      ...order.items.flatMap((item, index) => {
        const itemLines = [
          `${index + 1}. ${item.productNameZhSnapshot} x ${item.quantity}`,
        ];
        if (item.remark) {
          itemLines.push(`   ${labels.itemRemark}：${item.remark}`);
        }
        return itemLines;
      }),
      '',
      this.dash(printer.paperWidth),
      '',
      `${labels.orderRemark}：`,
      order.customerRemark || labels.none,
      '',
      this.line(printer.paperWidth),
    ];
    return this.toEscPosBuffer(printer, lines);
  }

  private toEscPosBuffer(printer: PrinterSetting, lines: string[]) {
    const body = `${lines.join('\n')}\n\n\n`;
    return Buffer.concat([
      Buffer.from([0x1b, 0x40]),
      this.buildPrintBuffer(body, printer.encoding),
      Buffer.from([0x1d, 0x56, 0x42, 0x00]),
    ]);
  }

  private buildPrintBuffer(text: string, encoding: PrinterEncoding) {
    switch (encoding) {
      case 'UTF8':
      case 'GBK':
      case 'CP1258':
      default:
        return Buffer.from(text, 'utf8');
    }
  }

  private line(width: PaperWidth) {
    return width === 'WIDTH_58' ? '========================' : '================================';
  }

  private dash(width: PaperWidth) {
    return width === 'WIDTH_58' ? '------------------------' : '--------------------------------';
  }

  private toPaperWidth(value?: 58 | 80): PaperWidth {
    return value === 58 ? 'WIDTH_58' : 'WIDTH_80';
  }

  private async resolveOrderPrinters(
    merchantId: bigint,
    printedBy: PrintLogOperator,
    printerIds?: bigint[],
  ) {
    if (printerIds?.length) {
      const uniqueIds = [...new Set(printerIds.map((id) => id.toString()))].map((id) =>
        BigInt(id),
      );
      const printers = await this.prisma.printerSetting.findMany({
        where: { merchantId, id: { in: uniqueIds } },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
      if (printers.length !== uniqueIds.length) {
        throw new BadRequestException('Printer not found or not owned by merchant');
      }
      return printers;
    }

    if (printedBy === 'SYSTEM') {
      return this.getAutoPrintPrinters(merchantId);
    }

    const defaultPrinter = await this.getDefaultPrinter(merchantId);
    return defaultPrinter ? [defaultPrinter] : [];
  }

  private clearDefaultPrinters(merchantId: bigint, exceptId?: bigint) {
    return this.prisma.printerSetting.updateMany({
      where: {
        merchantId,
        id: exceptId ? { not: exceptId } : undefined,
      },
      data: { isDefault: false },
    });
  }

  private async requirePrinter(merchantId: bigint, id: bigint) {
    const printer = await this.prisma.printerSetting.findFirst({
      where: { id, merchantId },
    });
    if (!printer) {
      throw new NotFoundException('Printer not found');
    }
    return printer;
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
