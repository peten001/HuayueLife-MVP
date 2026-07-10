import { BadRequestException, GoneException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ORDERING_DISABLED_MESSAGE = '平台经营能力总开关已关闭，暂不可使用订单能力';
const MERCHANT_OPERATION_EDIT_DISABLED_MESSAGE =
  '平台经营能力总开关已关闭，暂不可修改商家经营能力。';
const PLATFORM_ORDERING_ENV_READONLY_MESSAGE =
  '当前总开关由服务器环境变量控制，请修改服务器配置后重启 API。';

@Injectable()
export class AppConfigService {
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
      readOnly: true,
      message: PLATFORM_ORDERING_ENV_READONLY_MESSAGE,
    };
  }

  updatePlatformOrderingEnabled(_enabled?: boolean) {
    throw new BadRequestException(PLATFORM_ORDERING_ENV_READONLY_MESSAGE);
  }

  isPlatformOrderingEnabled() {
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
