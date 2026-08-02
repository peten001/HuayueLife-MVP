import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrintJobStatus } from '@prisma/client';
import {
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { BootstrapLanTerminalDto } from '../dto/lan-terminal-bootstrap.dto';
import { PairTerminalDto } from '../dto/terminal.dto';
import {
  containsPrintingCredentialMaterial,
  PRINTING_ERROR_CODES,
} from '../types/printing-errors';
import { lanBindingMetadata } from '../types/lan-terminal-binding';
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

  /**
   * Establishes a Terminal credential for an already authenticated merchant
   * Android installation. Android owns the random secret. Only its HMAC is
   * persisted, and neither the derived credential nor the secret leaves this
   * method in a response, error, audit event, or capability payload.
   */
  async bootstrapLanTerminal(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    dto: BootstrapLanTerminalDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    this.flags.assertLanPrintingEnabled();
    this.assertBootstrapSecret(dto.terminalSecret);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // A merchant-row lock serializes first registration and idempotent
        // retries without introducing a new table or migration.
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`,
        );
        const merchant = await tx.merchant.findUnique({
          where: { id: merchantId },
          select: { id: true, status: true, printingEnabled: true },
        });
        if (!merchant || merchant.status !== 'ACTIVE' || !merchant.printingEnabled) {
          throw new ConflictException({
            code: PRINTING_ERROR_CODES.PRINTING_NOT_ENABLED,
            message: '当前商家未启用打印能力',
          });
        }

        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM merchant_terminals WHERE device_identifier = ${dto.terminalInstanceId} FOR UPDATE`,
        );

        let terminal = await tx.merchantTerminal.findUnique({
          where: { deviceIdentifier: dto.terminalInstanceId },
        });
        if (terminal && terminal.merchantId !== merchantId) {
          this.deviceConflict();
        }
        if (
          terminal &&
          (terminal.status !== 'ACTIVE' || terminal.revokedAt !== null)
        ) {
          this.deviceConflict();
        }

        const now = new Date();
        const capabilities = bootstrapCapabilities(
          terminal?.capabilities,
          dto.deviceModel,
          dto.appVersionCode,
          now,
        );
        if (!terminal) {
          terminal = await tx.merchantTerminal.create({
            data: {
              merchantId,
              name:
                dto.terminalName ?? dto.deviceModel ?? 'Android 商家终端',
              platform: 'ANDROID',
              status: 'ACTIVE',
              capabilities,
              deviceIdentifier: dto.terminalInstanceId,
              appVersion: dto.appVersion,
              lastSeenAt: now,
              pairedAt: now,
            },
          });
        }

        const derivedCredential = `yt1.${terminal.id}.${dto.terminalSecret}`;
        const expectedHash = this.hashTerminalToken(derivedCredential);

        if (terminal.tokenHash) {
          if (!safeHexEqual(terminal.tokenHash, expectedHash)) {
            if (
              terminal.merchantId !== merchantId ||
              terminal.deviceIdentifier !== dto.terminalInstanceId ||
              terminal.platform !== 'ANDROID' ||
              terminal.status !== 'ACTIVE' ||
              terminal.revokedAt !== null ||
              terminal.boundPrinterId !== null ||
              terminal.lastSeenAt === null ||
              now.getTime() - terminal.lastSeenAt.getTime() <=
                this.terminalOfflineThresholdMs()
            ) {
              this.deviceConflict();
            }

            const activeJobs = await tx.printJob.count({
              where: {
                merchantId,
                claimedByTerminalId: terminal.id,
                status: {
                  in: [PrintJobStatus.CLAIMED, PrintJobStatus.PRINTING],
                },
              },
            });
            if (activeJobs !== 0) this.deviceConflict();

            const activeLanPrinters = await tx.printer.findMany({
              where: {
                merchantId,
                channelType: 'LOCAL_LAN_ESCPOS',
                deletedAt: null,
              },
              select: { capabilities: true },
            });
            if (
              activeLanPrinters.some(
                (printer) =>
                  lanBindingMetadata(printer.capabilities)?.terminalId ===
                  terminal.id.toString(),
              )
            ) {
              this.deviceConflict();
            }

            const tokenExpiresAt = new Date(
              now.getTime() + this.tokenLifetimeMs(),
            );
            const recovered = await tx.merchantTerminal.updateMany({
              where: {
                id: terminal.id,
                merchantId,
                deviceIdentifier: dto.terminalInstanceId,
                platform: 'ANDROID',
                status: 'ACTIVE',
                revokedAt: null,
                boundPrinterId: null,
                tokenHash: terminal.tokenHash,
                tokenVersion: terminal.tokenVersion,
                lastSeenAt: terminal.lastSeenAt,
              },
              data: {
                name: dto.terminalName ?? terminal.name,
                capabilities,
                appVersion: dto.appVersion,
                lastSeenAt: now,
                pairedAt: terminal.pairedAt ?? now,
                tokenHash: expectedHash,
                tokenVersion: { increment: 1 },
                tokenIssuedAt: now,
                tokenExpiresAt,
              },
            });
            if (recovered.count !== 1) this.deviceConflict();

            const registered = await tx.merchantTerminal.findUniqueOrThrow({
              where: { id: terminal.id },
            });
            await this.audit.record(
              {
                merchantId,
                actorStaffId,
                action: 'LAN_TERMINAL_BOOTSTRAP_STALE_RECOVERED',
                resourceType: 'MerchantTerminal',
                resourceId: terminal.id,
                beforeData: {
                  platform: terminal.platform,
                  appVersion: terminal.appVersion,
                  credentialVersion: terminal.tokenVersion,
                  lastSeenAt: terminal.lastSeenAt,
                },
                afterData: {
                  platform: 'ANDROID',
                  appVersion: dto.appVersion,
                  credentialVersion: registered.tokenVersion,
                  credentialExpiresAt: tokenExpiresAt.toISOString(),
                },
                requestId,
              },
              tx,
            );
            return bootstrapResponse(
              registered.id,
              registered.tokenVersion,
              tokenExpiresAt,
            );
          }
          if (!terminal.tokenExpiresAt) {
            this.deviceConflict();
          }

          await tx.merchantTerminal.update({
            where: { id: terminal.id },
            data: {
              name: dto.terminalName ?? terminal.name,
              capabilities,
              appVersion: dto.appVersion,
              lastSeenAt: now,
            },
          });
          await this.audit.record(
            {
              merchantId,
              actorStaffId,
              action: 'LAN_TERMINAL_BOOTSTRAP_REUSED',
              resourceType: 'MerchantTerminal',
              resourceId: terminal.id,
              afterData: {
                platform: 'ANDROID',
                appVersion: dto.appVersion,
                credentialVersion: terminal.tokenVersion,
              },
              requestId,
            },
            tx,
          );
          return bootstrapResponse(
            terminal.id,
            terminal.tokenVersion,
            terminal.tokenExpiresAt,
          );
        }

        const tokenExpiresAt = new Date(now.getTime() + this.tokenLifetimeMs());
        const claimed = await tx.merchantTerminal.updateMany({
          where: {
            id: terminal.id,
            merchantId,
            status: 'ACTIVE',
            revokedAt: null,
            tokenHash: null,
          },
          data: {
            name: dto.terminalName ?? terminal.name,
            capabilities,
            appVersion: dto.appVersion,
            lastSeenAt: now,
            pairedAt: terminal.pairedAt ?? now,
            tokenHash: expectedHash,
            tokenVersion: { increment: 1 },
            tokenIssuedAt: now,
            tokenExpiresAt,
          },
        });
        if (claimed.count !== 1) {
          // A credential written by any other flow is never overwritten.
          this.deviceConflict();
        }
        const registered = await tx.merchantTerminal.findUniqueOrThrow({
          where: { id: terminal.id },
        });
        await this.audit.record(
          {
            merchantId,
            actorStaffId,
            action: 'LAN_TERMINAL_BOOTSTRAPPED',
            resourceType: 'MerchantTerminal',
            resourceId: terminal.id,
            afterData: {
              platform: 'ANDROID',
              appVersion: dto.appVersion,
              credentialVersion: registered.tokenVersion,
              credentialExpiresAt: tokenExpiresAt.toISOString(),
            },
            requestId,
          },
          tx,
        );
        return bootstrapResponse(
          registered.id,
          registered.tokenVersion,
          tokenExpiresAt,
        );
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.deviceConflict();
      }
      throw error;
    }
  }

  async renewLanTerminalCredential(
    terminal: AuthenticatedTerminal,
    requestId?: string,
  ) {
    this.flags.assertTaskCenterEnabled();
    this.flags.assertLanPrintingEnabled();
    const current = await this.prisma.merchantTerminal.findFirst({
      where: {
        id: terminal.id,
        merchantId: terminal.merchantId,
        status: 'ACTIVE',
        revokedAt: null,
        tokenVersion: terminal.tokenVersion,
      },
      select: {
        id: true,
        merchantId: true,
        tokenHash: true,
        tokenVersion: true,
        tokenExpiresAt: true,
        merchant: { select: { status: true, printingEnabled: true } },
      },
    });
    const now = new Date();
    if (
      !current ||
      !current.tokenHash ||
      !current.tokenExpiresAt ||
      current.tokenExpiresAt <= now
    ) {
      this.authRejected();
    }
    if (
      current.merchant.status !== 'ACTIVE' ||
      !current.merchant.printingEnabled
    ) {
      throw new ConflictException({
        code: PRINTING_ERROR_CODES.PRINTING_NOT_ENABLED,
        message: '当前商家未启用打印能力',
      });
    }

    const renewAfter = new Date(
      current.tokenExpiresAt.getTime() - this.tokenRenewBeforeMs(),
    );
    if (now < renewAfter) {
      return credentialRenewalResponse(
        current.id,
        current.tokenVersion,
        current.tokenExpiresAt,
        false,
      );
    }

    const tokenExpiresAt = new Date(now.getTime() + this.tokenLifetimeMs());
    const changed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.merchantTerminal.updateMany({
        where: {
          id: current.id,
          merchantId: current.merchantId,
          status: 'ACTIVE',
          revokedAt: null,
          tokenVersion: current.tokenVersion,
          tokenHash: current.tokenHash,
          tokenExpiresAt: current.tokenExpiresAt,
        },
        data: { tokenExpiresAt },
      });
      if (updated.count !== 1) {
        this.conflict('终端凭据状态已变化，请停止续期并重新认证');
      }
      await this.audit.record(
        {
          merchantId: current.merchantId,
          action: 'LAN_TERMINAL_CREDENTIAL_RENEWED',
          resourceType: 'MerchantTerminal',
          resourceId: current.id,
          afterData: {
            credentialVersion: current.tokenVersion,
            credentialExpiresAt: tokenExpiresAt.toISOString(),
          },
          requestId,
        },
        tx,
      );
      return updated;
    });
    if (changed.count !== 1) {
      this.conflict('终端凭据状态已变化，请停止续期并重新认证');
    }
    return credentialRenewalResponse(
      current.id,
      current.tokenVersion,
      tokenExpiresAt,
      true,
    );
  }

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
    const match = token.match(/^yt1\.([1-9][0-9]{0,18})\.([A-Za-z0-9_-]{43})$/);
    if (!match) this.authRejected();
    const terminalId = BigInt(match[1]);
    if (terminalId > 9_223_372_036_854_775_807n) this.authRejected();
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

  private tokenRenewBeforeMs() {
    const configured = Number(
      this.config.get('TERMINAL_TOKEN_RENEW_BEFORE_DAYS') ?? 30,
    );
    const days = Number.isFinite(configured)
      ? Math.min(90, Math.max(1, Math.floor(configured)))
      : 30;
    return days * 24 * 60 * 60 * 1_000;
  }

  private terminalOfflineThresholdMs() {
    const configured = Number(
      this.config.get<string>('TERMINAL_HEARTBEAT_SECONDS'),
    );
    const heartbeatSeconds = Number.isInteger(configured)
      ? Math.min(60, Math.max(10, configured))
      : 20;
    return Math.max(30, heartbeatSeconds * 3) * 1_000;
  }

  private assertBootstrapSecret(value: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '终端密钥格式无效',
      });
    }
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.byteLength !== 32 || decoded.toString('base64url') !== value) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: '终端密钥格式无效',
      });
    }
  }

  private deviceConflict(): never {
    throw new ConflictException({
      code: PRINTING_ERROR_CODES.TERMINAL_DEVICE_CONFLICT,
      message: '该终端已完成注册，已拒绝覆盖现有凭据',
    });
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
  if (
    typeof value === 'string' &&
    containsPrintingCredentialMaterial(value)
  ) {
    throw new ConflictException({
      code: PRINTING_ERROR_CODES.CONFIG_INVALID,
      message: '终端能力信息不允许包含敏感字段',
    });
  }
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

function bootstrapCapabilities(
  existing: Prisma.JsonValue | null | undefined,
  deviceModel: string | undefined,
  appVersionCode: number | undefined,
  reportedAt: Date,
) {
  const safeExisting =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? existing
      : {};
  return normalizeSafeJson({
    ...safeExisting,
    lanTerminalBootstrap: {
      deviceModel,
      appVersionCode,
      reportedAt: reportedAt.toISOString(),
    },
  });
}

function bootstrapResponse(
  terminalId: bigint,
  tokenVersion: number,
  tokenExpiresAt: Date,
) {
  return {
    terminalId: terminalId.toString(),
    tokenVersion,
    tokenExpiresAt: tokenExpiresAt.toISOString(),
    authorizationScheme: 'Terminal' as const,
  };
}

function credentialRenewalResponse(
  terminalId: bigint,
  tokenVersion: number,
  tokenExpiresAt: Date,
  renewed: boolean,
) {
  return {
    terminalId: terminalId.toString(),
    tokenVersion,
    tokenExpiresAt: tokenExpiresAt.toISOString(),
    authorizationScheme: 'Terminal' as const,
    renewed,
  };
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
