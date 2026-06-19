import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { UpdateMerchantProfileDto } from './dto/update-merchant-profile.dto';

@Injectable()
export class MerchantProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(merchantId: bigint) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }
    return this.serializeMerchantProfile(merchant);
  }

  async updateProfile(merchantId: bigint, dto: UpdateMerchantProfileDto) {
    await this.getProfile(merchantId);
    validateRequiredUpdateValues(dto);

    const { homepageCategoryKeys, ...profileDto } = dto;
    const data = stripUndefined({
      ...profileDto,
      homepageCategoryKeys:
        homepageCategoryKeys === undefined
          ? undefined
          : stringifyHomepageCategoryKeys(homepageCategoryKeys),
      minimumDeliveryAmountVnd:
        dto.minimumDeliveryAmountVnd === undefined
          ? undefined
          : BigInt(dto.minimumDeliveryAmountVnd),
      deliveryFeeVnd:
        dto.deliveryFeeVnd === undefined ? undefined : BigInt(dto.deliveryFeeVnd),
      businessHours:
        dto.businessHours === undefined
          ? undefined
          : (dto.businessHours as Prisma.InputJsonValue),
    }) as Prisma.MerchantUpdateInput;

    return this.prisma.merchant.update({
      where: { id: merchantId },
      data,
    }).then((merchant) => this.serializeMerchantProfile(merchant));
  }

  private serializeMerchantProfile(merchant: any) {
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }

    return {
      ...merchant,
      latitude: merchant.latitude.toString(),
      longitude: merchant.longitude.toString(),
      minimumDeliveryAmountVnd: merchant.minimumDeliveryAmountVnd.toString(),
      deliveryFeeVnd: merchant.deliveryFeeVnd.toString(),
      deliveryRadiusKm: merchant.deliveryRadiusKm.toString(),
      homepageCategoryKeys: parseHomepageCategoryKeys(
        merchant.homepageCategoryKeys,
      ),
      manualPopular: Boolean(merchant.manualPopular),
    };
  }
}

function validateRequiredUpdateValues(dto: UpdateMerchantProfileDto) {
  if (
    dto.businessHours !== undefined &&
    (dto.businessHours === null ||
      typeof dto.businessHours !== 'object' ||
      Array.isArray(dto.businessHours))
  ) {
    throw new BadRequestException(
      'businessHours must be an object and cannot be null or an array',
    );
  }

  assertNumber(dto.minimumDeliveryAmountVnd, 'minimumDeliveryAmountVnd');
  assertNumber(dto.deliveryFeeVnd, 'deliveryFeeVnd');
  assertNumber(dto.deliveryRadiusKm, 'deliveryRadiusKm');
}

function assertNumber(value: number | undefined, field: string) {
  if (
    value !== undefined &&
    (value === null || typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new BadRequestException(
      `${field} must be a number and cannot be null or empty`,
    );
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

const HOMEPAGE_CATEGORY_KEYS = new Set(['chinese', 'noodles', 'drinks']);

function stringifyHomepageCategoryKeys(value: string[] | undefined) {
  if (!value) return '[]';
  return JSON.stringify(
    Array.from(new Set(value.filter((item) => HOMEPAGE_CATEGORY_KEYS.has(item)))),
  );
}

function parseHomepageCategoryKeys(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => HOMEPAGE_CATEGORY_KEYS.has(item));
  }
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => HOMEPAGE_CATEGORY_KEYS.has(item))
      : [];
  } catch {
    return [];
  }
}
