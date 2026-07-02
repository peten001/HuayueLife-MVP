import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import AdmZip = require('adm-zip');
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
import ExcelJS = require('exceljs');
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
  sep,
} from 'node:path';
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
  MerchantImportSourceType,
} from './dto/merchant-import.dto';
import { DEFAULT_DISPLAY_CAPABILITIES } from './platform-dictionary-seed';
import { PlatformDictionariesService } from './platform-dictionaries.service';
import { PlatformUploadsService, type UploadedImage } from './platform-uploads.service';
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
  province: string | null;
  city: string;
  district?: string | null;
  contactPhone: string;
  address: string | null;
  addressZh: string | null;
  latitude: string | null;
  longitude: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
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

type MerchantImportSession = {
  id: string;
  sourceType: MerchantImportSourceType;
  createdAt: number;
  tempDir: string | null;
  rows: MerchantImportPreviewRow[];
};

type PreparedMerchantImportSource = {
  sourceType: MerchantImportSourceType;
  tempDir: string | null;
  records: Array<Record<string, string>>;
};

type MerchantImportFieldKey =
  | 'nameZh'
  | 'nameVi'
  | 'nameEn'
  | 'businessType'
  | 'contactPhone'
  | 'contactName'
  | 'province'
  | 'city'
  | 'district'
  | 'addressZh'
  | 'addressVi'
  | 'addressEn'
  | 'latitude'
  | 'longitude'
  | 'openingHoursText'
  | 'descriptionZh'
  | 'descriptionVi'
  | 'descriptionEn'
  | 'logoUrl'
  | 'coverPath'
  | 'promotionTagCodes'
  | 'isNew'
  | 'sortOrder'
  | 'isVisibleOnClient'
  | 'status';

