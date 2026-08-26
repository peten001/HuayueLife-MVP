import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { TerminalAuthGuard } from '../guards/terminal-auth.guard';
import { ActiveTerminalGuard } from '../guards/active-terminal.guard';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import {
  TerminalConnectorController,
  TerminalPairingController,
} from './terminal-connector.controller';

const LARGE_RECEIPT_FIXTURE_BYTES = [
  1 * 1024 * 1024,
  2 * 1024 * 1024,
  5 * 1024 * 1024,
] as const;

describe('terminal connector controller contract', () => {
  it('keeps public pairing separate from Terminal-authenticated execution', () => {
    expect(Reflect.getMetadata(PATH_METADATA, TerminalPairingController)).toBe(
      'terminal',
    );
    expect(Reflect.getMetadata(PATH_METADATA, TerminalConnectorController)).toBe(
      'terminal',
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, TerminalConnectorController),
    ).toEqual([TerminalAuthGuard]);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, TerminalPairingController),
    ).toBeUndefined();
  });

  it('never accepts the merchant identity from connector request bodies', () => {
    const methods = Object.getOwnPropertyNames(
      TerminalConnectorController.prototype,
    );
    expect(methods).toEqual(
      expect.arrayContaining([
        'heartbeat',
        'config',
        'syncUsbBinding',
        'claim',
        'markPrinting',
        'markSucceeded',
        'markFailed',
        'extendLease',
        'reportPrinterStatus',
      ]),
    );
  });

  it('requires ACTIVE status only on execution and printer mutation routes', () => {
    for (const method of [
      'syncUsbBinding',
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
          TerminalConnectorController.prototype[method],
        ),
      ).toEqual([ActiveTerminalGuard]);
    }
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        TerminalConnectorController.prototype.syncUsbBinding,
      ),
    ).toBe('usb/bindings/sync');
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        TerminalConnectorController.prototype.heartbeat,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(GUARDS_METADATA, TerminalConnectorController.prototype.config),
    ).toBeUndefined();
  });

  it('rejects blind retry after any USB bytes may have been written', () => {
    const controller = new TerminalConnectorController(
      {} as never,
      {} as never,
      {} as never,
    );
    expect(() =>
      controller.markFailed(
        {
          id: 1n,
          merchantId: 2n,
          boundPrinterId: 3n,
          name: '终端',
          platform: 'ANDROID',
          status: 'ACTIVE',
          tokenVersion: 1,
        },
        { id: '4' },
        {
          attemptNo: 1,
          leaseVersion: 2,
          bytesWritten: 128,
          contentHash: 'a'.repeat(64),
          retryable: true,
          errorCode: 'USB_WRITE_FAILED',
          errorMessage: 'partial write',
          outcome: 'FAILED',
        },
      ),
    ).toThrow(BadRequestException);
  });

  it('does not accept a zero-byte success report', () => {
    const controller = new TerminalConnectorController(
      {} as never,
      {} as never,
      {} as never,
    );
    expect(() =>
      controller.markSucceeded(
        {
          id: 1n,
          merchantId: 2n,
          boundPrinterId: 3n,
          name: '终端',
          platform: 'ANDROID',
          status: 'ACTIVE',
          tokenVersion: 1,
        },
        { id: '4' },
        {
          attemptNo: 1,
          leaseVersion: 2,
          bytesWritten: 0,
          contentHash: 'a'.repeat(64),
        },
      ),
    ).toThrow(BadRequestException);
  });

  it('keeps heartbeat and USB printer-status responses as bounded control data', async () => {
    const connector = {
      heartbeat: jest.fn().mockResolvedValue({
        terminalId: 30n,
        serverTime: new Date('2026-08-25T12:00:00.000Z'),
        nextHeartbeatSeconds: 20,
        pollIntervalSeconds: 2,
        configVersion: 7,
      }),
      reportPrinterStatus: jest.fn().mockResolvedValue({
        printerId: 38n,
        reportedStatus: 'CONNECTED',
        persistedStatus: 'ONLINE',
        reportedAt: new Date('2026-08-25T12:00:00.000Z'),
      }),
    };
    const controller = new TerminalConnectorController(
      connector as never,
      {} as never,
      {} as never,
    );
    const terminal = {
      id: 30n,
      merchantId: 11n,
      boundPrinterId: 38n,
      name: '收银终端',
      platform: 'ANDROID' as const,
      status: 'ACTIVE' as const,
      tokenVersion: 1,
    };

    const heartbeat = await controller.heartbeat(terminal, {
      heartbeatSeq: 1,
      appVersion: '2.0.0-rc13',
    });
    const printerStatus = await controller.reportPrinterStatus(terminal, {
      printerId: '38',
      status: 'CONNECTED',
    });

    assertBoundedControlResponse(heartbeat);
    assertBoundedControlResponse(printerStatus);
  });

  it.each(
    LARGE_RECEIPT_FIXTURE_BYTES.flatMap((fixtureBytes) => [
      ['success', 'SUCCEEDED', 'markSucceeded', fixtureBytes] as const,
      ['failure', 'RETRY_WAIT', 'markFailed', fixtureBytes] as const,
    ]),
  )(
    'keeps USB %s acknowledgements bounded with a %i-byte print fixture',
    async (_label, status, method, fixtureBytes) => {
      const attempts = {
        [method]: jest.fn().mockResolvedValue({
          jobId: '1126',
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
        }),
      };
      const controller = new TerminalConnectorController(
        {} as never,
        {} as never,
        attempts as never,
      );
      const terminal = {
        id: 30n,
        merchantId: 11n,
        boundPrinterId: 38n,
        name: '收银终端',
        platform: 'ANDROID' as const,
        status: 'ACTIVE' as const,
        tokenVersion: 1,
      };
      const response =
        method === 'markSucceeded'
          ? await controller.markSucceeded(terminal, { id: '1126' }, {
              attemptNo: 1,
              leaseVersion: 2,
              bytesWritten: 109_237,
              contentHash: 'a'.repeat(64),
            })
          : await controller.markFailed(terminal, { id: '1126' }, {
              attemptNo: 1,
              leaseVersion: 2,
              bytesWritten: 0,
              contentHash: 'a'.repeat(64),
              retryable: true,
              errorCode: PRINTING_ERROR_CODES.NETWORK_TIMEOUT,
              errorMessage: 'timeout',
              outcome: 'FAILED',
            });

      expect(response).toEqual({ jobId: '1126', status });
      expect(Object.keys(response).sort()).toEqual(['jobId', 'status']);
      assertBoundedControlResponse(response);
    },
  );

  it.each(LARGE_RECEIPT_FIXTURE_BYTES)(
    'keeps USB lease renewal bounded with a %i-byte print fixture',
    async (fixtureBytes) => {
      const leaseExpiresAt = new Date('2026-08-25T12:00:00.000Z');
      const attempts = {
        extendLease: jest.fn().mockResolvedValue({
          leaseVersion: 7,
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
        }),
        markPrinting: jest.fn(),
      };
      const controller = new TerminalConnectorController(
        {} as never,
        {} as never,
        attempts as never,
      );

      const response = await controller.extendLease(
        {
          id: 30n,
          merchantId: 11n,
          boundPrinterId: 38n,
          name: '收银终端',
          platform: 'ANDROID',
          status: 'ACTIVE',
          tokenVersion: 1,
        },
        { id: '1126' },
        { leaseVersion: 6, leaseMs: 60_000 },
      );

      expect(response).toEqual({ leaseVersion: 7, leaseExpiresAt });
      expect(Object.keys(response).sort()).toEqual([
        'leaseExpiresAt',
        'leaseVersion',
      ]);
      assertBoundedControlResponse(response);
      expect(attempts.extendLease).toHaveBeenCalledWith(
        11n,
        30n,
        1126n,
        6,
        60_000,
      );
      expect(attempts.markPrinting).not.toHaveBeenCalled();
    },
  );
});

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
