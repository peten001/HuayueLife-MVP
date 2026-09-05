import { effectiveOrderWhere } from '../orders/effective-order';
import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { MerchantAnalyticsQueryDto } from './dto/merchant-analytics-query.dto';
import {
  normalizeBusinessHours,
  resolveBusinessDate,
} from '../../common/utils/merchant-hours';
import { businessDateRangeCandidateWhere, resolveOrderBusinessDate } from './business-day-accounting';
import {
  buildMerchantSettlements,
  toSettlementFacts,
  type MerchantSettlementFact,
  type SettlementItemRow,
  type SettlementOrderRow,
  type SettlementSessionRow,
  type SettlementTableRow,
} from './merchant-settlements';

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;
const TIME_BUCKET_HOURS = 2;

interface TrendRow {
  bucket: string;
  settlementCount: bigint | number;
  revenueVnd: bigint | Prisma.Decimal | number | string;
}

interface TimeDistributionRow {
  weekday: bigint | number;
  startHour: bigint | number;
  settlementCount: bigint | number;
  revenueVnd: bigint | Prisma.Decimal | number | string;
}

export interface DishAggregateRow {
  dishKey: string;
  productId: bigint | number | string | null;
  name: string;
  imageUrl: string | null;
  categoryNameZh?: string | null;
  categoryNameVi?: string | null;
  categoryNameEn?: string | null;
  quantity: bigint | number;
  revenueVnd: bigint | Prisma.Decimal | number | string;
}

interface PeriodRange {
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  startDate: string;
  endDate: string;
  previousStartDate: string;
  previousEndDate: string;
  dayCount: number;
  granularity: 'hour' | 'day';
}

