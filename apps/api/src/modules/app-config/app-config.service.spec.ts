import { ConfigService } from '@nestjs/config';
import { BadRequestException, GoneException } from '@nestjs/common';
import { AppConfigService } from './app-config.service';

describe('AppConfigService', () => {
  const originalPlatformOrderingEnabled = process.env.PLATFORM_ORDERING_ENABLED;

  afterEach(() => {
    if (originalPlatformOrderingEnabled === undefined) {
      delete process.env.PLATFORM_ORDERING_ENABLED;
      return;
    }
    process.env.PLATFORM_ORDERING_ENABLED = originalPlatformOrderingEnabled;
  });

  function serviceWith(value: string | undefined) {
    const config = {
      get: jest.fn().mockReturnValue(value),
    } as unknown as ConfigService;
    return new AppConfigService(config);
  }

  it('defaults platformOrderingEnabled to false', () => {
    expect(serviceWith(undefined).getPublicConfig()).toEqual({
      platformOrderingEnabled: false,
    });
  });

  it.each(['true', '1', 'yes', 'on'])('parses %s as enabled', (value) => {
    expect(serviceWith(value).isPlatformOrderingEnabled()).toBe(true);
  });

  it.each(['false', '0', 'no', 'off', 'invalid'])('parses %s as disabled', (value) => {
    expect(serviceWith(value).isPlatformOrderingEnabled()).toBe(false);
  });

  it('reports platform settings as environment controlled and read-only', () => {
    const service = serviceWith('false');
    expect(service.getPlatformSettings()).toMatchObject({
      platformOrderingEnabled: false,
      source: 'PLATFORM_ORDERING_ENABLED',
      persistence: 'environment',
      readOnly: true,
    });
  });

  it('rejects runtime updates because environment settings are read-only', () => {
    expect(() => serviceWith('false').updatePlatformOrderingEnabled()).toThrow(
      BadRequestException,
    );
  });

  it('throws a gone error when ordering is disabled', () => {
    expect(() => serviceWith('false').assertOrderingEnabled()).toThrow(GoneException);
  });
});
