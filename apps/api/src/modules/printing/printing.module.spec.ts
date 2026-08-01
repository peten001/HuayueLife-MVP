import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { LanTerminalConnectorController } from './controllers/lan-terminal-connector.controller';
import { TerminalConnectorController } from './controllers/terminal-connector.controller';
import { MerchantPrintingController } from './controllers/merchant-printing.controller';
import { PrintingModule } from './printing.module';

describe('PrintingModule route registration', () => {
  it('registers the Terminal heartbeat controller exactly once without removing Merchant or LAN routes', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, PrintingModule) as unknown[];

    expect(controllers).toEqual(
      expect.arrayContaining([
        MerchantPrintingController,
        LanTerminalConnectorController,
        TerminalConnectorController,
      ]),
    );
    expect(controllers.filter((controller) => controller === TerminalConnectorController)).toHaveLength(1);
    expect(Reflect.getMetadata(PATH_METADATA, TerminalConnectorController)).toBe('terminal');
    expect(Reflect.getMetadata(PATH_METADATA, TerminalConnectorController.prototype.heartbeat)).toBe('heartbeat');
  });
});
