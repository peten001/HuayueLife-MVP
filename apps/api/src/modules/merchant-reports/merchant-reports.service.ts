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
  orderCountComparison: string;
  orderCountComparisonTrend: ComparisonTrend;
  totalAmountComparison: string;
  totalAmountComparisonTrend: ComparisonTrend;
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

type SendDailyReportForMerchantOptions = {
  language?: string;
  source: 'manual' | 'scheduled';
  skipIfAlreadySent?: boolean;
};

type ComparisonTrend = 'up' | 'down' | 'flat';

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
    return this.buildSnapshot(merchantId, merchant.nameZh, merchant.nameVi, language);
  }

  async sendDailyReport(merchantId: bigint, dto: SendDailyReportDto) {
    const result = await this.sendDailyReportForMerchant(merchantId, {
      language: dto.language,
      source: 'manual',
    });
    return {
      success: true,
      mocked: result.mocked,
      message: 'Daily report mock sent',
      logId: result.logId,
      imageUrl: result.imageUrl,
    };
  }

  async sendDailyReportForMerchant(
    merchantId: bigint,
    options: SendDailyReportForMerchantOptions,
  ) {
    const merchant = await this.requireFeatureEnabled(merchantId);
    const settings = await this.prisma.merchantReportSetting.findUnique({
      where: { merchantId },
      select: {
        language: true,
        zaloRecipient: true,
      },
    });
    const language = resolveLanguage(options.language ?? settings?.language ?? 'zh');
    const reportDate = getVietnamReportDate(new Date());
    const recipient = settings?.zaloRecipient?.trim() || null;
    let snapshot: DailyReportSnapshot | null = null;

    const shouldSkipDuplicate = options.skipIfAlreadySent || options.source === 'scheduled';
    if (shouldSkipDuplicate) {
      const existingSuccessLog = await this.prisma.dailyReportLog.findFirst({
        where: {
          merchantId,
          reportDate,
          language,
          channel: 'zalo',
          status: 'SUCCESS',
          mocked: true,
        },
        select: { id: true },
      });
      if (existingSuccessLog) {
        return {
          success: false,
          skipped: true,
          reason: 'already_sent' as const,
          mocked: true,
          logId: existingSuccessLog.id.toString(),
          imageUrl: null,
        };
      }
    }

    try {
      snapshot = await this.buildSnapshot(merchantId, merchant.nameZh, merchant.nameVi, language, reportDate);
      const senderResult = await this.zaloSender.sendDailyReport({
        recipient: recipient ?? '',
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
          recipient,
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
          recipient,
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

  async listDailyReportLogs(merchantId: bigint, limitInput?: string) {
    await this.requireFeatureEnabled(merchantId);
    const limit = normalizeLimit(limitInput);
    const logs = await this.prisma.dailyReportLog.findMany({
      where: { merchantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        reportDate: true,
        language: true,
        channel: true,
        recipient: true,
        status: true,
        mocked: true,
        reportImageUrl: true,
        errorMessage: true,
        createdAt: true,
      },
    });

    return {
      items: logs.map((item) => ({
        id: item.id.toString(),
        reportDate: formatDateForReport(item.reportDate),
        language: resolveLanguage(item.language),
        channel: item.channel,
        recipient: item.recipient,
        status: item.status,
        mocked: item.mocked,
        reportImageUrl: item.reportImageUrl,
        errorMessage: item.errorMessage,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  private async buildSnapshot(
    merchantId: bigint,
    merchantNameZh: string,
    merchantNameVi: string | null,
    language: DailyReportLanguage,
    reportDate = getVietnamReportDate(new Date()),
  ): Promise<DailyReportSnapshot> {
    const { startUtc, endUtc } = getVietnamDayBoundsUtc(reportDate);
    const previousReportDate = new Date(reportDate.getTime() - 24 * 60 * 60 * 1000);
    const { startUtc: previousStartUtc, endUtc: previousEndUtc } = getVietnamDayBoundsUtc(previousReportDate);
    const [orders, orderItems, previousStats] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          merchantId,
          createdAt: {
            gte: startUtc,
            lt: endUtc,
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
              gte: startUtc,
              lt: endUtc,
            },
          },
        },
        select: {
          productId: true,
          productNameZhSnapshot: true,
          quantity: true,
        },
      }),
      this.prisma.order.aggregate({
        where: {
          merchantId,
          createdAt: {
            gte: previousStartUtc,
            lt: previousEndUtc,
          },
        },
        _count: { _all: true },
        _sum: { totalAmountVnd: true },
      }),
    ]);

    const summary = buildSummary(orders, orderItems, language, {
      previousOrderCount: previousStats._count._all,
      previousTotalAmount: previousStats._sum.totalAmountVnd ?? 0n,
    });
    const reportDateText = formatDateForReport(reportDate);
    const merchantDisplayName = resolveMerchantDisplayName(merchantNameZh, merchantNameVi, language);
    const rendered = await this.imageService.renderDailyReport({
      merchantId: merchantId.toString(),
      merchantName: merchantDisplayName,
      reportDate: reportDateText,
      language,
      summary,
    });

    return {
      reportDate: reportDateText,
      language,
      merchantName: merchantDisplayName,
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
        nameVi: true,
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
  comparison?: {
    previousOrderCount: number;
    previousTotalAmount: bigint;
  },
): DailyReportSummary {
  const orderCount = orders.length;
  const totalAmount = orders.reduce((sum, item) => sum + item.totalAmountVnd, 0n);
  const averageOrderAmount = orderCount > 0 ? totalAmount / BigInt(orderCount) : 0n;
  const orderCountComparison = buildOrderCountComparisonText(
    orderCount,
    comparison?.previousOrderCount ?? 0,
    language,
  );
  const totalAmountComparison = buildRevenueComparisonText(
    totalAmount,
    comparison?.previousTotalAmount ?? 0n,
    language,
  );
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
    const hour = getVietnamHour(order.createdAt);
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
    orderCountComparison: orderCountComparison.text,
    orderCountComparisonTrend: orderCountComparison.trend,
    totalAmountComparison: totalAmountComparison.text,
    totalAmountComparisonTrend: totalAmountComparison.trend,
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

function buildOrderCountComparisonText(
  current: number,
  previous: number,
  language: DailyReportLanguage,
): { text: string; trend: ComparisonTrend } {
  const delta = current - previous;
  if (delta > 0) {
    return {
      text: language === 'vi' ? `↑ ${delta} đơn so với hôm qua` : `较昨日 ↑ ${delta} 单`,
      trend: 'up',
    };
  }

  if (delta < 0) {
    return {
      text: language === 'vi' ? `↓ ${Math.abs(delta)} đơn so với hôm qua` : `较昨日 ↓ ${Math.abs(delta)} 单`,
      trend: 'down',
    };
  }

  return {
    text: language === 'vi' ? '0 đơn so với hôm qua' : '较昨日 0 单',
    trend: 'flat',
  };
}

function buildRevenueComparisonText(
  current: number | bigint,
  previous: number | bigint,
  language: DailyReportLanguage,
): { text: string; trend: ComparisonTrend } {
  const currentValue = typeof current === 'bigint' ? Number(current) : current;
  const previousValue = typeof previous === 'bigint' ? Number(previous) : previous;

  if (previousValue === 0) {
    if (currentValue === 0) {
      return {
        text: language === 'vi' ? '0% so với hôm qua' : '较昨日 0%',
        trend: 'flat',
      };
    }
    return {
      text: language === 'vi' ? '↑ 100% so với hôm qua' : '较昨日 ↑ 100%',
      trend: 'up',
    };
  }

  const delta = currentValue - previousValue;
  if (delta > 0) {
    const percent = Math.abs((delta / previousValue) * 100);
    const percentText = formatPercent(percent);
    return {
      text: language === 'vi' ? `↑ ${percentText}% so với hôm qua` : `较昨日 ↑ ${percentText}%`,
      trend: 'up',
    };
  }

  if (delta < 0) {
    const percent = Math.abs((delta / previousValue) * 100);
    const percentText = formatPercent(percent);
    return {
      text: language === 'vi' ? `↓ ${percentText}% so với hôm qua` : `较昨日 ↓ ${percentText}%`,
      trend: 'down',
    };
  }

  return {
    text: language === 'vi' ? '0% so với hôm qua' : '较昨日 0%',
    trend: 'flat',
  };
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

function formatPercent(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatDateForReport(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getVietnamCurrentTime(date = new Date()) {
  const parts = getVietnamDateParts(date);
  return {
    ...parts,
    hhmm: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
    reportDate: dateOnlyFromVietnamParts(parts),
    reportDateText: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
  };
}

function getVietnamReportDate(date: Date) {
  return getVietnamCurrentTime(date).reportDate;
}

function getVietnamDayBoundsUtc(reportDate: Date) {
  const year = reportDate.getUTCFullYear();
  const month = reportDate.getUTCMonth();
  const day = reportDate.getUTCDate();
  return {
    startUtc: new Date(Date.UTC(year, month, day, -7, 0, 0, 0)),
    endUtc: new Date(Date.UTC(year, month, day + 1, -7, 0, 0, 0)),
  };
}

function getVietnamHour(date: Date) {
  return getVietnamDateParts(date).hour;
}

function getVietnamDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

function dateOnlyFromVietnamParts(parts: { year: number; month: number; day: number }) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0));
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

function normalizeLimit(value?: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(100, Math.max(1, Math.trunc(parsed)));
}

function resolveMerchantDisplayName(
  nameZh: string,
  nameVi: string | null,
  language: DailyReportLanguage,
) {
  if (language === 'vi') {
    return nameVi?.trim() || nameZh;
  }
  return nameZh;
}
