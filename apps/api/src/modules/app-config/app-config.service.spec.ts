import { ConfigService } from '@nestjs/config';
import { GoneException } from '@nestjs/common';
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

  it('allows runtime updates without changing merchant capability fields', () => {
    const service = serviceWith('false');
    expect(service.getPlatformSettings().platformOrderingEnabled).toBe(false);
    expect(service.updatePlatformOrderingEnabled(true).platformOrderingEnabled).toBe(true);
    expect(service.getPublicConfig().platformOrderingEnabled).toBe(true);
  });

  it('throws a gone error when ordering is disabled', () => {
    expect(() => serviceWith('false').assertOrderingEnabled()).toThrow(GoneException);
  });
});
