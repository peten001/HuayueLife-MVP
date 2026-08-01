import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  channelForV2Transport,
  isV2LocalChannel,
  V2_LOCAL_CHANNELS,
  V2_TERMINAL_ADAPTERS,
  v2BindingMetadata,
} from './v2-terminal-binding';

describe('V2 terminal binding contract', () => {
  it('maps USB, LAN, and classic Bluetooth to distinct immutable channels/adapters', () => {
    expect(V2_LOCAL_CHANNELS).toEqual([
      'LOCAL_USB_ESCPOS',
      'LOCAL_LAN_ESCPOS',
      'LOCAL_BLUETOOTH_ESCPOS',
    ]);
    expect(channelForV2Transport('USB')).toBe('LOCAL_USB_ESCPOS');
    expect(channelForV2Transport('LAN')).toBe('LOCAL_LAN_ESCPOS');
    expect(channelForV2Transport('BLUETOOTH')).toBe('LOCAL_BLUETOOTH_ESCPOS');
    expect(V2_TERMINAL_ADAPTERS).toEqual({
      LOCAL_USB_ESCPOS: 'ANDROID_USB_ESCPOS',
      LOCAL_LAN_ESCPOS: 'ANDROID_LAN_ESCPOS',
      LOCAL_BLUETOOTH_ESCPOS: 'ANDROID_BLUETOOTH_ESCPOS',
    });
    expect(isV2LocalChannel('CLOUD_FEIE')).toBe(false);
  });

  it('fails closed on malformed, unversioned, or archived metadata', () => {
    const binding = {
      terminalId: '67',
      terminalInstanceId: 'd2.install-1',
      localBindingId: 'binding-1',
      bindingVersion: 1,
      transport: 'BLUETOOTH',
      endpointKey: 'bluetooth:AA:BB:CC:DD:EE:FF',
      bindingUpdatedAt: '2026-08-01T00:00:00.000Z',
    };
    expect(v2BindingMetadata({ v2Binding: binding })).toEqual(binding);
    expect(v2BindingMetadata({ v2Binding: { ...binding, bindingVersion: 0 } })).toBeNull();
    expect(v2BindingMetadata({ v2Binding: { ...binding, terminalId: '0' } })).toBeNull();
    expect(v2BindingMetadata({
      v2Binding: { ...binding, terminalId: '9223372036854775808' },
    })).toBeNull();
    expect(v2BindingMetadata({ v2Binding: { ...binding, archivedAt: 'invalid' } })).toBeNull();
  });

  it('adds Bluetooth through one additive migration without renaming old enum values', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const migration = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20260801000000_add_local_bluetooth_escpos_channel/migration.sql',
      ),
      'utf8',
    );
    const enumBlock = schema.match(/enum PrinterChannelType \{[\s\S]*?\}/)?.[0] ?? '';

    for (const channel of [
      'LOCAL_LAN_ESCPOS',
      'LOCAL_USB_ESCPOS',
      'CLOUD_FEIE',
      'CLOUD_YILIAN',
      'CLOUD_XINYE',
      'CLOUD_GPRINTER',
      'BUILTIN_SUNMI',
      'BUILTIN_IMIN',
      'LOCAL_BLUETOOTH_ESCPOS',
    ]) {
      expect(enumBlock).toContain(channel);
      expect(migration).toContain(`'${channel}'`);
    }
    expect(migration).toMatch(/ALTER TABLE `printers`[\s\S]*MODIFY `channel_type` ENUM/);
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i);
  });
});