@Injectable()
export class MerchantAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAnalytics(
    merchantId: bigint,
    query: MerchantAnalyticsQueryDto,
  ) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { businessHours: true },
    });
    if (!merchant) throw new BadRequestException('商家不存在');
    const schedule = normalizeBusinessHours(merchant.businessHours);
    const range = resolvePeriodRange(
      query.dateFrom,
      query.dateTo,
      resolveBusinessDate(schedule),
    );
    const candidates = await this.loadOrders(
      merchantId,
      schedule,
      range.previousStartDate,
      range.endDate,
    );
    const datedOrders = candidates.map((order) => ({
      ...order,
      resolvedBusinessDate: resolveOrderBusinessDate(order, schedule),
    }));
    // Financial / transaction facts come from the canonical Settlement Read
    // Model: one closed table-session checkout = one fact, one pickup or
    // delivery order = one fact. Dish metrics below still use every raw
    // OrderItem so no sold quantity is lost by grouping.
    const settlements = buildMerchantSettlements(
      candidates.map(toSettlementOrderRow),
      (at) => resolveBusinessDate(schedule, at),
    );
    const facts = toSettlementFacts(settlements);
    const currentOrders = datedOrders.filter((order) =>
      order.resolvedBusinessDate >= range.startDate &&
      order.resolvedBusinessDate <= range.endDate,
    );
    const previousOrders = datedOrders.filter((order) =>
      order.resolvedBusinessDate >= range.previousStartDate &&
      order.resolvedBusinessDate <= range.previousEndDate,
    );
    const currentFacts = facts.filter(
      (fact) =>
        fact.businessDate >= range.startDate &&
        fact.businessDate <= range.endDate,
    );
    const previousFacts = facts.filter(
      (fact) =>
        fact.businessDate >= range.previousStartDate &&
        fact.businessDate <= range.previousEndDate,
    );
    const trendRows = aggregateTrendRows(currentFacts, range);
    const timeRows = aggregateTimeDistributionRows(currentFacts);
    const currentDishRows = aggregateDishRows(currentOrders);
    const previousDishRows = aggregateDishRows(previousOrders);

    const currentOverview = buildOverview(
      currentFacts.length,
      currentFacts.reduce((sum, fact) => sum + fact.finalRevenueVnd, 0n),
    );
    const funds = buildFundsOverview(currentFacts);
    const previousOverview = buildOverview(
      previousFacts.length,
      previousFacts.reduce((sum, fact) => sum + fact.finalRevenueVnd, 0n),
    );
    const topDishes = mergeDishRows(currentDishRows, previousDishRows);
    const timeDistribution = fillTimeDistribution(timeRows);
    const peakPeriod = resolvePeakPeriod(timeDistribution);

    return {
      generatedAt: new Date().toISOString(),
      currency: 'VND',
      period: {
        startDate: range.startDate,
        endDate: range.endDate,
        previousStartDate: range.previousStartDate,
        previousEndDate: range.previousEndDate,
        dayCount: range.dayCount,
        granularity: range.granularity,
        timeZone: 'Asia/Ho_Chi_Minh',
      },
      overview: {
        ...currentOverview,
        funds,
        previous: previousOverview,
        comparison: {
          revenuePercent: calculatePercentChange(
            currentOverview.revenueVnd,
            previousOverview.revenueVnd,
          ),
          settlementCountPercent: calculatePercentChange(
            currentOverview.settlementCount,
            previousOverview.settlementCount,
          ),
          averageOrderValuePercent: calculatePercentChange(
            currentOverview.averageOrderValueVnd,
            previousOverview.averageOrderValueVnd,
          ),
        },
        topDish: topDishes[0] ?? null,
      },
      trend: fillTrend(trendRows, range),
      timeDistribution,
      peakPeriod,
      topDishes,
    };
  }

  private loadOrders(
    merchantId: bigint,
    schedule: ReturnType<typeof normalizeBusinessHours>,
    startDate: string,
    endDate: string,
  ) {
    return this.prisma.order.findMany({
      where: effectiveOrderWhere({
        merchantId,
        status: OrderStatus.COMPLETED,
        ...businessDateRangeCandidateWhere(startDate, endDate),
      }),
      select: {
        id: true,
        orderNo: true,
        status: true,
        orderType: true,
        businessDate: true,
        completedAt: true,
        cancelledAt: true,
        createdAt: true,
        updatedAt: true,
        totalAmountVnd: true,
        itemAmountVnd: true,
        deliveryFeeVnd: true,
        discountPayableRateBps: true,
        discountAmountVnd: true,
        roundingAmountVnd: true,
        paymentMethod: true,
        tableId: true,
        tableSessionId: true,
        tableNoSnapshot: true,
        table: {
          select: { id: true, tableNo: true, tableName: true },
        },
        tableSession: {
          select: {
            id: true,
            openedAt: true,
            openedBusinessDate: true,
            status: true,
            closedAt: true,
            businessDate: true,
            discountAmountVnd: true,
            roundingAmountVnd: true,
            paymentMethod: true,
          },
        },
        items: {
          select: {
            id: true,
            productId: true,
            productNameZhSnapshot: true,
            imageUrlSnapshot: true,
            unitPriceVnd: true,
            quantity: true,
            subtotalVnd: true,
            remark: true,
            product: {
              select: {
                nameZh: true,
                nameVi: true,
                nameEn: true,
                imageUrl: true,
                category: {
                  select: { nameZh: true, nameVi: true, nameEn: true },
                },
              },
            },
          },
        },
      },
      orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
    });
  }
}

type AnalyticsOrder = Awaited<ReturnType<MerchantAnalyticsService['getAnalytics']>> extends never
  ? never
  : {
      resolvedBusinessDate: string;
      id: bigint;
      orderNo: string;
      status: 'COMPLETED';
      orderType: 'DINE_IN' | 'PICKUP' | 'DELIVERY';
      businessDate: Date | null;
      completedAt: Date | null;
      cancelledAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      totalAmountVnd: bigint;
      itemAmountVnd: bigint;
      deliveryFeeVnd: bigint;
      discountPayableRateBps: number | null;
      discountAmountVnd: bigint | null;
      roundingAmountVnd: bigint | null;
      paymentMethod: 'CASH' | 'BANK_TRANSFER' | null;
      tableId: bigint | null;
      tableSessionId: bigint | null;
      tableNoSnapshot: string | null;
      table: SettlementTableRow | null;
      tableSession: SettlementSessionRow | null;
      items: Array<{
        id: bigint;
        productId: bigint | null;
        productNameZhSnapshot: string;
        imageUrlSnapshot: string | null;
        unitPriceVnd: bigint;
        quantity: number;
        subtotalVnd: bigint;
        remark: string | null;
        product: {
          nameZh: string;
          nameVi: string | null;
          nameEn: string | null;
          imageUrl: string | null;
          category: { nameZh: string; nameVi: string | null; nameEn: string | null } | null;
        } | null;
      }>;
    };

