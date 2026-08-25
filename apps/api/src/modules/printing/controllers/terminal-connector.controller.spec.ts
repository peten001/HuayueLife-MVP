import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { TerminalAuthGuard } from '../guards/terminal-auth.guard';
import { ActiveTerminalGuard } from '../guards/active-terminal.guard';
import {
  TerminalConnectorController,
  TerminalPairingController,
} from './terminal-connector.controller';

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

  it('keeps USB lease renewal responses bounded and free of print artifacts', async () => {
    const leaseExpiresAt = new Date('2026-08-25T12:00:00.000Z');
    const attempts = {
      extendLease: jest.fn().mockResolvedValue({
        id: 1126n,
        status: 'CLAIMED',
        leaseVersion: 7,
        leaseExpiresAt,
        renderedPayload: Buffer.alloc(1_100_000),
        renderedPayloadBase64: 'x'.repeat(1_100_000),
        receiptSnapshot: { document: 'PrintDocument', body: 'x'.repeat(1_100_000) },
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
    const serialized = JSON.stringify(response);
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThan(16 * 1024);
    expect(Object.keys(response).sort()).toEqual(['leaseExpiresAt', 'leaseVersion']);
    expect(serialized).not.toMatch(
      /renderedPayload|renderedPayloadBase64|receiptSnapshot|PrintDocument|document/i,
    );
    expect(attempts.extendLease).toHaveBeenCalledWith(11n, 30n, 1126n, 6, 60_000);
    expect(attempts.markPrinting).not.toHaveBeenCalled();
  });
});
