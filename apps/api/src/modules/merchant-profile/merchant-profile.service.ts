import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { UpdateMerchantProfileDto } from './dto/update-merchant-profile.dto';
import {
  parseHomepageCategoryKeys,
  stringifyHomepageCategoryKeys,
} from '../shared/homepage-category-keys';

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
    const currentProfile = await this.getProfile(merchantId);
    validateRequiredUpdateValues(dto);

    const { homepageCategoryKeys, ...profileDto } = dto;
    const nextHomepageCategoryKeys =
      homepageCategoryKeys === undefined
        ? undefined
        : mergeMerchantEditableHomepageCategoryKeys(
            currentProfile.homepageCategoryKeys,
            homepageCategoryKeys,
          );
    const data = stripUndefined({
      ...profileDto,
      homepageCategoryKeys:
        nextHomepageCategoryKeys === undefined
          ? undefined
          : stringifyHomepageCategoryKeys(nextHomepageCategoryKeys),
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
      isVisibleOnClient: merchant.isVisibleOnClient,
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

function mergeMerchantEditableHomepageCategoryKeys(
  existingKeys: string[],
  requestedKeys: string[],
) {
  const preservedPlatformKeys = parseHomepageCategoryKeys(existingKeys).filter(
    (key) => key === 'popular_food',
  );
  const editableKeys = parseHomepageCategoryKeys(requestedKeys).filter(
    (key) => key !== 'popular_food',
  );
  return Array.from(new Set([...preservedPlatformKeys, ...editableKeys]));
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
