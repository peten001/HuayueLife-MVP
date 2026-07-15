import { PrintingAuditService } from './printing-audit.service';

describe('PrintingAuditService sanitization', () => {
  let prisma: { printingAuditLog: { create: jest.Mock } };
  let service: PrintingAuditService;

  beforeEach(() => {
    prisma = { printingAuditLog: { create: jest.fn().mockResolvedValue({ id: 1n }) } };
    service = new PrintingAuditService(prisma as never);
  });

  it('redacts credentials and phone-like numbers from audit data and reason', async () => {
    await service.record({
      merchantId: 7n,
      actorStaffId: 3n,
      action: 'SECURITY_TEST',
      resourceType: 'Printer',
      resourceId: 17n,
      beforeData: {
        token: 'secret-token',
        nested: { apiKey: 'secret-key', safeId: 99n },
      },
      reason: 'token=secret apiKey=secret-key phone 84912345678',
      requestId: 'request-safe_1',
    });

    expect(prisma.printingAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        beforeData: {
          token: '[redacted]',
          nested: { apiKey: '[redacted]', safeId: '99' },
        },
        reason:
          'token=[redacted] apiKey=[redacted] phone [redacted-number]',
        requestId: 'request-safe_1',
      }),
    });
  });

  it.each([
    'contains spaces',
    '../path',
    'request/with/slash',
    'x'.repeat(65),
  ])('drops invalid requestId %p instead of persisting it', async (requestId) => {
    await service.record({
      merchantId: 7n,
      action: 'REQUEST_ID_TEST',
      resourceType: 'PrintJob',
      requestId,
    });

    expect(prisma.printingAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ requestId: undefined }),
    });
  });
});
