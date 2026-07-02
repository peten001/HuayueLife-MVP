import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Merchant,
  MerchantClaimStatus,
  MerchantMode,
  MerchantStatus,
  OrderStatus,
  OrderType,
  Prisma,
  ProductStatus,
  StaffRole,
  StaffStatus,
  TableStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { CreatePlatformMerchantDto } from './dto/create-platform-merchant.dto';
import { UpdatePlatformMerchantDto } from './dto/update-platform-merchant.dto';
import {
  CreateDisplayMerchantDto,
  UpdateMerchantCapabilitiesDto,
  UpdateMerchantTagsDto,
} from './dto/create-display-merchant.dto';
import { CreateMerchantImageDto, UpdateMerchantImageDto } from './dto/merchant-image.dto';
import type {
  MerchantImportConfirmRequest,
  MerchantImportConfirmResult,
  MerchantImportNormalizedRow,
  MerchantImportPreviewResponse,
  MerchantImportPreviewRow,
} from './dto/merchant-import.dto';
import { DEFAULT_DISPLAY_CAPABILITIES } from './platform-dictionary-seed';
import { PlatformDictionariesService } from './platform-dictionaries.service';
import {
  parseHomepageCategoryKeys,
  stringifyHomepageCategoryKeys,
} from '../shared/homepage-category-keys';

type MerchantWithOwner = Merchant & {
  businessType?: {
    id: bigint;
    code: string;
    nameZh: string;
    nameVi: string | null;
    nameEn: string | null;
  } | null;
  staff: Array<{
    id: bigint;
    username: string;
    mustChangePassword: boolean;
    status: StaffStatus;
    role: StaffRole;
  }>;
  promotionTags?: Array<{
    promotionTag: {
      id: bigint;
      code: string;
      nameZh: string;
      nameVi: string | null;
      nameEn: string | null;
    };
  }>;
  capabilities?: Array<{
    isEnabled: boolean;
    capability: {
      id: bigint;
      code: string;
      nameZh: string;
      nameVi: string | null;
      nameEn: string | null;
    };
  }>;
  images?: Array<{
    id: bigint;
    imageType: string;
    imageUrl: string;
    titleZh: string | null;
    titleVi: string | null;
    titleEn: string | null;
    sortOrder: number;
    isVisible: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>;
};

type PlatformMerchantListItem = {
  id: string;
  nameZh: string;
  nameVi?: string | null;
  nameEn?: string | null;
  businessType: DictionaryRef | null;
  merchantMode: MerchantMode;
  claimStatus: MerchantClaimStatus;
  city: string;
  district?: string | null;
  contactPhone: string;
  homepageCategoryKeys: string[];
  manualPopular: boolean;
  isVisibleOnClient: boolean;
  reportFeatureEnabled: boolean;
  promotionTags: DictionaryRef[];
  capabilities: Array<DictionaryRef & { isEnabled: boolean }>;
  capabilitySummary: string[];
  images: ReturnType<typeof serializeImages>;
  sortOrder: number;
  isNew: boolean;
  status: MerchantStatus;
  createdAt: string;
  updatedAt: string;
  ownerUsername: string;
  ownerMustChangePassword: boolean;
  ownerStatus: StaffStatus;
  profileCompletion: number;
  missingProfileFields: string[];
  todayOrderCount: number;
  todayOrderAmount: string;
  pendingAcceptanceOrderCount: number;
  preparingOrderCount: number;
  last7DaysOrderCount: number;
  lastOrderAt: string | null;
};

type MerchantOperationStats = {
  todayOrderCount: number;
  todayOrderAmount: string;
  pendingAcceptanceOrderCount: number;
  preparingOrderCount: number;
  last7DaysOrderCount: number;
  lastOrderAt: string | null;
};

type PlatformMerchantDetailResponse = {
  merchant: {
    id: string;
    name: string;
    nameZh: string;
    nameVi: string | null;
    nameEn: string | null;
    businessType: DictionaryRef | null;
    merchantMode: MerchantMode;
    claimStatus: MerchantClaimStatus;
    account: string;
    phone: string;
    contactName: string;
    province: string;
    city: string;
    district: string | null;
    address: string;
    addressZh: string | null;
    addressVi: string | null;
    addressEn: string | null;
    latitude: string;
    longitude: string;
    openingHoursText: string | null;
    descriptionZh: string | null;
    descriptionVi: string | null;
    descriptionEn: string | null;
    status: MerchantStatus;
    isActive: boolean;
    logoUrl: string | null;
    coverUrl: string | null;
    homepageCategoryKeys: string[];
    manualPopular: boolean;
    isVisibleOnClient: boolean;
    reportFeatureEnabled: boolean;
    dineInEnabled: boolean;
    promotionTags: DictionaryRef[];
    capabilities: Array<DictionaryRef & { isEnabled: boolean }>;
    sortOrder: number;
    isNew: boolean;
    images: ReturnType<typeof serializeImages>;
    profileCompletion: number;
    createdAt: string;
    updatedAt: string;
  };
  metrics: {
    todayOrderCount: number;
    todayOrderAmount: string;
    pendingAcceptanceOrderCount: number;
    preparingOrderCount: number;
    last7DaysOrderCount: number;
    last7DaysOrderAmount: string;
    completedOrderCount: number;
    canceledOrderCount: number;
    completionRate: number | null;
    averageOrderAmount: string | null;
    lastOrderAt: string | null;
  };
  trend: Array<{
    date: string;
    orderCount: number;
    orderAmount: string;
  }>;
  operation: {
    menuCategoryCount: number;
    dishCount: number;
    activeDishCount: number;
    tableCount: number;
    activeTableCount: number;
  };
  recentOrders: Array<{
    id: string;
    orderNo: string;
    orderType: OrderType;
    status: OrderStatus;
    totalAmount: string;
    contactPhone: string | null;
    createdAt: string;
  }>;
};

type DictionaryRef = {
  id: string;
  code: string;
  nameZh: string;
  nameVi?: string | null;
  nameEn?: string | null;
};

type UploadedFileLike = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size?: number;
};

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const PREPARING_STATUSES: OrderStatus[] = [
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.DELIVERING,
];

const DEFAULT_BUSINESS_HOURS = {
  monday: ['10:00-22:00'],
  tuesday: ['10:00-22:00'],
  wednesday: ['10:00-22:00'],
  thursday: ['10:00-22:00'],
  friday: ['10:00-22:00'],
  saturday: ['10:00-22:00'],
  sunday: ['10:00-22:00'],
};

