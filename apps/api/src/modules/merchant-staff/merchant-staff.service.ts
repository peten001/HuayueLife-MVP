import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { CreateMerchantStaffDto } from './dto/create-merchant-staff.dto';
import { UpdateMerchantStaffDto } from './dto/update-merchant-staff.dto';

@Injectable()
export class MerchantStaffService {
  constructor(private readonly prisma: PrismaService) {}

  list(merchantId: bigint) {
    return this.prisma.merchantStaff.findMany({
      where: { merchantId },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async create(merchantId: bigint, dto: CreateMerchantStaffDto) {
    await this.ensureUsernameAvailable(dto.username);
    if (dto.role === StaffRole.OWNER) {
      throw new BadRequestException('Cannot create OWNER staff account');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    return this.prisma.merchantStaff.create({
      data: {
        merchantId,
        username: dto.username,
        displayName: dto.displayName,
        passwordHash,
        role: dto.role,
      },
      select: this.staffSelect,
    });
  }

  async update(merchantId: bigint, id: bigint, dto: UpdateMerchantStaffDto) {
    const staff = await this.requireOwnedStaff(merchantId, id);
    if (
      dto.role !== undefined &&
      staff.role === StaffRole.OWNER &&
      dto.role !== StaffRole.OWNER
    ) {
      throw new ForbiddenException('OWNER role cannot be changed here');
    }
    if (dto.role === StaffRole.OWNER) {
      throw new BadRequestException('Cannot change staff role to OWNER');
    }
    if (dto.displayName === undefined && dto.role === undefined) {
      throw new BadRequestException('No updatable field provided');
    }

    const data: { displayName?: string; role?: StaffRole } = {};
    if (dto.displayName !== undefined) {
      data.displayName = dto.displayName;
    }
    if (dto.role !== undefined) {
      data.role = dto.role;
    }

    return this.prisma.merchantStaff.update({
      where: { id },
      data,
      select: this.staffSelect,
    });
  }

  async disable(merchantId: bigint, currentStaffId: bigint, id: bigint) {
    const staff = await this.requireOwnedStaff(merchantId, id);
    if (staff.id === currentStaffId) {
      throw new ForbiddenException('Cannot disable yourself');
    }
    if (staff.role === StaffRole.OWNER) {
      const ownerCount = await this.prisma.merchantStaff.count({
        where: { merchantId, role: StaffRole.OWNER, status: 'ACTIVE' },
      });
      if (ownerCount <= 1) {
        throw new ForbiddenException('Cannot disable the last owner');
      }
    }

    return this.prisma.merchantStaff.update({
      where: { id },
      data: { status: 'DISABLED' },
      select: this.staffSelect,
    });
  }

  async resetPassword(merchantId: bigint, id: bigint) {
    await this.requireOwnedStaff(merchantId, id);
    const newPassword = this.generatePassword();
    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.merchantStaff.update({
      where: { id },
      data: { passwordHash },
    });

    return { newPassword };
  }

  private async ensureUsernameAvailable(username: string) {
    const existing = await this.prisma.merchantStaff.findFirst({
      where: { username },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Username already exists');
    }
  }

  private async requireOwnedStaff(merchantId: bigint, id: bigint) {
    const staff = await this.prisma.merchantStaff.findFirst({
      where: { id, merchantId },
      select: {
        id: true,
        merchantId: true,
        role: true,
      },
    });
    if (!staff) {
      throw new NotFoundException('Merchant staff not found');
    }
    return staff;
  }

  private generatePassword() {
    return randomBytes(9).toString('base64url').slice(0, 12);
  }

  private readonly staffSelect = {
    id: true,
    username: true,
    displayName: true,
    role: true,
    status: true,
    lastLoginAt: true,
    createdAt: true,
    updatedAt: true,
  } as const;
}
