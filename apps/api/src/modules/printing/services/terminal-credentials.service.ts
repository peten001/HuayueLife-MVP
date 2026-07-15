import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { PairTerminalDto } from '../dto/terminal.dto';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import { AuthenticatedTerminal } from '../types/terminal-auth';
import { PrintingAuditService } from './printing-audit.service';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';

const DEFAULT_PAIRING_MINUTES = 10;
const DEFAULT_TOKEN_DAYS = 365;

@Injectable()
export class TerminalCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly audit: PrintingAuditService,
  ) {}

  async generatePairingCode(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    terminalId: bigint,
    expiresInMinutes = DEFAULT_PAIRING_MINUTES,
    rotation = false,
  ) {
    this.flags.assertTaskCenterEnabled();
    const terminal = await this.prisma.merchantTerminal.findFirst({
      where: { id: terminalId, merchantId },
    });
    if (!terminal) this.notFound();
    if (terminal.status === 'REVOKED') {
      this.conflict('已撤销终端不能生成绑定码，请新建终端');
    }
    if (!rotation && terminal.status !== 'UNPAIRED') {
      this.conflict('已绑定终端必须通过凭据轮换重新绑定');
    }

    const pairingId = randomUUID();
    const pairingCode = randomInt(0, 100_000_000).toString().padStart(8, '0');
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + Math.min(10, Math.max(5, expiresInMinutes)) * 60_000,
    );
    const pairingCodeHash = this.hashPairingCode(pairingId, pairingCode);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (rotation) await quarantineTerminalJobs(tx, terminal.id, now);
      const changed = await tx.merchantTerminal.updateMany({
        where: {
          id: terminal.id,
          merchantId,
          status: terminal.status,
          tokenVersion: terminal.tokenVersion,
          revokedAt: null,
        },
        data: {
          status: 'UNPAIRED',
          pairingId,
          pairingCodeHash,
          pairingExpiresAt: expiresAt,
          pairingAttemptCount: 0,
          pairingMaxAttempts: 5,
          tokenHash: rotation ? null : undefined,
          tokenIssuedAt: rotation ? null : undefined,
          tokenExpiresAt: rotation ? null : undefined,
          tokenVersion: rotation ? { increment: 1 } : undefined,
          deviceIdentifier: rotation ? null : undefined,
          pairedAt: rotation ? null : undefined,
          revokedAt: null,
        },
      });
      if (changed.count !== 1) {
        this.conflict('终端状态已变更，请刷新后重试');
      }
      const next = await tx.merchantTerminal.findUniqueOrThrow({
        where: { id: terminal.id },
      });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: rotation
            ? 'TERMINAL_CREDENTIAL_ROTATION_REQUESTED'
            : 'TERMINAL_PAIRING_CODE_CREATED',
          resourceType: 'MerchantTerminal',
          resourceId: terminal.id,
          afterData: { pairingId, expiresAt, maxAttempts: 5 },
          requestId,
        },
        tx,
      );
      return next;
    });

    return {
      terminal: publicTerminal(updated),
      pairing: {
        pairingId,
        pairingCode,
        pairingPayload: `ytpair:v1:${pairingId}:${pairingCode}`,
        expiresAt,
        maxAttempts: 5,
      },
    };
  }

  async pair(dto: PairTerminalDto, requestId?: string) {
    this.flags.assertTaskCenterEnabled();
    const terminal = await this.prisma.merchantTerminal.findUnique({
      where: { pairingId: dto.pairingId },
      include: {
        merchant: {
          select: { id: true, nameZh: true, status: true, printingEnabled: true },
        },
      },
    });
    const now = new Date();
    if (
      !terminal ||
      terminal.status !== 'UNPAIRED' ||
      !terminal.pairingCodeHash ||
      !terminal.pairingExpiresAt ||
      terminal.pairingExpiresAt <= now ||
      terminal.pairingAttemptCount >= terminal.pairingMaxAttempts ||
      terminal.merchant.status !== 'ACTIVE'
    ) {
      this.pairingRejected();
    }

    const receivedHash = this.hashPairingCode(dto.pairingId, dto.pairingCode);
    if (!safeHexEqual(terminal.pairingCodeHash, receivedHash)) {
      await this.prisma.$transaction(async (tx) => {
        await tx.merchantTerminal.updateMany({
          where: {
            id: terminal.id,
            status: 'UNPAIRED',
            pairingAttemptCount: { lt: terminal.pairingMaxAttempts },
            pairingExpiresAt: { gt: now },
          },
          data: { pairingAttemptCount: { increment: 1 } },
        });
        await this.audit.record(
          {
            merchantId: terminal.merchantId,
            action: 'TERMINAL_PAIRING_FAILED',
            resourceType: 'MerchantTerminal',
            resourceId: terminal.id,
            afterData: { reason: 'CODE_MISMATCH' },
            requestId,
          },
          tx,
        );
      });
      this.pairingRejected();
    }

    const token = this.issueToken(terminal.id);
    const tokenHash = this.hashTerminalToken(token);
    const tokenExpiresAt = new Date(now.getTime() + this.tokenLifetimeMs());
    try {
      const paired = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.merchantTerminal.updateMany({
          where: {
            id: terminal.id,
            merchantId: terminal.merchantId,
            status: 'UNPAIRED',
            pairingId: dto.pairingId,
            pairingCodeHash: terminal.pairingCodeHash,
            pairingExpiresAt: { gt: now },
            pairingAttemptCount: { lt: terminal.pairingMaxAttempts },
          },
          data: {
            status: 'ACTIVE',
            name: dto.name ?? terminal.name,
            platform: 'ANDROID',
            deviceIdentifier: dto.deviceIdentifier,
            capabilities: normalizeSafeJson(dto.capabilities ?? {}),
            appVersion: dto.appVersion,
            lastSeenAt: now,
            pairedAt: now,
            pairingId: null,
            pairingCodeHash: null,
            pairingExpiresAt: null,
            pairingAttemptCount: 0,
            tokenHash,
            tokenVersion: { increment: 1 },
            tokenIssuedAt: now,
            tokenExpiresAt,
            revokedAt: null,
          },
        });
        if (changed.count !== 1) this.pairingRejected();
        const next = await tx.merchantTerminal.findUniqueOrThrow({
          where: { id: terminal.id },
        });
        await this.audit.record(
          {
            merchantId: terminal.merchantId,
            action: 'TERMINAL_PAIRED',
            resourceType: 'MerchantTerminal',
            resourceId: terminal.id,
            afterData: {
              platform: next.platform,
              appVersion: next.appVersion,
              tokenVersion: next.tokenVersion,
            },
            requestId,
          },
          tx,
        );
        return next;
      });
      return {
        terminal: publicTerminal(paired),
        merchant: terminal.merchant,
        credential: { token, tokenExpiresAt, tokenVersion: paired.tokenVersion },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: PRINTING_ERROR_CODES.TERMINAL_DEVICE_CONFLICT,
          message: '该设备标识已绑定其他终端，请先撤销旧终端',
        });
      }
      throw error;
    }
  }

  async authenticate(token: string): Promise<AuthenticatedTerminal> {
    this.flags.assertTaskCenterEnabled();
    const match = token.match(/^yt1\.([0-9]+)\.([A-Za-z0-9_-]{32,})$/);
    if (!match) this.authRejected();
    const terminalId = BigInt(match[1]);
    const terminal = await this.prisma.merchantTerminal.findUnique({
      where: { id: terminalId },
      select: {
        id: true,
        merchantId: true,
        boundPrinterId: true,
        name: true,
        platform: true,
        status: true,
        revokedAt: true,
        tokenHash: true,
        tokenVersion: true,
        tokenExpiresAt: true,
      },
    });
    const now = new Date();
    if (
      !terminal ||
      !['ACTIVE', 'DISABLED'].includes(terminal.status) ||
      terminal.revokedAt ||
      !terminal.tokenHash ||
      !terminal.tokenExpiresAt ||
      terminal.tokenExpiresAt <= now ||
      !safeHexEqual(terminal.tokenHash, this.hashTerminalToken(token))
    ) {
      this.authRejected();
    }
    return {
      id: terminal.id,
      merchantId: terminal.merchantId,
      boundPrinterId: terminal.boundPrinterId,
      name: terminal.name,
      platform: terminal.platform,
      status: terminal.status,
      tokenVersion: terminal.tokenVersion,
    };
  }

  private issueToken(terminalId: bigint) {
    return `yt1.${terminalId}.${randomBytes(32).toString('base64url')}`;
  }

  private hashPairingCode(pairingId: string, pairingCode: string) {
    return createHmac('sha256', this.pepper())
      .update(`pair:v1:${pairingId}:${pairingCode}`)
      .digest('hex');
  }

  private hashTerminalToken(token: string) {
    return createHmac('sha256', this.pepper())
      .update(`terminal-token:v1:${token}`)
      .digest('hex');
  }

  private pepper() {
    const value = this.config.get<string>('TERMINAL_AUTH_PEPPER')?.trim();
    if (
      !value ||
      Buffer.byteLength(value) < 32 ||
      /replace|change[-_ ]?me|example|development|default/i.test(value)
    ) {
      throw new ServiceUnavailableException({
        code: PRINTING_ERROR_CODES.TERMINAL_AUTH_NOT_CONFIGURED,
        message: '终端认证密钥尚未安全配置',
      });
    }
    return value;
  }

  private tokenLifetimeMs() {
    const value = Number(this.config.get<string>('TERMINAL_TOKEN_TTL_DAYS'));
    const days = Number.isInteger(value) ? Math.min(730, Math.max(1, value)) : DEFAULT_TOKEN_DAYS;
    return days * 24 * 60 * 60 * 1_000;
  }

  private notFound(): never {
    throw new ConflictException({
      code: PRINTING_ERROR_CODES.RESOURCE_NOT_FOUND,
      message: '商家终端不存在',
    });
  }

  private conflict(message: string): never {
    throw new ConflictException({ code: PRINTING_ERROR_CODES.STATE_CONFLICT, message });
  }

  private pairingRejected(): never {
    throw new UnauthorizedException({
      code: PRINTING_ERROR_CODES.TERMINAL_PAIRING_REJECTED,
      message: '绑定信息无效、已过期或尝试次数已用尽',
    });
  }

  private authRejected(): never {
    throw new UnauthorizedException({
      code: PRINTING_ERROR_CODES.TERMINAL_AUTH_INVALID,
      message: '终端凭据无效或已失效',
    });
  }
}

