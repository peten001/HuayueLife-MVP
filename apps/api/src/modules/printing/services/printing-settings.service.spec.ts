import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { PrintingSettingsService } from './printing-settings.service';

describe('PrintingSettingsService', () => {
  it('keeps merchant printing disabled unless explicitly enabled and audited', async () => {
    const prisma = createPrismaMock();
    prisma.merchant.findUnique.mockResolvedValue({
      id: 7n,
      status: 'ACTIVE',
      printingEnabled: false,
    });
    prisma.merchant.updateMany.mockResolvedValue({ count: 1 });
    prisma.merchant.findUniqueOrThrow.mockResolvedValue({
      id: 7n,
      status: 'ACTIVE',
      printingEnabled: true,
    });
    const audit = { record: jest.fn().mockResolvedValue({ id: 1n }) };
    const service = new PrintingSettingsService(
      prisma as never,
      {
        assertTaskCenterEnabled: jest.fn(),
        status: jest.fn().mockReturnValue({ executionEnabled: false }),
      } as never,
      audit as never,
    );

    await expect(service.assertMerchantEnabled(7n)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(service.update(7n, 3n, 'request-1', true)).resolves.toEqual(
      expect.objectContaining({ printingEnabled: true }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MERCHANT_PRINTING_ENABLED' }),
      prisma,
    );
    expect(prisma.merchant.updateMany).toHaveBeenCalledWith({
      where: { id: 7n, status: 'ACTIVE' },
      data: { printingEnabled: true },
    });
  });

  it('does not enable physical printing for an inactive merchant', async () => {
    const prisma = createPrismaMock();
    prisma.merchant.findUnique.mockResolvedValue({
      id: 7n,
      status: 'DISABLED',
      printingEnabled: false,
    });
    const service = new PrintingSettingsService(
      prisma as never,
      {
        assertTaskCenterEnabled: jest.fn(),
        status: jest.fn().mockReturnValue({ executionEnabled: false }),
      } as never,
      { record: jest.fn() } as never,
    );

    await expect(service.update(7n, 3n, 'request-disabled', true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.assertMerchantEnabled(7n)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.merchant.updateMany).not.toHaveBeenCalled();
  });

  it('fails closed if the merchant is disabled between the read and enable write', async () => {
    const prisma = createPrismaMock();
    prisma.merchant.findUnique.mockResolvedValue({
      id: 7n,
      status: 'ACTIVE',
      printingEnabled: false,
    });
    prisma.merchant.updateMany.mockResolvedValue({ count: 0 });
    const audit = { record: jest.fn() };
    const service = new PrintingSettingsService(
      prisma as never,
      {
        assertTaskCenterEnabled: jest.fn(),
        status: jest.fn().mockReturnValue({ executionEnabled: false }),
      } as never,
      audit as never,
    );

    await expect(service.update(7n, 3n, 'request-race', true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.merchant.updateMany).toHaveBeenCalledWith({
      where: { id: 7n, status: 'ACTIVE' },
      data: { printingEnabled: true },
    });
    expect(prisma.merchant.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

function createPrismaMock() {
  const prisma = {
    merchant: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
  );
  return prisma;
}
