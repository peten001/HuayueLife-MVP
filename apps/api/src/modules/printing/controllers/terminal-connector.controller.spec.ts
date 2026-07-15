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
});
