import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  BootstrapV2TerminalDto,
  ClaimV2PrintJobDto,
  ReportV2PrinterStatusDto,
  SyncV2BindingDto,
} from './v2-terminal-connector.dto';

describe('V2 terminal connector DTOs', () => {
  it('accepts the complete bootstrap contract and rejects non-canonical secrets', async () => {
    await expect(errors(BootstrapV2TerminalDto, {
      terminalInstanceId: 'd2.install-1',
      terminalSecret: 'a'.repeat(43),
      terminalName: 'D2 Front',
      deviceModel: 'D2',
      appVersion: '2.0.0-rc1',
      appVersionCode: 40,
      capabilities: { usb: true, lan: true, bluetoothClassic: true },
    })).resolves.toHaveLength(0);

    expect(await errors(BootstrapV2TerminalDto, {
      terminalInstanceId: 'd2.install-1',
      terminalSecret: `${'a'.repeat(42)}=`,
      appVersion: '2.0.0-rc1',
      capabilities: {},
    })).not.toHaveLength(0);
  });

  it.each([
    ['USB', { vendorId: 1155, productId: 22336 }],
    ['LAN', { host: '192.168.1.42', port: 9100 }],
    ['BLUETOOTH', {
      macAddress: 'AA:BB:CC:DD:EE:FF',
      deviceName: 'BT Printer',
      serviceUuid: '00001101-0000-1000-8000-00805F9B34FB',
    }],
  ])('accepts the generic %s binding envelope', async (transport, transportConfig) => {
    await expect(errors(SyncV2BindingDto, {
      localBindingId: 'binding-1',
      expectedBindingVersion: 0,
      transport,
      displayName: 'Front printer',
      paperWidth: 'MM80',
      transportConfig,
      appVersion: '2.0.0-rc1',
      appVersionCode: 40,
      status: 'CONNECTED',
      capabilities: {},
    })).resolves.toHaveLength(0);
  });

  it('validates every nested claim route and rejects unversioned identities', async () => {
    await expect(errors(ClaimV2PrintJobDto, {
      allowAutomatic: true,
      leaseMs: 60_000,
      routes: [{ printerId: '123', localBindingId: 'binding-1', bindingVersion: 1 }],
    })).resolves.toHaveLength(0);

    expect(await errors(ClaimV2PrintJobDto, {
      allowAutomatic: true,
      routes: [{ printerId: '123', localBindingId: 'binding-1', bindingVersion: 0 }],
    })).not.toHaveLength(0);
  });

  it.each(['PROBE', 'LOCAL_TEST', 'PRINT_RESULT'])('accepts status source %s', async (source) => {
    await expect(errors(ReportV2PrinterStatusDto, {
      printerId: '123',
      localBindingId: 'binding-1',
      bindingVersion: 1,
      status: 'CONNECTED',
      source,
      capabilities: {},
      lastErrorCode: null,
      lastErrorMessage: null,
    })).resolves.toHaveLength(0);
  });

  it('rejects unknown request fields so the route identity cannot drift', async () => {
    const validation = await errors(ReportV2PrinterStatusDto, {
      printerId: '123',
      localBindingId: 'binding-1',
      bindingVersion: 1,
      status: 'CONNECTED',
      source: 'PROBE',
      merchantId: '7',
    });
    expect(validation).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'merchantId' })]),
    );
  });
});

function errors(Dto: new () => object, payload: Record<string, unknown>) {
  return validate(plainToInstance(Dto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}
