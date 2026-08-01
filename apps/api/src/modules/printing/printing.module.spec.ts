import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { LanTerminalConnectorController } from './controllers/lan-terminal-connector.controller';
import { MerchantPrintingController } from './controllers/merchant-printing.controller';
import {
  TerminalConnectorController,
  TerminalPairingController,
} from './controllers/terminal-connector.controller';
import { TerminalHeartbeatController } from './controllers/terminal-heartbeat.controller';
import { V2TerminalBootstrapController } from './controllers/v2-terminal-bootstrap.controller';
import { V2TerminalConnectorController } from './controllers/v2-terminal-connector.controller';
import { PrintingModule } from './printing.module';

describe('PrintingModule HTTP route registration', () => {
  it('registers the complete legacy and V2 controller sets together', () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      PrintingModule,
    );

    expect(controllers).toEqual([
      MerchantPrintingController,
      TerminalPairingController,
      TerminalHeartbeatController,
      TerminalConnectorController,
      LanTerminalConnectorController,
      V2TerminalBootstrapController,
      V2TerminalConnectorController,
    ]);
  });

  it('keeps legacy paths unchanged and adds only the isolated V2 prefixes', () => {
    expect(Reflect.getMetadata(PATH_METADATA, TerminalPairingController)).toBe('terminal');
    expect(Reflect.getMetadata(PATH_METADATA, TerminalHeartbeatController)).toBe('terminal');
    expect(Reflect.getMetadata(PATH_METADATA, TerminalConnectorController)).toBe('terminal');
    expect(Reflect.getMetadata(PATH_METADATA, LanTerminalConnectorController)).toBe('terminal/lan');
    expect(Reflect.getMetadata(PATH_METADATA, V2TerminalBootstrapController)).toBe(
      'merchant/printing/connector/v2',
    );
    expect(Reflect.getMetadata(PATH_METADATA, V2TerminalConnectorController)).toBe(
      'terminal/v2',
    );
    expect(Reflect.getMetadata(
      PATH_METADATA,
      TerminalHeartbeatController.prototype.heartbeat,
    )).toBe('heartbeat');
  });

  it('delegates the shared heartbeat without changing the legacy response', () => {
    const response = {
      terminalId: 67n,
      serverTime: new Date('2026-08-01T00:00:00.000Z'),
      nextHeartbeatSeconds: 20,
      pollIntervalSeconds: 5,
      configVersion: 3,
    };
    const connector = { heartbeat: jest.fn().mockReturnValue(response) };
    const controller = new TerminalHeartbeatController(connector as never);
    const terminal = {
      id: 67n,
      merchantId: 7n,
      boundPrinterId: 17n,
      name: 'D2',
      platform: 'ANDROID' as const,
      status: 'ACTIVE' as const,
      tokenVersion: 1,
    };
    const dto = { appVersion: '2.0.0-rc1', heartbeatSeq: 1 };

    expect(controller.heartbeat(terminal, dto)).toBe(response);
    expect(connector.heartbeat).toHaveBeenCalledWith(terminal, dto);
  });
});