function toSettlementOrderRow(
  order: Omit<AnalyticsOrder, 'resolvedBusinessDate' | 'status'>,
): SettlementOrderRow {
  return {
    id: order.id,
    orderNo: order.orderNo,
    status: 'COMPLETED',
    orderType: order.orderType,
    createdAt: order.createdAt,
    completedAt: order.completedAt,
    cancelledAt: order.cancelledAt,
    updatedAt: order.updatedAt,
    businessDate: order.businessDate,
    totalAmountVnd: order.totalAmountVnd,
    itemAmountVnd: order.itemAmountVnd,
    deliveryFeeVnd: order.deliveryFeeVnd,
    discountPayableRateBps: order.discountPayableRateBps,
    discountAmountVnd: order.discountAmountVnd,
    roundingAmountVnd: order.roundingAmountVnd,
    paymentMethod: order.paymentMethod,
    tableId: order.tableId,
    tableSessionId: order.tableSessionId,
    tableNoSnapshot: order.tableNoSnapshot,
    tableSession: order.tableSession,
    table: order.table,
    items: order.items.map(
      (item): SettlementItemRow => ({
        id: item.id,
        productId: item.productId,
        productNameZhSnapshot: item.productNameZhSnapshot,
        imageUrlSnapshot: item.imageUrlSnapshot,
        unitPriceVnd: item.unitPriceVnd,
        quantity: item.quantity,
        subtotalVnd: item.subtotalVnd,
        remark: item.remark,
        product: item.product
          ? {
              nameZh: item.product.nameZh,
              nameVi: item.product.nameVi,
              nameEn: item.product.nameEn,
            }
          : null,
      }),
    ),
  };
}

function aggregateTrendRows(facts: MerchantSettlementFact[], range: PeriodRange): TrendRow[] {
  const values = new Map<string, { settlementCount: number; revenueVnd: bigint }>();
  for (const fact of facts) {
    const local = new Date(fact.businessStartedAt.getTime() + VIETNAM_OFFSET_MS);
    const bucket = range.granularity === 'hour'
      ? String(local.getUTCHours()).padStart(2, '0')
      : fact.businessDate;
    const value = values.get(bucket) ?? { settlementCount: 0, revenueVnd: 0n };
    value.settlementCount += 1;
    value.revenueVnd += fact.finalRevenueVnd;
    values.set(bucket, value);
  }
  return [...values].map(([bucket, value]) => ({ bucket, ...value }));
}

function aggregateTimeDistributionRows(facts: MerchantSettlementFact[]): TimeDistributionRow[] {
  const values = new Map<string, {
    weekday: number;
    startHour: number;
    settlementCount: number;
    revenueVnd: bigint;
  }>();
  for (const fact of facts) {
    const local = new Date(fact.businessStartedAt.getTime() + VIETNAM_OFFSET_MS);
    const weekday = (new Date(`${fact.businessDate}T00:00:00.000Z`).getUTCDay() + 6) % 7;
    const startHour = Math.floor(local.getUTCHours() / TIME_BUCKET_HOURS) * TIME_BUCKET_HOURS;
    const key = `${weekday}:${startHour}`;
    const value = values.get(key) ?? { weekday, startHour, settlementCount: 0, revenueVnd: 0n };
    value.settlementCount += 1;
    value.revenueVnd += fact.finalRevenueVnd;
    values.set(key, value);
  }
  return [...values.values()];
}

function aggregateDishRows(orders: Array<{ items: AnalyticsOrder['items'] }>) {
  const values = new Map<string, DishAggregateRow>();
  for (const order of orders) {
    for (const item of order.items) {
      const dishKey = item.productId === null
        ? `name:${item.productNameZhSnapshot}`
        : `product:${item.productId}`;
      const category = item.product?.category;
      const current = values.get(dishKey);
      if (current) {
        current.quantity = Number(current.quantity) + item.quantity;
        current.revenueVnd = BigInt(String(current.revenueVnd)) + item.subtotalVnd;
      } else {
        values.set(dishKey, {
          dishKey,
          productId: item.productId,
          name: item.productNameZhSnapshot,
          imageUrl: item.imageUrlSnapshot || item.product?.imageUrl || null,
          categoryNameZh: category?.nameZh ?? null,
          categoryNameVi: category?.nameVi ?? null,
          categoryNameEn: category?.nameEn ?? null,
          quantity: item.quantity,
          revenueVnd: item.subtotalVnd,
        });
      }
    }
  }
  return filterAnalyticsDishRows([...values.values()]);
}

