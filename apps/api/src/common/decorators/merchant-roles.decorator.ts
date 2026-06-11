import { SetMetadata } from '@nestjs/common';
import { StaffRole } from '@prisma/client';

export const MERCHANT_ROLES_KEY = 'merchant_roles';

export const MerchantRoles = (...roles: StaffRole[]) =>
  SetMetadata(MERCHANT_ROLES_KEY, roles);
