import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

try {
  const {
    printerConfigurationState,
    printerConnectionState,
    printerLastConnectedAt,
    resolvePrintingCenterSummary,
  } = await server.ssrLoadModule('/src/utils/printing-status.ts');

  const now = Date.parse('2026-07-24T10:00:00.000Z');
  const evidenceUpdatedAt = '2026-07-24T09:59:30.000Z';
  const printer = (overrides = {}, evidence = {}) => ({
    id: '1',
    name: 'Front USB',
    channelType: 'LOCAL_USB_ESCPOS',
    paperWidth: 'MM80',
    purpose: 'FRONT_DESK',
    enabled: true,
    status: 'ONLINE',
    connectionConfig: {},
    capabilities: {
      connectorStatus: {
        usbDeviceRecognized: true,
        usbPermissionGranted: true,
        usbInterfaceValid: true,
        usbEndpointValid: true,
        appExecutionReady: true,
        ...evidence,
      },
    },
    readiness: {
      state: 'READY',
      channelImplemented: true,
      configValid: true,
      statusReady: true,
      executionEvidenceReady: true,
      evidenceUpdatedAt,
      evidenceTtlMs: 120_000,
    },
    createdAt: evidenceUpdatedAt,
    updatedAt: evidenceUpdatedAt,
    ...overrides,
  });

  assert.equal(printerConfigurationState(printer()), 'CONFIGURED');
  assert.equal(printerConfigurationState(printer({ enabled: false })), 'DISABLED');
  assert.equal(
    printerConfigurationState(printer({ readiness: { channelImplemented: true, configValid: false } })),
    'NOT_CONFIGURED',
  );
  assert.equal(printerConnectionState(printer(), now), 'CONNECTED');
  const connectedAt = '2026-07-24T09:58:00.000Z';
  const printerWithConnectionHistory = printer({
    capabilities: {
      connectorStatus: {
        usbDeviceRecognized: true,
        usbPermissionGranted: true,
        usbInterfaceValid: true,
        usbEndpointValid: true,
        appExecutionReady: true,
      },
      lastConnectedAt: connectedAt,
    },
  });
  assert.equal(printerLastConnectedAt(printerWithConnectionHistory), connectedAt);
  assert.equal(
    printerConnectionState(printer({}, { usbDeviceRecognized: false }), now),
    'DEVICE_NOT_DETECTED',
  );
  assert.equal(
    printerConnectionState(printer({}, { usbPermissionGranted: false }), now),
    'WAITING_PERMISSION',
  );
  assert.equal(
    printerConnectionState(
      printer(
        { readiness: { state: 'DEVICE_OFFLINE', channelImplemented: true, configValid: true, statusReady: false, executionEvidenceReady: false, evidenceUpdatedAt, evidenceTtlMs: 120_000 } },
        { appExecutionReady: false },
      ),
      now,
    ),
    'RECONNECTING',
  );
  assert.equal(
    printerConnectionState(
      printer({ readiness: { state: 'DEVICE_OFFLINE', channelImplemented: true, configValid: true, statusReady: true, executionEvidenceReady: false, evidenceUpdatedAt: '2026-07-24T09:50:00.000Z', evidenceTtlMs: 120_000 } }),
      now,
    ),
    'OFFLINE',
  );
  assert.equal(
    printerConnectionState(
      printer({ status: 'UNKNOWN', capabilities: {}, readiness: { state: 'DEVICE_OFFLINE', channelImplemented: true, configValid: true, statusReady: false } }),
      now,
    ),
    'UNKNOWN',
  );

  const disabledButConnected = printer({ enabled: false });
  assert.equal(printerConfigurationState(disabledButConnected), 'DISABLED');
  assert.equal(printerConnectionState(disabledButConnected, now), 'CONNECTED');

  assert.deepEqual(
    resolvePrintingCenterSummary(
      [printer()],
      [{ id: '1', printerId: '1', enabled: true, autoPrint: true }],
      true,
      now,
    ),
    {
      localChannel: 'AVAILABLE',
      automaticPrinting: 'ENABLED',
      recentTerminalConnection: 'ONLINE',
      lastEvidenceAt: evidenceUpdatedAt,
      lastConnectedAt: null,
    },
  );

  assert.equal(
    resolvePrintingCenterSummary(
      [printer({ enabled: false })],
      [{ id: '1', printerId: '1', enabled: true, autoPrint: true }],
      true,
      now,
    ).automaticPrinting,
    'DISABLED',
  );
  assert.equal(
    resolvePrintingCenterSummary(
      [printerWithConnectionHistory],
      [{ id: '1', printerId: '1', enabled: true, autoPrint: true }],
      true,
      now,
    ).lastConnectedAt,
    connectedAt,
  );
  assert.equal(
    resolvePrintingCenterSummary(
      [printer()],
      [{ id: '1', printerId: '1', enabled: true, autoPrint: true }],
      false,
      now,
    ).automaticPrinting,
    'DISABLED',
  );

  const sourceFiles = await Promise.all(
    [
      '../src/components/printing/PrintingCenterShell.vue',
      '../src/pages/printing/PrintingPrintersPage.vue',
      '../src/pages/printing/PrintingRulesPage.vue',
      '../src/i18n/printing.ts',
    ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')),
  );
  const source = sourceFiles.join('\n');
  assert.doesNotMatch(source, /\bBETA\b|打印中心 Beta|\bRC\d*\b|到店前|到店验证/);
  assert.doesNotMatch(sourceFiles[1], /capabilitiesText|parseCapabilities/);
  assert.doesNotMatch(sourceFiles[1], /row\.status\s*}}\s*·/);
  assert.match(sourceFiles[1], /capabilityStatus/);
  assert.match(sourceFiles[1], /configurationStatus/);
  assert.match(sourceFiles[1], /connectionStatus/);
  const updatePayload = sourceFiles[1].match(
    /function buildUpdatePayload\(\)[\s\S]*?\n}/,
  )?.[0] ?? '';
  assert.doesNotMatch(updatePayload, /capabilities|connectionConfig|channelType|enabled/);

  const [routerSource, layoutSource] = await Promise.all([
    readFile(new URL('../src/router/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/layouts/MerchantLayout.vue', import.meta.url), 'utf8'),
  ]);
  assert.match(
    routerSource,
    /path: 'printing-center',[\s\S]*?meta: \{ roles: \['OWNER', 'MANAGER'] \}/,
  );
  assert.equal((layoutSource.match(/\['\/printing-center'/g) ?? []).length, 2);

  console.log('merchant-admin printing status: PASS');
} finally {
  await server.close();
}
