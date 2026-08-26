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
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import { LanTerminalConnectorController } from './lan-terminal-connector.controller';

const LARGE_RECEIPT_FIXTURE_BYTES = [
  1 * 1024 * 1024,
  2 * 1024 * 1024,
  5 * 1024 * 1024,
  10 * 1024 * 1024,
] as const;

const terminal = {
  id: 67n,
  merchantId: 7n,
  boundPrinterId: null,
  name: 'D2 收银台',
  platform: 'ANDROID' as const,
  status: 'ACTIVE' as const,
  tokenVersion: 1,
  appVersion: '2.0.0-rc13',
};

const request = { requestId: 'req-lan-capacity' } as never;

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

  it.each(
    LARGE_RECEIPT_FIXTURE_BYTES.flatMap((fixtureBytes) => [
      ['success', 'SUCCEEDED', 'markSucceeded', fixtureBytes] as const,
      ['failure', 'RETRY_WAIT', 'markFailed', fixtureBytes] as const,
    ]),
  )(
    'keeps LAN %s acknowledgements bounded with a %i-byte print fixture',
    async (_label, status, method, fixtureBytes) => {
      const { controller, attempts } = createController();
      attempts[method].mockResolvedValue({
        jobId: '1136',
        status,
        renderedPayload: Buffer.alloc(fixtureBytes),
        renderedPayloadBase64: 'x'.repeat(fixtureBytes),
        receiptSnapshot: {
          document: 'PrintDocument',
          body: 'x'.repeat(fixtureBytes),
        },
        printDocument: { body: 'x'.repeat(fixtureBytes) },
        artifact: Buffer.alloc(fixtureBytes),
        payloadBase64: 'x'.repeat(fixtureBytes),
      });
      const response =
        method === 'markSucceeded'
          ? await controller.markSucceeded(terminal, { id: '1136' }, {
              printerId: '37',
              localBindingId: 'binding-1',
              bindingVersion: 1,
              attemptNo: 1,
              leaseVersion: 2,
              bytesWritten: 109_237,
              contentHash: 'a'.repeat(64),
            })
          : await controller.markFailed(terminal, { id: '1136' }, {
              printerId: '37',
              localBindingId: 'binding-1',
              bindingVersion: 1,
              attemptNo: 1,
              leaseVersion: 2,
              bytesWritten: 0,
              contentHash: 'a'.repeat(64),
              retryable: true,
              errorCode: PRINTING_ERROR_CODES.NETWORK_TIMEOUT,
              errorMessage: 'timeout',
              outcome: 'FAILED',
            });

      expect(response).toEqual({ jobId: '1136', status });
      expect(Object.keys(response).sort()).toEqual(['jobId', 'status']);
      assertBoundedControlResponse(response);
    },
  );

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

  it('keeps LAN printer-status responses as bounded control data', async () => {
    const { controller, bindings } = createController();
    bindings.reportStatus.mockResolvedValue({
      printerId: 37n,
      reportedStatus: 'CONNECTED',
      persistedStatus: 'ONLINE',
      reportedAt: new Date('2026-08-25T12:00:00.000Z'),
    });

    const response = await controller.reportPrinterStatus(terminal, {
      printerId: '37',
      localBindingId: 'binding-1',
      bindingVersion: 1,
      status: 'CONNECTED',
      serviceRunning: true,
      executionEnabled: true,
    });

    assertBoundedControlResponse(response);
  });

  it.each(LARGE_RECEIPT_FIXTURE_BYTES)(
    'keeps LAN lease renewal bounded with a %i-byte print fixture',
    async (fixtureBytes) => {
      const leaseExpiresAt = new Date('2026-08-25T12:00:00.000Z');
      const { controller, attempts } = createController();
      attempts.extendLease.mockResolvedValue({
        leaseVersion: 9,
        leaseExpiresAt,
        renderedPayload: Buffer.alloc(fixtureBytes),
        renderedPayloadBase64: 'x'.repeat(fixtureBytes),
        receiptSnapshot: {
          document: 'PrintDocument',
          body: 'x'.repeat(fixtureBytes),
        },
        printDocument: { body: 'x'.repeat(fixtureBytes) },
        artifact: Buffer.alloc(fixtureBytes),
        payloadBase64: 'x'.repeat(fixtureBytes),
      });

      const response = await controller.extendLease(
        terminal,
        { id: '1136' },
        {
          printerId: '37',
          localBindingId: 'binding-1',
          bindingVersion: 1,
          leaseVersion: 8,
          leaseMs: 60_000,
        },
      );

      expect(response).toEqual({ leaseVersion: 9, leaseExpiresAt });
      expect(Object.keys(response).sort()).toEqual([
        'leaseExpiresAt',
        'leaseVersion',
      ]);
      assertBoundedControlResponse(response);
      expect(attempts.extendLease).toHaveBeenCalledWith(
        7n,
        67n,
        1136n,
        8,
        60_000,
        'binding-1',
        1,
        37n,
      );
      expect(attempts.markPrinting).not.toHaveBeenCalled();
    },
  );
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

function assertBoundedControlResponse(response: Record<string, unknown>) {
  const serialized = JSON.stringify(
    {
      code: 'OK',
      message: 'success',
      data: response,
      requestId: `req_${'x'.repeat(32)}`,
      timestamp: '2026-08-25T12:00:00.000Z',
    },
    (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
  );
  expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThan(16 * 1024);
  expect(serialized).not.toMatch(
    /renderedPayload|receiptSnapshot|printDocument|semanticDocument|artifact|payloadBase64|snapshot/i,
  );
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