const STRUCTURED_CATEGORY_CJK_MARKERS = [
  '米饭', '饭类', '饮料', '饮品', '酒水', '茶饮', '咖啡',
] as const;
const STRUCTURED_CATEGORY_WORD_MARKERS = [
  'com', 'rice', 'do uong', 'nuoc uong', 'giai khat', 'nuoc ngot', 'beverage',
  'beverages', 'drink', 'drinks', 'soda', 'juice', 'bia', 'beer', 'ruou', 'wine',
  'ca phe', 'coffee', 'tra sua', 'tea',
] as const;
const GENERIC_CATEGORY_MARKERS = [
  '主食', '其他', '其它', '未分类', 'uncategorized', 'other', 'others', 'misc',
  'mon khac', 'khac',
] as const;
const HISTORY_RICE_CJK_MARKERS = [
  '米饭', '白饭', '炒饭', '盖饭', '拌饭',
] as const;
const HISTORY_BEVERAGE_CJK_ENDINGS = [
  '饮料', '饮品', '可乐', '雪碧', '果汁', '啤酒', '白酒', '红酒', '咖啡',
  '奶茶', '柠檬茶', '冰茶',
] as const;
const HISTORY_RICE_WORD_MARKERS = ['com', 'rice'] as const;
const HISTORY_BEVERAGE_WORD_ENDINGS = [
  'do uong', 'nuoc uong', 'giai khat', 'nuoc ngot', 'beverage', 'beverages',
  'drink', 'drinks', 'soda', 'juice', 'bia', 'beer', 'ruou', 'wine', 'coffee',
  'tra sua', 'tea',
] as const;
const HISTORY_BEVERAGE_WORD_PREFIXES = [
  'nuoc suoi', 'nuoc ep', 'nuoc ngot', 'nuoc uong', 'do uong', 'giai khat',
  'tra sua', 'ca phe', 'bia tuoi', 'ruou vang',
] as const;

export function filterAnalyticsDishRows(rows: DishAggregateRow[]) {
  return rows.filter((row) => !shouldExcludeDishFromAnalytics(row));
}

export function shouldExcludeDishFromAnalytics(
  row: Pick<
    DishAggregateRow,
    'name' | 'categoryNameZh' | 'categoryNameVi' | 'categoryNameEn'
  >,
) {
  const categoryNames = [
    row.categoryNameZh,
    row.categoryNameVi,
    row.categoryNameEn,
  ].filter((value): value is string => Boolean(value?.trim()));

  if (categoryNames.length) {
    const categorySignals = categoryNames.map(resolveCategorySignal);
    if (categorySignals.includes('mixed')) {
      return matchesHistoricalDishName(row.name);
    }
    if (categorySignals.includes('excluded')) {
      return true;
    }

    if (categoryNames.some((value) => isInformativeCategory(value))) {
      return false;
    }
  }

  return matchesHistoricalDishName(row.name);
}

function resolveCategorySignal(value: string): 'excluded' | 'mixed' | 'none' {
  const normalized = normalizeDishClassifierText(value);
  if (!normalized) return 'none';
  const hasExcludedMeaning =
    STRUCTURED_CATEGORY_CJK_MARKERS.some((marker) => normalized.includes(marker)) ||
    STRUCTURED_CATEGORY_WORD_MARKERS.some((marker) =>
      containsNormalizedPhrase(normalized, marker),
    );
  if (!hasExcludedMeaning) return 'none';

  let remainder = normalized;
  for (const marker of STRUCTURED_CATEGORY_CJK_MARKERS) {
    remainder = remainder.split(marker).join(' ');
  }
  for (const marker of STRUCTURED_CATEGORY_WORD_MARKERS) {
    remainder = ` ${remainder} `.replaceAll(` ${marker} `, ' ').trim();
  }
  remainder = remainder
    .replace(/[类分類品系列与和及]/gu, ' ')
    .split(/\s+/u)
    .filter((token) => !['and', 'or', 'va', 'category', 'categories', 'menu', 'nhom'].includes(token))
    .join('')
    .trim();

  return remainder ? 'mixed' : 'excluded';
}

function isInformativeCategory(value: string) {
  const normalized = normalizeDishClassifierText(value);
  return Boolean(normalized) && !GENERIC_CATEGORY_MARKERS.some((marker) =>
    normalized === normalizeDishClassifierText(marker),
  );
}