@Injectable()
export class PlatformMerchantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dictionaries: PlatformDictionariesService,
  ) {}

  async list() {
    await this.dictionaries.ensureDefaults();
    const now = new Date();
    const todayStart = startOfVietnamDay(now);
    const tomorrowStart = addDays(todayStart, 1);
    const last7Start = addDays(todayStart, -6);
    const merchants = await this.prisma.merchant.findMany({
      where: {
        status: { not: MerchantStatus.DELETED },
      },
      include: {
        businessType: true,
        staff: {
          where: { role: StaffRole.OWNER },
          select: {
            id: true,
            username: true,
            mustChangePassword: true,
            status: true,
            role: true,
          },
        },
        promotionTags: {
          include: { promotionTag: true },
        },
        capabilities: {
          include: { capability: true },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
    const merchantIds = merchants.map((merchant) => merchant.id);
    const operationStats = await this.loadOperationStats(
      merchantIds,
      todayStart,
      tomorrowStart,
      last7Start,
    );

    return {
      items: merchants.map((merchant) =>
        this.toListItem(merchant, operationStats.get(merchant.id.toString())),
      ),
    };
  }

  async detail(id: bigint): Promise<PlatformMerchantDetailResponse> {
    const merchant = await this.requireMerchant(id);
    const now = new Date();
    const todayStart = startOfVietnamDay(now);
    const tomorrowStart = addDays(todayStart, 1);
    const last7Start = addDays(todayStart, -6);

    const [
      todayStats,
      last7Stats,
      currentPendingCount,
      currentPreparingCount,
      allTimeStats,
      canceledOrderCount,
      recentOrders,
      menuCategoryCount,
      dishCount,
      activeDishCount,
      tableCount,
      activeTableCount,
      lastOrder,
      trendOrders,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        where: {
          merchantId: id,
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gte: todayStart, lt: tomorrowStart },
        },
        _count: { _all: true },
        _sum: { totalAmountVnd: true },
      }),
      this.prisma.order.aggregate({
        where: {
          merchantId: id,
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gte: last7Start, lt: tomorrowStart },
        },
        _count: { _all: true },
        _sum: { totalAmountVnd: true },
      }),
      this.prisma.order.count({
        where: {
          merchantId: id,
          status: OrderStatus.PENDING_ACCEPTANCE,
        },
      }),
      this.prisma.order.count({
        where: {
          merchantId: id,
          status: { in: PREPARING_STATUSES },
        },
      }),
      this.prisma.order.aggregate({
        where: {
          merchantId: id,
          status: { not: OrderStatus.CANCELLED },
        },
        _count: { _all: true },
        _sum: { totalAmountVnd: true },
      }),
      this.prisma.order.count({
        where: {
          merchantId: id,
          status: OrderStatus.CANCELLED,
        },
      }),
      this.prisma.order.findMany({
        where: { merchantId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 5,
        select: {
          id: true,
          orderNo: true,
          orderType: true,
          status: true,
          totalAmountVnd: true,
          contactPhone: true,
          createdAt: true,
        },
      }),
      this.prisma.category.count({
        where: { merchantId: id },
      }),
      this.prisma.product.count({
        where: { merchantId: id },
      }),
      this.prisma.product.count({
        where: { merchantId: id, status: ProductStatus.ON_SALE },
      }),
      this.prisma.diningTable.count({
        where: { merchantId: id },
      }),
      this.prisma.diningTable.count({
        where: { merchantId: id, status: TableStatus.ACTIVE },
      }),
      this.prisma.order.findFirst({
        where: { merchantId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true },
      }),
      this.prisma.order.findMany({
        where: {
          merchantId: id,
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gte: last7Start, lt: tomorrowStart },
        },
        select: {
          totalAmountVnd: true,
          createdAt: true,
        },
      }),
    ]);

    const activeCount = Number(allTimeStats._count._all ?? 0);
    const completedOrderCount = await this.prisma.order.count({
      where: {
        merchantId: id,
        status: OrderStatus.COMPLETED,
      },
    });
    const totalAllTimeAmount = allTimeStats._sum.totalAmountVnd ?? 0n;
    const profile = this.computeProfileCompletion(merchant);

    return {
      merchant: {
        id: merchant.id.toString(),
        name: merchant.nameZh,
        nameZh: merchant.nameZh,
        nameVi: merchant.nameVi,
        nameEn: merchant.nameEn,
        businessType: serializeDictionaryRef(merchant.businessType),
        merchantMode: merchant.merchantMode,
        claimStatus: merchant.claimStatus,
        account:
          merchant.staff.find((item) => item.role === StaffRole.OWNER)?.username ??
          merchant.contactPhone,
        phone: merchant.contactPhone,
        contactName: merchant.contactName,
        province: merchant.province,
        city: merchant.city,
        district: merchant.district,
        address: merchant.addressDetail,
        addressZh: merchant.addressZh,
        addressVi: merchant.addressVi,
        addressEn: merchant.addressEn,
        latitude: merchant.latitude.toString(),
        longitude: merchant.longitude.toString(),
        openingHoursText: merchant.openingHoursText,
        descriptionZh: merchant.descriptionZh,
        descriptionVi: merchant.descriptionVi,
        descriptionEn: merchant.descriptionEn,
        status: merchant.status,
        isActive: merchant.status === MerchantStatus.ACTIVE,
        logoUrl: merchant.logoUrl,
        coverUrl: merchant.coverUrl,
        homepageCategoryKeys: parseHomepageCategoryKeys(merchant.homepageCategoryKeys),
        manualPopular: Boolean(merchant.manualPopular),
        isVisibleOnClient: Boolean(merchant.isVisibleOnClient),
        reportFeatureEnabled: Boolean(merchant.reportFeatureEnabled),
        dineInEnabled: Boolean(merchant.dineInEnabled),
        promotionTags: serializePromotionRefs(merchant),
        capabilities: serializeCapabilityRefs(merchant),
        images: serializeImages(merchant),
        sortOrder: merchant.sortOrder,
        isNew: merchant.isNew,
        profileCompletion: profile.completion,
        createdAt: merchant.createdAt.toISOString(),
        updatedAt: merchant.updatedAt.toISOString(),
      },
      metrics: {
        todayOrderCount: Number(todayStats._count._all ?? 0),
        todayOrderAmount: (todayStats._sum.totalAmountVnd ?? 0n).toString(),
        pendingAcceptanceOrderCount: currentPendingCount,
        preparingOrderCount: currentPreparingCount,
        last7DaysOrderCount: Number(last7Stats._count._all ?? 0),
        last7DaysOrderAmount: (last7Stats._sum.totalAmountVnd ?? 0n).toString(),
        completedOrderCount,
        canceledOrderCount,
        completionRate:
          activeCount > 0 ? Math.round((completedOrderCount / activeCount) * 100) : null,
        averageOrderAmount:
          activeCount > 0 ? (totalAllTimeAmount / BigInt(activeCount)).toString() : null,
        lastOrderAt: lastOrder?.createdAt.toISOString() ?? null,
      },
      trend: buildTrendRows(last7Start, trendOrders),
      operation: {
        menuCategoryCount,
        dishCount,
        activeDishCount,
        tableCount,
        activeTableCount,
      },
      recentOrders: recentOrders.map((order) => ({
        id: order.id.toString(),
        orderNo: order.orderNo,
        orderType: order.orderType,
        status: order.status,
        totalAmount: order.totalAmountVnd.toString(),
        contactPhone: order.contactPhone,
        createdAt: order.createdAt.toISOString(),
      })),
    };
  }

  async create(dto: CreatePlatformMerchantDto) {
    const phone = dto.phone.trim();
    const existingOwner = await this.prisma.merchantStaff.findFirst({
      where: { username: phone },
      select: { id: true },
    });
    if (existingOwner) {
      throw new ConflictException('该手机号已存在');
    }

    const generatedName = `新商户-${phone}`;
    const passwordHash = await bcrypt.hash('12345678', 12);
    const merchant = await this.prisma.merchant.create({
      data: {
        nameZh: generatedName,
        nameVi: null,
        merchantType: 'RESTAURANT',
        logoUrl: null,
        coverUrl: null,
        contactName: phone,
        contactPhone: phone,
        province: '待完善',
        city: '待完善',
        district: null,
        addressDetail: '待完善',
        latitude: 0,
        longitude: 0,
        businessHours: DEFAULT_BUSINESS_HOURS,
        notice: null,
        minimumDeliveryAmountVnd: 0n,
        deliveryFeeVnd: 0n,
        deliveryRadiusKm: 0,
        dineInEnabled: true,
        pickupEnabled: true,
        deliveryEnabled: false,
        homepageCategoryKeys: stringifyHomepageCategoryKeys(
          dto.homepageCategoryKeys,
        ),
        manualPopular: Boolean(dto.manualPopular),
        isVisibleOnClient:
          dto.isVisibleOnClient === undefined ? true : dto.isVisibleOnClient,
        reportFeatureEnabled: Boolean(dto.reportFeatureEnabled),
        status: MerchantStatus.ACTIVE,
        staff: {
          create: {
            username: phone,
            displayName: `${generatedName}老板`,
            passwordHash,
            role: StaffRole.OWNER,
            status: StaffStatus.ACTIVE,
            mustChangePassword: true,
          },
        },
      },
      include: {
        staff: {
          where: { role: StaffRole.OWNER },
          select: {
            id: true,
            username: true,
            mustChangePassword: true,
            status: true,
            role: true,
          },
        },
      },
    });

    return this.toListItem(merchant, emptyOperationStats());
  }

  async createDisplayMerchant(dto: CreateDisplayMerchantDto) {
    await this.dictionaries.ensureDefaults();
    const businessTypeId = await this.resolveBusinessTypeId(dto.businessTypeId);
    const tagIds = parseIdList(dto.promotionTagIds);
    const capabilities = await this.loadCapabilities();
    const enabledCapabilityCodes = new Set(
      Object.entries(DEFAULT_DISPLAY_CAPABILITIES)
        .filter(([, enabled]) => enabled)
        .map(([code]) => code),
    );
    const homepageCategoryKeys = businessTypeId
      ? await this.homepageKeysForBusinessType(businessTypeId)
      : [];
    const manualPopular = await this.hasPromotionTagCode(tagIds, 'HOT_FOOD');

    const merchant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.merchant.create({
        data: {
          businessTypeId,
          nameZh: dto.nameZh.trim(),
          nameVi: dto.nameVi.trim(),
          nameEn: dto.nameEn.trim(),
          merchantType: 'RESTAURANT',
          merchantMode: normalizeMerchantMode(dto.merchantMode) ?? MerchantMode.DISPLAY,
          claimStatus: MerchantClaimStatus.UNCLAIMED,
          logoUrl: trimOrNull(dto.logoUrl),
          coverUrl: dto.coverUrl.trim(),
          contactName: dto.contactName.trim(),
          contactPhone: dto.contactPhone.trim(),
          province: dto.province.trim(),
          city: trimOrNull(dto.city) ?? dto.province.trim(),
          district: trimOrNull(dto.district),
          addressDetail: dto.addressZh.trim(),
          addressZh: dto.addressZh.trim(),
          addressVi: trimOrNull(dto.addressVi),
          addressEn: trimOrNull(dto.addressEn),
          latitude: dto.latitude,
          longitude: dto.longitude,
          businessHours: DEFAULT_BUSINESS_HOURS,
          openingHoursText: trimOrNull(dto.openingHoursText),
          notice: trimOrNull(dto.descriptionZh),
          descriptionZh: trimOrNull(dto.descriptionZh),
          descriptionVi: trimOrNull(dto.descriptionVi),
          descriptionEn: trimOrNull(dto.descriptionEn),
          minimumDeliveryAmountVnd: 0n,
          deliveryFeeVnd: 0n,
          deliveryRadiusKm: 0,
          dineInEnabled: false,
          pickupEnabled: false,
          deliveryEnabled: false,
          homepageCategoryKeys: stringifyHomepageCategoryKeys(homepageCategoryKeys),
          manualPopular,
          isVisibleOnClient:
            dto.isVisibleOnClient === undefined ? true : dto.isVisibleOnClient,
          reportFeatureEnabled: false,
          sortOrder: dto.sortOrder ?? 0,
          isNew: Boolean(dto.isNew),
          recommendedAt: tagIds.length ? new Date() : null,
          status: dto.status ?? MerchantStatus.ACTIVE,
        },
      });

      if (tagIds.length) {
        await tx.merchantPromotionTag.createMany({
          data: tagIds.map((promotionTagId) => ({
            merchantId: created.id,
            promotionTagId,
          })),
          skipDuplicates: true,
        });
      }
      if (capabilities.length) {
        await tx.merchantCapability.createMany({
          data: capabilities.map((capability) => ({
            merchantId: created.id,
            capabilityId: capability.id,
            isEnabled: enabledCapabilityCodes.has(capability.code),
          })),
          skipDuplicates: true,
        });
      }
      const imageRows = [
        created.logoUrl
          ? {
              merchantId: created.id,
              imageType: 'LOGO',
              imageUrl: created.logoUrl,
              titleZh: 'Logo',
              sortOrder: 0,
              isVisible: true,
            }
          : null,
        created.coverUrl
          ? {
              merchantId: created.id,
              imageType: 'COVER',
              imageUrl: created.coverUrl,
              titleZh: '封面图',
              sortOrder: 1,
              isVisible: true,
            }
          : null,
      ].filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (imageRows.length) {
        await tx.merchantImage.createMany({ data: imageRows });
      }
      return created;
    });

    return this.findById(merchant.id);
  }

  getMerchantImportTemplate() {
    const headers = MERCHANT_IMPORT_HEADERS.join(',');
    const example = serializeCsvRow([
      '川味小馆',
      'Quán Tứ Xuyên',
      'Chuanwei Restaurant',
      'CHINESE_RESTAURANT',
      '0988123456',
      '胡老板',
      '北江',
      'No.18 Area A, Commercial Street, Van Trung Industrial Park',
      '21.28',
      '106.20',
      'https://example.com/merchant-cover.jpg',
    ]);
    return `\ufeff${headers}\n${example}\n`;
  }

  async previewMerchantImport(file?: UploadedFileLike): Promise<MerchantImportPreviewResponse> {
    const upload = this.ensureImportCsv(file);
    const csv = decodeCsvBuffer(upload.buffer);
    const parsed = parseCsv(csv);
    const records = parsed.records.filter((record) => hasAnyCsvValue(record));
    if (!records.length) {
      return { totalRows: 0, validRows: 0, invalidRows: 0, rows: [] };
    }
    return this.buildMerchantImportPreview(records);
  }

  async confirmMerchantImport(body: MerchantImportConfirmRequest): Promise<MerchantImportConfirmResult> {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const createdMerchantIds: string[] = [];
    const failedRows: MerchantImportConfirmResult['failedRows'] = [];
    let importedCount = 0;

    for (const row of rows) {
      const previewErrors = Array.isArray(row.errors) ? row.errors : [];
      if (previewErrors.length) {
        failedRows.push({ rowNumber: row.rowNumber, errors: previewErrors });
        continue;
      }
      const normalized = row.normalizedData;
      if (!normalized) {
        failedRows.push({ rowNumber: row.rowNumber, errors: ['缺少规范化数据'] });
        continue;
      }
      try {
        const businessType = await this.resolveSelectableBusinessTypeByCode(normalized.businessTypeCode);
        const promotionTags = await this.resolveEnabledPromotionTagsByCodes(normalized.promotionTagCodes);
        const created = await this.createDisplayMerchant({
          nameZh: normalized.nameZh,
          nameVi: normalized.nameVi,
          nameEn: normalized.nameEn,
          businessTypeId: businessType.id.toString(),
          merchantMode: MerchantMode.DISPLAY,
          contactPhone: normalized.contactPhone,
          contactName: normalized.contactName,
          province: normalized.province,
          city: normalized.city ?? normalized.province,
          district: normalized.district ?? undefined,
          addressZh: normalized.addressZh,
          addressVi: normalized.addressVi ?? undefined,
          addressEn: normalized.addressEn ?? undefined,
          latitude: normalized.latitude as number,
          longitude: normalized.longitude as number,
          openingHoursText: normalized.openingHoursText ?? undefined,
          descriptionZh: normalized.descriptionZh ?? undefined,
          descriptionVi: normalized.descriptionVi ?? undefined,
          descriptionEn: normalized.descriptionEn ?? undefined,
          logoUrl: normalized.logoUrl ?? undefined,
          coverUrl: normalized.coverUrl,
          promotionTagIds: promotionTags.map((item) => item.id.toString()),
          isNew: normalized.isNew,
          isVisibleOnClient: normalized.isVisibleOnClient,
          sortOrder: normalized.sortOrder,
          status:
            normalized.status === 'DRAFT' ? MerchantStatus.PENDING : MerchantStatus.ACTIVE,
        });
        createdMerchantIds.push(created.id);
        importedCount += 1;
      } catch (error) {
        failedRows.push({
          rowNumber: row.rowNumber,
          errors: [error instanceof Error ? error.message : '导入失败'],
        });
      }
    }

    return {
      importedCount,
      failedCount: failedRows.length,
      failedRows,
      createdMerchantIds,
    };
  }

  async update(id: bigint, dto: UpdatePlatformMerchantDto) {
    await this.requireMerchant(id);
    const data: Record<string, unknown> = {};
    if (dto.nameZh !== undefined) {
      data.nameZh = dto.nameZh.trim();
    }
    if (dto.nameVi !== undefined) data.nameVi = trimOrNull(dto.nameVi);
    if (dto.nameEn !== undefined) data.nameEn = trimOrNull(dto.nameEn);
    if (dto.businessTypeId !== undefined) {
      data.businessTypeId = dto.businessTypeId ? BigInt(dto.businessTypeId) : null;
      data.homepageCategoryKeys = stringifyHomepageCategoryKeys(
        dto.businessTypeId
          ? await this.homepageKeysForBusinessType(BigInt(dto.businessTypeId))
          : [],
      );
    }
    if (dto.merchantMode !== undefined) data.merchantMode = normalizeMerchantMode(dto.merchantMode);
    if (dto.contactPhone !== undefined) {
      data.contactPhone = dto.contactPhone.trim();
    }
    if (dto.contactName !== undefined) data.contactName = trimOrNull(dto.contactName) ?? '';
    if (dto.province !== undefined) {
      data.province = trimOrNull(dto.province) ?? '';
      if (dto.city === undefined) {
        data.city = trimOrNull(dto.province) ?? '';
      }
    }
    if (dto.city !== undefined) data.city = trimOrNull(dto.city) ?? '';
    if (dto.district !== undefined) data.district = trimOrNull(dto.district);
    if (dto.addressZh !== undefined) {
      data.addressZh = trimOrNull(dto.addressZh);
      data.addressDetail = trimOrNull(dto.addressZh) ?? '';
    }
    if (dto.addressVi !== undefined) data.addressVi = trimOrNull(dto.addressVi);
    if (dto.addressEn !== undefined) data.addressEn = trimOrNull(dto.addressEn);
    if (dto.latitude !== undefined) data.latitude = dto.latitude;
    if (dto.longitude !== undefined) data.longitude = dto.longitude;
    if (dto.openingHoursText !== undefined) data.openingHoursText = trimOrNull(dto.openingHoursText);
    if (dto.descriptionZh !== undefined) {
      data.descriptionZh = trimOrNull(dto.descriptionZh);
      data.notice = trimOrNull(dto.descriptionZh);
    }
    if (dto.descriptionVi !== undefined) data.descriptionVi = trimOrNull(dto.descriptionVi);
    if (dto.descriptionEn !== undefined) data.descriptionEn = trimOrNull(dto.descriptionEn);
    if (dto.logoUrl !== undefined) data.logoUrl = trimOrNull(dto.logoUrl);
    if (dto.coverUrl !== undefined) data.coverUrl = trimOrNull(dto.coverUrl);
    if (dto.homepageCategoryKeys !== undefined) {
      data.homepageCategoryKeys = stringifyHomepageCategoryKeys(
        dto.homepageCategoryKeys,
      );
    }
    if (dto.manualPopular !== undefined) {
      data.manualPopular = dto.manualPopular;
    }
    if (dto.isVisibleOnClient !== undefined) {
      data.isVisibleOnClient = dto.isVisibleOnClient;
    }
    if (dto.reportFeatureEnabled !== undefined) {
      data.reportFeatureEnabled = dto.reportFeatureEnabled;
    }
    if (dto.isNew !== undefined) data.isNew = dto.isNew;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.status !== undefined) data.status = dto.status;

    await this.prisma.merchant.update({
      where: { id },
      data: this.applyLegacyCapabilityBooleans(data),
    });

    return this.findById(id);
  }

  async updateCapabilities(id: bigint, dto: UpdateMerchantCapabilitiesDto) {
    await this.requireMerchant(id);
    await this.dictionaries.ensureDefaults();
    const capabilities = await this.loadCapabilities();
    const capabilityByCode = new Map(capabilities.map((item) => [item.code, item]));
    const requested = new Map(
      (dto.items ?? []).map((item) => [String(item.code), Boolean(item.isEnabled)]),
    );
    await this.prisma.$transaction(async (tx) => {
      for (const [code, isEnabled] of requested) {
        const capability = capabilityByCode.get(code);
        if (!capability) continue;
        await tx.merchantCapability.upsert({
          where: {
            merchantId_capabilityId: {
              merchantId: id,
              capabilityId: capability.id,
            },
          },
          create: {
            merchantId: id,
            capabilityId: capability.id,
            isEnabled,
          },
          update: { isEnabled },
        });
      }
      await tx.merchant.update({
        where: { id },
        data: legacyBooleansFromCapabilities(requested),
      });
    });
    return this.findById(id);
  }

  async updateTags(id: bigint, dto: UpdateMerchantTagsDto) {
    await this.requireMerchant(id);
    const tagIds = parseIdList(dto.promotionTagIds);
    const manualPopular = await this.hasPromotionTagCode(tagIds, 'HOT_FOOD');
    await this.prisma.$transaction(async (tx) => {
      await tx.merchantPromotionTag.deleteMany({ where: { merchantId: id } });
      if (tagIds.length) {
        await tx.merchantPromotionTag.createMany({
          data: tagIds.map((promotionTagId) => ({ merchantId: id, promotionTagId })),
          skipDuplicates: true,
        });
      }
      await tx.merchant.update({
        where: { id },
        data: {
          manualPopular,
          recommendedAt: tagIds.length ? new Date() : null,
        },
      });
    });
    return this.findById(id);
  }

  async openAccount(id: bigint) {
    const merchant = await this.requireMerchant(id);
    if (merchant.staff.some((item) => item.role === StaffRole.OWNER)) {
      return this.findById(id);
    }
    const username = merchant.contactPhone.trim();
    if (!username) throw new BadRequestException('商家手机号不能为空');
    const existingOwner = await this.prisma.merchantStaff.findFirst({
      where: { username },
      select: { id: true },
    });
    if (existingOwner) throw new ConflictException('该手机号已存在');
    const passwordHash = await bcrypt.hash('12345678', 12);
    await this.prisma.$transaction(async (tx) => {
      await tx.merchantStaff.create({
        data: {
          merchantId: id,
          username,
          passwordHash,
          displayName: `${merchant.nameZh}老板`,
          role: StaffRole.OWNER,
          status: StaffStatus.ACTIVE,
          mustChangePassword: true,
        },
      });
      await tx.merchant.update({
        where: { id },
        data: {
          claimStatus: MerchantClaimStatus.CLAIMED,
          merchantMode: MerchantMode.MANAGED,
        },
      });
    });
    return this.findById(id);
  }

  async listImages(id: bigint) {
    await this.requireMerchant(id);
    const items = await this.prisma.merchantImage.findMany({
      where: { merchantId: id },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return { items: items.map(serializeImage) };
  }

  async createImage(id: bigint, dto: CreateMerchantImageDto) {
    await this.requireMerchant(id);
    const item = await this.prisma.merchantImage.create({
      data: {
        merchantId: id,
        imageType: dto.imageType,
        imageUrl: dto.imageUrl.trim(),
        titleZh: trimOrNull(dto.titleZh),
        titleVi: trimOrNull(dto.titleVi),
        titleEn: trimOrNull(dto.titleEn),
        sortOrder: dto.sortOrder ?? 0,
        isVisible: dto.isVisible ?? true,
      },
    });
    await this.syncLegacyImageUrl(id, item.imageType, item.imageUrl, item.isVisible);
    return serializeImage(item);
  }

  async updateImage(id: bigint, imageId: bigint, dto: UpdateMerchantImageDto) {
    await this.requireMerchant(id);
    const previous = await this.prisma.merchantImage.findUnique({
      where: { id: imageId },
      select: { merchantId: true, imageType: true },
    });
    if (!previous || previous.merchantId !== id) throw new NotFoundException('Merchant image not found');
    const item = await this.prisma.merchantImage.update({
      where: { id: imageId },
      data: stripUndefined({
        imageType: dto.imageType,
        imageUrl: dto.imageUrl?.trim(),
        titleZh: dto.titleZh === undefined ? undefined : trimOrNull(dto.titleZh),
        titleVi: dto.titleVi === undefined ? undefined : trimOrNull(dto.titleVi),
        titleEn: dto.titleEn === undefined ? undefined : trimOrNull(dto.titleEn),
        sortOrder: dto.sortOrder,
        isVisible: dto.isVisible,
      }),
    });
    if (previous.imageType !== item.imageType && isLegacyImageType(previous.imageType)) {
      await this.refreshLegacyImageUrl(id, previous.imageType);
    }
    await this.syncLegacyImageUrl(id, item.imageType, item.imageUrl, item.isVisible);
    return serializeImage(item);
  }

  async hideImage(id: bigint, imageId: bigint) {
    await this.requireMerchant(id);
    const previous = await this.prisma.merchantImage.findUnique({
      where: { id: imageId },
      select: { merchantId: true, imageType: true },
    });
    if (!previous || previous.merchantId !== id) throw new NotFoundException('Merchant image not found');
    const item = await this.prisma.merchantImage.update({
      where: { id: imageId },
      data: { isVisible: false },
    });
    if (isLegacyImageType(previous.imageType)) {
      await this.refreshLegacyImageUrl(id, previous.imageType);
    }
    return serializeImage(item);
  }

  async disable(id: bigint) {
    await this.requireMerchant(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.merchant.update({
        where: { id },
        data: { status: MerchantStatus.DISABLED },
      });
      await tx.merchantStaff.updateMany({
        where: { merchantId: id },
        data: { status: StaffStatus.DISABLED },
      });
    });
    return this.findById(id);
  }

  async enable(id: bigint) {
    await this.requireMerchant(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.merchant.update({
        where: { id },
        data: { status: MerchantStatus.ACTIVE },
      });
      await tx.merchantStaff.updateMany({
        where: { merchantId: id },
        data: { status: StaffStatus.ACTIVE },
      });
    });
    return this.findById(id);
  }

  async resetPassword(id: bigint) {
    const merchant = await this.requireMerchant(id);
    const owner = merchant.staff.find((item) => item.role === StaffRole.OWNER);
    if (!owner) {
      throw new NotFoundException('OWNER account not found');
    }
    const passwordHash = await bcrypt.hash('12345678', 12);
    await this.prisma.merchantStaff.update({
      where: { id: owner.id },
      data: {
        passwordHash,
        mustChangePassword: true,
        status: StaffStatus.ACTIVE,
      },
    });
    return this.findById(id);
  }

  async delete(id: bigint) {
    await this.requireMerchant(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.merchant.update({
        where: { id },
        data: { status: MerchantStatus.DELETED },
      });
      await tx.merchantStaff.updateMany({
        where: { merchantId: id },
        data: { status: StaffStatus.DISABLED },
      });
    });
    return this.findById(id);
  }

  private async findById(id: bigint) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id },
        include: {
        businessType: true,
        staff: {
          where: { role: StaffRole.OWNER },
          select: {
            id: true,
            username: true,
            mustChangePassword: true,
            status: true,
            role: true,
          },
        },
        promotionTags: {
          include: { promotionTag: true },
        },
        capabilities: {
          include: { capability: true },
        },
        images: true,
      },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }
    return this.toListItem(merchant, emptyOperationStats());
  }

  private async requireMerchant(id: bigint) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id },
      include: {
        businessType: true,
        staff: {
          where: { role: StaffRole.OWNER },
          select: {
            id: true,
            username: true,
            mustChangePassword: true,
            status: true,
            role: true,
          },
        },
        promotionTags: {
          include: { promotionTag: true },
        },
        capabilities: {
          include: { capability: true },
        },
        images: true,
      },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }
    return merchant as MerchantWithOwner;
  }

  private toListItem(
    merchant: MerchantWithOwner,
    stats = emptyOperationStats(),
  ): PlatformMerchantListItem {
    const owner = merchant.staff.find((item) => item.role === StaffRole.OWNER);
    const profile = this.computeProfileCompletion(merchant);
    return {
      id: merchant.id.toString(),
      nameZh: merchant.nameZh,
      nameVi: merchant.nameVi,
      nameEn: merchant.nameEn,
      businessType: serializeDictionaryRef(merchant.businessType),
      merchantMode: merchant.merchantMode,
      claimStatus: merchant.claimStatus,
      city: merchant.city,
      district: merchant.district,
      contactPhone: merchant.contactPhone,
      homepageCategoryKeys: parseHomepageCategoryKeys(
        merchant.homepageCategoryKeys,
      ),
      manualPopular: Boolean(merchant.manualPopular),
        isVisibleOnClient: Boolean(merchant.isVisibleOnClient),
        reportFeatureEnabled: Boolean(merchant.reportFeatureEnabled),
      promotionTags: serializePromotionRefs(merchant),
      capabilities: serializeCapabilityRefs(merchant),
      capabilitySummary: serializeCapabilityRefs(merchant)
        .filter((item) => item.isEnabled)
        .map((item) => item.nameZh),
      sortOrder: merchant.sortOrder,
      isNew: merchant.isNew,
      images: serializeImages(merchant),
        status: merchant.status,
      createdAt: merchant.createdAt.toISOString(),
      updatedAt: merchant.updatedAt.toISOString(),
      ownerUsername: owner?.username ?? '',
      ownerMustChangePassword: owner?.mustChangePassword ?? false,
      ownerStatus: owner?.status ?? StaffStatus.DISABLED,
      profileCompletion: profile.completion,
      missingProfileFields: profile.missingFields,
      todayOrderCount: stats.todayOrderCount,
      todayOrderAmount: stats.todayOrderAmount,
      pendingAcceptanceOrderCount: stats.pendingAcceptanceOrderCount,
      preparingOrderCount: stats.preparingOrderCount,
      last7DaysOrderCount: stats.last7DaysOrderCount,
      lastOrderAt: stats.lastOrderAt,
    };
  }

  private async loadOperationStats(
    merchantIds: bigint[],
    todayStart: Date,
    tomorrowStart: Date,
    last7Start: Date,
  ) {
    const stats = new Map<string, MerchantOperationStats>();
    for (const merchantId of merchantIds) {
      stats.set(merchantId.toString(), emptyOperationStats());
    }
    if (!merchantIds.length) return stats;

    const [
      todayGroups,
      pendingGroups,
      preparingGroups,
      last7Groups,
      lastOrderGroups,
    ] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['merchantId'],
        where: {
          merchantId: { in: merchantIds },
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gte: todayStart, lt: tomorrowStart },
        },
        _count: { _all: true },
        _sum: { totalAmountVnd: true },
      }),
      this.prisma.order.groupBy({
        by: ['merchantId'],
        where: {
          merchantId: { in: merchantIds },
          status: OrderStatus.PENDING_ACCEPTANCE,
        },
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ['merchantId'],
        where: {
          merchantId: { in: merchantIds },
          status: { in: PREPARING_STATUSES },
        },
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ['merchantId'],
        where: {
          merchantId: { in: merchantIds },
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gte: last7Start, lt: tomorrowStart },
        },
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ['merchantId'],
        where: { merchantId: { in: merchantIds } },
        _max: { createdAt: true },
      }),
    ]);

    for (const item of todayGroups) {
      const row = stats.get(item.merchantId.toString());
      if (!row) continue;
      row.todayOrderCount = item._count._all;
      row.todayOrderAmount = (item._sum.totalAmountVnd ?? 0n).toString();
    }
    for (const item of pendingGroups) {
      const row = stats.get(item.merchantId.toString());
      if (row) row.pendingAcceptanceOrderCount = item._count._all;
    }
    for (const item of preparingGroups) {
      const row = stats.get(item.merchantId.toString());
      if (row) row.preparingOrderCount = item._count._all;
    }
    for (const item of last7Groups) {
      const row = stats.get(item.merchantId.toString());
      if (row) row.last7DaysOrderCount = item._count._all;
    }
    for (const item of lastOrderGroups) {
      const row = stats.get(item.merchantId.toString());
      if (row) row.lastOrderAt = item._max.createdAt?.toISOString() ?? null;
    }

    return stats;
  }

  private async resolveBusinessTypeId(value?: string) {
    await this.dictionaries.ensureDefaults();
    if (value?.trim()) return BigInt(value);
    const fallback = await this.prisma.merchantBusinessType.findFirst({
      where: { code: 'CHINESE_RESTAURANT' },
      select: { id: true },
    });
    return fallback?.id ?? null;
  }

  private async homepageKeysForBusinessType(id: bigint) {
    const type = await this.prisma.merchantBusinessType.findUnique({
      where: { id },
      select: { code: true },
    });
    const map: Record<string, string> = {
      CHINESE_RESTAURANT: 'chinese_dining',
      NOODLE_SNACK: 'noodles_snacks',
      COFFEE_TEA: 'coffee_milk_tea',
      FLOWER_GIFT: 'flowers_gifts',
      FRUIT_FRESH: 'fresh_fruit',
      CONVENIENCE_MARKET: 'convenience_store',
      VIETNAMESE_FOOD: 'vietnamese_food',
    };
    return type?.code && map[type.code] ? [map[type.code]] : [];
  }

  private async hasPromotionTagCode(tagIds: bigint[], code: string) {
    if (!tagIds.length) return false;
    const count = await this.prisma.promotionTag.count({
      where: { id: { in: tagIds }, code },
    });
    return count > 0;
  }

  private async loadCapabilities() {
    await this.dictionaries.ensureDefaults();
    return this.prisma.capability.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, code: true },
    });
  }

  private ensureImportCsv(file?: UploadedFileLike) {
    if (!file) {
      throw new BadRequestException('CSV file is required');
    }
    const name = file.originalname?.toLowerCase() ?? '';
    const mime = file.mimetype?.toLowerCase() ?? '';
    const isCsvFile =
      name.endsWith('.csv') ||
      mime.includes('csv') ||
      mime === 'text/plain' ||
      mime === 'application/vnd.ms-excel';
    if (!isCsvFile) {
      throw new BadRequestException('当前版本仅支持 CSV');
    }
    return file;
  }

  private async buildMerchantImportPreview(
    records: Array<Record<string, string>>,
  ): Promise<MerchantImportPreviewResponse> {
    await this.dictionaries.ensureDefaults();
    const [businessTypes, promotionTags, existingMerchants] = await Promise.all([
      this.prisma.merchantBusinessType.findMany({
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          parentId: true,
          code: true,
          nameZh: true,
          enabled: true,
        },
      }),
      this.prisma.promotionTag.findMany({
        where: { enabled: true },
        select: {
          id: true,
          code: true,
          nameZh: true,
          enabled: true,
        },
      }),
      this.prisma.merchant.findMany({
        where: { status: { not: MerchantStatus.DELETED } },
        select: {
          nameZh: true,
          contactPhone: true,
        },
      }),
    ]);

    const selectableBusinessTypes = getSelectableBusinessTypes(businessTypes);
    const businessTypeByCode = new Map(selectableBusinessTypes.map((item) => [item.code, item]));
    const promotionTagByCode = new Map(promotionTags.map((item) => [item.code, item]));
    const rows = records.map((rawData, index) =>
      this.normalizeImportRecord({
        rowNumber: index + 2,
        rawData,
        businessTypeByCode,
        promotionTagByCode,
      }),
    );

    const pairCounts = new Map<string, number>();
    for (const row of rows) {
      const normalized = row.normalizedData;
      if (!normalized) continue;
      const key = pairKey(normalized.nameZh, normalized.contactPhone);
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }

    const existingPairs = new Set(
      existingMerchants.map((item) => pairKey(item.nameZh, item.contactPhone)),
    );

    for (const row of rows) {
      const normalized = row.normalizedData;
      if (!normalized) {
        row.status = 'ERROR';
        continue;
      }
      const key = pairKey(normalized.nameZh, normalized.contactPhone);
      if ((pairCounts.get(key) ?? 0) > 1) {
        row.warnings.push('同一文件内 nameZh + contactPhone 重复');
      }
      if (existingPairs.has(key)) {
        row.warnings.push('数据库中已存在相同 nameZh + contactPhone 的商家');
      }
      row.status = row.errors.length ? 'ERROR' : row.warnings.length ? 'WARNING' : 'VALID';
    }

    return {
      totalRows: rows.length,
      validRows: rows.filter((item) => item.status !== 'ERROR').length,
      invalidRows: rows.filter((item) => item.status === 'ERROR').length,
      rows,
    };
  }

  private normalizeImportRecord({
    rowNumber,
    rawData,
    businessTypeByCode,
    promotionTagByCode,
  }: {
    rowNumber: number;
    rawData: Record<string, string>;
    businessTypeByCode: Map<string, { id: bigint; code: string; nameZh: string; enabled: boolean; parentId: bigint | null }>;
    promotionTagByCode: Map<string, { id: bigint; code: string; nameZh: string; enabled: boolean }>;
  }): MerchantImportPreviewRow {
    const normalized = normalizeMerchantImportRow(rawData);
    const errors: string[] = [];
    const warnings: string[] = [];
    const rawStatus = normalizeImportText(rawData.status).toUpperCase();

    if (!normalized.nameZh) errors.push('nameZh 必填');
    if (!normalized.businessTypeCode) {
      errors.push('businessTypeCode 必填');
    } else {
      const businessType = businessTypeByCode.get(normalized.businessTypeCode);
      if (!businessType) {
        errors.push(`businessTypeCode ${normalized.businessTypeCode} 不存在或不可导入`);
      }
    }
    if (!normalized.nameVi) errors.push('nameVi 必填');
    if (!normalized.nameEn) errors.push('nameEn 必填');
    if (!normalized.contactPhone) errors.push('contactPhone 必填');
    if (!normalized.contactName) errors.push('contactName 必填');
    if (!normalized.province) errors.push('province 必填');
    if (!normalized.addressZh) errors.push('addressZh 必填');
    if (!normalized.coverUrl) errors.push('coverUrl 必填');
    if (normalized.latitude === null || !Number.isFinite(normalized.latitude)) {
      errors.push('latitude 必填');
    } else if (normalized.latitude < -90 || normalized.latitude > 90) {
      errors.push('纬度必须在 -90 到 90 之间');
    }
    if (normalized.longitude === null || !Number.isFinite(normalized.longitude)) {
      errors.push('longitude 必填');
    } else if (normalized.longitude < -180 || normalized.longitude > 180) {
      errors.push('经度必须在 -180 到 180 之间');
    }
    if (rawStatus && rawStatus !== 'DRAFT' && rawStatus !== 'ACTIVE') {
      errors.push('status 只能是 DRAFT 或 ACTIVE');
    }

    if (normalized.promotionTagCodes.length) {
      const allowedCodes = new Set(['HOT_FOOD']);
      const invalidCode = normalized.promotionTagCodes.find((code) => !allowedCodes.has(code));
      if (invalidCode) {
        errors.push('当前阶段仅支持 HOT_FOOD 热门推荐');
      } else {
        for (const code of normalized.promotionTagCodes) {
          if (!promotionTagByCode.has(code)) {
            errors.push(`promotionTagCode ${code} 不存在或不可导入`);
          }
        }
      }
    }

    const isPublicVisible = normalized.status === 'ACTIVE' && normalized.isVisibleOnClient;
    const hasLatitude = normalized.latitude !== null && Number.isFinite(normalized.latitude);
    const hasLongitude = normalized.longitude !== null && Number.isFinite(normalized.longitude);
    if (isPublicVisible && (!hasLatitude || !hasLongitude)) {
      warnings.push(
        '该商家将前台展示但缺少准确经纬度，可能影响导航，建议补充经纬度或先设为草稿/隐藏。',
      );
    }

    return {
      rowNumber,
      rawData,
      normalizedData: normalized,
      errors,
      warnings,
      status: errors.length ? 'ERROR' : 'VALID',
    };
  }

  private async resolveSelectableBusinessTypeByCode(code: string) {
    const businessType = await this.prisma.merchantBusinessType.findFirst({
      where: {
        code,
        enabled: true,
      },
      select: {
        id: true,
        code: true,
        parentId: true,
      },
    });
    if (!businessType) {
      throw new BadRequestException(`businessTypeCode ${code} 不存在或不可导入`);
    }
    if (businessType.code === 'FOOD_SERVICE' || businessType.parentId === null) {
      const hasChildren = await this.prisma.merchantBusinessType.count({
        where: { parentId: businessType.id },
      });
      if (businessType.code === 'FOOD_SERVICE' || hasChildren > 0) {
        throw new BadRequestException('FOOD_SERVICE 是父级分组，不能作为导入类型');
      }
    }
    return businessType;
  }

  private async resolveEnabledPromotionTagsByCodes(codes: string[]) {
    if (!codes.length) return [];
    const allowedCodes = new Set(['HOT_FOOD']);
    const invalidCode = codes.find((code) => !allowedCodes.has(code));
    if (invalidCode) {
      throw new BadRequestException('当前阶段仅支持 HOT_FOOD 热门推荐');
    }
    const items = await this.prisma.promotionTag.findMany({
      where: {
        code: { in: codes },
        enabled: true,
      },
      select: {
        id: true,
        code: true,
      },
    });
    if (items.length !== new Set(codes).size) {
      const found = new Set(items.map((item) => item.code));
      const missing = codes.find((code) => !found.has(code));
      throw new BadRequestException(`promotionTagCode ${missing ?? ''} 不存在或不可导入`);
    }
    return items;
  }

  private async syncLegacyImageUrl(id: bigint, imageType: string, imageUrl: string, isVisible: boolean) {
    if (!isLegacyImageType(imageType)) return;
    if (!isVisible) {
      await this.refreshLegacyImageUrl(id, imageType);
      return;
    }
    if (imageType === 'LOGO') {
      await this.prisma.merchant.update({ where: { id }, data: { logoUrl: imageUrl } });
    }
    if (imageType === 'COVER') {
      await this.prisma.merchant.update({ where: { id }, data: { coverUrl: imageUrl } });
    }
  }

  private async refreshLegacyImageUrl(id: bigint, imageType: string) {
    if (!isLegacyImageType(imageType)) return;
    const item = await this.prisma.merchantImage.findFirst({
      where: {
        merchantId: id,
        imageType,
        isVisible: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }, { id: 'desc' }],
      select: { imageUrl: true },
    });
    if (!item) return;
    if (imageType === 'LOGO') {
      await this.prisma.merchant.update({ where: { id }, data: { logoUrl: item.imageUrl } });
    }
    if (imageType === 'COVER') {
      await this.prisma.merchant.update({ where: { id }, data: { coverUrl: item.imageUrl } });
    }
  }

  private applyLegacyCapabilityBooleans(data: Record<string, unknown>) {
    if (isDisplayMode(data.merchantMode)) {
      data.dineInEnabled = false;
      data.pickupEnabled = false;
      data.deliveryEnabled = false;
      data.reportFeatureEnabled = false;
    }
    return data;
  }

  private computeProfileCompletion(merchant: Merchant) {
    const total = 11;
    const missingFields: string[] = [];

    if (!merchant.nameZh?.trim() || merchant.nameZh.startsWith('新商户-')) {
      missingFields.push('chineseName');
    }
    if (!merchant.nameVi?.trim()) missingFields.push('vietnameseName');
    if (!merchant.nameEn?.trim()) missingFields.push('englishName');
    if (!merchant.businessTypeId) missingFields.push('businessType');
    if (!merchant.coverUrl?.trim()) {
      missingFields.push('coverUrl');
    }
    if (!merchant.contactPhone?.trim()) {
      missingFields.push('contactPhone');
    }
    if (!merchant.contactName?.trim()) {
      missingFields.push('contactName');
    }
    if (!merchant.province?.trim() || merchant.province === '待完善') {
      missingFields.push('province');
    }
    if (
      (!(merchant.addressZh?.trim()) && !(merchant.addressDetail?.trim()))
      || merchant.addressDetail === '待完善'
    ) {
      missingFields.push('addressDetail');
    }
    if (!hasStoredCoordinate(merchant.latitude)) missingFields.push('latitude');
    if (!hasStoredCoordinate(merchant.longitude)) missingFields.push('longitude');

    const completion = Math.max(0, Math.min(100, Math.round(((total - missingFields.length) / total) * 100)));
    return { completion, missingFields };
  }
}

