import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, OrderType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SendDailyReportDto } from './dto/send-daily-report.dto';
import { UpdateReportSettingsDto } from './dto/update-report-settings.dto';
import {
  DAILY_REPORT_FEATURE_DISABLED_MESSAGE,
  DEFAULT_DAILY_REPORT_PUSH_TIME,
  type DailyReportLanguage,
  DAILY_REPORT_LANGUAGES,
} from './merchant-reports.constants';
import { DailyReportImageService } from './daily-report-image.service';
import { ZaloReportSender } from './zalo-report.sender';

type MerchantReportSettingsResponse = {
  enabled: boolean;
  zaloRecipient: string;
  pushTime: string;
  language: DailyReportLanguage;
  aiSuggestions: boolean;
};

type DailyReportSummary = {
  orderCount: number;
  totalAmount: string;
  averageOrderAmount: string;
  dineInCount: number;
  pickupCount: number;
  deliveryCount: number;
  statusCounts: Record<string, number>;
  topProducts: Array<{
    name: string;
    quantity: number;
  }>;
  peakHour: string;
  peakHourOrderCount: number;
  suggestions: string[];
};

type DailyReportSnapshot = {
  reportDate: string;
  language: DailyReportLanguage;
  merchantName: string;
  summary: DailyReportSummary;
  imageUrl: string;
};

type MerchantReportPreviewResponse = DailyReportSnapshot;

@Injectable()
export class MerchantReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly imageService: DailyReportImageService,
    private readonly zaloSender: ZaloReportSender,
  ) {}

  async getFeature(merchantId: bigint) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { reportFeatureEnabled: true },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }
    return { enabled: merchant.reportFeatureEnabled };
  }

  async getSettings(merchantId: bigint): Promise<MerchantReportSettingsResponse> {
    await this.requireFeatureEnabled(merchantId);
    const setting = await this.prisma.merchantReportSetting.findUnique({
      where: { merchantId },
    });
    return this.toSettingsResponse(setting);
  }

  async updateSettings(
    merchantId: bigint,
    dto: UpdateReportSettingsDto,
  ): Promise<MerchantReportSettingsResponse> {
    await this.requireFeatureEnabled(merchantId);
    const setting = await this.prisma.merchantReportSetting.upsert({
      where: { merchantId },
      create: {
        merchantId,
        enabled: dto.enabled,
        zaloRecipient: normalizeOptionalText(dto.zaloRecipient),
        pushTime: dto.pushTime,
        language: resolveLanguage(dto.language),
        aiSuggestions: dto.aiSuggestions,
      },
      update: {
        enabled: dto.enabled,
        zaloRecipient: normalizeOptionalText(dto.zaloRecipient),
        pushTime: dto.pushTime,
        language: resolveLanguage(dto.language),
        aiSuggestions: dto.aiSuggestions,
      },
    });

    return this.toSettingsResponse(setting);
  }

  async previewDailyReport(
    merchantId: bigint,
    languageInput?: string,
  ): Promise<MerchantReportPreviewResponse> {
    const merchant = await this.requireFeatureEnabled(merchantId);
    const settings = await this.prisma.merchantReportSetting.findUnique({
      where: { merchantId },
      select: { language: true },
    });
    const language = resolveLanguage(languageInput ?? settings?.language ?? 'zh');
    return this.buildSnapshot(merchantId, merchant.nameZh, language);
  }

  async sendDailyReport(merchantId: bigint, dto: SendDailyReportDto) {
    const merchant = await this.requireFeatureEnabled(merchantId);
    const settings = await this.prisma.merchantReportSetting.findUnique({
      where: { merchantId },
      select: {
        language: true,
        zaloRecipient: true,
      },
    });
    const language = resolveLanguage(dto.language ?? settings?.language ?? 'zh');
    const reportDate = startOfLocalDay(new Date());
    let snapshot: DailyReportSnapshot | null = null;

    try {
      snapshot = await this.buildSnapshot(merchantId, merchant.nameZh, language, reportDate);
      const senderResult = await this.zaloSender.sendDailyReport({
        recipient: settings?.zaloRecipient?.trim() ?? '',
        language,
        imageUrl: snapshot.imageUrl,
        summary: snapshot.summary as Record<string, unknown>,
      });

      const log = await this.prisma.dailyReportLog.create({
        data: {
          merchantId,
          reportDate,
          language,
          channel: 'zalo',
          recipient: settings?.zaloRecipient?.trim() || null,
          status: 'SUCCESS',
          mocked: senderResult.mocked,
          reportImageUrl: snapshot.imageUrl,
          summaryJson: snapshot.summary as Prisma.InputJsonValue,
          errorMessage: null,
          sentAt: new Date(),
        },
      });

      return {
        success: true,
        mocked: senderResult.mocked,
        message: 'Daily report mock sent',
        logId: log.id.toString(),
        imageUrl: snapshot.imageUrl,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Daily report mock failed';
      await this.prisma.dailyReportLog.create({
        data: {
          merchantId,
          reportDate,
          language,
          channel: 'zalo',
          recipient: settings?.zaloRecipient?.trim() || null,
          status: 'FAILED',
          mocked: true,
          reportImageUrl: snapshot?.imageUrl ?? null,
          summaryJson: snapshot?.summary
            ? (snapshot.summary as Prisma.InputJsonValue)
            : Prisma.DbNull,
          errorMessage: message,
          sentAt: null,
        },
      });
      throw new InternalServerErrorException(message);
    }
  }

  private async buildSnapshot(
    merchantId: bigint,
    merchantName: string,
    language: DailyReportLanguage,
    reportDate = startOfLocalDay(new Date()),
  ): Promise<DailyReportSnapshot> {
    const nextDay = addDays(reportDate, 1);
    const [orders, orderItems] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          merchantId,
          createdAt: {
            gte: reportDate,
            lt: nextDay,
          },
        },
        select: {
          orderType: true,
          status: true,
          totalAmountVnd: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.orderItem.findMany({
        where: {
          order: {
            merchantId,
            createdAt: {
              gte: reportDate,
              lt: nextDay,
            },
          },
        },
        select: {
          productId: true,
          productNameZhSnapshot: true,
          quantity: true,
        },
      }),
    ]);

    const summary = buildSummary(orders, orderItems, language);
    const reportDateText = formatDateForReport(reportDate);
    const rendered = await this.imageService.renderDailyReport({
      merchantId: merchantId.toString(),
      merchantName: resolveMerchantDisplayName(merchantName, language),
      reportDate: reportDateText,
      language,
      summary,
    });

    return {
      reportDate: reportDateText,
      language,
      merchantName: resolveMerchantDisplayName(merchantName, language),
      summary,
      imageUrl: rendered.imageUrl,
    };
  }

  private async requireFeatureEnabled(merchantId: bigint) {
    // reportFeatureEnabled only gates the merchant daily-report feature surface.
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: {
        id: true,
        nameZh: true,
        reportFeatureEnabled: true,
      },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }
    if (!merchant.reportFeatureEnabled) {
      throw new ForbiddenException(DAILY_REPORT_FEATURE_DISABLED_MESSAGE);
    }
    return merchant;
  }

  private toSettingsResponse(
    setting: {
      enabled: boolean;
      zaloRecipient: string | null;
      pushTime: string;
      language: string;
      aiSuggestions: boolean;
    } | null,
  ): MerchantReportSettingsResponse {
    return {
      enabled: setting?.enabled ?? false,
      zaloRecipient: setting?.zaloRecipient ?? '',
      pushTime: setting?.pushTime ?? DEFAULT_DAILY_REPORT_PUSH_TIME,
      language: resolveLanguage(setting?.language ?? 'zh'),
      aiSuggestions: setting?.aiSuggestions ?? false,
    };
  }
}

