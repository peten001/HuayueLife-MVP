import { GoneException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ORDERING_DISABLED_MESSAGE = '平台经营能力总开关已关闭，暂不可使用订单能力';
const MERCHANT_OPERATION_EDIT_DISABLED_MESSAGE =
  '平台经营能力总开关已关闭，暂不可修改商家经营能力。';

@Injectable()
export class AppConfigService {
  private runtimePlatformOrderingEnabled: boolean | null = null;

  constructor(private readonly config: ConfigService) {}

  getPublicConfig() {
    return {
      platformOrderingEnabled: this.isPlatformOrderingEnabled(),
    };
  }

  getPlatformSettings() {
    return {
      platformOrderingEnabled: this.isPlatformOrderingEnabled(),
      source: 'PLATFORM_ORDERING_ENABLED',
      persistence: 'environment',
    };
  }

  updatePlatformOrderingEnabled(enabled: boolean) {
    this.runtimePlatformOrderingEnabled = enabled;
    process.env.PLATFORM_ORDERING_ENABLED = enabled ? 'true' : 'false';
    return this.getPlatformSettings();
  }

  isPlatformOrderingEnabled() {
    if (this.runtimePlatformOrderingEnabled !== null) {
      return this.runtimePlatformOrderingEnabled;
    }
    return parseBoolean(this.config.get<string>('PLATFORM_ORDERING_ENABLED')) ?? false;
  }

  assertOrderingEnabled(message = ORDERING_DISABLED_MESSAGE) {
    if (!this.isPlatformOrderingEnabled()) {
      throw new GoneException(message);
    }
  }

  merchantOperationEditDisabledMessage() {
    return MERCHANT_OPERATION_EDIT_DISABLED_MESSAGE;
  }
}

function parseBoolean(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return null;
}