function normalizeMerchantMode(value: string | undefined) {
  if (!value) return undefined;
  if (value === 'DISPLAY_ONLY') return MerchantMode.DISPLAY;
  if (['PRODUCT_DISPLAY', 'ONLINE_ORDER', 'QR_ORDER'].includes(value)) {
    return MerchantMode.MANAGED;
  }
  return value as MerchantMode;
}

function isDisplayMode(value: unknown) {
  return value === MerchantMode.DISPLAY || value === 'DISPLAY_ONLY';
}

function isLegacyImageType(value: string) {
  return value === 'LOGO' || value === 'COVER';
}

function serializeDictionaryRef(
  item:
    | {
        id: bigint;
        code: string;
        nameZh: string;
        nameVi?: string | null;
        nameEn?: string | null;
      }
    | null
    | undefined,
): DictionaryRef | null {
  if (!item) return null;
  return {
    id: item.id.toString(),
    code: item.code,
    nameZh: item.nameZh,
    nameVi: item.nameVi,
    nameEn: item.nameEn,
  };
}

function serializePromotionRefs(merchant: MerchantWithOwner) {
  return (merchant.promotionTags ?? [])
    .map((item) => serializeDictionaryRef(item.promotionTag))
    .filter((item): item is DictionaryRef => Boolean(item));
}

