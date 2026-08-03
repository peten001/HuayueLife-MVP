import {
  ExecutionContext,
  ForbiddenException,
  RequestMethod,
  UnauthorizedException,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { StaffRole } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MERCHANT_ROLES_KEY } from '../../../common/decorators/merchant-roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../../common/guards/merchant-role.guard';
import { ClaimPrintJobDto } from '../dto/terminal-connector.dto';
import { ActiveMerchantStaffGuard } from '../guards/active-merchant-staff.guard';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import { MerchantPrintingController } from './merchant-printing.controller';

describe('MerchantPrintingController contract', () => {
  it('uses the isolated merchant printing namespace and merchant guards', () => {
    expect(Reflect.getMetadata(PATH_METADATA, MerchantPrintingController)).toBe(
      'merchant/printing',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, MerchantPrintingController)).toEqual([
      JwtAuthGuard,
      ActiveMerchantStaffGuard,
      MerchantRoleGuard,
    ]);
    expect(Reflect.getMetadata(MERCHANT_ROLES_KEY, MerchantPrintingController)).toEqual([
      StaffRole.OWNER,
      StaffRole.MANAGER,
      StaffRole.STAFF,
    ]);
  });

  it('exposes bootstrap and USB merchant-session routes without LAN terminal execution routes', () => {
    const routes = controllerRoutes();

    expect(routes).toEqual(
      expect.arrayContaining([
        ['GET', 'printers'],
        ['GET', 'feature-state'],
        ['GET', 'cloud-execution-state'],
        ['GET', 'settings'],
        ['PATCH', 'settings'],
        ['PATCH', 'automatic-creation'],
        ['POST', 'printers'],
        ['GET', 'printers/:id'],
        ['PATCH', 'printers/:id'],
        ['POST', 'printers/:id/enable'],
        ['POST', 'printers/:id/disable'],
        ['POST', 'printers/:id/archive'],
        ['POST', 'printers/:id/test-job'],
        ['GET', 'templates'],
        ['POST', 'templates'],
        ['GET', 'templates/:id'],
        ['PATCH', 'templates/:id'],
        ['POST', 'templates/:id/duplicate'],
        ['GET', 'rules'],
        ['POST', 'rules'],
        ['PATCH', 'rules/:id'],
        ['POST', 'rules/:id/enable'],
        ['POST', 'rules/:id/disable'],
        ['GET', 'jobs'],
        ['GET', 'jobs/:id'],
        ['POST', 'jobs/:id/cancel'],
        ['POST', 'jobs/:id/retry'],
        ['POST', 'jobs/order'],
        ['POST', 'jobs/table-bill'],
        ['POST', 'jobs/:id/reprint'],
        ['GET', 'connector/config'],
        ['POST', 'connector/lan-terminal/bootstrap'],
        ['GET', 'connector/jobs/active'],
        ['POST', 'connector/jobs/claim'],
        ['POST', 'connector/jobs/:id/printing'],
        ['POST', 'connector/jobs/:id/succeeded'],
        ['POST', 'connector/jobs/:id/failed'],
        ['POST', 'connector/jobs/:id/extend-lease'],
        ['POST', 'connector/printers/status'],
      ]),
    );
    expect(routes).not.toContainEqual(['POST', 'connector/lan-bindings/sync']);
    expect(routes.flat().join(' ')).not.toMatch(
      /terminals|pairing-code|rotate-credentials|heartbeat/i,
    );

    const methods = Object.getOwnPropertyNames(MerchantPrintingController.prototype);
    expect(methods).not.toEqual(
      expect.arrayContaining([
        'createTerminal',
        'updateTerminal',
        'generateTerminalPairingCode',
        'rotateTerminalCredentials',
        'heartbeat',
        'syncLanBinding',
      ]),
    );

    const activeArgs = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      MerchantPrintingController,
      'activeConnectorJob',
    ) as Record<string, { data?: string }>;
    const queryNames = Object.values(activeArgs).map((entry) => entry.data);
    expect(queryNames).toContain('printerId');
    expect(queryNames).not.toContain('terminalId');
  });

  it('passes the authenticated merchant and staff scope to service calls', async () => {
    const printers = serviceMock(['list']);
    const templates = serviceMock([]);
    const rules = serviceMock([]);
    const jobs = serviceMock(['retry']);
    const attempts = serviceMock([]);
    const flags = { status: jest.fn() };
    const settings = {
      get: jest.fn().mockResolvedValue({
        printingEnabled: false,
        automaticCreationEnabled: true,
      }),
      updateAutomaticCreation: jest.fn().mockResolvedValue({ automaticCreationEnabled: true }),
    };
    const cloudExecution = {
      status: jest.fn().mockReturnValue({
        enabled: true,
        providers: {
          FEIE: { enabled: true, configured: true },
          YILIAN: { enabled: false, configured: false },
        },
      }),
    };
    printers.list.mockResolvedValue([]);
    jobs.retry.mockResolvedValue({ id: 301n });
    const terminalCredentials = serviceMock(['bootstrapLanTerminal']);
    terminalCredentials.bootstrapLanTerminal.mockResolvedValue({
      terminalId: '67',
    });
    const controller = new MerchantPrintingController(
      printers as never,
      templates as never,
      rules as never,
      jobs as never,
      attempts as never,
      flags as never,
      settings as never,
      cloudExecution as never,
      terminalCredentials as never,
    );

    await controller.listPrinters(7n);
    await controller.retryJob(
      7n,
      { sub: '3' } as never,
      { requestId: 'request-1' } as never,
      { id: '301' },
      { reason: '排除故障后重试' },
    );
    const bootstrapDto = {
      terminalInstanceId: 'install-uuid-1',
      terminalSecret: 'a'.repeat(43),
      appVersion: '1.0.0-rc7.3',
    };
    await controller.bootstrapLanTerminal(
      7n,
      { sub: '3' } as never,
      { requestId: 'request-bootstrap' } as never,
      bootstrapDto,
    );

    expect(printers.list).toHaveBeenCalledWith(7n);
    expect(jobs.retry).toHaveBeenCalledWith(
      7n,
      3n,
      'request-1',
      301n,
      '排除故障后重试',
    );
    expect(terminalCredentials.bootstrapLanTerminal).toHaveBeenCalledWith(
      7n,
      3n,
      'request-bootstrap',
      bootstrapDto,
    );

    flags.status.mockReturnValue({
      taskCenterEnabled: true,
      automaticCreationEnabled: false,
      executionEnabled: true,
      legacyPrintingEnabled: false,
      lanPrintingEnabled: true,
      executionState: 'READY_FOR_CONNECTOR',
    });
    await expect(controller.featureState(7n)).resolves.toEqual({
      legacyPrintingEnabled: false,
      merchantPrintingEnabled: false,
      automaticCreationEnabled: true,
      taskCenterEnabled: true,
      executionEnabled: true,
      lanPrintingEnabled: true,
      executionState: 'READY_FOR_CONNECTOR',
    });
    expect(controller.cloudExecutionState()).toEqual({
      enabled: true,
      providers: {
        FEIE: { enabled: true, configured: true },
        YILIAN: { enabled: false, configured: false },
      },
    });

    await expect(
      controller.updateAutomaticCreation(11n, { automaticCreationEnabled: true }),
    ).resolves.toEqual({ automaticCreationEnabled: true });
    expect(settings.updateAutomaticCreation).toHaveBeenCalledWith(11n, true);
  });

  it('keeps the new printing API available while legacy printing is disabled', async () => {
    const printers = serviceMock(['list']);
    printers.list.mockResolvedValue([{ id: 1n }]);
    const flags = {
      status: jest.fn().mockReturnValue({ legacyPrintingEnabled: false }),
    };
    const controller = new MerchantPrintingController(
      printers as never,
      serviceMock([]) as never,
      serviceMock([]) as never,
      serviceMock([]) as never,
      serviceMock([]) as never,
      flags as never,
      { get: jest.fn() } as never,
      { status: jest.fn() } as never,
      serviceMock([]) as never,
    );

    await expect(controller.listPrinters(7n)).resolves.toEqual([{ id: 1n }]);
    expect(flags.status()).toEqual({ legacyPrintingEnabled: false });
  });

  it('keeps spoofed merchant-session terminal identity out of every connector call', async () => {
    const jobs = serviceMock([
      'findActiveMerchantConnectorJob',
      'connectorJobPayload',
      'claimNextMerchantJob',
    ]);
    const attempts = serviceMock([
      'markPrinting',
      'markSucceeded',
      'markFailed',
      'extendLease',
    ]);
    jobs.findActiveMerchantConnectorJob.mockResolvedValue({ id: 101n });
    jobs.claimNextMerchantJob.mockResolvedValue({ id: 102n });
    jobs.connectorJobPayload.mockResolvedValue({ id: 101n });
    attempts.markPrinting.mockResolvedValue({
      job: { id: 103n },
      attempt: { attemptNo: 1 },
    });
    attempts.markSucceeded.mockResolvedValue({ id: 103n, status: 'SUCCEEDED' });
    attempts.markFailed.mockResolvedValue({ id: 104n, status: 'FAILED' });
    attempts.extendLease.mockResolvedValue({ id: 105n, status: 'CLAIMED' });
    const controller = new MerchantPrintingController(
      serviceMock([]) as never,
      serviceMock([]) as never,
      serviceMock([]) as never,
      jobs as never,
      attempts as never,
      serviceMock([]) as never,
      serviceMock([]) as never,
      serviceMock([]) as never,
      serviceMock([]) as never,
    );
    const forgedTerminalId = '999999';
    const contentHash = 'a'.repeat(64);

    await controller.activeConnectorJob(7n, '12');
    await controller.claimConnectorJob(7n, {
      allowAutomatic: false,
      printerId: '12',
      leaseMs: 30_000,
      terminalId: forgedTerminalId,
    } as never);
    await controller.markConnectorPrinting(
      7n,
      { id: '103' },
      {
        leaseVersion: 1,
        adapter: 'LOCAL_USB_ESCPOS',
        contentHash,
        terminalId: forgedTerminalId,
      } as never,
    );
    await controller.markConnectorSucceeded(
      7n,
      { id: '103' },
      {
        attemptNo: 1,
        leaseVersion: 1,
        bytesWritten: 64,
        contentHash,
        terminalId: forgedTerminalId,
      } as never,
    );
    await controller.markConnectorFailed(
      7n,
      { id: '104' },
      {
        attemptNo: 1,
        leaseVersion: 1,
        bytesWritten: 0,
        contentHash,
        retryable: true,
        errorCode: PRINTING_ERROR_CODES.NETWORK_TIMEOUT,
        errorMessage: '连接超时',
        outcome: 'FAILED',
        terminalId: forgedTerminalId,
      } as never,
    );
    await controller.extendConnectorLease(
      7n,
      { id: '105' },
      {
        leaseVersion: 1,
        leaseMs: 30_000,
        terminalId: forgedTerminalId,
      } as never,
    );

    expect(jobs.findActiveMerchantConnectorJob).toHaveBeenCalledWith(7n, 12n, null);
    expect(jobs.connectorJobPayload.mock.calls).toEqual(
      expect.arrayContaining([
        [7n, null, 101n],
        [7n, null, 102n],
        [7n, null, 103n],
      ]),
    );
    const claimCall = jobs.claimNextMerchantJob.mock.calls[0];
    expect(claimCall).toEqual([7n, 12n, 30_000, false]);
    expect(claimCall[4] ?? null).toBeNull();
    expect(attempts.markPrinting).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 7n, terminalId: null, jobId: 103n }),
    );
    expect(attempts.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 7n, terminalId: null, jobId: 103n }),
    );
    expect(attempts.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 7n, terminalId: null, jobId: 104n }),
    );
    expect(attempts.extendLease).toHaveBeenCalledWith(
      7n,
      null,
      105n,
      1,
      30_000,
    );
    expect(serializedCalls(jobs, attempts)).not.toContain(forgedTerminalId);
  });

  it('rejects terminal identity fields as non-whitelisted merchant claim input', async () => {
    const dto = plainToInstance(ClaimPrintJobDto, {
      allowAutomatic: false,
      printerId: '12',
      terminalId: '999999',
      localBindingId: 'lan-binding-1',
      bindingVersion: 3,
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['terminalId', 'localBindingId', 'bindingVersion']),
    );
  });

  it('requires owner or manager for configuration mutations', () => {
    for (const methodName of [
      'createPrinter',
      'createPrinterTestJob',
      'updatePrinter',
      'enablePrinter',
      'disablePrinter',
      'archivePrinter',
      'createTemplate',
      'updateTemplate',
      'duplicateTemplate',
      'createRule',
      'updateRule',
      'enableRule',
      'disableRule',
      'cancelJob',
      'updateSettings',
      'updateAutomaticCreation',
      'cloudExecutionState',
      'bootstrapLanTerminal',
    ] as const) {
      expect(
        Reflect.getMetadata(
          MERCHANT_ROLES_KEY,
          MerchantPrintingController.prototype[methodName],
        ),
      ).toEqual([StaffRole.OWNER, StaffRole.MANAGER]);
    }
  });

  it('returns 401 semantics when no bearer token is present', () => {
    const guard = new JwtAuthGuard({ verify: jest.fn() } as unknown as JwtService);
    const context = executionContext(
      { header: jest.fn().mockReturnValue(undefined) },
      MerchantPrintingController.prototype.listPrinters,
    );

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('returns 403 semantics when STAFF attempts to bootstrap a long-lived terminal credential', () => {
    const guard = new MerchantRoleGuard(new Reflector());
    const context = executionContext(
      {
        user: {
          sub: '3',
          accountType: 'MERCHANT_STAFF',
          merchantId: '7',
          role: StaffRole.STAFF,
        },
      },
      MerchantPrintingController.prototype.bootstrapLanTerminal,
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it.each([
    [StaffRole.OWNER, true],
    [StaffRole.MANAGER, true],
    [StaffRole.STAFF, false],
  ] as const)('enforces printer archive permission for %s', (role, allowed) => {
    const guard = new MerchantRoleGuard(new Reflector());
    const context = executionContext(
      {
        user: {
          sub: '3',
          accountType: 'MERCHANT_STAFF',
          merchantId: '7',
          role,
        },
      },
      MerchantPrintingController.prototype.archivePrinter,
    );

    if (allowed) expect(guard.canActivate(context)).toBe(true);
    else expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it.each([StaffRole.OWNER, StaffRole.MANAGER])(
    'allows %s to bootstrap a long-lived terminal credential',
    (role) => {
      const guard = new MerchantRoleGuard(new Reflector());
      const context = executionContext(
        {
          user: {
            sub: '3',
            accountType: 'MERCHANT_STAFF',
            merchantId: '7',
            role,
          },
        },
        MerchantPrintingController.prototype.bootstrapLanTerminal,
      );

      expect(guard.canActivate(context)).toBe(true);
    },
  );
});

function controllerRoutes(): Array<[string, string]> {
  const prototype = MerchantPrintingController.prototype as unknown as Record<
    string,
    unknown
  >;
  return Object.getOwnPropertyNames(MerchantPrintingController.prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => prototype[name])
    .filter((handler): handler is (...args: unknown[]) => unknown =>
      typeof handler === 'function',
    )
    .map((handler) => [
      RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod],
      Reflect.getMetadata(PATH_METADATA, handler) as string,
    ]);
}

function serviceMock(methods: string[]) {
  return Object.fromEntries(methods.map((method) => [method, jest.fn()])) as Record<
    string,
    jest.Mock
  >;
}

function serializedCalls(...services: Array<Record<string, jest.Mock>>) {
  return JSON.stringify(
    services.flatMap((service) =>
      Object.values(service).flatMap((method) => method.mock.calls),
    ),
    (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
  );
}

function executionContext(
  request: Record<string, unknown>,
  handler: (...args: never[]) => unknown,
) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => MerchantPrintingController,
  } as unknown as ExecutionContext;
}