function buildSummary(
  orders: Array<{
    orderType: OrderType;
    status: OrderStatus;
    totalAmountVnd: bigint;
    createdAt: Date;
  }>,
  orderItems: Array<{
    productId: bigint | null;
    productNameZhSnapshot: string;
    quantity: number;
  }>,
  language: DailyReportLanguage,
): DailyReportSummary {
  const orderCount = orders.length;
  const totalAmount = orders.reduce((sum, item) => sum + item.totalAmountVnd, 0n);
  const averageOrderAmount = orderCount > 0 ? totalAmount / BigInt(orderCount) : 0n;
  const dineInCount = orders.filter((item) => item.orderType === OrderType.DINE_IN).length;
  const pickupCount = orders.filter((item) => item.orderType === OrderType.PICKUP).length;
  const deliveryCount = orders.filter((item) => item.orderType === OrderType.DELIVERY).length;
  const statusCounts: Record<string, number> = {
    PENDING_ACCEPTANCE: 0,
    ACCEPTED: 0,
    PREPARING: 0,
    READY: 0,
    DELIVERING: 0,
    COMPLETED: 0,
    CANCELLED: 0,
  };
  for (const order of orders) {
    statusCounts[order.status] = (statusCounts[order.status] ?? 0) + 1;
  }

  const hourCounts = new Map<number, number>();
  for (const order of orders) {
    const hour = order.createdAt.getHours();
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
  }
  const [peakHour, peakHourOrderCount] = getPeakHour(hourCounts, language);

  const productCounts = new Map<string, { name: string; quantity: number }>();
  for (const item of orderItems) {
    const key = item.productId?.toString() ?? item.productNameZhSnapshot;
    const current = productCounts.get(key);
    if (current) {
      current.quantity += item.quantity;
      continue;
    }
    productCounts.set(key, {
      name: item.productNameZhSnapshot,
      quantity: item.quantity,
    });
  }

  const topProducts = Array.from(productCounts.values())
    .sort((left, right) => right.quantity - left.quantity)
    .slice(0, 5);

  return {
    orderCount,
    totalAmount: totalAmount.toString(),
    averageOrderAmount: averageOrderAmount.toString(),
    dineInCount,
    pickupCount,
    deliveryCount,
    statusCounts,
    topProducts,
    peakHour,
    peakHourOrderCount,
    suggestions: buildSuggestions(
      {
        orderCount,
        totalAmount: totalAmount.toString(),
        averageOrderAmount: averageOrderAmount.toString(),
        dineInCount,
        pickupCount,
        deliveryCount,
        statusCounts,
        topProducts,
        peakHour,
        peakHourOrderCount,
      },
      language,
    ),
  };
}

