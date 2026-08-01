import { BadRequestException, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { LanActiveJobQueryDto } from '../dto/lan-terminal-connector.dto';
import { ActiveTerminalGuard } from '../guards/active-terminal.guard';
import { TerminalAuthGuard } from '../guards/terminal-auth.guard';
import { ANDROID_LAN_ESCPOS_ADAPTER } from '../types/lan-terminal-binding';
import { LanTerminalConnectorController } from './lan-terminal-connector.controller';

const terminal = {
  id: 67n,
  merchantId: 7n,
  boundPrinterId: null,
  name: 'D2 收银台',
  platform: 'ANDROID' as const,
  status: 'ACTIVE' as const,
  tokenVersion: 1,
};

describe('LanTerminalConnectorController contract', () => {
  it('passes a numeric query bindingVersion to the active-job service', async () => {
    const { controller, jobs } = createController();
    jobs.findActiveLanTerminalJob.mockResolvedValue(null);
    const query = plainToInstance(LanActiveJobQueryDto, {
      printerId: '17',
      localBindingId: 'binding-1',
      bindingVersion: '1',
    });

    await controller.activeJob(terminal, query);

    expect(query.bindingVersion).toBe(1);
    expect(typeof query.bindingVersion).toBe('number');
    expect(jobs.findActiveLanTerminalJob).toHaveBeenCalledWith(
      7n,
      67n,
      17n,
      'binding-1',
      1,
    );
  });

  it('exposes only the narrow Terminal-authenticated LAN namespace', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, LanTerminalConnectorController),
    ).toBe('terminal/lan');
    expect(
      Reflect.getMetadata(GUARDS_METADATA, LanTerminalConnectorController),
    ).toEqual([TerminalAuthGuard]);
    expect(controllerRoutes()).toEqual([
      ['POST', 'credential/renew'],
      ['GET', 'config'],
      ['POST', 'bindings/sync'],
      ['GET', 'jobs/active'],
      ['POST', 'jobs/claim'],
      ['POST', 'jobs/:id/printing'],
      ['POST', 'jobs/:id/succeeded'],
      ['POST', 'jobs/:id/failed'],
      ['POST', 'jobs/:id/extend'],
      ['POST', 'printers/status'],
    ]);
    for (const methodName of [
      'renewCredential',
      'syncBinding',
      'activeJob',
      'claim',
      'markPrinting',
      'markSucceeded',
      'markFailed',
      'extendLease',
      'reportPrinterStatus',
    ] as const) {
      expect(
        Reflect.getMetadata(
          GUARDS_METADATA,
          LanTerminalConnectorController.prototype[methodName],
        ),
      ).toEqual([ActiveTerminalGuard]);
    }
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        LanTerminalConnectorController.prototype.config,
      ),
    ).toBeUndefined();
  });

  it('derives terminal identity from CurrentTerminal and ignores a forged body terminalId', async () => {
    const { controller, jobs } = createController();
    jobs.claimNextLanTerminalJob.mockResolvedValue({ id: 301n });
    jobs.connectorJobPayload.mockResolvedValue({ id: 301n });

    await controller.claim(terminal, {
      printerId: '17',
      localBindingId: 'binding-1',
      bindingVersion: 3,
      allowAutomatic: false,
      terminalId: '999',
    } as never);

    expect(jobs.claimNextLanTerminalJob).toHaveBeenCalledWith(
      7n,
      67n,
      17n,
      'binding-1',
      3,
      undefined,
      false,
    );
    expect(jobs.connectorJobPayload).toHaveBeenCalledWith(
      7n,
      67n,
      301n,
      17n,
      'binding-1',
      3,
    );
    expect(jobs.claimNextLanTerminalJob).not.toHaveBeenCalledWith(
      expect.anything(),
      999n,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('renews only the authenticated terminal credential without accepting a body token', async () => {
    const { controller, credentials } = createController();
    credentials.renewLanTerminalCredential.mockResolvedValue({
      terminalId: '67',
      tokenVersion: 1,
      tokenExpiresAt: '2027-07-30T00:00:00.000Z',
      authorizationScheme: 'Terminal',
      renewed: true,
    });

    await controller.renewCredential(terminal, { requestId: 'renew-1' } as never);

    expect(credentials.renewLanTerminalCredential).toHaveBeenCalledWith(
      terminal,
      'renew-1',
    );
  });

  it('forces the canonical LAN adapter and forwards the complete route tuple', async () => {
    const { controller, attempts, jobs } = createController();
    attempts.markPrinting.mockResolvedValue({
      job: { id: 301n },
      attempt: { id: 901n },
    });
    jobs.connectorJobPayload.mockResolvedValue({ id: 301n });
    const contentHash = 'a'.repeat(64);

    await controller.markPrinting(
      terminal,
      { id: '301' },
      {
        printerId: '17',
        localBindingId: 'binding-1',
        bindingVersion: 3,
        leaseVersion: 4,
        contentHash,
        adapter: 'FORGED_ADAPTER',
      } as never,
    );

    expect(attempts.markPrinting).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 7n,
        terminalId: 67n,
        printerId: 17n,
        localBindingId: 'binding-1',
        bindingVersion: 3,
        adapter: ANDROID_LAN_ESCPOS_ADAPTER,
      }),
    );
  });

  it('rejects noncanonical LAN failure outcomes before service mutation', () => {
    const { controller, attempts } = createController();

    expect(() =>
      controller.markFailed(
        terminal,
        { id: '301' },
        {
          printerId: '17',
          localBindingId: 'binding-1',
          bindingVersion: 3,
          attemptNo: 1,
          leaseVersion: 4,
          bytesWritten: 12,
          contentHash: 'a'.repeat(64),
          retryable: true,
          errorCode: 'NETWORK_TIMEOUT',
          errorMessage: 'timeout',
          outcome: 'FAILED',
        },
      ),
    ).toThrow(BadRequestException);
    expect(attempts.markFailed).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range status printerId before Prisma-backed services', () => {
    const { controller, bindings } = createController();

    expect(() =>
      controller.reportPrinterStatus(terminal, {
        printerId: '9223372036854775808',
        localBindingId: 'binding-1',
        bindingVersion: 1,
        status: 'CONNECTED',
        serviceRunning: true,
        executionEnabled: true,
      }),
    ).toThrow(BadRequestException);
    expect(bindings.reportStatus).not.toHaveBeenCalled();
  });
});

