import { ServiceUnavailableException } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';

@Injectable()
export class PrintingFeatureFlagsService {
  constructor(private readonly config: ConfigService) {}

  taskCenterEnabled() {
    return this.readBoolean('PRINTING_TASK_CENTER_ENABLED', true);
  }

  automaticCreationEnabled() {
    return this.readBoolean('PRINTING_AUTO_CREATE_ENABLED', false);
  }

  executionEnabled() {
    return this.readBoolean('PRINTING_EXECUTION_ENABLED', false);
  }

  status() {
    return {
      taskCenterEnabled: this.taskCenterEnabled(),
      automaticCreationEnabled: this.automaticCreationEnabled(),
      executionEnabled: this.executionEnabled(),
      executionState: this.executionEnabled() ? 'READY_FOR_CONNECTOR' : 'CONNECTOR_PENDING',
    };
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
    if (!this.automaticCreationEnabled()) {
      throw new ServiceUnavailableException({
        code: PRINTING_ERROR_CODES.AUTO_CREATE_DISABLED,
        message: '自动创建打印任务当前未启用',
      });
    }
  }

  assertExecutionEnabled() {
    if (!this.executionEnabled()) {
      throw new ServiceUnavailableException({
        code: PRINTING_ERROR_CODES.EXECUTION_DISABLED,
        message: '打印执行端尚未接入',
      });
    }
  }

  private readBoolean(key: string, fallback: boolean) {
    const value = this.config.get<string | boolean>(key);
    if (typeof value === 'boolean') return value;
    const normalized = value?.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized ?? '')) return true;
    if (['false', '0', 'no', 'off'].includes(normalized ?? '')) return false;
    return fallback;
  }
}