function buildSuggestions(
  summary: Pick<
    DailyReportSummary,
    | 'orderCount'
    | 'totalAmount'
    | 'averageOrderAmount'
    | 'dineInCount'
    | 'pickupCount'
    | 'deliveryCount'
    | 'statusCounts'
    | 'topProducts'
    | 'peakHour'
    | 'peakHourOrderCount'
  >,
  language: DailyReportLanguage,
) {
  const suggestions: string[] = [];
  const pendingCount =
    (summary.statusCounts.PENDING_ACCEPTANCE ?? 0) +
    (summary.statusCounts.ACCEPTED ?? 0) +
    (summary.statusCounts.PREPARING ?? 0) +
    (summary.statusCounts.READY ?? 0) +
    (summary.statusCounts.DELIVERING ?? 0);

  if (summary.orderCount === 0) {
    suggestions.push(
      language === 'vi'
        ? 'Hôm nay chưa có đơn, hãy kiểm tra trạng thái mở cửa và hiển thị món.'
        : '今日暂无订单，建议检查门店营业状态和商品展示。',
    );
    return suggestions;
  }

  if (pendingCount > 0) {
    suggestions.push(
      language === 'vi'
        ? 'Hiện còn đơn chưa hoàn tất, nên kiểm tra trạng thái đơn trước khi kết thúc ca.'
        : '当前仍有未完成订单，建议营业结束前检查订单状态。',
    );
  }

  if (summary.peakHourOrderCount >= Math.max(5, Math.ceil(summary.orderCount * 0.25))) {
    suggestions.push(
      language === 'vi'
        ? `Đơn hàng tập trung vào khung giờ ${summary.peakHour}, nên chuẩn bị món bán chạy sớm hơn.`
        : `高峰时段订单集中在 ${summary.peakHour}，建议提前准备热门菜品。`,
    );
  }

  if (summary.topProducts.length > 0) {
    suggestions.push(
      language === 'vi'
        ? `${summary.topProducts[0].name} đang bán rất tốt, hãy cân nhắc tăng tồn chuẩn bị ngày mai.`
        : `${summary.topProducts[0].name} 销量较高，建议明天适当增加备货。`,
    );
  }

  const deliveryRatio = summary.deliveryCount / Math.max(1, summary.orderCount);
  if (deliveryRatio < 0.15) {
    suggestions.push(
      language === 'vi'
        ? 'Đơn giao hàng còn ít, có thể nhấn mạnh phạm vi giao và phí giao trong mô tả cửa hàng.'
        : '配送订单较少，可在店铺说明中突出配送范围和配送费。',
    );
  }

  if (summary.dineInCount > summary.pickupCount + summary.deliveryCount) {
    suggestions.push(
      language === 'vi'
        ? 'Đơn ăn tại chỗ chiếm đa số, hãy ưu tiên tối ưu tốc độ ra món.'
        : '堂食订单占比较高，建议优先优化出餐速度。',
    );
  }

  return suggestions.slice(0, 3);
}

function getPeakHour(
  hourCounts: Map<number, number>,
  language: DailyReportLanguage,
): [string, number] {
  if (hourCounts.size === 0) {
    return [
      language === 'vi'
        ? 'Hôm nay chưa có khung giờ cao điểm rõ ràng'
        : '今日暂无明显高峰时段',
      0,
    ];
  }

  let peakHour = 0;
  let peakHourOrderCount = 0;
  for (const [hour, count] of hourCounts.entries()) {
    if (count > peakHourOrderCount) {
      peakHour = hour;
      peakHourOrderCount = count;
    }
  }

  return [`${formatHour(peakHour)}-${formatHour((peakHour + 1) % 24)}`, peakHourOrderCount];
}

function formatHour(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function formatDateForReport(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  // TODO: Use Asia/Ho_Chi_Minh timezone for merchant daily reports.
  return result;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function normalizeOptionalText(value?: string) {
  const normalized = value?.trim();
  return normalized?.length ? normalized : null;
}

function resolveLanguage(value?: string | null): DailyReportLanguage {
  if (value && DAILY_REPORT_LANGUAGES.includes(value as DailyReportLanguage)) {
    return value as DailyReportLanguage;
  }
  return 'zh';
}

function resolveMerchantDisplayName(nameZh: string, language: DailyReportLanguage) {
  if (language === 'vi') {
    return nameZh;
  }
  return nameZh;
}
