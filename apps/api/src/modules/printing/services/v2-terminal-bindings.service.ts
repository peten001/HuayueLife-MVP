import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Printer, PrinterChannelType } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { isIP } from 'node:net';
import { PrismaService } from '../../../database/prisma.service';
import {
  ArchiveV2BindingDto,
  ReportV2PrinterStatusDto,
  SyncV2BindingDto,
  V2RouteIdentityDto,
} from '../dto/v2-terminal-connector.dto';
import {
  containsPrintingCredentialMaterial,
  PRINTING_ERROR_CODES,
  sanitizePrintingError,
} from '../types/printing-errors';
import { AuthenticatedTerminal } from '../types/terminal-auth';
import {
  channelForV2Transport,
  isPlainObject,
  isV2LocalChannel,
  V2_LOCAL_CHANNELS,
  V2_TERMINAL_ADAPTERS,
  v2BindingMetadata,
  V2Transport,
} from '../types/v2-terminal-binding';
import { PrintingAuditService } from './printing-audit.service';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';
import { hasExplicitV2ExecutionEvidence } from '../utils/printer-readiness';

type DbClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class V2TerminalBindingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly audit: PrintingAuditService,
  ) {}

  async configFor(terminal: AuthenticatedTerminal) {
    this.flags.assertTaskCenterEnabled();
    const record = await this.prisma.merchantTerminal.findFirst({
      where: {
        id: terminal.id,
        merchantId: terminal.merchantId,
        status: { in: ['ACTIVE', 'DISABLED'] },
        revokedAt: null,
        tokenVersion: terminal.tokenVersion,
      },
      select: {
        id: true,
        status: true,
        configVersion: true,
        merchant: { select: { id: true, status: true, printingEnabled: true } },
      },
    });
    if (!record) this.terminalDisabled();
    const printers = await this.prisma.printer.findMany({
      where: {
        merchantId: terminal.merchantId,
        channelType: { in: [...V2_LOCAL_CHANNELS] },
        deletedAt: null,
      },
      orderBy: [{ enabled: 'desc' }, { createdAt: 'asc' }],
    });
    return {
      merchantId: record.merchant.id.toString(),
      terminalId: record.id.toString(),
      merchantPrintingEnabled:
        record.merchant.status === 'ACTIVE' && record.merchant.printingEnabled,
      terminalEnabled: record.status === 'ACTIVE',
      executionEnabled: this.flags.executionEnabled(),
      automaticCreationEnabled: this.flags.automaticCreationEnabled(),
      heartbeatSeconds: boundedInteger(
        this.config.get('TERMINAL_HEARTBEAT_SECONDS'),
        10,
        60,
        20,
      ),
      pollIntervalSeconds: boundedInteger(
        this.config.get('TERMINAL_JOB_POLL_SECONDS'),
        5,
        10,
        5,
      ),
      configVersion: record.configVersion,
      printers: printers
        .map((printer) => this.publicV2Printer(printer, terminal.id))
        .filter((printer): printer is NonNullable<typeof printer> => Boolean(printer)),
    };
  }

  async sync(
    terminal: AuthenticatedTerminal,
    requestId: string | undefined,
    dto: SyncV2BindingDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    const normalized = normalizeTransportConfig(dto.transport, dto.transportConfig);
    const endpointKey = endpointKeyFor(dto.transport, normalized);
    const reportedCapabilities = safeJson(dto.capabilities ?? {});
    const channelType = channelForV2Transport(dto.transport);

    return this.prisma.$transaction(async (tx) => {
      await this.lockMerchant(tx, terminal.merchantId);
      const activeTerminal = await this.requireActiveTerminal(terminal, tx);
      if (
        activeTerminal.merchant.status !== 'ACTIVE' ||
        !activeTerminal.merchant.printingEnabled
      ) {
        throw new ConflictException({
          code: PRINTING_ERROR_CODES.PRINTING_NOT_ENABLED,
          message: '当前商家未启用打印能力',
        });
      }
      const printers = await tx.printer.findMany({
        where: {
          merchantId: terminal.merchantId,
          channelType: { in: [...V2_LOCAL_CHANNELS] },
          deletedAt: null,
        },
      });
      const sameLocalBinding = printers.find((printer) => {
        const binding = v2BindingMetadata(printer.capabilities);
        return binding?.localBindingId === dto.localBindingId;
      });
      if (
        sameLocalBinding &&
        v2BindingMetadata(sameLocalBinding.capabilities)?.terminalId !==
          terminal.id.toString()
      ) {
        this.bindingConflict('该 localBindingId 已属于其他终端');
      }
      const sameEndpoint = printers.find((printer) => {
        const binding = v2BindingMetadata(printer.capabilities);
        return (
          binding?.terminalId === terminal.id.toString() &&
          binding.endpointKey === endpointKey
        );
      });
      if (
        sameLocalBinding &&
        sameEndpoint &&
        sameLocalBinding.id !== sameEndpoint.id
      ) {
        this.bindingConflict(
          '该物理 endpoint 已属于同一终端的其他 V2 Binding',
        );
      }
      const existing = sameLocalBinding ?? sameEndpoint;
      const previousBinding = existing
        ? v2BindingMetadata(existing.capabilities)
        : null;

      if (!existing && dto.expectedBindingVersion !== 0) {
        this.versionConflict(
          '首次 V2 Binding 同步的 expectedBindingVersion 必须为 0',
          null,
          0,
        );
      }
      if (
        existing &&
        sameLocalBinding &&
        dto.expectedBindingVersion !== previousBinding?.bindingVersion
      ) {
        this.versionConflict(
          'V2 Binding 版本已变化，请采用服务器当前版本',
          existing.id,
          previousBinding?.bindingVersion ?? 0,
        );
      }
      if (
        existing &&
        sameEndpoint &&
        !sameLocalBinding &&
        dto.expectedBindingVersion !== 0 &&
        dto.expectedBindingVersion !== previousBinding?.bindingVersion
      ) {
        this.versionConflict(
          '该物理 endpoint 已存在，请采用服务器当前 Binding',
          existing.id,
          previousBinding?.bindingVersion ?? 0,
        );
      }

      const configurationChanged = Boolean(
        existing &&
          (existing.channelType !== channelType ||
            existing.paperWidth !== dto.paperWidth ||
            previousBinding?.localBindingId !== dto.localBindingId ||
            previousBinding?.endpointKey !== endpointKey ||
            JSON.stringify(existing.connectionConfig) !== JSON.stringify(normalized)),
      );
      if (existing && configurationChanged) {
        const activeJob = await tx.printJob.findFirst({
          where: {
            merchantId: terminal.merchantId,
            printerId: existing.id,
            status: { in: ['CLAIMED', 'PRINTING'] },
          },
          select: { id: true },
        });
        if (activeJob) {
          throw new ConflictException({
            code: PRINTING_ERROR_CODES.BINDING_BUSY,
            message: '该打印机仍有执行中的任务，不能修改 Binding',
          });
        }
      }

      const now = new Date();
      const currentVersion = previousBinding?.bindingVersion ?? 0;
      if (configurationChanged && currentVersion >= 2_147_483_647) {
        this.bindingConflict('V2 Binding 版本已达上限');
      }
      const bindingVersion = existing
        ? configurationChanged
          ? currentVersion + 1
          : Math.max(1, currentVersion)
        : 1;
      const currentCapabilities =
        existing && isPlainObject(existing.capabilities)
          ? existing.capabilities
          : {};
      const capabilities = safeJson({
        ...currentCapabilities,
        v2Binding: {
          terminalId: terminal.id.toString(),
          terminalInstanceId: activeTerminal.deviceIdentifier,
          localBindingId: dto.localBindingId,
          bindingVersion,
          transport: dto.transport,
          endpointKey,
          bindingUpdatedAt:
            existing && !configurationChanged && previousBinding
              ? previousBinding.bindingUpdatedAt
              : now.toISOString(),
        },
        v2Status: nextV2Status(
          currentCapabilities.v2Status,
          dto.status,
          'PROBE',
          reportedCapabilities,
          null,
          null,
          now,
        ),
      });
      const persistedStatus = printerStatus(dto.status);
      const printer = existing
        ? await tx.printer.update({
            where: { id: existing.id },
            data: {
              name: dto.displayName,
              channelType,
              paperWidth: dto.paperWidth,
              connectionConfig: normalized,
              capabilities,
              status: persistedStatus,
              ...(configurationChanged ? { enabled: false } : {}),
            },
          })
        : await tx.printer.create({
            data: {
              merchantId: terminal.merchantId,
              name: dto.displayName,
              channelType,
              paperWidth: dto.paperWidth,
              purpose: 'FRONT_DESK',
              enabled: false,
              status: persistedStatus,
              connectionConfig: normalized,
              capabilities,
            },
          });
      await tx.merchantTerminal.update({
        where: { id: terminal.id },
        data: {
          appVersion: dto.appVersion,
          lastSeenAt: now,
          configVersion: configurationChanged || !existing
            ? { increment: 1 }
            : undefined,
        },
      });
      await this.audit.record(
        {
          merchantId: terminal.merchantId,
          action: existing
            ? configurationChanged
              ? 'V2_BINDING_CONFIGURATION_CHANGED'
              : 'V2_BINDING_SYNCED'
            : 'V2_BINDING_CREATED',
          resourceType: 'Printer',
          resourceId: printer.id,
          beforeData: previousBinding ?? undefined,
          afterData: {
            terminalId: terminal.id.toString(),
            localBindingId: dto.localBindingId,
            bindingVersion,
            transport: dto.transport,
            enabled: printer.enabled,
          },
          requestId,
        },
        tx,
      );
      return {
        merchantId: terminal.merchantId.toString(),
        terminalId: terminal.id.toString(),
        printerId: printer.id.toString(),
        localBindingId: dto.localBindingId,
        bindingVersion,
        channelType: printer.channelType,
        status: printer.status,
        enabled: printer.enabled,
        reportedAt: now.toISOString(),
      };
    });
  }

  async archive(
    terminal: AuthenticatedTerminal,
    requestId: string | undefined,
    dto: ArchiveV2BindingDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    const printerId = BigInt(dto.printerId);
    return this.prisma.$transaction(async (tx) => {
      await this.lockMerchant(tx, terminal.merchantId);
      await this.requireActiveTerminal(terminal, tx);
      const printer = await tx.printer.findFirst({
        where: { id: printerId, merchantId: terminal.merchantId },
      });
      if (!printer) this.notFound();
      const binding = v2BindingMetadata(printer.capabilities);
      this.assertBindingIdentity(binding, terminal.id, dto, true);
      if (printer.deletedAt || binding?.archivedAt) {
        return {
          merchantId: terminal.merchantId.toString(),
          terminalId: terminal.id.toString(),
          printerId: printer.id.toString(),
          localBindingId: dto.localBindingId,
          bindingVersion: dto.bindingVersion,
          archived: true,
          archivedAt:
            binding?.archivedAt ?? printer.deletedAt?.toISOString() ?? null,
        };
      }
      const activeJob = await tx.printJob.findFirst({
        where: {
          merchantId: terminal.merchantId,
          printerId,
          status: { in: ['CLAIMED', 'PRINTING'] },
        },
        select: { id: true },
      });
      if (activeJob) {
        throw new ConflictException({
          code: PRINTING_ERROR_CODES.BINDING_BUSY,
          message: '该打印机仍有执行中的任务，请完成后重试删除',
        });
      }
      const now = new Date();
      await tx.printJob.updateMany({
        where: {
          merchantId: terminal.merchantId,
          printerId,
          status: { in: ['PENDING', 'RETRY_WAIT'] },
        },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          completedAt: now,
          claimedAt: null,
          claimedByTerminalId: null,
          leaseExpiresAt: null,
          leaseVersion: { increment: 1 },
          retryBlocked: true,
          lastErrorCode: PRINTING_ERROR_CODES.BINDING_ARCHIVED,
          lastErrorMessage: '打印机 Binding 已归档，任务已停止执行',
        },
      });
      await tx.printTriggerOutbox.updateMany({
        where: {
          merchantId: terminal.merchantId,
          printerId,
          status: { in: ['PENDING', 'PROCESSING'] },
        },
        data: {
          status: 'FAILED',
          processedAt: now,
          claimedAt: null,
          leaseExpiresAt: null,
          lastErrorCode: PRINTING_ERROR_CODES.BINDING_ARCHIVED,
          lastErrorMessage: '打印机 Binding 已归档，自动打印意图已终止',
        },
      });
      await tx.printRule.updateMany({
        where: { merchantId: terminal.merchantId, printerId },
        data: { enabled: false, autoPrint: false },
      });
      const currentCapabilities = isPlainObject(printer.capabilities)
        ? printer.capabilities
        : {};
      const capabilities = safeJson({
        ...currentCapabilities,
        v2Binding: { ...binding, archivedAt: now.toISOString() },
      });
      const archived = await tx.printer.update({
        where: { id: printer.id },
        data: { enabled: false, deletedAt: now, capabilities },
      });
      await tx.merchantTerminal.update({
        where: { id: terminal.id },
        data: { configVersion: { increment: 1 }, lastSeenAt: now },
      });
      await this.audit.record(
        {
          merchantId: terminal.merchantId,
          action: 'V2_BINDING_ARCHIVED',
          resourceType: 'Printer',
          resourceId: printer.id,
          beforeData: {
            enabled: printer.enabled,
            localBindingId: binding?.localBindingId,
            bindingVersion: binding?.bindingVersion,
          },
          afterData: { enabled: false, archivedAt: now.toISOString() },
          requestId,
        },
        tx,
      );
      return {
        merchantId: terminal.merchantId.toString(),
        terminalId: terminal.id.toString(),
        printerId: archived.id.toString(),
        localBindingId: dto.localBindingId,
        bindingVersion: dto.bindingVersion,
        archived: true,
        archivedAt: now.toISOString(),
      };
    });
  }

  async reportStatus(
    terminal: AuthenticatedTerminal,
    dto: ReportV2PrinterStatusDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    const printerId = BigInt(dto.printerId);
    const reportedCapabilities = safeJson(dto.capabilities ?? {});
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const activeTerminal = await this.requireActiveTerminal(terminal, tx);
      const { printer, binding } = await this.requireRoute(
        terminal,
        dto,
        true,
        false,
        tx,
      );
      const currentCapabilities = isPlainObject(printer.capabilities)
        ? printer.capabilities
        : {};
      const capabilities = safeJson({
        ...currentCapabilities,
        v2Status: nextV2Status(
          currentCapabilities.v2Status,
          dto.status,
          dto.source,
          reportedCapabilities,
          sanitizePrintingError(dto.lastErrorCode),
          sanitizePrintingError(dto.lastErrorMessage),
          now,
        ),
      });
      const changed = await tx.printer.updateMany({
        where: {
          id: printerId,
          merchantId: terminal.merchantId,
          channelType: printer.channelType,
          updatedAt: printer.updatedAt,
          deletedAt: null,
        },
        data: { status: printerStatus(dto.status), capabilities },
      });
      if (changed.count !== 1) {
        this.versionConflict(
          'V2 Binding 已变化，请重新同步后再上报状态',
          printer.id,
          binding.bindingVersion,
        );
      }
      await tx.merchantTerminal.updateMany({
        where: {
          id: terminal.id,
          merchantId: terminal.merchantId,
          status: 'ACTIVE',
          revokedAt: null,
          tokenVersion: terminal.tokenVersion,
        },
        data: {
          lastSeenAt: now,
          lastErrorCode: dto.lastErrorCode ?? null,
          lastErrorMessage: sanitizePrintingError(dto.lastErrorMessage),
          appVersion: activeTerminal.appVersion,
        },
      });
      return {
        merchantId: terminal.merchantId.toString(),
        terminalId: terminal.id.toString(),
        printerId: printer.id.toString(),
        localBindingId: binding.localBindingId,
        bindingVersion: binding.bindingVersion,
        reportedStatus: dto.status,
        persistedStatus: printerStatus(dto.status),
        source: dto.source,
        reportedAt: now.toISOString(),
      };
    });
  }

  async requireRoute(
    terminal: AuthenticatedTerminal,
    route: V2RouteIdentityDto,
    allowDisabled: boolean,
    requireOnline: boolean,
    client: DbClient = this.prisma,
  ) {
    const printer = await client.printer.findFirst({
      where: {
        id: BigInt(route.printerId),
        merchantId: terminal.merchantId,
        channelType: { in: [...V2_LOCAL_CHANNELS] },
        deletedAt: null,
      },
    });
    if (!printer) this.notFound();
    const binding = v2BindingMetadata(printer.capabilities);
    this.assertBindingIdentity(binding, terminal.id, route);
    if (!allowDisabled && !printer.enabled) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.PRINTER_DISABLED,
        message: '打印机尚未启用',
      });
    }
    if (
      requireOnline &&
      (printer.status !== 'ONLINE' ||
        !hasExplicitV2ExecutionEvidence(printer.capabilities))
    ) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.PRINTER_OFFLINE,
        message: '打印机缺少当前 CONNECTED 物理状态',
      });
    }
    return { printer, binding: binding! };
  }

  async requireEnableable(merchantId: bigint, printerId: bigint) {
    const printer = await this.prisma.printer.findFirst({
      where: {
        id: printerId,
        merchantId,
        channelType: { in: [...V2_LOCAL_CHANNELS] },
        deletedAt: null,
      },
    });
    if (!printer) this.notFound();
    const binding = v2BindingMetadata(printer.capabilities);
    if (
      !binding ||
      binding.archivedAt ||
      printer.status !== 'ONLINE' ||
      !hasExplicitV2ExecutionEvidence(printer.capabilities)
    ) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.PRINTER_OFFLINE,
        message: 'V2 打印机缺少当前 CONNECTED Binding',
      });
    }
    const bindingUpdatedAt = new Date(binding.bindingUpdatedAt);
    const latestTest = await this.prisma.printJob.findFirst({
      where: {
        merchantId,
        printerId,
        source: 'TEST',
        status: 'SUCCEEDED',
        completedAt: { gte: bindingUpdatedAt },
      },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      include: {
        attempts: {
          where: {
            terminalId: BigInt(binding.terminalId),
            adapter: this.adapterFor(printer.channelType),
            result: 'SUCCEEDED',
            bytesWritten: { gt: 0 },
            startedAt: { gte: bindingUpdatedAt },
            finishedAt: { gte: bindingUpdatedAt },
          },
          take: 1,
        },
      },
    });
    if (!latestTest?.attempts.length) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.TEST_PRINT_REQUIRED,
        message: 'V2 打印机必须先完成当前 Binding 的测试打印',
      });
    }
    return { printer, binding, latestTest };
  }

  async describe(printer: Printer) {
    const binding = v2BindingMetadata(printer.capabilities);
    if (!binding || binding.archivedAt) return null;
    const terminal = await this.prisma.merchantTerminal.findFirst({
      where: {
        id: BigInt(binding.terminalId),
        merchantId: printer.merchantId,
        revokedAt: null,
      },
      select: {
        id: true,
        name: true,
        status: true,
        appVersion: true,
        lastSeenAt: true,
      },
    });
    const capabilities = isPlainObject(printer.capabilities)
      ? printer.capabilities
      : {};
    return {
      terminalId: binding.terminalId,
      localBindingId: binding.localBindingId,
      bindingVersion: binding.bindingVersion,
      transport: binding.transport,
      bindingUpdatedAt: binding.bindingUpdatedAt,
      endpointKey: binding.endpointKey,
      physicalStatus: capabilities.v2Status ?? null,
      terminal,
    };
  }

  adapterFor(channelType: PrinterChannelType) {
    if (!isV2LocalChannel(channelType)) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CHANNEL_NOT_IMPLEMENTED,
        message: 'V2 终端只执行 USB、LAN 或经典蓝牙任务',
      });
    }
    return V2_TERMINAL_ADAPTERS[channelType];
  }

  private async requireActiveTerminal(
    terminal: AuthenticatedTerminal,
    client: DbClient,
  ) {
    const record = await client.merchantTerminal.findFirst({
      where: {
        id: terminal.id,
        merchantId: terminal.merchantId,
        status: 'ACTIVE',
        revokedAt: null,
        tokenVersion: terminal.tokenVersion,
      },
      select: {
        id: true,
        deviceIdentifier: true,
        appVersion: true,
        merchant: { select: { status: true, printingEnabled: true } },
      },
    });
    if (!record || !record.deviceIdentifier) this.terminalDisabled();
    return record;
  }

  private publicV2Printer(printer: Printer, terminalId: bigint) {
    const binding = v2BindingMetadata(printer.capabilities);
    if (!binding || binding.terminalId !== terminalId.toString() || binding.archivedAt) {
      return null;
    }
    const capabilities = isPlainObject(printer.capabilities)
      ? printer.capabilities
      : {};
    return {
      id: printer.id.toString(),
      name: printer.name,
      channelType: printer.channelType,
      paperWidth: printer.paperWidth,
      purpose: printer.purpose,
      enabled: printer.enabled,
      status: printer.status,
      connectionConfig: printer.connectionConfig,
      binding: {
        localBindingId: binding.localBindingId,
        bindingVersion: binding.bindingVersion,
        transport: binding.transport,
      },
      physicalStatus: capabilities.v2Status ?? null,
    };
  }

  private assertBindingIdentity(
    binding: ReturnType<typeof v2BindingMetadata>,
    terminalId: bigint,
    route: V2RouteIdentityDto,
    allowArchived = false,
  ) {
    if (
      !binding ||
      (!allowArchived && binding.archivedAt) ||
      binding.terminalId !== terminalId.toString() ||
      binding.localBindingId !== route.localBindingId ||
      binding.bindingVersion !== route.bindingVersion
    ) {
      this.versionConflict(
        '打印机与 V2 Binding route 不匹配',
        BigInt(route.printerId),
        binding?.bindingVersion ?? 0,
      );
    }
  }

  private async lockMerchant(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
  ) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`,
    );
  }

  private versionConflict(
    message: string,
    printerId: bigint | null,
    currentBindingVersion: number,
  ): never {
    throw new ConflictException({
      code: PRINTING_ERROR_CODES.BINDING_VERSION_CONFLICT,
      message,
      printerId: printerId?.toString() ?? null,
      currentBindingVersion,
    });
  }

  private bindingConflict(message: string): never {
    throw new ConflictException({
      code: PRINTING_ERROR_CODES.STATE_CONFLICT,
      message,
    });
  }

  private notFound(): never {
    throw new NotFoundException({
      code: PRINTING_ERROR_CODES.RESOURCE_NOT_FOUND,
      message: 'V2 打印机 Binding 不存在',
    });
  }

  private terminalDisabled(): never {
    throw new ConflictException({
      code: PRINTING_ERROR_CODES.TERMINAL_DISABLED,
      message: '终端已停用、撤销或凭据已轮换',
    });
  }
}

function normalizeTransportConfig(
  transport: V2Transport,
  value: Record<string, unknown>,
) {
  assertNoSecrets(value);
  if (transport === 'LAN') {
    if (Object.keys(value).some((key) => !['host', 'port'].includes(key))) {
      configError('LAN transportConfig 仅允许 host 和 port');
    }
    const host = typeof value.host === 'string' ? value.host.trim() : '';
    const port = value.port;
    if (!isPrivateIpv4(host) || !Number.isInteger(port) || Number(port) < 1 || Number(port) > 65_535) {
      configError('LAN host 必须是 RFC1918 私有 IPv4，port 必须是 1–65535');
    }
    return { host, port: Number(port) } satisfies Prisma.InputJsonObject;
  }
  if (transport === 'USB') {
    const allowed = [
      'vendorId',
      'productId',
      'deviceName',
      'interfaceClass',
      'endpointAddress',
    ];
    if (Object.keys(value).some((key) => !allowed.includes(key))) {
      configError('USB transportConfig 含有不支持的字段');
    }
    const vendorId = integerInRange(value.vendorId, 0, 65_535);
    const productId = integerInRange(value.productId, 0, 65_535);
    if (vendorId === null || productId === null) {
      configError('USB vendorId 和 productId 必须是 0–65535 整数');
    }
    const deviceName = optionalText(value.deviceName, 256, 'USB deviceName');
    const interfaceClass = optionalInteger(
      value.interfaceClass,
      0,
      255,
      'USB interfaceClass',
    );
    const endpointAddress = optionalInteger(
      value.endpointAddress,
      0,
      255,
      'USB endpointAddress',
    );
    return {
      vendorId,
      productId,
      ...(deviceName ? { deviceName } : {}),
      ...(interfaceClass === undefined ? {} : { interfaceClass }),
      ...(endpointAddress === undefined ? {} : { endpointAddress }),
    } satisfies Prisma.InputJsonObject;
  }
  const allowed = ['macAddress', 'deviceName', 'serviceUuid'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    configError('Bluetooth transportConfig 含有不支持的字段');
  }
  const macAddress =
    typeof value.macAddress === 'string' ? value.macAddress.trim().toUpperCase() : '';
  const deviceName = optionalText(value.deviceName, 128, 'Bluetooth deviceName');
  const serviceUuid =
    typeof value.serviceUuid === 'string'
      ? value.serviceUuid.trim().toUpperCase()
      : '';
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(macAddress)) {
    configError('Bluetooth macAddress 格式无效');
  }
  if (!deviceName) configError('Bluetooth deviceName 不能为空');
  if (!/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(serviceUuid)) {
    configError('Bluetooth serviceUuid 格式无效');
  }
  return { macAddress, deviceName, serviceUuid } satisfies Prisma.InputJsonObject;
}

function endpointKeyFor(
  transport: V2Transport,
  config: Prisma.InputJsonObject,
) {
  if (transport === 'LAN') return `lan:${config.host}:${config.port}`;
  if (transport === 'BLUETOOTH') {
    return `bluetooth:${config.macAddress}:${config.serviceUuid}`;
  }
  return [
    'usb',
    config.vendorId,
    config.productId,
    config.deviceName ?? '',
    config.interfaceClass ?? '',
    config.endpointAddress ?? '',
  ].join(':');
}

function nextV2Status(
  current: unknown,
  status: 'UNKNOWN' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR',
  source: 'PROBE' | 'LOCAL_TEST' | 'PRINT_RESULT',
  capabilities: Prisma.InputJsonObject,
  lastErrorCode: string | null,
  lastErrorMessage: string | null,
  now: Date,
) {
  const previous = isPlainObject(current) ? current : {};
  return {
    ...previous,
    status,
    source,
    reportedAt: now.toISOString(),
    capabilities,
    lastErrorCode,
    lastErrorMessage,
    ...(status === 'CONNECTED' ? { lastConnectedAt: now.toISOString() } : {}),
    ...(source === 'LOCAL_TEST' ? { lastTestedAt: now.toISOString() } : {}),
  };
}

function printerStatus(
  status: 'UNKNOWN' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR',
) {
  if (status === 'CONNECTED') return 'ONLINE' as const;
  if (status === 'DISCONNECTED') return 'OFFLINE' as const;
  return status;
}

function safeJson(value: Record<string, unknown>) {
  assertNoSecrets(value);
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > 16_384) throw new Error('JSON_TOO_LARGE');
    return JSON.parse(serialized) as Prisma.InputJsonObject;
  } catch (error) {
    throw new BadRequestException({
      code: PRINTING_ERROR_CODES.CONFIG_INVALID,
      message:
        error instanceof Error && error.message === 'JSON_TOO_LARGE'
          ? 'V2 Binding 信息超过 16KB'
          : 'V2 Binding 信息必须是有效 JSON',
    });
  }
}

function assertNoSecrets(value: unknown) {
  if (
    typeof value === 'string' &&
    containsPrintingCredentialMaterial(value)
  ) {
    configError('V2 Binding 不允许包含凭据');
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (/password|secret|token|cookie|authorization|credential|api[_-]?key/i.test(key)) {
      configError('V2 Binding 不允许包含密钥字段');
    }
    assertNoSecrets(nested);
  }
}

function configError(message: string): never {
  throw new BadRequestException({
    code: PRINTING_ERROR_CODES.CONFIG_INVALID,
    message,
  });
}

function integerInRange(value: unknown, min: number, max: number) {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max
    ? Number(value)
    : null;
}

function optionalInteger(
  value: unknown,
  min: number,
  max: number,
  label: string,
) {
  if (value === undefined) return undefined;
  const normalized = integerInRange(value, min, max);
  if (normalized === null) configError(`${label} 格式无效`);
  return normalized;
}

function optionalText(value: unknown, max: number, label: string) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    configError(`${label} 格式无效`);
  }
  return value.trim();
}

function isPrivateIpv4(value: string) {
  if (isIP(value) !== 4) return false;
  const octets = value.split('.').map(Number);
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const parsed = Number(value);
  return Number.isInteger(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
}