function serializeCapabilityRefs(merchant: MerchantWithOwner) {
  return (merchant.capabilities ?? [])
    .map((item) => {
      const ref = serializeCapabilityDictionaryRef(item.capability);
      return ref ? { ...ref, isEnabled: item.isEnabled } : null;
    })
    .filter((item): item is DictionaryRef & { isEnabled: boolean } => Boolean(item));
}

function serializeCapabilityDictionaryRef(
  item:
    | {
        id: bigint;
        code: string;
        nameZh: string;
        nameVi: string | null;
        nameEn: string | null;
      }
    | null
    | undefined,
): DictionaryRef | null {
  if (!item) return null;
  return {
    id: item.id.toString(),
    code: item.code,
    nameZh: displayCapabilityNameZh(item.code, item.nameZh),
    nameVi: displayCapabilityNameVi(item.code, item.nameVi),
    nameEn: displayCapabilityNameEn(item.code, item.nameEn),
  };
}

function displayCapabilityNameZh(code: string, nameZh: string) {
  if (code === 'qrOrderEnabled') return '到店扫码点餐';
  if (code === 'onlineOrderEnabled') return '在线下单（兼容）';
  return nameZh;
}

function displayCapabilityNameVi(code: string, nameVi: string | null) {
  if (code === 'qrOrderEnabled') return 'Quet ma goi mon tai quan';
  if (code === 'onlineOrderEnabled') return 'Dat hang online (tuong thich)';
  return nameVi;
}

