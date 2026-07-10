import { GoneException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfigService } from './app-config.service';

describe('AppConfigService', () => {
  function serviceWith(options: {
    envValue?: string;
    dbValue?: unknown;
  } = {}) {
    let storedValue = options.dbValue;
    const config = {
      get: jest.fn((key: string) =>
        key === 'PLATFORM_ORDERING_ENABLED' ? options.envValue : undefined,
      ),
    } as unknown as ConfigService;
    const prisma = {
      platformSetting: {
        findUnique: jest.fn(async () =>
          storedValue === undefined
            ? null
            : {
                key: 'platformOrderingEnabled',
                value: storedValue,
              },
        ),
        upsert: jest.fn(async ({ create, update }) => {
          storedValue = update.value ?? create.value;
          return {
            key: 'platformOrderingEnabled',
            value: storedValue,
          };
        }),
      },
      merchant: {
        updateMany: jest.fn(),
      },
      merchantCapability: {
        updateMany: jest.fn(),
      },
    };
    return {
      service: new AppConfigService(config, prisma as never),
      prisma,
    };
  }

  it('defaults platformOrderingEnabled to false when database and env are empty', async () => {
    const { service } = serviceWith();
    await expect(service.getPublicConfig()).resolves.toEqual({
      platformOrderingEnabled: false,
    });
    await expect(service.getPlatformSettings()).resolves.toMatchObject({
      platformOrderingEnabled: false,
      source: 'fallback',
      readOnly: false,
    });
  });

  it('uses the environment fallback when the database setting is missing', async () => {
    const { service } = serviceWith({ envValue: 'true' });
    await expect(service.getPublicConfig()).resolves.toEqual({
      platformOrderingEnabled: true,
    });
    await expect(service.getPlatformSettings()).resolves.toMatchObject({
      platformOrderingEnabled: true,
      source: 'env',
      readOnly: false,
    });
  });

  it.each(['true', '1', 'yes', 'on'])('parses %s as enabled', async (value) => {
    const { service } = serviceWith({ envValue: value });
    await service.onModuleInit();
    expect(service.isPlatformOrderingEnabled()).toBe(true);
  });

  it.each(['false', '0', 'no', 'off', 'invalid'])('parses %s as disabled', async (value) => {
    const { service } = serviceWith({ envValue: value });
    await service.onModuleInit();
    expect(service.isPlatformOrderingEnabled()).toBe(false);
  });

  it('persists platformOrderingEnabled=true and returns database settings', async () => {
    const { service, prisma } = serviceWith();

    await expect(service.updatePlatformOrderingEnabled(true)).resolves.toMatchObject({
      platformOrderingEnabled: true,
      source: 'database',
      readOnly: false,
    });
    expect(prisma.platformSetting.upsert).toHaveBeenCalledWith({
      where: { key: 'platformOrderingEnabled' },
      update: { value: true },
      create: {
        key: 'platformOrderingEnabled',
        value: true,
      },
    });
    await expect(service.getPlatformSettings()).resolves.toMatchObject({
      platformOrderingEnabled: true,
      source: 'database',
      readOnly: false,
    });
    await expect(service.getPublicConfig()).resolves.toEqual({
      platformOrderingEnabled: true,
    });
  });

  it('persists platformOrderingEnabled=false after being enabled', async () => {
    const { service } = serviceWith({ dbValue: true });

    await expect(service.updatePlatformOrderingEnabled(false)).resolves.toMatchObject({
      platformOrderingEnabled: false,
      source: 'database',
      readOnly: false,
    });
    await expect(service.getPublicConfig()).resolves.toEqual({
      platformOrderingEnabled: false,
    });
  });

  it('uses the database value before the environment fallback', async () => {
    const { service } = serviceWith({ envValue: 'true', dbValue: false });

    await expect(service.getPlatformSettings()).resolves.toMatchObject({
      platformOrderingEnabled: false,
      source: 'database',
      readOnly: false,
    });
    await expect(service.getPublicConfig()).resolves.toEqual({
      platformOrderingEnabled: false,
    });
  });

  it('does not bulk update merchant capability fields when toggling the platform switch', async () => {
    const { service, prisma } = serviceWith();

    await service.updatePlatformOrderingEnabled(true);
    await service.updatePlatformOrderingEnabled(false);

    expect(prisma.merchant.updateMany).not.toHaveBeenCalled();
    expect(prisma.merchantCapability.updateMany).not.toHaveBeenCalled();
  });

  it('throws a gone error when ordering is disabled', async () => {
    const { service } = serviceWith({ dbValue: false });
    await service.onModuleInit();

    expect(() => service.assertOrderingEnabled()).toThrow(GoneException);
  });
});
