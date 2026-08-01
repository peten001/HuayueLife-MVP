import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SyncLanTerminalBindingDto } from './lan-terminal-binding.dto';
import {
  ClaimLanPrintJobDto,
  LanActiveJobQueryDto,
  MarkLanPrintingDto,
  ReportLanPrinterStatusDto,
} from './lan-terminal-connector.dto';

describe('LAN Terminal DTO security contract', () => {
  it('transforms an integer active-job query bindingVersion to a number', async () => {
    for (const bindingVersion of ['1', '10']) {
      const dto = plainToInstance(LanActiveJobQueryDto, {
        ...routePayload(),
        bindingVersion,
      });

      await expect(validateDto(dto)).resolves.toHaveLength(0);
      expect(dto.bindingVersion).toBe(Number(bindingVersion));
      expect(typeof dto.bindingVersion).toBe('number');
    }
  });

  it('rejects invalid active-job query bindingVersion values', async () => {
    for (const bindingVersion of ['1.5', 'abc', '', undefined, '0', '-1']) {
      const dto = plainToInstance(LanActiveJobQueryDto, {
        ...routePayload(),
        bindingVersion,
      });

      await expect(validateDto(dto)).resolves.not.toHaveLength(0);
    }
  });

  it('accepts the frozen binding sync contract and requires expectedBindingVersion', async () => {
    await expect(errors(SyncLanTerminalBindingDto, syncPayload())).resolves.toHaveLength(
      0,
    );
    expect(
      await errors(SyncLanTerminalBindingDto, {
        ...syncPayload(),
        expectedBindingVersion: undefined,
      }),
    ).not.toHaveLength(0);
  });

  it('forbids caller-supplied terminal identity and secret fields', async () => {
    for (const forbidden of [
      'terminalId',
      'terminalInstanceId',
      'terminalSecret',
      'authorization',
    ]) {
      const validation = await errors(ClaimLanPrintJobDto, {
        ...routePayload(),
        allowAutomatic: false,
        [forbidden]: 'forged',
      });
      expect(validation).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ property: forbidden }),
        ]),
      );
    }
  });

  it('requires printerId, localBindingId, and bindingVersion on execution requests', async () => {
    const payload = {
      ...routePayload(),
      leaseVersion: 2,
      contentHash: 'a'.repeat(64),
    };
    await expect(errors(MarkLanPrintingDto, payload)).resolves.toHaveLength(0);
    for (const key of ['printerId', 'localBindingId', 'bindingVersion'] as const) {
      expect(
        await errors(MarkLanPrintingDto, { ...payload, [key]: undefined }),
      ).not.toHaveLength(0);
    }
  });

  it('keeps binding versions within the frozen signed Int32 range', async () => {
    await expect(
      errors(SyncLanTerminalBindingDto, {
        ...syncPayload(),
        expectedBindingVersion: 2_147_483_647,
      }),
    ).resolves.toHaveLength(0);
    expect(
      await errors(SyncLanTerminalBindingDto, {
        ...syncPayload(),
        expectedBindingVersion: 2_147_483_648,
      }),
    ).not.toHaveLength(0);
    expect(
      await errors(ClaimLanPrintJobDto, {
        ...routePayload(),
        bindingVersion: 2_147_483_648,
        allowAutomatic: false,
      }),
    ).not.toHaveLength(0);
  });

  it('rejects non-positive and oversized database IDs before Prisma lookup', async () => {
    for (const printerId of ['0', '92233720368547758080', '9'.repeat(200)]) {
      expect(
        await errors(ClaimLanPrintJobDto, {
          ...routePayload(),
          printerId,
          allowAutomatic: false,
        }),
      ).not.toHaveLength(0);
    }
  });

  it('does not accept a caller-selected adapter', async () => {
    const validation = await errors(MarkLanPrintingDto, {
      ...routePayload(),
      leaseVersion: 2,
      contentHash: 'a'.repeat(64),
      adapter: 'FORGED_ADAPTER',
    });
    expect(validation).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'adapter' })]),
    );
  });

  it('validates the status route tuple before accepting connector evidence', async () => {
    await expect(
      errors(ReportLanPrinterStatusDto, {
        ...routePayload(),
        status: 'CONNECTED',
        serviceRunning: true,
        executionEnabled: true,
      }),
    ).resolves.toHaveLength(0);
    expect(
      await errors(ReportLanPrinterStatusDto, {
        ...routePayload(),
        status: 'ONLINE',
        serviceRunning: true,
        executionEnabled: true,
      }),
    ).not.toHaveLength(0);
  });
});

function errors(
  Dto: new () => object,
  payload: Record<string, unknown>,
) {
  return validateDto(plainToInstance(Dto, payload));
}

function validateDto(dto: object) {
  return validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

function routePayload() {
  return {
    printerId: '17',
    localBindingId: 'binding-1',
    bindingVersion: 1,
  };
}

function syncPayload() {
  return {
    localBindingId: 'binding-1',
    displayName: 'LAN 前台打印机',
    host: '192.168.1.20',
    port: 9100,
    paperWidth: 'MM80',
    appVersion: '1.0.0-rc7.4',
    appVersionCode: 25,
    serviceRunning: true,
    executionEnabled: true,
    status: 'CONNECTED',
    expectedBindingVersion: 0,
  };
}