function displayCapabilityNameEn(code: string, nameEn: string | null) {
  if (code === 'qrOrderEnabled') return 'Scan to Order In-store';
  if (code === 'onlineOrderEnabled') return 'Online Order (Legacy)';
  return nameEn;
}

function serializeImages(merchant: MerchantWithOwner) {
  return (merchant.images ?? []).map(serializeImage);
}

function serializeImage(item: {
  id: bigint;
  imageType: string;
  imageUrl: string;
  titleZh: string | null;
  titleVi: string | null;
  titleEn: string | null;
  sortOrder: number;
  isVisible: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: item.id.toString(),
    imageType: item.imageType,
    imageUrl: item.imageUrl,
    titleZh: item.titleZh,
    titleVi: item.titleVi,
    titleEn: item.titleEn,
    sortOrder: item.sortOrder,
    isVisible: item.isVisible,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function parseIdList(values: string[] | undefined) {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
        .map((value) => BigInt(value)),
    ),
  );
}

function legacyBooleansFromCapabilities(values: Map<string, boolean>) {
  const data: Record<string, boolean> = {};
  if (values.has('dineInEnabled')) data.dineInEnabled = Boolean(values.get('dineInEnabled'));
  if (values.has('pickupEnabled')) data.pickupEnabled = Boolean(values.get('pickupEnabled'));
  if (values.has('deliveryEnabled')) data.deliveryEnabled = Boolean(values.get('deliveryEnabled'));
  if (values.has('zaloReportEnabled')) {
    data.reportFeatureEnabled = Boolean(values.get('zaloReportEnabled'));
  }
  return data;
}