type MerchantImportFieldDefinition = {
  key: MerchantImportFieldKey;
  label: string;
  required: boolean;
  description: string;
  format: string;
  options?: string[];
  correctExample: string;
  wrongExample: string;
  textFormat?: boolean;
  decimalFormat?: string;
};

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const IMPORT_SESSION_TTL_MS = 30 * 60 * 1000;
const PREPARING_STATUSES: OrderStatus[] = [
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.DELIVERING,
];
const IMPORT_TEMPLATE_SHEET_NAME = '商家导入模板';
const IMPORT_INSTRUCTIONS_SHEET_NAME = '填写说明';
const IMPORT_OPTIONS_SHEET_NAME = 'Options';
const IMPORT_BOOLEAN_OPTIONS = ['TRUE', 'FALSE'] as const;
const IMPORT_STATUS_OPTIONS = ['DRAFT', 'ACTIVE'] as const;
const IMPORT_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const;

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
  private readonly importSessions = new Map<string, MerchantImportSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly dictionaries: PlatformDictionariesService,
    private readonly uploads: PlatformUploadsService,
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
          coverUrl: trimOrNull(dto.coverUrl),
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

  async getMerchantImportTemplate() {
    await this.dictionaries.ensureDefaults();
    const [businessTypes, promotionTags] = await Promise.all([
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
        where: { enabled: true, code: 'HOT_FOOD' },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { code: true, nameZh: true },
      }),
    ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Huayue Life Platform';
    workbook.created = new Date();
    const selectableBusinessTypes = getSelectableBusinessTypes(businessTypes);
    const fieldDefinitions = buildMerchantImportFieldDefinitions({
      businessTypeCodes: selectableBusinessTypes.map((item) => item.code),
      promotionTagCodes: promotionTags.map((item) => item.code),
    });
    const optionSheet = workbook.addWorksheet(IMPORT_OPTIONS_SHEET_NAME);
    optionSheet.state = 'veryHidden';
    fillImportOptionSheet(optionSheet, selectableBusinessTypes.map((item) => item.code), promotionTags.map((item) => item.code));

    const templateSheet = workbook.addWorksheet(IMPORT_TEMPLATE_SHEET_NAME, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    fillMerchantImportTemplateSheet(templateSheet, fieldDefinitions, optionSheet.name);

    const instructionSheet = workbook.addWorksheet(IMPORT_INSTRUCTIONS_SHEET_NAME, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    fillMerchantImportInstructionSheet(instructionSheet, fieldDefinitions, selectableBusinessTypes, promotionTags.map((item) => item.code));

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  }

  async previewMerchantImport(file?: UploadedFileLike): Promise<MerchantImportPreviewResponse> {
    await this.cleanupExpiredImportSessions();
    const upload = this.ensureImportUpload(file);
    let prepared: PreparedMerchantImportSource | null = null;
    try {
      prepared = await this.prepareMerchantImportSource(upload);
      const rows = await this.buildMerchantImportPreview(
        prepared.records,
        prepared.sourceType,
        prepared.tempDir,
      );
      const sessionId = randomUUID();
      this.importSessions.set(sessionId, {
        id: sessionId,
        sourceType: prepared.sourceType,
        createdAt: Date.now(),
        tempDir: prepared.tempDir,
        rows,
      });
      prepared.tempDir = null;
      return {
        sessionId,
        sourceType: prepared.sourceType,
        totalRows: rows.length,
        validRows: rows.filter((item) => item.status !== 'ERROR').length,
        invalidRows: rows.filter((item) => item.status === 'ERROR').length,
        rows,
      };
    } catch (error) {
      if (prepared?.tempDir) {
        await this.removeDirectory(prepared.tempDir);
      }
      throw error;
    }
  }

  async confirmMerchantImport(body: MerchantImportConfirmRequest): Promise<MerchantImportConfirmResult> {
    await this.cleanupExpiredImportSessions();
    const sessionId = body.sessionId?.trim();
    if (!sessionId) {
      throw new BadRequestException('缺少导入会话，请重新上传文件');
    }

    const session = this.importSessions.get(sessionId);
    if (!session) {
      throw new BadRequestException('导入会话已失效，请重新上传文件');
    }

    const requestedRowNumbers = Array.isArray(body.rowNumbers) && body.rowNumbers.length
      ? new Set(body.rowNumbers)
      : null;
    const rows = session.rows.filter((row) =>
      requestedRowNumbers ? requestedRowNumbers.has(row.rowNumber) : row.status !== 'ERROR',
    );
    if (!rows.length) {
      throw new BadRequestException('没有可导入的有效数据');
    }

    const createdMerchantIds: string[] = [];
    const failedRows: MerchantImportConfirmResult['failedRows'] = [];
    let importedCount = 0;
    let imageUploadSuccessCount = 0;
    let imageUploadFailureCount = 0;

    try {
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

        let coverUrl: string | undefined;
        let attemptedImageUpload = false;
        try {
          const businessType = await this.resolveSelectableBusinessTypeByCode(normalized.businessTypeCode);
          const promotionTags = await this.resolveEnabledPromotionTagsByCodes(normalized.promotionTagCodes);
          if (normalized.coverPath) {
            attemptedImageUpload = true;
            const uploadedCover = await this.uploadImportCoverImage(normalized.coverPath, session);
            coverUrl = uploadedCover.imageUrl;
          }

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
            coverUrl,
            promotionTagIds: promotionTags.map((item) => item.id.toString()),
            isNew: normalized.isNew,
            isVisibleOnClient: normalized.isVisibleOnClient,
            sortOrder: normalized.sortOrder,
            status:
              normalized.status === 'DRAFT' ? MerchantStatus.PENDING : MerchantStatus.ACTIVE,
          });
          if (coverUrl) {
            imageUploadSuccessCount += 1;
          }
          createdMerchantIds.push(created.id);
          importedCount += 1;
        } catch (error) {
          if (coverUrl) {
            await this.uploads.removeMerchantImage(coverUrl);
          }
          if (attemptedImageUpload) {
            imageUploadFailureCount += 1;
          }
          failedRows.push({
            rowNumber: row.rowNumber,
            errors: [error instanceof Error ? error.message : '导入失败'],
          });
        }
      }

      return {
        totalRows: session.rows.length,
        importedCount,
        failedCount: failedRows.length,
        imageUploadSuccessCount,
        imageUploadFailureCount,
        failedRows,
        createdMerchantIds,
      };
    } finally {
      await this.destroyImportSession(sessionId);
    }
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
      province: merchant.province ?? null,
      city: merchant.city,
      district: merchant.district,
      contactPhone: merchant.contactPhone,
      address: merchant.addressDetail ?? merchant.addressZh ?? null,
      addressZh: merchant.addressZh ?? null,
      latitude: merchant.latitude?.toString() ?? null,
      longitude: merchant.longitude?.toString() ?? null,
      logoUrl: merchant.logoUrl ?? null,
      coverUrl: merchant.coverUrl ?? null,
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

  private ensureImportUpload(file?: UploadedFileLike) {
    if (!file) {
      throw new BadRequestException('请上传 XLSX 或 ZIP 导入文件');
    }
    const name = file.originalname?.toLowerCase() ?? '';
    if (name.endsWith('.xlsx') || name.endsWith('.zip')) {
      return file;
    }
    throw new BadRequestException('仅支持上传 XLSX 或 ZIP 文件');
  }

  private async prepareMerchantImportSource(
    file: UploadedFileLike,
  ): Promise<PreparedMerchantImportSource> {
    const name = file.originalname?.toLowerCase() ?? '';
    if (name.endsWith('.xlsx')) {
      return {
        sourceType: 'XLSX',
        tempDir: null,
        records: await this.readMerchantImportWorkbook(file.buffer),
      };
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'huayue-merchant-import-'));
    try {
      const workbookBuffer = await this.extractMerchantImportZip(file.buffer, tempDir);
      return {
        sourceType: 'ZIP',
        tempDir,
        records: await this.readMerchantImportWorkbook(workbookBuffer),
      };
    } catch (error) {
      await this.removeDirectory(tempDir);
      throw error;
    }
  }

  private async extractMerchantImportZip(buffer: Buffer, tempDir: string) {
    let archive: AdmZip;
    try {
      archive = new AdmZip(buffer);
    } catch {
      throw new BadRequestException('ZIP 文件损坏或无法解析');
    }

    const xlsxEntries = archive
      .getEntries()
      .filter((entry) => !entry.isDirectory && isRealZipEntry(entry.entryName))
      .filter((entry) => extname(entry.entryName).toLowerCase() === '.xlsx');

    if (xlsxEntries.length !== 1) {
      throw new BadRequestException('ZIP 中必须且只能包含一个 XLSX 文件');
    }

    for (const entry of archive.getEntries()) {
      if (entry.isDirectory || !isRealZipEntry(entry.entryName)) {
        continue;
      }
      const targetPath = resolveZipEntryPath(tempDir, entry.entryName);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, entry.getData());
    }

    return readFile(resolveZipEntryPath(tempDir, xlsxEntries[0].entryName));
  }

  private async readMerchantImportWorkbook(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer);
    } catch {
      throw new BadRequestException('XLSX 文件无法解析，请检查模板和文件内容');
    }

    const worksheet =
      workbook.getWorksheet(IMPORT_TEMPLATE_SHEET_NAME)
      ?? workbook.worksheets.find((item) => item.state !== 'hidden');
    if (!worksheet) {
      throw new BadRequestException('XLSX 中未找到可导入的工作表');
    }

    const headerRow = worksheet.getRow(1);
    const headers = Array.from({ length: worksheet.columnCount }, (_, index) =>
      normalizeImportText(headerRow.getCell(index + 1).text),
    ).filter((item) => item.length > 0);
    if (!headers.length) {
      throw new BadRequestException('XLSX 第一行缺少表头');
    }

    const records: Array<Record<string, string>> = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = normalizeImportText(row.getCell(index + 1).text);
      });
      if (hasAnyCsvValue(record)) {
        records.push(record);
      }
    }
    return records;
  }

  private async buildMerchantImportPreview(
    records: Array<Record<string, string>>,
    sourceType: MerchantImportSourceType,
    tempDir: string | null,
  ) {
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
    const rows = await Promise.all(records.map((rawData, index) =>
      this.normalizeImportRecord({
        rowNumber: index + 2,
        rawData,
        businessTypeByCode,
        promotionTagByCode,
        sourceType,
        tempDir,
      }),
    ));

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

    return rows;
  }

  private async normalizeImportRecord({
    rowNumber,
    rawData,
    businessTypeByCode,
    promotionTagByCode,
    sourceType,
    tempDir,
  }: {
    rowNumber: number;
    rawData: Record<string, string>;
    businessTypeByCode: Map<string, { id: bigint; code: string; nameZh: string; enabled: boolean; parentId: bigint | null }>;
    promotionTagByCode: Map<string, { id: bigint; code: string; nameZh: string; enabled: boolean }>;
    sourceType: MerchantImportSourceType;
    tempDir: string | null;
  }): Promise<MerchantImportPreviewRow> {
    const normalized = normalizeMerchantImportRow(rawData);
    const errors: string[] = [];
    const warnings: string[] = [];
    const rawBusinessType = normalizeImportText(rawData.businessType || rawData.businessTypeCode);
    const rawStatus = normalizeImportText(rawData.status).toUpperCase();
    const rawIsNew = normalizeImportText(rawData.isNew);
    const rawVisible = normalizeImportText(rawData.isVisibleOnClient);
    const rawSortOrder = normalizeImportText(rawData.sortOrder);
    const parsedIsNew = parseImportBoolean(rawData.isNew, false);
    const parsedVisible = parseImportBoolean(rawData.isVisibleOnClient, true);
    const parsedSortOrder = parseImportInteger(rawData.sortOrder, 0);

    validateImportStringField(errors, rowNumber, 'nameZh', rawData.nameZh, normalized.nameZh, {
      required: true,
      maxLength: 120,
      example: '688便利店',
    });
    validateImportStringField(errors, rowNumber, 'nameVi', rawData.nameVi, normalized.nameVi, {
      required: true,
      maxLength: 120,
      example: 'Cua hang tien loi 688',
    });
    validateImportStringField(errors, rowNumber, 'nameEn', rawData.nameEn, normalized.nameEn, {
      required: true,
      maxLength: 120,
      example: '688 Convenience Store',
    });

    if (!normalized.businessTypeCode) {
      errors.push(formatImportError(rowNumber, 'businessType', rawBusinessType, '不能为空', '请填写系统允许的业务类型编码'));
    } else {
      const businessType = businessTypeByCode.get(normalized.businessTypeCode);
      if (!businessType) {
        errors.push(
          formatImportError(
            rowNumber,
            'businessType',
            rawBusinessType || normalized.businessTypeCode,
            '无效',
            `允许值：${Array.from(businessTypeByCode.keys()).join('、')}`,
          ),
        );
      }
    }

    validateImportStringField(errors, rowNumber, 'contactPhone', rawData.contactPhone, normalized.contactPhone, {
      required: true,
      maxLength: 32,
      example: '0333520688',
    });
    validateImportStringField(errors, rowNumber, 'contactName', rawData.contactName, normalized.contactName, {
      required: true,
      maxLength: 64,
      example: 'Nguyen Van A',
    });
    validateImportStringField(errors, rowNumber, 'province', rawData.province, normalized.province, {
      required: true,
      maxLength: 80,
      example: 'Bac Giang',
    });
    validateImportStringField(errors, rowNumber, 'city', rawData.city, normalized.city ?? '', {
      required: false,
      maxLength: 80,
      example: 'Bac Giang',
    });
    validateImportStringField(errors, rowNumber, 'district', rawData.district, normalized.district ?? '', {
      required: false,
      maxLength: 80,
      example: 'Viet Yen',
    });
    validateImportStringField(errors, rowNumber, 'addressZh', rawData.addressZh, normalized.addressZh, {
      required: true,
      maxLength: 255,
      example: '北江省越安县云中工业区商业街18号',
    });
    validateImportStringField(errors, rowNumber, 'addressVi', rawData.addressVi, normalized.addressVi ?? '', {
      required: false,
      maxLength: 255,
      example: 'So 18 pho thuong mai khu cong nghiep Van Trung',
    });
    validateImportStringField(errors, rowNumber, 'addressEn', rawData.addressEn, normalized.addressEn ?? '', {
      required: false,
      maxLength: 255,
      example: 'No.18 Commercial Street, Van Trung Industrial Park',
    });
    validateImportStringField(errors, rowNumber, 'openingHoursText', rawData.openingHoursText, normalized.openingHoursText ?? '', {
      required: false,
      maxLength: 255,
      example: '10:00-22:00',
    });
    validateImportStringField(errors, rowNumber, 'descriptionZh', rawData.descriptionZh, normalized.descriptionZh ?? '', {
      required: false,
      maxLength: 2000,
      example: '主营日用百货与便民服务',
    });
    validateImportStringField(errors, rowNumber, 'descriptionVi', rawData.descriptionVi, normalized.descriptionVi ?? '', {
      required: false,
      maxLength: 2000,
      example: 'Chuyen do gia dung va dich vu tien ich',
    });
    validateImportStringField(errors, rowNumber, 'descriptionEn', rawData.descriptionEn, normalized.descriptionEn ?? '', {
      required: false,
      maxLength: 2000,
      example: 'Daily goods and convenience services',
    });
    validateImportStringField(errors, rowNumber, 'logoUrl', rawData.logoUrl, normalized.logoUrl ?? '', {
      required: false,
      maxLength: 500,
      example: 'https://cdn.example.com/logo.jpg',
    });

    if (normalized.latitude === null || !Number.isFinite(normalized.latitude)) {
      errors.push(formatImportError(rowNumber, 'latitude', rawData.latitude, '格式错误', '必须填写合法纬度，范围 -90 至 90'));
    } else if (normalized.latitude < -90 || normalized.latitude > 90) {
      errors.push(formatImportError(rowNumber, 'latitude', rawData.latitude, '超出范围', '必须填写合法纬度，范围 -90 至 90'));
    }
    if (normalized.longitude === null || !Number.isFinite(normalized.longitude)) {
      errors.push(formatImportError(rowNumber, 'longitude', rawData.longitude, '格式错误', '必须填写合法经度，范围 -180 至 180'));
    } else if (normalized.longitude < -180 || normalized.longitude > 180) {
      errors.push(formatImportError(rowNumber, 'longitude', rawData.longitude, '超出范围', '必须填写合法经度，范围 -180 至 180'));
    }

    if (rawStatus && !IMPORT_STATUS_OPTIONS.includes(rawStatus as (typeof IMPORT_STATUS_OPTIONS)[number])) {
      errors.push(
        formatImportError(
          rowNumber,
          'status',
          rawData.status,
          '无效',
          `允许值：${IMPORT_STATUS_OPTIONS.join('、')}`,
        ),
      );
    }
    if (rawIsNew && parsedIsNew.invalid) {
      errors.push(formatImportError(rowNumber, 'isNew', rawData.isNew, '无效', '只允许 TRUE 或 FALSE'));
    }
    if (rawVisible && parsedVisible.invalid) {
      errors.push(
        formatImportError(
          rowNumber,
          'isVisibleOnClient',
          rawData.isVisibleOnClient,
          '无效',
          '只允许 TRUE 或 FALSE',
        ),
      );
    }
    if (rawSortOrder && parsedSortOrder.invalid) {
      errors.push(formatImportError(rowNumber, 'sortOrder', rawData.sortOrder, '格式错误', '必须填写大于等于 0 的整数'));
    }

    if (normalized.promotionTagCodes.length) {
      const allowedCodes = new Set(['HOT_FOOD']);
      const invalidCode = normalized.promotionTagCodes.find((code) => !allowedCodes.has(code));
      if (invalidCode) {
        errors.push(
          formatImportError(
            rowNumber,
            'promotionTagCodes',
            rawData.promotionTagCodes,
            '无效',
            '当前仅允许 HOT_FOOD',
          ),
        );
      } else {
        for (const code of normalized.promotionTagCodes) {
          if (!promotionTagByCode.has(code)) {
            errors.push(
              formatImportError(
                rowNumber,
                'promotionTagCodes',
                rawData.promotionTagCodes,
                '无效',
                `允许值：${Array.from(promotionTagByCode.keys()).join('、')}`,
              ),
            );
          }
        }
      }
    }

    if (normalized.coverPath) {
      const coverPathValidation = await this.validateImportCoverPath(
        normalized.coverPath,
        sourceType,
        tempDir,
      );
      if (coverPathValidation) {
        errors.push(formatImportError(rowNumber, 'coverPath', rawData.coverPath || rawData.coverUrl, coverPathValidation, '请填写 ZIP 包内相对路径，例如 images/BG001_688便利店/cover.jpg'));
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

  private async validateImportCoverPath(
    coverPath: string,
    sourceType: MerchantImportSourceType,
    tempDir: string | null,
  ) {
    if (sourceType !== 'ZIP') {
      return '填写了 coverPath 时必须上传 ZIP，不能只上传 XLSX';
    }
    if (!tempDir) {
      return 'ZIP 导入临时目录不存在，请重新上传';
    }

    const normalizedPath = normalizeImportRelativePath(coverPath);
    if (!normalizedPath) {
      return '不能为空';
    }
    if (isAbsoluteImportPath(normalizedPath)) {
      return '不允许填写绝对路径';
    }
    if (hasPathTraversal(normalizedPath)) {
      return '不允许包含 ../ 路径穿越';
    }

    const extension = extname(normalizedPath).toLowerCase().replace('.', '');
    if (!IMPORT_IMAGE_EXTENSIONS.includes(extension as (typeof IMPORT_IMAGE_EXTENSIONS)[number])) {
      return `仅支持 ${IMPORT_IMAGE_EXTENSIONS.join(' / ')} 图片`;
    }

    let fileBuffer: Buffer;
    try {
      const resolvedPath = resolveImportAssetPath(tempDir, normalizedPath);
      fileBuffer = await readFile(resolvedPath);
      const mimeType = await this.uploads.detectMerchantImageMime(fileBuffer);
      this.uploads.validateMerchantImage({
        buffer: fileBuffer,
        mimetype: mimeType,
        originalname: basename(normalizedPath),
        size: fileBuffer.byteLength,
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        return localizeImportExceptionMessage(extractExceptionMessage(error));
      }
      return `找不到文件：${normalizedPath}`;
    }

    return '';
  }

  private async uploadImportCoverImage(coverPath: string, session: MerchantImportSession) {
    if (!session.tempDir) {
      throw new BadRequestException('当前导入包不包含图片目录，请改为上传 ZIP');
    }
    const normalizedPath = normalizeImportRelativePath(coverPath);
    const filePath = resolveImportAssetPath(session.tempDir, normalizedPath);
    const buffer = await readFile(filePath);
    const mimeType = await this.uploads.detectMerchantImageMime(buffer);
    const uploadFile: UploadedImage = {
      buffer,
      mimetype: mimeType,
      originalname: basename(normalizedPath),
      size: buffer.byteLength,
    };
    return this.uploads.saveMerchantImage(uploadFile);
  }

  private async destroyImportSession(sessionId: string) {
    const session = this.importSessions.get(sessionId);
    this.importSessions.delete(sessionId);
    if (session?.tempDir) {
      await this.removeDirectory(session.tempDir);
    }
  }

  private async cleanupExpiredImportSessions() {
    const now = Date.now();
    const expiredIds = Array.from(this.importSessions.values())
      .filter((session) => now - session.createdAt >= IMPORT_SESSION_TTL_MS)
      .map((session) => session.id);
    for (const sessionId of expiredIds) {
      await this.destroyImportSession(sessionId);
    }
  }

  private async removeDirectory(target: string) {
    await rm(target, { recursive: true, force: true });
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
      throw new BadRequestException(`businessType 值“${code}”无效。允许填写系统开放的业务类型编码`);
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
      throw new BadRequestException('promotionTagCodes 仅支持 HOT_FOOD');
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
      throw new BadRequestException(`promotionTagCodes 值“${missing ?? ''}”无效`);
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

function buildMerchantImportFieldDefinitions({
  businessTypeCodes,
  promotionTagCodes,
}: {
  businessTypeCodes: string[];
  promotionTagCodes: string[];
}): MerchantImportFieldDefinition[] {
  return [
    { key: 'nameZh', label: '中文店名', required: true, description: '商家的中文显示名称', format: '文本，2-120 字符', correctExample: '688便利店', wrongExample: '空白', textFormat: true },
    { key: 'nameVi', label: '越南语店名', required: true, description: '商家的越南语显示名称', format: '文本，2-120 字符', correctExample: 'Cua hang tien loi 688', wrongExample: '空白', textFormat: true },
    { key: 'nameEn', label: '英文店名', required: true, description: '商家的英文显示名称', format: '文本，2-120 字符', correctExample: '688 Convenience Store', wrongExample: '空白', textFormat: true },
    { key: 'businessType', label: '商家类型', required: true, description: '必须填写系统允许的业务类型编码', format: '固定枚举', options: businessTypeCodes, correctExample: businessTypeCodes[0] ?? 'CHINESE_RESTAURANT', wrongExample: '便利店', textFormat: true },
    { key: 'contactPhone', label: '联系电话', required: true, description: '商家联系电话，按文本填写，避免科学计数法', format: '文本，1-32 字符', correctExample: '0333520688', wrongExample: '3.33521E+9', textFormat: true },
    { key: 'contactName', label: '联系人', required: true, description: '联系人姓名；留空时会回退为 nameZh', format: '文本，1-64 字符', correctExample: 'Nguyen Van A', wrongExample: '*', textFormat: true },
    { key: 'province', label: '省/直辖市', required: true, description: '商家所在省/直辖市', format: '文本，1-80 字符', correctExample: 'Bac Giang', wrongExample: '空白', textFormat: true },
    { key: 'city', label: '城市', required: false, description: '可选；留空时默认使用 province', format: '文本，最多 80 字符', correctExample: 'Bac Giang', wrongExample: '超过 80 字符', textFormat: true },
    { key: 'district', label: '区/县', required: false, description: '可选区县信息', format: '文本，最多 80 字符', correctExample: 'Viet Yen', wrongExample: '超过 80 字符', textFormat: true },
    { key: 'addressZh', label: '中文详细地址', required: true, description: '商家的中文详细地址', format: '文本，1-255 字符', correctExample: '北江省越安县云中工业区商业街18号', wrongExample: '空白', textFormat: true },
    { key: 'addressVi', label: '越南语详细地址', required: false, description: '可选越南语地址', format: '文本，最多 255 字符', correctExample: 'So 18 pho thuong mai khu cong nghiep Van Trung', wrongExample: '超过 255 字符', textFormat: true },
    { key: 'addressEn', label: '英文详细地址', required: false, description: '可选英文地址', format: '文本，最多 255 字符', correctExample: 'No.18 Commercial Street, Van Trung Industrial Park', wrongExample: '超过 255 字符', textFormat: true },
    { key: 'latitude', label: '纬度', required: true, description: 'Google Maps 纬度，范围 -90 至 90', format: '小数，最多 7 位小数', correctExample: '21.2414881', wrongExample: '106.154411', decimalFormat: '0.0000000' },
    { key: 'longitude', label: '经度', required: true, description: 'Google Maps 经度，范围 -180 至 180', format: '小数，最多 7 位小数', correctExample: '106.154411', wrongExample: '21.2414881', decimalFormat: '0.0000000' },
    { key: 'openingHoursText', label: '营业时间文本', required: false, description: '可选营业时间说明', format: '文本，最多 255 字符', correctExample: '10:00-22:00', wrongExample: '超过 255 字符', textFormat: true },
    { key: 'descriptionZh', label: '中文描述', required: false, description: '可选中文简介', format: '文本，最多 2000 字符', correctExample: '主营日用百货与便民服务', wrongExample: '超过 2000 字符', textFormat: true },
    { key: 'descriptionVi', label: '越南语描述', required: false, description: '可选越南语简介', format: '文本，最多 2000 字符', correctExample: 'Chuyen do gia dung va dich vu tien ich', wrongExample: '超过 2000 字符', textFormat: true },
    { key: 'descriptionEn', label: '英文描述', required: false, description: '可选英文简介', format: '文本，最多 2000 字符', correctExample: 'Daily goods and convenience services', wrongExample: '超过 2000 字符', textFormat: true },
    { key: 'logoUrl', label: 'Logo URL', required: false, description: '可选商家 Logo 网络地址，保持现有兼容能力', format: '文本，最多 500 字符', correctExample: 'https://cdn.example.com/logo.jpg', wrongExample: '/Users/peter/logo.jpg', textFormat: true },
    { key: 'coverPath', label: '商家封面图路径', required: false, description: 'ZIP 压缩包内图片的相对路径；不填写则不导入封面图', format: '文本，相对路径', correctExample: 'images/BG001_688便利店/cover.jpg', wrongExample: '/Users/peter/Desktop/cover.jpg', textFormat: true },
    { key: 'promotionTagCodes', label: '推荐标签编码', required: false, description: '当前仅支持 HOT_FOOD，多个值用英文逗号分隔', format: '固定枚举', options: promotionTagCodes, correctExample: promotionTagCodes[0] ?? 'HOT_FOOD', wrongExample: 'FEATURED', textFormat: true },
    { key: 'isNew', label: '是否新店', required: false, description: '是否标记为新店', format: '布尔值', options: [...IMPORT_BOOLEAN_OPTIONS], correctExample: 'TRUE', wrongExample: '是', textFormat: true },
    { key: 'sortOrder', label: '排序值', required: false, description: '列表排序，默认 0', format: '整数，大于等于 0', correctExample: '10', wrongExample: '-1', textFormat: true },
    { key: 'isVisibleOnClient', label: '前台是否展示', required: false, description: '是否在小程序前台展示，默认 TRUE', format: '布尔值', options: [...IMPORT_BOOLEAN_OPTIONS], correctExample: 'TRUE', wrongExample: 'yes', textFormat: true },
    { key: 'status', label: '导入状态', required: false, description: 'ACTIVE 导入为启用，DRAFT 导入为待完善', format: '固定枚举', options: [...IMPORT_STATUS_OPTIONS], correctExample: 'ACTIVE', wrongExample: 'PENDING', textFormat: true },
  ];
}

function fillImportOptionSheet(
  sheet: ExcelJS.Worksheet,
  businessTypeCodes: string[],
  promotionTagCodes: string[],
) {
  sheet.getCell('A1').value = 'businessType';
  sheet.getCell('B1').value = 'promotionTagCodes';
  sheet.getCell('C1').value = 'boolean';
  sheet.getCell('D1').value = 'status';
  businessTypeCodes.forEach((value, index) => {
    sheet.getCell(index + 2, 1).value = value;
  });
  promotionTagCodes.forEach((value, index) => {
    sheet.getCell(index + 2, 2).value = value;
  });
  IMPORT_BOOLEAN_OPTIONS.forEach((value, index) => {
    sheet.getCell(index + 2, 3).value = value;
  });
  IMPORT_STATUS_OPTIONS.forEach((value, index) => {
    sheet.getCell(index + 2, 4).value = value;
  });
}

function fillMerchantImportTemplateSheet(
  sheet: ExcelJS.Worksheet,
  fieldDefinitions: MerchantImportFieldDefinition[],
  optionSheetName: string,
) {
  sheet.addRow(fieldDefinitions.map((field) => field.key));
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: fieldDefinitions.length },
  };

  fieldDefinitions.forEach((field, index) => {
    const columnIndex = index + 1;
    const column = sheet.getColumn(columnIndex);
    const headerCell = sheet.getRow(1).getCell(columnIndex);
    headerCell.font = {
      bold: true,
      color: { argb: field.required ? 'FFB42318' : 'FF0F172A' },
    };
    headerCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: field.required ? 'FFFDE2E2' : 'FFF8FAFC' },
    };
    headerCell.alignment = { vertical: 'middle', horizontal: 'center' };
    headerCell.border = {
      top: { style: 'thin', color: { argb: 'FFD0D7DE' } },
      left: { style: 'thin', color: { argb: 'FFD0D7DE' } },
      bottom: { style: 'thin', color: { argb: 'FFD0D7DE' } },
      right: { style: 'thin', color: { argb: 'FFD0D7DE' } },
    };
    headerCell.note = `${field.label}\n${field.description}\n格式：${field.format}`;
    column.width = Math.max(16, Math.min(40, Math.max(field.key.length + 4, field.label.length + 6)));
    if (field.textFormat) {
      column.numFmt = '@';
    }
    if (field.decimalFormat) {
      column.numFmt = field.decimalFormat;
    }
    applyTemplateValidation(sheet, columnIndex, field, optionSheetName);
  });
}

function fillMerchantImportInstructionSheet(
  sheet: ExcelJS.Worksheet,
  fieldDefinitions: MerchantImportFieldDefinition[],
  businessTypes: Array<{ code: string; nameZh: string }>,
  promotionTagCodes: string[],
) {
  const headers = ['字段名', '中文名称', '是否必填', '填写说明', '数据格式', '固定选项', '正确示例', '错误示例'];
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };
  sheet.columns = [
    { width: 18 },
    { width: 18 },
    { width: 10 },
    { width: 44 },
    { width: 24 },
    { width: 38 },
    { width: 30 },
    { width: 30 },
  ];

  const businessTypeText = businessTypes.map((item) => `${item.code}（${item.nameZh}）`).join('、');
  const promotionTagText = promotionTagCodes.length ? promotionTagCodes.join('、') : '无';
  for (const field of fieldDefinitions) {
    const optionsText =
      field.key === 'businessType'
        ? businessTypeText
        : field.key === 'promotionTagCodes'
          ? promotionTagText
          : field.options?.join('、') ?? '无';
    sheet.addRow([
      field.key,
      field.label,
      field.required ? '是' : '否',
      field.description,
      field.format,
      optionsText || '无',
      field.correctExample,
      field.wrongExample,
    ]);
  }
}

