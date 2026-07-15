import {
  GoneException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';

@Injectable()
export class PrintingFeatureFlagsService implements OnModuleInit {
  private readonly logger = new Logger(PrintingFeatureFlagsService.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const status = this.status();
    this.logger.log(
      `Feature flags: taskCenter=${status.taskCenterEnabled}, autoCreate=${status.automaticCreationEnabled}, execution=${status.executionEnabled}, legacy=${status.legacyPrintingEnabled}`,
    );
  }

  taskCenterEnabled() {
    return this.readBoolean('PRINTING_TASK_CENTER_ENABLED', true);
  }

  automaticCreationEnabled() {
    return this.readBoolean('PRINTING_AUTO_CREATE_ENABLED', false);
  }

  executionEnabled() {
    return this.readBoolean('PRINTING_EXECUTION_ENABLED', false);
  }

  legacyPrintingEnabled() {
    return this.readBoolean('LEGACY_PRINTING_ENABLED', false);
  }

  status() {
    this.assertSafeConfiguration();
    return {
      taskCenterEnabled: this.taskCenterEnabled(),
      automaticCreationEnabled: this.automaticCreationEnabled(),
      executionEnabled: this.executionEnabled(),
      legacyPrintingEnabled: this.legacyPrintingEnabled(),
      executionState: this.executionEnabled()
        ? 'READY_FOR_CONNECTOR'
        : 'CONNECTOR_PENDING',
    };
  }

  assertSafeConfiguration() {
    if (
      this.legacyPrintingEnabled() &&
      (this.automaticCreationEnabled() || this.executionEnabled())
    ) {
      throw new ServiceUnavailableException({
        code: PRINTING_ERROR_CODES.DUAL_PATH_NOT_ALLOWED,
        message: '旧服务器直打与新打印任务创建或执行通道不能同时启用',
      });
    }
  }

  assertTaskCenterEnabled() {
    if (!this.taskCenterEnabled()) {
      throw new ServiceUnavailableException({
        code: PRINTING_ERROR_CODES.TASK_CENTER_DISABLED,
        message: '打印任务中心当前未启用',
      });
    }
  }

  assertAutomaticCreationEnabled() {
    this.assertSafeConfiguration();
    if (!this.automaticCreationEnabled()) {
      throw new ServiceUnavailableException({
        code: PRINTING_ERROR_CODES.AUTO_CREATE_DISABLED,
        message: '自动创建打印任务当前未启用',
      });
    }
  }

  assertExecutionEnabled() {
    this.assertSafeConfiguration();
    if (!this.executionEnabled()) {
      throw new ServiceUnavailableException({
        code: PRINTING_ERROR_CODES.EXECUTION_DISABLED,
        message: '打印执行端尚未接入',
      });
    }
  }

  assertLegacyPrintingEnabled() {
    this.assertSafeConfiguration();
    if (!this.legacyPrintingEnabled()) {
      throw new GoneException({
        code: PRINTING_ERROR_CODES.LEGACY_PRINTING_DISABLED,
        message: '旧打印功能已停用，请使用打印中心。当前执行端尚未接入。',
      });
    }
  }

  private readBoolean(key: string, fallback: boolean) {
    const value = this.config.get<unknown>(key);
    if (typeof value === 'boolean') return value;
    if (value === undefined || value === null) {
      return fallback;
    }
    if (typeof value !== 'string') this.invalidBoolean(key);
    if (value.trim() === '') return fallback;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    this.invalidBoolean(key);
  }

  private invalidBoolean(key: string): never {
    throw new ServiceUnavailableException({
      code: PRINTING_ERROR_CODES.CONFIG_INVALID,
      message: `${key} 必须明确配置为 true 或 false`,
    });
  }
}