function trimOrNull(value: string | null | undefined) {
  const next = value?.trim();
  return next ? next : null;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}


function buildTrendRows(
  start: Date,
  orders: Array<{ totalAmountVnd: bigint; createdAt: Date }>,
) {
  const rows = new Map<string, { date: string; orderCount: number; orderAmount: bigint }>();
  for (let index = 0; index < 7; index += 1) {
    const date = formatVietnamDate(addDays(start, index));
    rows.set(date, { date, orderCount: 0, orderAmount: 0n });
  }

  for (const order of orders) {
    const date = formatVietnamDate(order.createdAt);
    const row = rows.get(date);
    if (!row) continue;
    row.orderCount += 1;
    row.orderAmount += order.totalAmountVnd;
  }

  return Array.from(rows.values()).map((row) => ({
    date: row.date,
    orderCount: row.orderCount,
    orderAmount: row.orderAmount.toString(),
  }));
}

function formatVietnamDate(date: Date) {
  const vietnamTime = new Date(date.getTime() + VIETNAM_OFFSET_MS);
  const year = vietnamTime.getUTCFullYear();
  const month = String(vietnamTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(vietnamTime.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyOperationStats(): MerchantOperationStats {
  return {
    todayOrderCount: 0,
    todayOrderAmount: '0',
    pendingAcceptanceOrderCount: 0,
    preparingOrderCount: 0,
    last7DaysOrderCount: 0,
    lastOrderAt: null,
  };
}

function startOfVietnamDay(date: Date) {
  const vietnamTime = new Date(date.getTime() + VIETNAM_OFFSET_MS);
  return new Date(
    Date.UTC(
      vietnamTime.getUTCFullYear(),
      vietnamTime.getUTCMonth(),
      vietnamTime.getUTCDate(),
    ) - VIETNAM_OFFSET_MS,
  );
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

const MERCHANT_IMPORT_HEADERS = [
  'nameZh',
  'nameVi',
  'nameEn',
  'businessTypeCode',
  'contactPhone',
  'contactName',
  'province',
  'addressZh',
  'latitude',
  'longitude',
  'coverUrl',
] as const;

function getSelectableBusinessTypes(
  businessTypes: Array<{
    id: bigint;
    parentId: bigint | null;
    code: string;
    nameZh: string;
    enabled: boolean;
  }>,
) {
  const parentIds = new Set(
    businessTypes
      .map((item) => item.parentId)
      .filter((value): value is bigint => value !== null),
  );
  return businessTypes.filter(
    (item) => item.enabled && item.code !== 'FOOD_SERVICE' && !parentIds.has(item.id),
  );
}

function normalizeMerchantImportRow(rawData: Record<string, string>): MerchantImportNormalizedRow {
  const nameZh = normalizeImportText(rawData.nameZh);
  const nameVi = normalizeImportText(rawData.nameVi);
  const nameEn = normalizeImportText(rawData.nameEn);
  const businessTypeCode = normalizeImportText(rawData.businessTypeCode).toUpperCase();
  const contactPhone = normalizeImportText(rawData.contactPhone);
  const contactName = normalizeImportText(rawData.contactName) || nameZh;
  const province = normalizeImportText(rawData.province) || normalizeImportText(rawData.city);
  const city = normalizeImportText(rawData.city) || province;
  const district = normalizeImportText(rawData.district);
  const addressZh = normalizeImportText(rawData.addressZh);
  const addressVi = normalizeImportText(rawData.addressVi);
  const addressEn = normalizeImportText(rawData.addressEn);
  const latitude = parseImportNumber(rawData.latitude);
  const longitude = parseImportNumber(rawData.longitude);
  const openingHoursText = normalizeImportText(rawData.openingHoursText);
  const descriptionZh = normalizeImportText(rawData.descriptionZh);
  const descriptionVi = normalizeImportText(rawData.descriptionVi);
  const descriptionEn = normalizeImportText(rawData.descriptionEn);
  const logoUrl = normalizeImportText(rawData.logoUrl);
  const coverUrl = normalizeImportText(rawData.coverUrl);
  const promotionTagCodes = normalizeImportList(rawData.promotionTagCodes).map((item) =>
    item.toUpperCase(),
  );

  return {
    nameZh,
    nameVi,
    nameEn,
    businessTypeCode,
    contactPhone,
    contactName,
    province,
    city,
    district,
    addressZh,
    addressVi,
    addressEn,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    openingHoursText,
    descriptionZh,
    descriptionVi,
    descriptionEn,
    logoUrl,
    coverUrl: coverUrl || '',
    promotionTagCodes: Array.from(new Set(promotionTagCodes)),
    isNew: parseImportBoolean(rawData.isNew, false),
    sortOrder: parseImportInteger(rawData.sortOrder, 0),
    isVisibleOnClient: parseImportBoolean(rawData.isVisibleOnClient, true),
    status: parseImportStatus(rawData.status),
  };
}

function decodeCsvBuffer(buffer: Buffer) {
  return buffer.toString('utf8').replace(/^\ufeff/, '');
}

function parseCsv(content: string) {
  const rows: string[][] = [];
  let currentCell = '';
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      continue;
    }

    currentCell += char;
  }

  currentRow.push(currentCell);
  rows.push(currentRow);

  const [headerRow = [], ...bodyRows] = rows;
  const headers = headerRow.map((header) => header.trim().replace(/^\ufeff/, ''));
  const records = bodyRows
    .map((cells) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = (cells[index] ?? '').trim();
      });
      return record;
    })
    .filter((record) => Object.values(record).some((value) => value.trim().length > 0));

  return { headers, records };
}