function applyTemplateValidation(
  sheet: ExcelJS.Worksheet,
  columnIndex: number,
  field: MerchantImportFieldDefinition,
  optionSheetName: string,
) {
  const endRow = 1000;
  let formula = '';
  if (field.key === 'businessType' && field.options?.length) {
    formula = `='${optionSheetName}'!$A$2:$A$${field.options.length + 1}`;
  } else if (field.key === 'promotionTagCodes' && field.options?.length) {
    formula = `='${optionSheetName}'!$B$2:$B$${field.options.length + 1}`;
  } else if ((field.key === 'isNew' || field.key === 'isVisibleOnClient') && field.options?.length) {
    formula = `='${optionSheetName}'!$C$2:$C$${field.options.length + 1}`;
  } else if (field.key === 'status' && field.options?.length) {
    formula = `='${optionSheetName}'!$D$2:$D$${field.options.length + 1}`;
  }
  if (!formula) return;
  for (let rowNumber = 2; rowNumber <= endRow; rowNumber += 1) {
    sheet.getCell(rowNumber, columnIndex).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [formula],
      showErrorMessage: true,
      errorStyle: 'error',
      errorTitle: '无效值',
      error: '请从下拉选项中选择系统允许的值',
    };
  }
}

function normalizeMerchantImportRow(rawData: Record<string, string>): MerchantImportNormalizedRow {
  const nameZh = normalizeImportText(rawData.nameZh);
  const nameVi = normalizeImportText(rawData.nameVi);
  const nameEn = normalizeImportText(rawData.nameEn);
  const businessTypeCode = normalizeImportText(rawData.businessType || rawData.businessTypeCode).toUpperCase();
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
  const coverPath = normalizeImportRelativePath(rawData.coverPath || rawData.coverUrl);
  const promotionTagCodes = normalizeImportList(rawData.promotionTagCodes).map((item) =>
    item.toUpperCase(),
  );
  const parsedIsNew = parseImportBoolean(rawData.isNew, false);
  const parsedSortOrder = parseImportInteger(rawData.sortOrder, 0);
  const parsedVisible = parseImportBoolean(rawData.isVisibleOnClient, true);

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
    coverPath,
    promotionTagCodes: Array.from(new Set(promotionTagCodes)),
    isNew: parsedIsNew.value,
    sortOrder: parsedSortOrder.value,
    isVisibleOnClient: parsedVisible.value,
    status: parseImportStatus(rawData.status),
  };
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
  if (!next) return { value: defaultValue, invalid: false };
  const normalized = next.toUpperCase();
  if (normalized === 'TRUE') return { value: true, invalid: false };
  if (normalized === 'FALSE') return { value: false, invalid: false };
  return { value: defaultValue, invalid: true };
}