export async function quarantineTerminalJobs(
  tx: Prisma.TransactionClient,
  terminalId: bigint,
  now = new Date(),
) {
  await tx.printJob.updateMany({
    where: { claimedByTerminalId: terminalId, status: 'CLAIMED' },
    data: {
      status: 'PENDING',
      claimedAt: null,
      claimedByTerminalId: null,
      leaseExpiresAt: null,
      leaseVersion: { increment: 1 },
      lastErrorCode: PRINTING_ERROR_CODES.TERMINAL_DISABLED,
      lastErrorMessage: '终端已停用，未开始任务已恢复等待领取',
    },
  });
  const uncertain = await tx.printJob.findMany({
    where: { claimedByTerminalId: terminalId, status: 'PRINTING' },
    select: { id: true, attemptCount: true },
  });
  for (const job of uncertain) {
    const changed = await tx.printJob.updateMany({
      where: { id: job.id, claimedByTerminalId: terminalId, status: 'PRINTING' },
      data: {
        status: 'FAILED',
        claimedAt: null,
        claimedByTerminalId: null,
        leaseExpiresAt: null,
        leaseVersion: { increment: 1 },
        completedAt: now,
        retryBlocked: true,
        lastErrorCode: PRINTING_ERROR_CODES.PRINT_OUTCOME_UNKNOWN,
        lastErrorMessage: '打印中终端被停用，实际出纸结果未知',
      },
    });
    if (changed.count === 1) {
      await tx.printAttempt.updateMany({
        where: { jobId: job.id, attemptNo: job.attemptCount, finishedAt: null },
        data: {
          finishedAt: now,
          result: 'OUTCOME_UNKNOWN',
          errorCode: PRINTING_ERROR_CODES.PRINT_OUTCOME_UNKNOWN,
          errorMessage: '终端凭据失效，实际出纸结果未知',
        },
      });
    }
  }
}