function matchesHistoricalDishName(value: string) {
  const normalized = normalizeDishClassifierText(value);
  if (!normalized) return false;

  if (HISTORY_RICE_CJK_MARKERS.some((marker) => normalized.includes(marker))) {
    return true;
  }
  if (HISTORY_BEVERAGE_CJK_ENDINGS.some((marker) => normalized.endsWith(marker))) {
    return true;
  }
  if (HISTORY_RICE_WORD_MARKERS.some((marker) =>
    containsNormalizedPhrase(normalized, marker),
  )) {
    return true;
  }
  if (HISTORY_BEVERAGE_WORD_PREFIXES.some((marker) =>
    normalized === marker || normalized.startsWith(`${marker} `),
  )) {
    return true;
  }

  return HISTORY_BEVERAGE_WORD_ENDINGS.some((marker) =>
    normalized === marker || normalized.endsWith(` ${marker}`),
  );
}

function normalizeDishClassifierText(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

function containsNormalizedPhrase(value: string, phrase: string) {
  return ` ${value} `.includes(` ${phrase} `);
}

export function buildOverview(
  settlementCount: number,
  revenue: bigint | number | string,
) {
  const revenueVnd = BigInt(revenue);
  return {
    revenueVnd: revenueVnd.toString(),
    settlementCount,
    averageOrderValueVnd:
      settlementCount > 0 ? (revenueVnd / BigInt(settlementCount)).toString() : '0',
  };
}

export function buildFundsOverview(facts: MerchantSettlementFact[]) {
  let grossAmountVnd = 0n;
  let discountAmountVnd = 0n;
  let roundingAmountVnd = 0n;
  let netSettledAmountVnd = 0n;
  let cashRevenueVnd = 0n;
  let bankTransferRevenueVnd = 0n;
  let unrecordedRevenueVnd = 0n;
  for (const fact of facts) {
    grossAmountVnd += fact.originalAmountVnd;
    discountAmountVnd += fact.discountAmountVnd;
    roundingAmountVnd += fact.roundingAmountVnd;
    netSettledAmountVnd += fact.finalRevenueVnd;
    if (fact.paymentMethod === 'CASH') cashRevenueVnd += fact.finalRevenueVnd;
    else if (fact.paymentMethod === 'BANK_TRANSFER') {
      bankTransferRevenueVnd += fact.finalRevenueVnd;
    } else {
      unrecordedRevenueVnd += fact.finalRevenueVnd;
    }
  }
  return {
    grossAmountVnd: grossAmountVnd.toString(),
    discountAmountVnd: discountAmountVnd.toString(),
    roundingAmountVnd: roundingAmountVnd.toString(),
    netSettledAmountVnd: netSettledAmountVnd.toString(),
    cashRevenueVnd: cashRevenueVnd.toString(),
    bankTransferRevenueVnd: bankTransferRevenueVnd.toString(),
    unrecordedRevenueVnd: unrecordedRevenueVnd.toString(),
  };
}

export function calculatePercentChange(
  current: bigint | number | string,
  previous: bigint | number | string,
) {
  const currentValue = Number(current);
  const previousValue = Number(previous);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue) || previousValue === 0) {
    return null;
  }
  return Math.round(((currentValue - previousValue) / previousValue) * 1000) / 10;
}

export function mergeDishRows(
  currentRows: DishAggregateRow[],
  previousRows: DishAggregateRow[],
) {
  const previousByKey = new Map(
    previousRows.map((item) => [item.dishKey, Number(item.quantity)]),
  );

  return currentRows
    .map((item) => {
      const quantity = Number(item.quantity);
      const previousQuantity = previousByKey.get(item.dishKey) ?? 0;
      return {
        key: item.dishKey,
        productId: item.productId === null ? null : String(item.productId),
        name: item.name,
        imageUrl: item.imageUrl,
        quantity,
        revenueVnd: String(item.revenueVnd),
        previousQuantity,
        changePercent: calculatePercentChange(quantity, previousQuantity),
      };
    })
    .sort(
      (left, right) =>
        right.quantity - left.quantity ||
        compareBigIntStrings(right.revenueVnd, left.revenueVnd) ||
        left.name.localeCompare(right.name, 'zh-CN'),
    )
    .slice(0, 10);
}

