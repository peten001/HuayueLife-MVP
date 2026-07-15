import { ForbiddenException } from '@nestjs/common';
import { ActiveMerchantStaffGuard } from './active-merchant-staff.guard';

describe('ActiveMerchantStaffGuard', () => {
  it('rechecks that a merchant JWT still belongs to an active staff record', async () => {
    const prisma = { merchantStaff: { findFirst: jest.fn() } };
    const guard = new ActiveMerchantStaffGuard(prisma as never);
    const request = {
      user: {
        sub: '3',
        merchantId: '7',
        accountType: 'MERCHANT_STAFF',
        role: 'MANAGER',
      },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;

    prisma.merchantStaff.findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    prisma.merchantStaff.findFirst.mockResolvedValue({ id: 3n, role: 'STAFF' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user.role).toBe('STAFF');
    expect(prisma.merchantStaff.findFirst).toHaveBeenLastCalledWith({
      where: { id: 3n, merchantId: 7n, status: 'ACTIVE' },
      select: { id: true, role: true },
    });
  });
});
