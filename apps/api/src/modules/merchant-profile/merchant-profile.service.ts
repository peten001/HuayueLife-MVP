import { Injectable, NotFoundException } from '@nestjs/common';
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
    return merchant;
  }

  async updateProfile(merchantId: bigint, dto: UpdateMerchantProfileDto) {
    await this.getProfile(merchantId);

    const data: Prisma.MerchantUpdateInput = {
      ...dto,
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
    };

    return this.prisma.merchant.update({
      where: { id: merchantId },
      data,
    });
  }
}