function serializeCsvRow(values: Array<string | number | boolean | null | undefined>) {
  return values
    .map((value) => {
      const text = value === null || value === undefined ? '' : String(value);
      if (!/[",\r\n]/.test(text)) {
        return text;
      }
      return `"${text.replace(/"/g, '""')}"`;
    })
    .join(',');
}

function hasAnyCsvValue(record: Record<string, string>) {
  return Object.values(record).some((value) => value.trim().length > 0);
}

function pairKey(nameZh: string, contactPhone: string) {
  return `${nameZh.trim()}::${contactPhone.trim()}`;
}

function normalizeImportText(value?: string) {
  const next = value?.trim();
  return next ? next : '';
}

function normalizeImportList(value?: string) {
  if (!value?.trim()) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseImportBoolean(value?: string, defaultValue = false) {
  const next = value?.trim();
  if (!next) return defaultValue;
  const normalized = next.toLowerCase();
  if (['true', '1', 'yes', 'y', '是'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', '否'].includes(normalized)) return false;
  return defaultValue;
}

function parseImportInteger(value?: string, defaultValue = 0) {
  const next = value?.trim();
  if (!next) return defaultValue;
  const parsed = Number(next);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : defaultValue;
}

function parseImportNumber(value?: string) {
  const next = value?.trim();
  if (!next) return undefined;
  const parsed = Number(next);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseImportStatus(value?: string): 'DRAFT' | 'ACTIVE' {
  const next = value?.trim().toUpperCase();
  if (!next) return 'ACTIVE';
  return next === 'DRAFT' ? 'DRAFT' : 'ACTIVE';
}

function hasStoredCoordinate(value: Merchant['latitude'] | Merchant['longitude']) {
  if (value === null || value === undefined) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed);
}
