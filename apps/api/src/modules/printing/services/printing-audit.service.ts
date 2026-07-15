import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { sanitizePrintingError } from '../types/printing-errors';

export interface PrintingAuditInput {
  merchantId: bigint;
  actorStaffId?: bigint;
  action: string;
  resourceType: string;
  resourceId?: bigint;
  beforeData?: unknown;
  afterData?: unknown;
  reason?: string;
  requestId?: string;
}

@Injectable()
export class PrintingAuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(
    input: PrintingAuditInput,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return client.printingAuditLog.create({
      data: {
        merchantId: input.merchantId,
        actorStaffId: input.actorStaffId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        beforeData: toJson(input.beforeData),
        afterData: toJson(input.afterData),
        reason: sanitizePrintingError(input.reason)?.slice(0, 255),
        requestId: safeRequestId(input.requestId),
      },
    });
  }
}

function safeRequestId(value: string | undefined) {
  if (!value || !/^[A-Za-z0-9._:-]{1,64}$/.test(value)) return undefined;
  return value;
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(value, (key, item) => {
      if (/password|secret|token|cookie|authorization|credential|api[_-]?key/i.test(key)) {
        return '[redacted]';
      }
      return typeof item === 'bigint' ? item.toString() : item;
    }),
  ) as Prisma.InputJsonValue;
}