function fillTrend(rows: TrendRow[], range: PeriodRange) {
  const values = new Map(
    rows.map((item) => [
      String(item.bucket),
      {
        settlementCount: Number(item.settlementCount),
        revenueVnd: String(item.revenueVnd),
      },
    ]),
  );

  if (range.granularity === 'hour') {
    return Array.from({ length: 24 }, (_, hour) => {
      const key = String(hour).padStart(2, '0');
      const value = values.get(key);
      return {
        key,
        label: `${key}:00`,
        settlementCount: value?.settlementCount ?? 0,
        revenueVnd: value?.revenueVnd ?? '0',
      };
    });
  }

  return buildDateKeys(range.start, range.end).map((key) => {
    const value = values.get(key);
    return {
      key,
      label: key,
      settlementCount: value?.settlementCount ?? 0,
      revenueVnd: value?.revenueVnd ?? '0',
    };
  });
}

function fillTimeDistribution(rows: TimeDistributionRow[]) {
  const values = new Map(
    rows.map((item) => [
      `${Number(item.weekday)}:${Number(item.startHour)}`,
      {
        settlementCount: Number(item.settlementCount),
        revenueVnd: String(item.revenueVnd),
      },
    ]),
  );

  return Array.from({ length: 7 }, (_, weekday) =>
    Array.from({ length: 24 / TIME_BUCKET_HOURS }, (_, index) => {
      const startHour = index * TIME_BUCKET_HOURS;
      const value = values.get(`${weekday}:${startHour}`);
      return {
        weekday,
        startHour,
        endHour: startHour + TIME_BUCKET_HOURS,
        settlementCount: value?.settlementCount ?? 0,
        revenueVnd: value?.revenueVnd ?? '0',
      };
    }),
  ).flat();
}

function resolvePeakPeriod(
  rows: Array<{
    startHour: number;
    endHour: number;
    settlementCount: number;
    revenueVnd: string;
  }>,
) {
  const byTime = new Map<
    number,
    { startHour: number; endHour: number; settlementCount: number; revenueVnd: bigint }
  >();
  for (const row of rows) {
    const value = byTime.get(row.startHour) ?? {
      startHour: row.startHour,
      endHour: row.endHour,
      settlementCount: 0,
      revenueVnd: 0n,
    };
    value.settlementCount += row.settlementCount;
    value.revenueVnd += BigInt(row.revenueVnd);
    byTime.set(row.startHour, value);
  }
  const peak = Array.from(byTime.values()).sort(
    (left, right) =>
      right.settlementCount - left.settlementCount ||
      compareBigIntStrings(right.revenueVnd.toString(), left.revenueVnd.toString()) ||
      left.startHour - right.startHour,
  )[0];
  if (!peak || peak.settlementCount === 0) return null;
  return {
    startHour: peak.startHour,
    endHour: peak.endHour,
    settlementCount: peak.settlementCount,
    revenueVnd: peak.revenueVnd.toString(),
  };
}

function resolvePeriodRange(dateFrom?: string, dateTo?: string, defaultDate?: string): PeriodRange {
  const today = defaultDate ?? formatVietnamDate(new Date());
  const startDate = dateFrom ?? today;
  const endDate = dateTo ?? dateFrom ?? today;
  const start = startOfVietnamDate(startDate);
  const endDayStart = startOfVietnamDate(endDate);
  if (endDayStart < start) {
    throw new BadRequestException('结束日期不能早于开始日期');
  }
  const dayCount = Math.round((endDayStart.getTime() - start.getTime()) / DAY_MS) + 1;
  if (dayCount > MAX_RANGE_DAYS) {
    throw new BadRequestException(`经营分析日期范围不能超过 ${MAX_RANGE_DAYS} 天`);
  }
  const end = addDays(endDayStart, 1);
  const previousEnd = start;
  const previousStart = addDays(previousEnd, -dayCount);
  return {
    start,
    end,
    previousStart,
    previousEnd,
    startDate,
    endDate,
    previousStartDate: formatVietnamDate(previousStart),
    previousEndDate: formatVietnamDate(addDays(previousEnd, -1)),
    dayCount,
    granularity: dayCount === 1 ? 'hour' : 'day',
  };
}

function startOfVietnamDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) - VIETNAM_OFFSET_MS);
}

function formatVietnamDate(date: Date) {
  const vietnamTime = new Date(date.getTime() + VIETNAM_OFFSET_MS);
  const year = vietnamTime.getUTCFullYear();
  const month = String(vietnamTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(vietnamTime.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function buildDateKeys(start: Date, end: Date) {
  const values: string[] = [];
  for (let current = start; current < end; current = addDays(current, 1)) {
    values.push(formatVietnamDate(current));
  }
  return values;
}

function compareBigIntStrings(left: string, right: string) {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue > rightValue ? 1 : leftValue < rightValue ? -1 : 0;
}
