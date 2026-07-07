import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

const CAPABILITY_CODES = ['pickupEnabled', 'deliveryEnabled'] as const;

export type MerchantCapabilityCode = (typeof CAPABILITY_CODES)[number] | 'qrOrderEnabled';

type CapabilityItem = {
  isEnabled: boolean;
  capability?: {
    code: string;
  } | null;
  code?: string | null;
};

export type MerchantCapabilitySource = {
  id?: bigint;
  pickupEnabled?: boolean | null;
  deliveryEnabled?: boolean | null;
  capabilities?: CapabilityItem[] | null;
};

export type ResolvedMerchantCapabilities = {
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
};

export type MerchantCapabilityMismatchSummary = {
  merchantCount: number;
  mismatchCount: number;
  merchants: Array<{
    merchantId: string;
    nameZh: string;
    pickupEnabled: boolean;
    pickupCapability: boolean | null;
    deliveryEnabled: boolean;
    deliveryCapability: boolean | null;
  }>;
};

@Injectable()
export class MerchantCapabilitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveMerchantCapabilities(
    merchantId: bigint,
  ): Promise<ResolvedMerchantCapabilities> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: {
        id: true,
        pickupEnabled: true,
        deliveryEnabled: true,
        capabilities: {
          where: {
            capability: {
              code: {
                in: [...CAPABILITY_CODES],
              },
            },
          },
          select: {
            isEnabled: true,
            capability: {
              select: {
                code: true,
              },
            },
          },
        },
      },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }
    return this.resolveCapabilitiesFromMerchant(merchant);
  }

  resolveCapabilitiesFromMerchant(
    merchant: MerchantCapabilitySource,
  ): ResolvedMerchantCapabilities {
    return {
      pickupEnabled: this.resolveCapabilityFlag(
        merchant,
        'pickupEnabled',
        Boolean(merchant.pickupEnabled),
      ),
      deliveryEnabled: this.resolveCapabilityFlag(
        merchant,
        'deliveryEnabled',
        Boolean(merchant.deliveryEnabled),
      ),
    };
  }

  resolveCapabilityFlag(
    merchant: MerchantCapabilitySource,
    code: MerchantCapabilityCode,
    fallbackValue = false,
  ) {
    const explicit = findCapabilityValue(merchant, code);
    return explicit ?? fallbackValue;
  }

  async getLegacyCapabilityMismatchSummary(
    limit = 50,
  ): Promise<MerchantCapabilityMismatchSummary> {
    const merchants = await this.prisma.merchant.findMany({
      select: {
        id: true,
        nameZh: true,
        pickupEnabled: true,
        deliveryEnabled: true,
        capabilities: {
          where: {
            capability: {
              code: {
                in: [...CAPABILITY_CODES],
              },
            },
          },
          select: {
            isEnabled: true,
            capability: {
              select: {
                code: true,
              },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    const mismatches = merchants
      .map((merchant) => {
        const pickupCapability = findCapabilityValue(merchant, 'pickupEnabled');
        const deliveryCapability = findCapabilityValue(merchant, 'deliveryEnabled');
        return {
          merchantId: merchant.id.toString(),
          nameZh: merchant.nameZh,
          pickupEnabled: Boolean(merchant.pickupEnabled),
          pickupCapability: pickupCapability ?? null,
          deliveryEnabled: Boolean(merchant.deliveryEnabled),
          deliveryCapability: deliveryCapability ?? null,
        };
      })
      .filter(
        (merchant) =>
          (merchant.pickupCapability !== null
            && merchant.pickupCapability !== merchant.pickupEnabled)
          || (merchant.deliveryCapability !== null
            && merchant.deliveryCapability !== merchant.deliveryEnabled),
      );

    return {
      merchantCount: merchants.length,
      mismatchCount: mismatches.length,
      merchants: mismatches.slice(0, limit),
    };
  }
}

function findCapabilityValue(
  merchant: MerchantCapabilitySource,
  code: MerchantCapabilityCode,
) {
  for (const item of merchant.capabilities ?? []) {
    const capabilityCode = item.capability?.code ?? item.code ?? null;
    if (capabilityCode === code) {
      return Boolean(item.isEnabled);
    }
  }
  return undefined;
}
