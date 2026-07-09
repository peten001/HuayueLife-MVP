import { ConfigService } from '@nestjs/config';
import { TablesService } from './tables.service';

type MiniappQrEnvResolver = {
  getTableQrEnvVersion(merchantId: number): 'release' | 'trial' | 'develop';
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

  function resolveEnvVersion(merchantId: number) {
    return (
      service as unknown as MiniappQrEnvResolver
    ).getTableQrEnvVersion(merchantId);
  }

  it('uses trial for whitelisted merchant 2', () => {
    config.set('WECHAT_MINIAPP_TRIAL_QR_MERCHANT_IDS', '2,7');

    expect(resolveEnvVersion(2)).toBe('trial');
  });

  it('uses trial for whitelisted merchant 7', () => {
    config.set('WECHAT_MINIAPP_TRIAL_QR_MERCHANT_IDS', '2,7');

    expect(resolveEnvVersion(7)).toBe('trial');
  });

  it('uses release for non-whitelisted merchants by default', () => {
    config.set('WECHAT_MINIAPP_TRIAL_QR_MERCHANT_IDS', '2,7');

    expect(resolveEnvVersion(11)).toBe('release');
  });

  it('uses release for merchant 2 when the trial whitelist is not configured', () => {
    expect(resolveEnvVersion(2)).toBe('release');
  });

  it('uses the dedicated QR env variable for non-whitelisted merchants', () => {
    config.set('WECHAT_MINIAPP_QR_ENV_VERSION', 'release');

    expect(resolveEnvVersion(11)).toBe('release');
  });

  it('falls back to release for invalid QR env values', () => {
    config.set('WECHAT_MINIAPP_QR_ENV_VERSION', 'staging');

    expect(resolveEnvVersion(11)).toBe('release');
  });

  it('ignores the legacy miniapp env variable for table QR codes', () => {
    config.set('WECHAT_MINIAPP_ENV_VERSION', 'trial');

    expect(resolveEnvVersion(11)).toBe('release');
  });

  it('ignores empty and invalid trial whitelist entries', () => {
    config.set('WECHAT_MINIAPP_TRIAL_QR_MERCHANT_IDS', '2, 7, abc');

    expect(resolveEnvVersion(2)).toBe('trial');
    expect(resolveEnvVersion(7)).toBe('trial');
    expect(resolveEnvVersion(11)).toBe('release');
  });
});
