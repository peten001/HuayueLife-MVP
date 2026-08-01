import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Printer } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { SyncLanTerminalBindingDto } from '../dto/lan-terminal-binding.dto';
import { ReportLanPrinterStatusDto } from '../dto/lan-terminal-connector.dto';
import {
  ANDROID_LAN_ESCPOS_ADAPTER,
  isFresh,
  isPlainObject,
  isPrivateIpv4,
  lanBindingMetadata,
  lanConnectorEvidence,
  lanEndpoint,
  safeJson,
  validLanConnectionConfig,
} from '../types/lan-terminal-binding';
import {
  PRINTING_ERROR_CODES,
  sanitizePrintingError,
} from '../types/printing-errors';
import { PrintingAuditService } from './printing-audit.service';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';
import { PrintingSettingsService } from './printing-settings.service';
import { AuthenticatedTerminal } from '../types/terminal-auth';

type DbClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class LanTerminalBindingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly settings: PrintingSettingsService,
    private readonly audit: PrintingAuditService,
  ) {}

  async sync(
    authenticatedTerminal: AuthenticatedTerminal,
    requestId: string | undefined,
    dto: SyncLanTerminalBindingDto,
  ) {
    const merchantId = authenticatedTerminal.merchantId;
    this.flags.assertTaskCenterEnabled();
    this.flags.assertLanPrintingEnabled();
    await this.settings.assertMerchantPrintingEnabled(merchantId);
    this.assertEndpoint(dto.host, dto.port);
    const reportedCapabilities = this.normalizeSafeJson(dto.capabilities ?? {});

    const result = await this.prisma.$transaction(async (tx) => {
          // Serializing binding syncs on the merchant row gives the JSON-backed
          // idempotency keys the same race protection as a dedicated unique key,
          // without introducing a second binding table or a migration.
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`,
          );
          const merchant = await tx.merchant.findUnique({
            where: { id: merchantId },
            select: { id: true, status: true, printingEnabled: true },
          });
          if (!merchant || merchant.status !== 'ACTIVE' || !merchant.printingEnabled) {
            throw new BadRequestException({
              code: PRINTING_ERROR_CODES.PRINTING_NOT_ENABLED,
              message: '当前商家未启用打印能力',
            });
          }

          const terminal = await tx.merchantTerminal.findFirst({
            where: {
              id: authenticatedTerminal.id,
              merchantId,
              status: 'ACTIVE',
              revokedAt: null,
              tokenVersion: authenticatedTerminal.tokenVersion,
            },
          });
          if (
            !terminal ||
            terminal.merchantId !== merchantId ||
            terminal.status !== 'ACTIVE' ||
            terminal.revokedAt ||
            terminal.tokenVersion !== authenticatedTerminal.tokenVersion ||
            !terminal.deviceIdentifier
          ) {
            throw new ConflictException({
              code: PRINTING_ERROR_CODES.TERMINAL_DISABLED,
              message: '终端未激活或缺少可信设备标识，不能同步 LAN Binding',
            });
          }

          const archivedPrinters = await tx.printer.findMany({
            where: {
              merchantId,
              channelType: 'LOCAL_LAN_ESCPOS',
              deletedAt: { not: null },
            },
            orderBy: { id: 'asc' },
          });
          const archivedExactBinding = archivedPrinters.find((printer) => {
            const binding = lanBindingMetadata(printer.capabilities);
            return Boolean(
              printer.deletedAt && binding?.localBindingId === dto.localBindingId,
            );
          });
          if (archivedExactBinding) {
            throw new ConflictException({
              code: PRINTING_ERROR_CODES.PRINTER_ARCHIVED_READD_REQUIRED,
              message:
                '该本地打印机记录已在后台移除，请先在收银机删除旧记录后重新添加',
            });
          }

          const now = new Date();
          const terminalCapabilities = this.normalizeSafeJson({
            ...(isPlainObject(terminal.capabilities)
              ? terminal.capabilities
              : {}),
            lanConnector: {
              serviceRunning: dto.serviceRunning,
              executionEnabled: dto.executionEnabled,
              appVersionCode: dto.appVersionCode,
              reportedAt: now.toISOString(),
            },
          });
          const terminalUpdated = await tx.merchantTerminal.updateMany({
            where: {
              id: terminal.id,
              merchantId,
              status: 'ACTIVE',
              revokedAt: null,
              tokenVersion: authenticatedTerminal.tokenVersion,
            },
            data: {
              capabilities: terminalCapabilities,
              appVersion: dto.appVersion,
              lastSeenAt: now,
              lastErrorCode: dto.lastError ? 'LAN_CONNECTOR_ERROR' : null,
              lastErrorMessage: sanitizePrintingError(dto.lastError),
            },
          });
          if (terminalUpdated.count !== 1) {
            throw new ConflictException({
              code: PRINTING_ERROR_CODES.TERMINAL_DISABLED,
              message: '终端状态已变化，请停止同步并重新认证',
            });
          }

          const printers = await tx.printer.findMany({
            where: {
              merchantId,
              channelType: 'LOCAL_LAN_ESCPOS',
              deletedAt: null,
            },
            orderBy: { id: 'asc' },
          });
          const exactBinding = printers.find((printer) => {
            const binding = lanBindingMetadata(printer.capabilities);
            return (
              binding?.terminalId === terminal!.id.toString() &&
              binding.localBindingId === dto.localBindingId
            );
          });
          const endpointBinding = printers.find((printer) => {
            const binding = lanBindingMetadata(printer.capabilities);
            const endpoint = lanEndpoint(printer.connectionConfig);
            return (
              binding?.terminalId === terminal!.id.toString() &&
              endpoint?.host === dto.host &&
              endpoint.port === dto.port
            );
          });
          const crossTerminal = printers.find((printer) => {
            const binding = lanBindingMetadata(printer.capabilities);
            const endpoint = lanEndpoint(printer.connectionConfig);
            return (
              binding &&
              binding.terminalId !== terminal!.id.toString() &&
              (binding.localBindingId === dto.localBindingId ||
                (endpoint?.host === dto.host && endpoint.port === dto.port))
            );
          });
          if (crossTerminal) {
            throw new ConflictException({
              code: PRINTING_ERROR_CODES.STATE_CONFLICT,
              message: '该 LAN Binding 或网络地址已绑定另一终端',
            });
          }
          if (
            exactBinding &&
            endpointBinding &&
            exactBinding.id !== endpointBinding.id
          ) {
            throw new ConflictException({
              code: PRINTING_ERROR_CODES.STATE_CONFLICT,
              message: '检测到重复 LAN Binding，请先人工核对现有打印机',
            });
          }

          const existing = exactBinding ?? endpointBinding;
          const previousBinding = existing
            ? lanBindingMetadata(existing.capabilities)
            : null;
          const previousEndpoint = existing
            ? lanEndpoint(existing.connectionConfig)
            : null;
          const currentBindingVersion = previousBinding?.bindingVersion ?? 0;
          const sameRouteConfiguration = Boolean(
            existing &&
              previousBinding &&
              previousEndpoint &&
              previousEndpoint.host === dto.host &&
              previousEndpoint.port === dto.port &&
              existing.paperWidth === dto.paperWidth &&
              previousBinding.localBindingId === dto.localBindingId &&
              previousBinding.terminalId === terminal.id.toString(),
          );
          if (!existing && dto.expectedBindingVersion !== 0) {
            throw new ConflictException({
              code: PRINTING_ERROR_CODES.STATE_CONFLICT,
              message: '首次 LAN Binding 同步的 expectedBindingVersion 必须为 0',
            });
          }
          if (
            existing &&
            !sameRouteConfiguration &&
            dto.expectedBindingVersion !== currentBindingVersion
          ) {
            throw new ConflictException({
              code: PRINTING_ERROR_CODES.STATE_CONFLICT,
              message: 'LAN Binding 版本已变化，请读取最新配置后再更新',
            });
          }
          const configChanged = Boolean(
            existing &&
              (previousEndpoint?.host !== dto.host ||
                previousEndpoint.port !== dto.port ||
                existing.paperWidth !== dto.paperWidth ||
                previousBinding?.localBindingId !== dto.localBindingId ||
                previousBinding?.terminalId !== terminal.id.toString()),
          );
          if (existing && configChanged) {
            if (currentBindingVersion >= 2_147_483_647) {
              throw new ConflictException({
                code: PRINTING_ERROR_CODES.STATE_CONFLICT,
                message: 'LAN Binding 版本已达上限，请人工核对后重新绑定',
              });
            }
            const activeJob = await tx.printJob.findFirst({
              where: {
                merchantId,
                printerId: existing.id,
                claimedByTerminalId: terminal.id,
                status: { in: ['CLAIMED', 'PRINTING'] },
              },
              select: { id: true },
            });
            if (activeJob) {
              throw new ConflictException({
                code: PRINTING_ERROR_CODES.STATE_CONFLICT,
                message: '该打印机仍有执行中的任务，不能修改 LAN Binding',
              });
            }
          }
          const bindingVersion = existing
            ? configChanged
              ? currentBindingVersion + 1
              : currentBindingVersion || 1
            : 1;
          const bindingUpdatedAt =
            existing && !configChanged && previousBinding
              ? previousBinding.bindingUpdatedAt
              : now.toISOString();
          const currentCapabilities =
            existing && isPlainObject(existing.capabilities)
              ? existing.capabilities
              : {};
          const connectorReady =
            dto.status === 'CONNECTED' &&
            dto.serviceRunning &&
            dto.executionEnabled;
          const status = configChanged
            ? 'UNVERIFIED'
            : connectorReady
              ? 'ONLINE'
              : dto.status === 'DISCONNECTED' || !dto.serviceRunning
                ? 'OFFLINE'
                : dto.status === 'ERROR'
                  ? 'ERROR'
                  : 'UNKNOWN';
          const capabilities = this.normalizeSafeJson({
            ...currentCapabilities,
            lanBinding: {
              terminalId: terminal.id.toString(),
              localBindingId: dto.localBindingId,
              terminalInstanceId: terminal.deviceIdentifier,
              executor: 'TERMINAL',
              adapter: ANDROID_LAN_ESCPOS_ADAPTER,
              bindingVersion,
              bindingUpdatedAt,
            },
            connectorStatus: {
              connectionType: 'LAN',
              status: dto.status,
              serviceRunning: dto.serviceRunning,
              executionEnabled: dto.executionEnabled,
              localBindingId: dto.localBindingId,
              capabilities: reportedCapabilities,
              lastError: sanitizePrintingError(dto.lastError),
            },
            connectorStatusUpdatedAt: now.toISOString(),
            ...(connectorReady ? { lastConnectedAt: now.toISOString() } : {}),
          });

          const printer = existing
            ? await tx.printer.update({
                where: { id: existing.id },
                data: {
                  name: dto.displayName,
                  paperWidth: dto.paperWidth,
                  connectionConfig: { host: dto.host, port: dto.port },
                  capabilities,
                  status,
                  ...(configChanged ? { enabled: false } : {}),
                },
              })
            : await tx.printer.create({
                data: {
                  merchantId,
                  name: dto.displayName,
                  channelType: 'LOCAL_LAN_ESCPOS',
                  paperWidth: dto.paperWidth,
                  purpose: 'FRONT_DESK',
                  enabled: false,
                  status,
                  connectionConfig: { host: dto.host, port: dto.port },
                  capabilities,
                },
              });
          await this.audit.record(
            {
              merchantId,
              action: existing
                ? configChanged
                  ? 'LAN_BINDING_CONFIGURATION_CHANGED'
                  : 'LAN_BINDING_SYNCED'
                : 'LAN_BINDING_CREATED',
              resourceType: 'Printer',
              resourceId: printer.id,
              beforeData: existing
                ? {
                    terminalId: previousBinding?.terminalId,
                    localBindingId: previousBinding?.localBindingId,
                    bindingVersion: previousBinding?.bindingVersion,
                  }
                : undefined,
              afterData: {
                terminalId: terminal.id.toString(),
                localBindingId: dto.localBindingId,
                bindingVersion,
                enabled: printer.enabled,
              },
              requestId,
            },
            tx,
          );
          return {
            terminalId: terminal.id,
            printerId: printer.id,
            localBindingId: dto.localBindingId,
            bindingVersion,
            status: printer.status,
            enabled: printer.enabled,
            reportedAt: now,
          };
        });
    return {
      terminalId: result.terminalId,
      printerId: result.printerId,
      localBindingId: result.localBindingId,
      bindingVersion: result.bindingVersion,
      status: result.status,
      enabled: result.enabled,
      reportedAt: result.reportedAt,
    };
  }

  async reportStatus(
    authenticatedTerminal: AuthenticatedTerminal,
    dto: ReportLanPrinterStatusDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    this.flags.assertLanPrintingEnabled();
    await this.settings.assertMerchantPrintingEnabled(
      authenticatedTerminal.merchantId,
    );
    const printerId = BigInt(dto.printerId);
    const now = new Date();
    const reportedCapabilities = this.normalizeSafeJson(dto.capabilities ?? {});
    return this.prisma.$transaction(async (tx) => {
      const { printer, binding } = await this.requireClaimable(
        authenticatedTerminal.merchantId,
        printerId,
        authenticatedTerminal.id,
        dto.localBindingId,
        dto.bindingVersion,
        true,
        tx,
        { requireFreshEvidence: false, requireFreshTerminal: false },
      );
      const currentCapabilities = isPlainObject(printer.capabilities)
        ? printer.capabilities
        : {};
      const connectorReady =
        dto.status === 'CONNECTED' &&
        dto.serviceRunning &&
        dto.executionEnabled;
      const persistedStatus = connectorReady
        ? printer.enabled
          ? 'ONLINE'
          : printer.status === 'UNVERIFIED'
            ? 'UNVERIFIED'
            : 'ONLINE'
        : dto.status === 'DISCONNECTED' || !dto.serviceRunning
          ? 'OFFLINE'
          : dto.status === 'ERROR'
            ? 'ERROR'
            : 'UNKNOWN';
      const capabilities = this.normalizeSafeJson({
        ...currentCapabilities,
        connectorStatus: {
          connectionType: 'LAN',
          status: dto.status,
          serviceRunning: dto.serviceRunning,
          executionEnabled: dto.executionEnabled,
          localBindingId: dto.localBindingId,
          capabilities: reportedCapabilities,
          lastError: sanitizePrintingError(dto.lastError),
        },
        connectorStatusUpdatedAt: now.toISOString(),
        ...(connectorReady ? { lastConnectedAt: now.toISOString() } : {}),
      });
      const changed = await tx.printer.updateMany({
        where: {
          id: printerId,
          merchantId: authenticatedTerminal.merchantId,
          channelType: 'LOCAL_LAN_ESCPOS',
          updatedAt: printer.updatedAt,
          deletedAt: null,
        },
        data: { status: persistedStatus, capabilities },
      });
      if (changed.count !== 1) {
        throw new ConflictException({
          code: PRINTING_ERROR_CODES.STATE_CONFLICT,
          message: 'LAN Binding 已变化，请重新同步配置后再上报状态',
        });
      }
      const terminalChanged = await tx.merchantTerminal.updateMany({
        where: {
          id: authenticatedTerminal.id,
          merchantId: authenticatedTerminal.merchantId,
          status: 'ACTIVE',
          revokedAt: null,
          tokenVersion: authenticatedTerminal.tokenVersion,
        },
        data: {
          lastSeenAt: now,
          lastErrorCode: dto.lastError ? 'LAN_CONNECTOR_ERROR' : null,
          lastErrorMessage: sanitizePrintingError(dto.lastError),
        },
      });
      if (terminalChanged.count !== 1) {
        throw new ConflictException({
          code: PRINTING_ERROR_CODES.TERMINAL_DISABLED,
          message: '终端状态已变化，请停止上报并重新认证',
        });
      }
      return {
        terminalId: authenticatedTerminal.id,
        printerId,
        localBindingId: binding.localBindingId,
        bindingVersion: binding.bindingVersion,
        reportedStatus: dto.status,
        persistedStatus,
        reportedAt: now,
      };
    });
  }

  async describe(printer: Printer, now = new Date()) {
    if (printer.channelType !== 'LOCAL_LAN_ESCPOS') return null;
    const binding = lanBindingMetadata(printer.capabilities);
    const endpoint = lanEndpoint(printer.connectionConfig);
    const evidence = lanConnectorEvidence(printer.capabilities);
    const terminal = binding
      ? await this.prisma.merchantTerminal.findFirst({
          where: {
            id: BigInt(binding.terminalId),
            merchantId: printer.merchantId,
            revokedAt: null,
          },
          select: {
            id: true,
            name: true,
            platform: true,
            status: true,
            appVersion: true,
            lastSeenAt: true,
            capabilities: true,
          },
        })
      : null;
    const latestTest = await this.prisma.printJob.findFirst({
      where: { merchantId: printer.merchantId, printerId: printer.id, source: 'TEST' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        status: true,
        createdAt: true,
        completedAt: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        attempts: {
          orderBy: { attemptNo: 'desc' },
          take: 1,
          select: {
            executorType: true,
            terminalId: true,
            adapter: true,
            result: true,
            bytesWritten: true,
            startedAt: true,
            finishedAt: true,
          },
        },
      },
    });
    const lastAttempt = latestTest?.attempts[0] ?? null;
    const bindingUpdatedAt = binding ? new Date(binding.bindingUpdatedAt) : null;
    const currentTestSucceeded = Boolean(
      binding &&
        latestTest?.status === 'SUCCEEDED' &&
        latestTest.completedAt &&
        bindingUpdatedAt &&
        latestTest.completedAt >= bindingUpdatedAt &&
        lastAttempt?.executorType === 'TERMINAL' &&
        lastAttempt.terminalId?.toString() === binding.terminalId &&
        lastAttempt.adapter === ANDROID_LAN_ESCPOS_ADAPTER &&
        lastAttempt.result === 'SUCCEEDED' &&
        lastAttempt.startedAt >= bindingUpdatedAt &&
        Boolean(
          lastAttempt.finishedAt && lastAttempt.finishedAt >= bindingUpdatedAt,
        ) &&
        Number(lastAttempt.bytesWritten) > 0,
    );
    const terminalFresh = Boolean(
      terminal?.status === 'ACTIVE' && isFresh(terminal.lastSeenAt, now),
    );
    const evidenceFresh = isFresh(evidence?.updatedAt ?? null, now);
    const serviceReady = Boolean(
      evidence?.serviceRunning && evidence.executionEnabled,
    );
    const connectorReady = Boolean(
      evidenceFresh && evidence?.status === 'CONNECTED' && serviceReady,
    );
    const bindingValid = Boolean(binding && endpoint && terminal);
    const lanEnabled = this.flags.lanPrintingEnabled();
    const canTest = Boolean(
      lanEnabled && bindingValid && terminalFresh && connectorReady,
    );
    const canEnable = Boolean(canTest && currentTestSucceeded && !printer.enabled);
    const enableBlockReason = !lanEnabled
      ? PRINTING_ERROR_CODES.LAN_PRINTING_DISABLED
      : !bindingValid
        ? PRINTING_ERROR_CODES.LAN_BINDING_MISSING
        : !terminalFresh
          ? PRINTING_ERROR_CODES.TERMINAL_OFFLINE
          : !serviceReady
            ? PRINTING_ERROR_CODES.CONNECTOR_SERVICE_STOPPED
            : !evidenceFresh || evidence?.status !== 'CONNECTED'
              ? PRINTING_ERROR_CODES.PRINTER_OFFLINE
              : !currentTestSucceeded
                ? PRINTING_ERROR_CODES.TEST_PRINT_REQUIRED
                : null;
    const adminState = !bindingValid
      ? 'WAITING_TERMINAL'
      : !terminalFresh || !connectorReady
        ? 'TERMINAL_OFFLINE'
        : !currentTestSucceeded
          ? 'WAITING_TEST'
          : printer.enabled
            ? 'ENABLED'
            : 'ONLINE_DISABLED';
    const terminalSessionConnector =
      terminal && isPlainObject(terminal.capabilities)
        ? terminal.capabilities.sessionConnector
        : null;
    const terminalBootstrap =
      terminal && isPlainObject(terminal.capabilities)
        ? terminal.capabilities.lanTerminalBootstrap
        : null;
    const terminalDeviceModel = isPlainObject(terminalBootstrap)
      ? terminalBootstrap.deviceModel
      : isPlainObject(terminalSessionConnector)
        ? terminalSessionConnector.deviceModel
        : undefined;
    const printerCapabilities = isPlainObject(printer.capabilities)
      ? printer.capabilities
      : null;
    const lastConnectedAt =
      printerCapabilities && typeof printerCapabilities.lastConnectedAt === 'string'
        ? printerCapabilities.lastConnectedAt
        : null;
    return {
      terminalId: binding?.terminalId ?? null,
      localBindingId: binding?.localBindingId ?? null,
      binding,
      endpoint,
      lastConnectedAt,
      terminal: terminal
        ? {
            id: terminal.id,
            name: terminal.name,
            deviceModel:
              typeof terminalDeviceModel === 'string'
                ? terminalDeviceModel
                : undefined,
            appVersion: terminal.appVersion,
            lastSeenAt: terminal.lastSeenAt,
            online: terminalFresh,
          }
        : null,
      serviceRunning: evidence?.serviceRunning ?? false,
      executionEnabled: evidence?.executionEnabled ?? false,
      statusUpdatedAt: evidence?.updatedAt,
      evidenceFresh,
      lastTest: latestTest
        ? {
            id: latestTest.id,
            status: latestTest.status,
            completedAt: latestTest.completedAt,
            lastErrorCode: latestTest.lastErrorCode,
            lastErrorMessage: sanitizePrintingError(
              latestTest.lastErrorMessage,
            ),
            attemptResult: lastAttempt?.result ?? null,
            currentBindingSucceeded: currentTestSucceeded,
          }
        : null,
      canTest,
      canEnable,
      enableBlockReason,
      adminState,
    };
  }

  async requireTestable(merchantId: bigint, printerId: bigint) {
    this.flags.assertLanPrintingEnabled();
    const printer = await this.requireOwnedLanPrinter(merchantId, printerId);
    const lan = await this.describe(printer);
    if (!lan?.canTest) this.throwGate(lan?.enableBlockReason);
    return { printer, lan };
  }

  async requireEnableable(merchantId: bigint, printerId: bigint) {
    const { printer, lan } = await this.requireTestable(merchantId, printerId);
    if (!lan.lastTest?.currentBindingSucceeded) {
      this.throwGate(PRINTING_ERROR_CODES.TEST_PRINT_REQUIRED);
    }
    return { printer, lan };
  }

  async requireClaimable(
    merchantId: bigint,
    printerId: bigint,
    terminalId: bigint,
    localBindingId: string | undefined,
    bindingVersion: number | undefined,
    allowDisabled: boolean,
    client: DbClient = this.prisma,
    options: {
      requireFreshEvidence?: boolean;
      requireFreshTerminal?: boolean;
    } = {},
  ) {
    this.flags.assertLanPrintingEnabled();
    const printer = await client.printer.findFirst({
      where: {
        id: printerId,
        merchantId,
        channelType: 'LOCAL_LAN_ESCPOS',
        deletedAt: null,
      },
    });
    if (!printer) this.notFound();
    const binding = lanBindingMetadata(printer.capabilities);
    if (
      !binding ||
      binding.terminalId !== terminalId.toString() ||
      !localBindingId ||
      binding.localBindingId !== localBindingId ||
      !Number.isInteger(bindingVersion) ||
      binding.bindingVersion !== bindingVersion
    ) {
      throw new ConflictException({
        code: PRINTING_ERROR_CODES.PERMISSION_DENIED,
        message: '任务终端与 LAN Binding 不匹配',
      });
    }
    if (!allowDisabled && !printer.enabled) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.PRINTER_DISABLED,
        message: 'LAN 打印机尚未启用',
      });
    }
    if (!allowDisabled && printer.status !== 'ONLINE') {
      this.throwGate(PRINTING_ERROR_CODES.PRINTER_OFFLINE);
    }
    const terminal = await client.merchantTerminal.findFirst({
      where: {
        id: terminalId,
        merchantId,
        status: 'ACTIVE',
        revokedAt: null,
      },
      select: { id: true, lastSeenAt: true },
    });
    if (
      !terminal ||
      (options.requireFreshTerminal !== false && !isFresh(terminal.lastSeenAt))
    ) {
      this.throwGate(PRINTING_ERROR_CODES.TERMINAL_OFFLINE);
    }
    if (options.requireFreshEvidence !== false) {
      const evidence = lanConnectorEvidence(printer.capabilities);
      if (!evidence?.serviceRunning || !evidence.executionEnabled) {
        this.throwGate(PRINTING_ERROR_CODES.CONNECTOR_SERVICE_STOPPED);
      }
      if (!isFresh(evidence.updatedAt) || evidence.status !== 'CONNECTED') {
        this.throwGate(PRINTING_ERROR_CODES.PRINTER_OFFLINE);
      }
    }
    if (!validLanConnectionConfig(printer.connectionConfig)) {
      this.throwGate(PRINTING_ERROR_CODES.LAN_BINDING_MISSING);
    }
    return { printer, terminal, binding };
  }

  private async requireOwnedLanPrinter(merchantId: bigint, printerId: bigint) {
    const printer = await this.prisma.printer.findFirst({
      where: {
        id: printerId,
        merchantId,
        channelType: 'LOCAL_LAN_ESCPOS',
        deletedAt: null,
      },
    });
    if (!printer) this.notFound();
    return printer;
  }

  private assertEndpoint(host: string, port: number) {
    if (!isPrivateIpv4(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: 'LAN host 必须是 RFC1918 私有 IPv4，port 必须是 1–65535',
      });
    }
  }

  private normalizeSafeJson(value: Record<string, unknown>) {
    try {
      return safeJson(value);
    } catch (error) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message:
          error instanceof Error && error.message === 'JSON_TOO_LARGE'
            ? 'LAN 终端能力信息过大'
            : 'LAN 终端能力信息不允许包含敏感字段',
      });
    }
  }

  private throwGate(code: string | null | undefined): never {
    const resolved = code ?? PRINTING_ERROR_CODES.PRINTER_OFFLINE;
    const messages: Record<string, string> = {
      [PRINTING_ERROR_CODES.LAN_PRINTING_DISABLED]: '局域网打印已被全局关闭',
      [PRINTING_ERROR_CODES.LAN_BINDING_MISSING]: 'LAN Binding 不存在或配置无效',
      [PRINTING_ERROR_CODES.TERMINAL_OFFLINE]: '对应商家终端离线或状态已过期',
      [PRINTING_ERROR_CODES.CONNECTOR_SERVICE_STOPPED]: '终端本地打印服务未运行',
      [PRINTING_ERROR_CODES.TEST_PRINT_REQUIRED]: '请先完成一次后台测试打印',
      [PRINTING_ERROR_CODES.PRINTER_OFFLINE]: 'LAN 打印机状态离线或已过期',
    };
    throw new BadRequestException({
      code: resolved,
      message: messages[resolved] ?? 'LAN 打印当前不可用',
    });
  }

  private notFound(): never {
    throw new NotFoundException({
      code: PRINTING_ERROR_CODES.RESOURCE_NOT_FOUND,
      message: 'LAN 打印机不存在或不属于当前商家',
    });
  }
}
