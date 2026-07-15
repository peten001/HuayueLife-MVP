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
} from '@nestjs/common/constants';
import { StaffRole } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { MERCHANT_ROLES_KEY } from '../../../common/decorators/merchant-roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../../common/guards/merchant-role.guard';
import { ActiveMerchantStaffGuard } from '../guards/active-merchant-staff.guard';
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

  it('exposes management routes and merchant-session connector routes without terminal pairing', () => {
    const routes = controllerRoutes();

    expect(routes).toEqual(
      expect.arrayContaining([
        ['GET', 'printers'],
        ['GET', 'feature-state'],
        ['GET', 'settings'],
        ['PATCH', 'settings'],
        ['POST', 'printers'],
        ['GET', 'printers/:id'],
        ['PATCH', 'printers/:id'],
        ['POST', 'printers/:id/disable'],
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
        ['GET', 'connector/jobs/active'],
        ['POST', 'connector/jobs/claim'],
        ['POST', 'connector/jobs/:id/printing'],
        ['POST', 'connector/jobs/:id/succeeded'],
        ['POST', 'connector/jobs/:id/failed'],
        ['POST', 'connector/jobs/:id/extend-lease'],
        ['POST', 'connector/printers/status'],
      ]),
    );
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
      ]),
    );
  });

  it('passes the authenticated merchant and staff scope to service calls', async () => {
    const printers = serviceMock(['list']);
    const templates = serviceMock([]);
    const rules = serviceMock([]);
    const jobs = serviceMock(['retry']);
    const attempts = serviceMock([]);
    const flags = { status: jest.fn() };
    const settings = {
      get: jest.fn().mockResolvedValue({ printingEnabled: false }),
    };
    printers.list.mockResolvedValue([]);
    jobs.retry.mockResolvedValue({ id: 301n });
    const controller = new MerchantPrintingController(
      printers as never,
      templates as never,
      rules as never,
      jobs as never,
      attempts as never,
      flags as never,
      settings as never,
    );

    await controller.listPrinters(7n);
    await controller.retryJob(
      7n,
      { sub: '3' } as never,
      { requestId: 'request-1' } as never,
      { id: '301' },
      { reason: '排除故障后重试' },
    );

    expect(printers.list).toHaveBeenCalledWith(7n);
    expect(jobs.retry).toHaveBeenCalledWith(
      7n,
      3n,
      'request-1',
      301n,
      '排除故障后重试',
    );

    flags.status.mockReturnValue({ legacyPrintingEnabled: false });
    await expect(controller.featureState(7n)).resolves.toEqual({
      legacyPrintingEnabled: false,
      merchantPrintingEnabled: false,
    });
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
    );

    await expect(controller.listPrinters(7n)).resolves.toEqual([{ id: 1n }]);
    expect(flags.status()).toEqual({ legacyPrintingEnabled: false });
  });

  it('requires owner or manager for configuration mutations', () => {
    for (const methodName of [
      'createPrinter',
      'createPrinterTestJob',
      'updatePrinter',
      'disablePrinter',
      'createTemplate',
      'updateTemplate',
      'duplicateTemplate',
      'createRule',
      'updateRule',
      'enableRule',
      'disableRule',
      'cancelJob',
      'updateSettings',
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

  it('returns 403 semantics when STAFF attempts an owner/manager configuration method', () => {
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
      MerchantPrintingController.prototype.createPrinter,
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
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
