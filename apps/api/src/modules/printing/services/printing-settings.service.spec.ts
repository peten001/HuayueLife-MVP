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
    });
    const flags = createFlagsMock();
    const service = new PrintingSettingsService(prisma as never, flags as never);

    await expect(service.get(7n)).resolves.toEqual({
      id: 7n,
      status: 'ACTIVE',
      printingEnabled: true,
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
  };
}
