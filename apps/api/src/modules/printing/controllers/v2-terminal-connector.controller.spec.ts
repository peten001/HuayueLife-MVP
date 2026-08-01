import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ActiveTerminalGuard } from '../guards/active-terminal.guard';
import { TerminalAuthGuard } from '../guards/terminal-auth.guard';
import { TerminalHeartbeatAuthGuard } from '../guards/terminal-heartbeat-auth.guard';
import { V2TerminalAuthGuard } from '../guards/v2-terminal-auth.guard';
import { TerminalConnectorController } from './terminal-connector.controller';
import { TerminalHeartbeatController } from './terminal-heartbeat.controller';
import { V2TerminalConnectorController } from './v2-terminal-connector.controller';

describe('V2 terminal connector controller contract', () => {
  it('isolates V2 Bearer routes while leaving legacy routes on Terminal auth', () => {
    expect(Reflect.getMetadata(PATH_METADATA, V2TerminalConnectorController)).toBe(
      'terminal/v2',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, V2TerminalConnectorController)).toEqual([
      V2TerminalAuthGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, TerminalConnectorController)).toEqual([
      TerminalAuthGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, TerminalHeartbeatController)).toEqual([
      TerminalHeartbeatAuthGuard,
    ]);
  });

  it('requires an active terminal for every V2 mutation and execution route', () => {
    for (const method of [
      'syncBinding',
      'archiveBinding',
      'reportStatus',
      'active',
      'claim',
      'markPrinting',
      'markSucceeded',
      'markFailed',
      'extendLease',
    ] as const) {
      expect(Reflect.getMetadata(
        GUARDS_METADATA,
        V2TerminalConnectorController.prototype[method],
      )).toEqual([ActiveTerminalGuard]);
    }
    expect(Reflect.getMetadata(
      GUARDS_METADATA,
      V2TerminalConnectorController.prototype.config,
    )).toBeUndefined();
  });

  it('derives adapters server-side and forbids unsafe or uncertain retry reports', async () => {
    const bindings = {
      requireRoute: jest.fn().mockResolvedValue({
        printer: { channelType: 'LOCAL_BLUETOOTH_ESCPOS' },
      }),
      adapterFor: jest.fn().mockReturnValue('ANDROID_BLUETOOTH_ESCPOS'),
    };
    const attempts = { markFailed: jest.fn() };
    const controller = new V2TerminalConnectorController(
      bindings as never,
      {} as never,
      {} as never,
      attempts as never,
    );
    const terminal = terminalAuth();
    const route = {
      printerId: '17',
      localBindingId: 'binding-bt-1',
      bindingVersion: 1,
      attemptNo: 1,
      leaseVersion: 2,
      bytesWritten: 32,
      contentHash: 'a'.repeat(64),
      retryable: true,
      errorCode: 'PRINT_OUTCOME_UNKNOWN' as const,
      errorMessage: 'result unknown',
      outcome: 'UNCERTAIN' as const,
    };

    await expect(
      controller.markFailed(terminal, { id: '301' }, route),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bindings.requireRoute).not.toHaveBeenCalled();
    expect(attempts.markFailed).not.toHaveBeenCalled();
  });
});

function terminalAuth() {
  return {
    id: 67n,
    merchantId: 7n,
    boundPrinterId: null,
    name: 'D2',
    platform: 'ANDROID' as const,
    status: 'ACTIVE' as const,
    tokenVersion: 1,
  };
}
