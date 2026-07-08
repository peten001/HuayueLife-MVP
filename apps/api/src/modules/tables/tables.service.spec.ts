import { ConfigService } from '@nestjs/config';
import { TablesService } from './tables.service';

type MiniappQrEnvResolver = {
  resolveMiniappQrEnvVersion(): 'release' | 'trial' | 'develop';
};

describe('TablesService miniapp QR env version', () => {
  const config = new Map<string, string>();
  const configService = {
    get: jest.fn((key: string) => config.get(key)),
  };

  let service: TablesService;

  beforeEach(() => {
    jest.clearAllMocks();
    config.clear();
    service = new TablesService(
      { diningTable: {} } as never,
      configService as unknown as ConfigService,
    );
  });

  function resolveEnvVersion() {
    return (
      service as unknown as MiniappQrEnvResolver
    ).resolveMiniappQrEnvVersion();
  }

  it('uses release in production even when the legacy miniapp env is trial', () => {
    config.set('NODE_ENV', 'production');
    config.set('WECHAT_MINIAPP_ENV_VERSION', 'trial');

    expect(resolveEnvVersion()).toBe('release');
  });

  it('allows the dedicated QR env variable to explicitly override production', () => {
    config.set('NODE_ENV', 'production');
    config.set('WECHAT_MINIAPP_ENV_VERSION', 'trial');
    config.set('WECHAT_MINIAPP_QR_ENV_VERSION', 'release');

    expect(resolveEnvVersion()).toBe('release');
  });

  it('keeps legacy miniapp env compatibility outside production', () => {
    config.set('NODE_ENV', 'development');
    config.set('WECHAT_MINIAPP_ENV_VERSION', 'develop');

    expect(resolveEnvVersion()).toBe('develop');
  });

  it('falls back to release for invalid QR env values', () => {
    config.set('NODE_ENV', 'production');
    config.set('WECHAT_MINIAPP_QR_ENV_VERSION', 'staging');

    expect(resolveEnvVersion()).toBe('release');
  });
});