function parseImportInteger(value?: string, defaultValue = 0) {
  const next = value?.trim();
  if (!next) return { value: defaultValue, invalid: false };
  const parsed = Number(next);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return { value: defaultValue, invalid: true };
  }
  return { value: parsed, invalid: false };
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

function normalizeImportRelativePath(value?: string) {
  const next = normalizeImportText(value).replace(/\\/g, '/');
  return next.replace(/^\.\//, '');
}

function isAbsoluteImportPath(value: string) {
  return isAbsolute(value) || /^[a-zA-Z]:\//.test(value) || value.startsWith('\\');
}

function hasPathTraversal(value: string) {
  const segments = value.split('/').filter(Boolean);
  return segments.includes('..');
}

function resolveImportAssetPath(baseDir: string, relativePath: string) {
  const normalized = normalizeImportRelativePath(relativePath);
  const resolvedPath = resolve(baseDir, normalized);
  const resolvedBase = `${resolve(baseDir)}${sep}`;
  if (!resolvedPath.startsWith(resolvedBase) && resolvedPath !== resolve(baseDir)) {
    throw new BadRequestException('图片路径越界');
  }
  return resolvedPath;
}

function resolveZipEntryPath(baseDir: string, entryName: string) {
  const normalizedEntry = normalizeImportRelativePath(entryName);
  if (!normalizedEntry || isAbsoluteImportPath(normalizedEntry) || hasPathTraversal(normalizedEntry)) {
    throw new BadRequestException(`ZIP 中存在非法路径：${entryName}`);
  }
  return resolveImportAssetPath(baseDir, normalizedEntry);
}

function isRealZipEntry(entryName: string) {
  const normalizedEntry = normalizeImportRelativePath(entryName);
  return Boolean(normalizedEntry) && !normalizedEntry.startsWith('__MACOSX/');
}

function validateImportStringField(
  errors: string[],
  rowNumber: number,
  field: string,
  rawValue: string | undefined,
  normalizedValue: string,
  options: { required: boolean; maxLength: number; example: string },
) {
  if (options.required && !normalizedValue) {
    errors.push(formatImportError(rowNumber, field, rawValue, '不能为空', `示例：${options.example}`));
    return;
  }
  if (normalizedValue && normalizedValue.length > options.maxLength) {
    errors.push(
      formatImportError(
        rowNumber,
        field,
        rawValue,
        `长度超限，最多 ${options.maxLength} 字符`,
        `示例：${options.example}`,
      ),
    );
  }
}

function formatImportError(
  rowNumber: number,
  field: string,
  rawValue: string | undefined,
  reason: string,
  hint: string,
) {
  const shownValue = normalizeImportText(rawValue) || '(空)';
  return `第 ${rowNumber} 行 ${field} 值“${shownValue}”${reason}。${hint}`;
}

function extractExceptionMessage(error: BadRequestException) {
  const response = error.getResponse();
  if (typeof response === 'string') {
    return response;
  }
  if (response && typeof response === 'object' && 'message' in response) {
    const { message } = response as { message?: string | string[] };
    if (Array.isArray(message)) {
      return message.join('；');
    }
    if (typeof message === 'string') {
      return message;
    }
  }
  return error.message;
}

function localizeImportExceptionMessage(message: string) {
  if (message === 'Image file exceeds 5MB') {
    return '图片文件不能超过 5MB';
  }
  if (message === 'Invalid image type' || message === 'Invalid image content') {
    return '图片格式无效，仅支持 jpg / jpeg / png / webp';
  }
  if (message === 'Image file is required') {
    return '缺少图片文件';
  }
  if (message === '图片路径越界') {
    return '图片路径越界';
  }
  return message;
}

function hasStoredCoordinate(value: Merchant['latitude'] | Merchant['longitude']) {
  if (value === null || value === undefined) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed);
}
