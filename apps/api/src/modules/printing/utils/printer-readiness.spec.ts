import {
  hasExplicitUsbExecutionEvidence,
  printerReadiness,
} from './printer-readiness';

describe('printerReadiness', () => {
  const now = new Date('2026-07-15T12:00:00.000Z');

  it.each(['ONLINE'] as const)(
    'returns READY only for the explicit positive status %s',
    (status) => {
      expect(printerReadiness(printer({ status }), now).state).toBe('READY');
    },
  );

  it.each(['UNKNOWN', 'UNVERIFIED', 'OFFLINE', 'ERROR'] as const)(
    'fails closed for status %s',
    (status) => {
      expect(printerReadiness(printer({ status }), now).state).toBe(
        'DEVICE_OFFLINE',
      );
    },
  );

  it('classifies disabled and malformed USB printers as not configured', () => {
    expect(printerReadiness(printer({ enabled: false }), now).state).toBe(
      'NOT_CONFIGURED',
    );
    expect(
      printerReadiness(
        printer({ connectionConfig: { vendorId: 1234 } }),
        now,
      ).state,
    ).toBe('NOT_CONFIGURED');
  });

  it('classifies an unimplemented channel as unavailable, never READY', () => {
    expect(
      printerReadiness(
        printer({
          channelType: 'LOCAL_LAN_ESCPOS',
          status: 'ONLINE',
          connectionConfig: { host: '192.168.1.20', port: 9100 },
        }),
        now,
      ).state,
    ).toBe('DEVICE_OFFLINE');
  });

  it('expires positive connector evidence after 120 seconds without using a terminal heartbeat', () => {
    expect(
      printerReadiness(
        printer({
          capabilities: positiveCapabilities(
            new Date(now.getTime() - 120_001).toISOString(),
          ),
        }),
        now,
      ).state,
    ).toBe('DEVICE_OFFLINE');
  });
});

describe('hasExplicitUsbExecutionEvidence', () => {
  const complete = {
    usbDeviceRecognized: true,
    usbPermissionGranted: true,
    usbInterfaceValid: true,
    usbEndpointValid: true,
    appExecutionReady: true,
  };

  it('requires every positive USB and app execution signal', () => {
    expect(hasExplicitUsbExecutionEvidence(complete)).toBe(true);
    for (const key of Object.keys(complete)) {
      expect(
        hasExplicitUsbExecutionEvidence({ ...complete, [key]: false }),
      ).toBe(false);
    }
    expect(hasExplicitUsbExecutionEvidence(undefined)).toBe(false);
  });
});

function printer(overrides: Record<string, unknown> = {}) {
  return {
    channelType: 'LOCAL_USB_ESCPOS' as const,
    enabled: true,
    status: 'ONLINE' as const,
    connectionConfig: {},
    capabilities: positiveCapabilities('2026-07-15T12:00:00.000Z'),
    ...overrides,
  } as never;
}

function positiveCapabilities(updatedAt: string) {
  return {
    connectorStatusUpdatedAt: updatedAt,
    connectorStatus: {
      usbDeviceRecognized: true,
      usbPermissionGranted: true,
      usbInterfaceValid: true,
      usbEndpointValid: true,
      appExecutionReady: true,
    },
  };
}