function normalizeSafeJson(value: Record<string, unknown>) {
  assertNoSecrets(value);
  const serialized = JSON.stringify(value);
  if (serialized.length > 16_384) {
    throw new ConflictException({
      code: PRINTING_ERROR_CODES.CONFIG_INVALID,
      message: '终端能力信息过大',
    });
  }
  return JSON.parse(serialized) as Prisma.InputJsonObject;
}

function assertNoSecrets(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (/password|secret|token|cookie|authorization|credential|api[_-]?key/i.test(key)) {
      throw new ConflictException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '终端能力信息不允许包含敏感字段',
      });
    }
    assertNoSecrets(nested);
  }
}

function safeHexEqual(expected: string, actual: string) {
  if (!/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(actual)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

function publicTerminal(terminal: {
  id: bigint;
  merchantId: bigint;
  boundPrinterId: bigint | null;
  name: string;
  platform: string;
  status: string;
  appVersion: string | null;
  lastSeenAt: Date | null;
  pairedAt: Date | null;
  tokenVersion: number;
}) {
  return {
    id: terminal.id,
    merchantId: terminal.merchantId,
    boundPrinterId: terminal.boundPrinterId,
    name: terminal.name,
    platform: terminal.platform,
    status: terminal.status,
    appVersion: terminal.appVersion,
    lastSeenAt: terminal.lastSeenAt,
    pairedAt: terminal.pairedAt,
    tokenVersion: terminal.tokenVersion,
  };
}
