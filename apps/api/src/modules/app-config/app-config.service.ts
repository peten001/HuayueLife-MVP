import { GoneException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';

const ORDERING_DISABLED_MESSAGE = '平台经营能力总开关已关闭，暂不可使用订单能力';
const MERCHANT_OPERATION_EDIT_DISABLED_MESSAGE =
  '平台经营能力总开关已关闭，暂不可修改商家经营能力。';
const PLATFORM_ORDERING_SETTING_KEY = 'platformOrderingEnabled';

type PlatformOrderingSource = 'database' | 'env' | 'fallback';

type PlatformOrderingSetting = {
  enabled: boolean;
  source: PlatformOrderingSource;
};

@Injectable()
export class AppConfigService implements OnModuleInit {
  private platformOrderingSetting: PlatformOrderingSetting | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    this.platformOrderingSetting = await this.resolvePlatformOrderingSetting();
  }

  async getPublicConfig() {
    const setting = await this.resolveAndCachePlatformOrderingSetting();
    return {
      platformOrderingEnabled: setting.enabled,
    };
  }

  async getPlatformSettings() {
    const setting = await this.resolveAndCachePlatformOrderingSetting();
    return {
      platformOrderingEnabled: setting.enabled,
      source: setting.source,
      readOnly: false,
    };
  }

  async updatePlatformOrderingEnabled(enabled: boolean) {
    await this.prisma.platformSetting.upsert({
      where: { key: PLATFORM_ORDERING_SETTING_KEY },
      update: { value: enabled },
      create: {
        key: PLATFORM_ORDERING_SETTING_KEY,
        value: enabled,
      },
    });
    this.platformOrderingSetting = {
      enabled,
      source: 'database',
    };
    return {
      platformOrderingEnabled: enabled,
      source: 'database' as const,
      readOnly: false,
    };
  }

  isPlatformOrderingEnabled() {
    return (this.platformOrderingSetting ?? this.resolvePlatformOrderingEnvSetting()).enabled;
  }

  assertOrderingEnabled(message = ORDERING_DISABLED_MESSAGE) {
    if (!this.isPlatformOrderingEnabled()) {
      throw new GoneException(message);
    }
  }

  merchantOperationEditDisabledMessage() {
    return MERCHANT_OPERATION_EDIT_DISABLED_MESSAGE;
  }

  private async resolveAndCachePlatformOrderingSetting() {
    const setting = await this.resolvePlatformOrderingSetting();
    this.platformOrderingSetting = setting;
    return setting;
  }

  private async resolvePlatformOrderingSetting(): Promise<PlatformOrderingSetting> {
    try {
      const setting = await this.prisma.platformSetting.findUnique({
        where: { key: PLATFORM_ORDERING_SETTING_KEY },
      });
      const enabled = parseSettingBoolean(setting?.value);
      if (enabled !== null) {
        return {
          enabled,
          source: 'database',
        };
      }
    } catch {
      // If the settings table is temporarily unavailable, keep the audit-safe fallback path.
    }

    return this.resolvePlatformOrderingEnvSetting();
  }

  private resolvePlatformOrderingEnvSetting(): PlatformOrderingSetting {
    const enabled = parseBoolean(this.config.get<string>('PLATFORM_ORDERING_ENABLED'));
    if (enabled !== null) {
      return {
        enabled,
        source: 'env',
      };
    }
    return {
      enabled: false,
      source: 'fallback',
    };
  }
}

function parseSettingBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return parseBoolean(value);
  return null;
}

function parseBoolean(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return null;
}