function createController() {
  const credentials = { renewLanTerminalCredential: jest.fn() };
  const connector = { lanConfigFor: jest.fn() };
  const bindings = { sync: jest.fn(), reportStatus: jest.fn() };
  const jobs = {
    findActiveLanTerminalJob: jest.fn(),
    claimNextLanTerminalJob: jest.fn(),
    connectorJobPayload: jest.fn(),
  };
  const attempts = {
    markPrinting: jest.fn(),
    markSucceeded: jest.fn(),
    markFailed: jest.fn(),
    extendLease: jest.fn(),
  };
  return {
    credentials,
    connector,
    bindings,
    jobs,
    attempts,
    controller: new LanTerminalConnectorController(
      credentials as never,
      connector as never,
      bindings as never,
      jobs as never,
      attempts as never,
    ),
  };
}

function controllerRoutes(): Array<[string, string]> {
  const prototype = LanTerminalConnectorController.prototype as unknown as Record<
    string,
    unknown
  >;
  return Object.getOwnPropertyNames(LanTerminalConnectorController.prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => prototype[name])
    .filter((handler): handler is (...args: unknown[]) => unknown =>
      typeof handler === 'function',
    )
    .map((handler) => [
      RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod],
      Reflect.getMetadata(PATH_METADATA, handler) as string,
    ])
    .filter((route) => route[1] !== undefined) as Array<[string, string]>;
}
