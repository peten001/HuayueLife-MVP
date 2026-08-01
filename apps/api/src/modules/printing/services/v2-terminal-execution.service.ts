import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  ClaimV2PrintJobDto,
  V2RouteIdentityDto,
} from '../dto/v2-terminal-connector.dto';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import { AuthenticatedTerminal } from '../types/terminal-auth';
import {
  V2_LOCAL_CHANNELS,
  v2BindingMetadata,
} from '../types/v2-terminal-binding';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';
import { PrintingSettingsService } from './printing-settings.service';
import { PrintJobsService } from './print-jobs.service';
import { V2TerminalBindingsService } from './v2-terminal-bindings.service';

@Injectable()
export class V2TerminalExecutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly settings: PrintingSettingsService,
    private readonly jobs: PrintJobsService,
    private readonly bindings: V2TerminalBindingsService,
  ) {}

  async active(terminal: AuthenticatedTerminal) {
    this.flags.assertTaskCenterEnabled();
    const job = await this.jobs.findActiveTerminalJob(
      terminal.merchantId,
      terminal.id,
    );
    if (!job) return { job: null };
    const route = await this.routeForJob(terminal, job.printerId);
    return {
      job: await this.jobs.connectorJobPayload(
        terminal.merchantId,
        terminal.id,
        job.id,
        job.printerId,
        route.localBindingId,
        route.bindingVersion,
      ),
    };
  }

  async claim(terminal: AuthenticatedTerminal, dto: ClaimV2PrintJobDto) {
    this.flags.assertTaskCenterEnabled();
    this.flags.assertExecutionEnabled();
    await this.settings.assertMerchantPrintingEnabled(terminal.merchantId);
    const routes = uniqueRoutes(dto.routes);
    for (const route of routes) {
      await this.bindings.requireRoute(terminal, route, true, true);
    }

    await this.jobs.releaseExpiredLeases(new Date());
    await this.jobs.releaseAvailableRetries(new Date(), terminal.merchantId);
    const automaticAllowed =
      dto.allowAutomatic && this.flags.automaticCreationEnabled();
    if (automaticAllowed) {
      await this.jobs.processPendingAutomaticTriggers(terminal.merchantId);
    }

    const active = await this.jobs.findActiveTerminalJob(
      terminal.merchantId,
      terminal.id,
    );
    if (active) {
      const route = requireSubmittedRoute(routes, active.printerId);
      await this.bindings.requireRoute(terminal, route, true, true);
      return {
        job: await this.jobs.connectorJobPayload(
          terminal.merchantId,
          terminal.id,
          active.id,
          active.printerId,
          route.localBindingId,
          route.bindingVersion,
        ),
      };
    }

    let claimed: { id: bigint; printerId: bigint } | null = null;
    for (let round = 0; round < 3 && !claimed; round += 1) {
      claimed = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM merchants WHERE id = ${terminal.merchantId} FOR UPDATE`,
        );
        const now = new Date();
        const terminalRecord = await tx.merchantTerminal.findFirst({
          where: {
            id: terminal.id,
            merchantId: terminal.merchantId,
            status: 'ACTIVE',
            revokedAt: null,
            tokenVersion: terminal.tokenVersion,
            merchant: { status: 'ACTIVE', printingEnabled: true },
          },
          select: { id: true },
        });
        if (!terminalRecord) this.terminalDisabled();

        const activeJob = await tx.printJob.findFirst({
          where: {
            merchantId: terminal.merchantId,
            claimedByTerminalId: terminal.id,
            status: { in: ['CLAIMED', 'PRINTING'] },
            leaseExpiresAt: { gt: now },
          },
          orderBy: { claimedAt: 'asc' },
          select: { id: true, printerId: true },
        });
        if (activeJob) return activeJob;

        const printerIds = routes.map((route) => BigInt(route.printerId));
        const printers = await tx.printer.findMany({
          where: {
            id: { in: printerIds },
            merchantId: terminal.merchantId,
            channelType: { in: [...V2_LOCAL_CHANNELS] },
            deletedAt: null,
          },
        });
        if (printers.length !== routes.length) this.routeConflict();
        for (const route of routes) {
          const printer = printers.find(
            (candidate) => candidate.id === BigInt(route.printerId),
          );
          const binding = v2BindingMetadata(printer?.capabilities);
          if (
            !printer ||
            !binding ||
            binding.archivedAt ||
            binding.terminalId !== terminal.id.toString() ||
            binding.localBindingId !== route.localBindingId ||
            binding.bindingVersion !== route.bindingVersion
          ) {
            this.routeConflict();
          }
        }

        const candidate = await tx.printJob.findFirst({
          where: {
            merchantId: terminal.merchantId,
            printerId: { in: printerIds },
            status: 'PENDING',
            availableAt: { lte: now },
            retryBlocked: false,
            OR: [
              {
                source: 'TEST',
                printer: {
                  merchantId: terminal.merchantId,
                  status: 'ONLINE',
                  deletedAt: null,
                  channelType: { in: [...V2_LOCAL_CHANNELS] },
                },
              },
              {
                source: { in: ['MANUAL', 'MANUAL_REPRINT'] },
                printer: {
                  merchantId: terminal.merchantId,
                  enabled: true,
                  status: 'ONLINE',
                  deletedAt: null,
                  channelType: { in: [...V2_LOCAL_CHANNELS] },
                },
              },
              ...(automaticAllowed
                ? [
                    {
                      source: 'AUTOMATIC' as const,
                      printRule: { enabled: true, autoPrint: true },
                      printer: {
                        merchantId: terminal.merchantId,
                        enabled: true,
                        status: 'ONLINE' as const,
                        deletedAt: null,
                        channelType: { in: [...V2_LOCAL_CHANNELS] },
                      },
                    },
                  ]
                : []),
            ],
          },
          orderBy: [{ priority: 'asc' }, { availableAt: 'asc' }, { id: 'asc' }],
          select: { id: true, printerId: true, leaseVersion: true },
        });
        if (!candidate) return null;
        const leaseExpiresAt = new Date(
          now.getTime() +
            Math.min(120_000, Math.max(5_000, dto.leaseMs ?? 30_000)),
        );
        const changed = await tx.printJob.updateMany({
          where: {
            id: candidate.id,
            merchantId: terminal.merchantId,
            status: 'PENDING',
            leaseVersion: candidate.leaseVersion,
            merchant: { status: 'ACTIVE', printingEnabled: true },
          },
          data: {
            status: 'CLAIMED',
            claimedAt: now,
            claimedByTerminalId: terminal.id,
            leaseExpiresAt,
            leaseVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) return null;
        await tx.merchantTerminal.update({
          where: { id: terminal.id },
          data: { lastSeenAt: now },
        });
        return { id: candidate.id, printerId: candidate.printerId };
      });
    }
    if (!claimed) return { job: null };
    const route = requireSubmittedRoute(routes, claimed.printerId);
    return {
      job: await this.jobs.connectorJobPayload(
        terminal.merchantId,
        terminal.id,
        claimed.id,
        claimed.printerId,
        route.localBindingId,
        route.bindingVersion,
      ),
    };
  }

  private async routeForJob(
    terminal: AuthenticatedTerminal,
    printerId: bigint,
  ) {
    const printer = await this.prisma.printer.findFirst({
      where: {
        id: printerId,
        merchantId: terminal.merchantId,
        channelType: { in: [...V2_LOCAL_CHANNELS] },
        deletedAt: null,
      },
      select: { capabilities: true },
    });
    const binding = v2BindingMetadata(printer?.capabilities);
    if (!binding || binding.terminalId !== terminal.id.toString() || binding.archivedAt) {
      this.routeConflict();
    }
    return {
      printerId: printerId.toString(),
      localBindingId: binding.localBindingId,
      bindingVersion: binding.bindingVersion,
    };
  }

  private routeConflict(): never {
    throw new ConflictException({
      code: PRINTING_ERROR_CODES.BINDING_VERSION_CONFLICT,
      message: 'V2 Job route 与当前 Binding 不匹配',
    });
  }

  private terminalDisabled(): never {
    throw new ConflictException({
      code: PRINTING_ERROR_CODES.TERMINAL_DISABLED,
      message: '终端已停用、撤销或凭据已轮换',
    });
  }
}

function uniqueRoutes(routes: V2RouteIdentityDto[]) {
  const seen = new Set<string>();
  for (const route of routes) {
    if (seen.has(route.printerId)) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message: 'claim routes 不得重复 printerId',
      });
    }
    seen.add(route.printerId);
  }
  return routes;
}

function requireSubmittedRoute(
  routes: V2RouteIdentityDto[],
  printerId: bigint,
) {
  const route = routes.find(
    (candidate) => BigInt(candidate.printerId) === printerId,
  );
  if (!route) {
    throw new ConflictException({
      code: PRINTING_ERROR_CODES.PERMISSION_DENIED,
      message: '终端已有任务不属于本次提交的 routes',
    });
  }
  return route;
}
