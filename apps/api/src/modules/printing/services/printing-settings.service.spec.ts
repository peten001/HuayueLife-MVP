import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrintingSettingsService } from './printing-settings.service';

describe('PrintingSettingsService', () => {
  it('returns the platform-owned printing capability as read-only state', async () => {
    const prisma = createPrismaMock();
    prisma.merchant.findUnique.mockResolvedValue({
      id: 7n,
      status: 'ACTIVE',
      printingEnabled: true,
      capabilities: [{ isEnabled: false }],
    });
    const flags = createFlagsMock();
    const service = new PrintingSettingsService(prisma as never, flags as never);

    await expect(service.get(7n)).resolves.toEqual({
      id: 7n,
      status: 'ACTIVE',
      printingEnabled: true,
      automaticCreationEnabled: false,
      featureFlags: { executionEnabled: false },
    });
  });

  it.each([true, false])(
    'rejects merchant attempts to set the platform printing capability to %s',
    async (printingEnabled) => {
      const prisma = createPrismaMock();
      const service = new PrintingSettingsService(
        prisma as never,
        createFlagsMock() as never,
      );

      await expect(
        service.update(7n, 3n, 'merchant-request', printingEnabled),
      ).rejects.toMatchObject({
        constructor: ForbiddenException,
        response: expect.objectContaining({
          code: 'PERMISSION_DENIED',
          message: '打印总能力只能由平台管理员开启或关闭',
        }),
      });
      expect(prisma.merchant.update).not.toHaveBeenCalled();
      expect(prisma.merchant.updateMany).not.toHaveBeenCalled();
    },
  );

  it('fails closed with the unified error when platform printing is disabled', async () => {
    const prisma = createPrismaMock();
    prisma.merchant.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      printingEnabled: false,
    });
    const service = new PrintingSettingsService(
      prisma as never,
      createFlagsMock() as never,
    );

    await expect(
      service.assertMerchantPrintingEnabled(7n),
    ).rejects.toMatchObject({
      constructor: ServiceUnavailableException,
      response: {
        code: 'PRINTING_NOT_ENABLED',
        message: '打印功能未开通，请联系平台管理员。',
      },
    });
  });

  it('permits execution only for an active merchant with printing enabled', async () => {
    const prisma = createPrismaMock();
    prisma.merchant.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      printingEnabled: true,
    });
    const service = new PrintingSettingsService(
      prisma as never,
      createFlagsMock() as never,
    );

    await expect(
      service.assertMerchantPrintingEnabled(7n),
    ).resolves.toBeUndefined();
  });

  it('stores the merchant automatic-creation preference without touching the platform gate', async () => {
    const prisma = createPrismaMock();
    prisma.merchant.findUnique
      .mockResolvedValueOnce({ id: 11n, status: 'ACTIVE', printingEnabled: true })
      .mockResolvedValueOnce({
        id: 11n,
        status: 'ACTIVE',
        printingEnabled: true,
        capabilities: [{ isEnabled: true }],
      });
    prisma.capability.upsert.mockResolvedValue({ id: 19n });
    const service = new PrintingSettingsService(
      prisma as never,
      createFlagsMock() as never,
    );

    await expect(service.updateAutomaticCreation(11n, true)).resolves.toEqual(
      expect.objectContaining({
        printingEnabled: true,
        automaticCreationEnabled: true,
      }),
    );
    expect(prisma.merchant.update).not.toHaveBeenCalled();
    expect(prisma.merchantCapability.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ merchantId: 11n, isEnabled: true }),
        update: { isEnabled: true },
      }),
    );
  });

  it('refuses to enable automatic creation when the platform gate is disabled', async () => {
    const prisma = createPrismaMock();
    prisma.merchant.findUnique.mockResolvedValue({
      id: 7n,
      status: 'ACTIVE',
      printingEnabled: false,
    });
    const service = new PrintingSettingsService(
      prisma as never,
      createFlagsMock() as never,
    );

    await expect(service.updateAutomaticCreation(7n, true)).rejects.toMatchObject({
      constructor: ServiceUnavailableException,
      response: expect.objectContaining({ code: 'PRINTING_NOT_ENABLED' }),
    });
    expect(prisma.merchantCapability.upsert).not.toHaveBeenCalled();
  });
});

function createFlagsMock() {
  return {
    assertTaskCenterEnabled: jest.fn(),
    status: jest.fn().mockReturnValue({ executionEnabled: false }),
  };
}

function createPrismaMock() {
  return {
    merchant: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    capability: { upsert: jest.fn() },
    merchantCapability: { upsert: jest.fn() },
  };
}
