import { GoneException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';

describe('PrintingFeatureFlagsService safe defaults', () => {
  const values = new Map<string, string>();
  const config = {
    get: jest.fn((key: string) => values.get(key)),
  };
  let service: PrintingFeatureFlagsService;

  beforeEach(() => {
    values.clear();
    config.get.mockClear();
    service = new PrintingFeatureFlagsService(config as unknown as ConfigService);
  });

  it('enables management but keeps automatic creation and execution off by default', () => {
    expect(service.status()).toEqual({
      taskCenterEnabled: true,
      automaticCreationEnabled: false,
      executionEnabled: false,
      legacyPrintingEnabled: false,
      executionState: 'CONNECTOR_PENDING',
    });
  });

  it('blocks automatic task creation and execution unless explicitly enabled', () => {
    expect(() => service.assertAutomaticCreationEnabled()).toThrow(
      ServiceUnavailableException,
    );
    expect(() => service.assertExecutionEnabled()).toThrow(
      ServiceUnavailableException,
    );
  });

  it('accepts only explicit true and false values without unsafe truthiness', () => {
    values.set('PRINTING_AUTO_CREATE_ENABLED', 'true');
    values.set('PRINTING_EXECUTION_ENABLED', 'true');
    values.set('LEGACY_PRINTING_ENABLED', 'false');
    expect(service.automaticCreationEnabled()).toBe(true);
    expect(service.executionEnabled()).toBe(true);
    expect(service.legacyPrintingEnabled()).toBe(false);

    values.set('PRINTING_AUTO_CREATE_ENABLED', 'false');
    values.set('PRINTING_EXECUTION_ENABLED', 'false');
    expect(service.automaticCreationEnabled()).toBe(false);
    expect(service.executionEnabled()).toBe(false);

    values.set('PRINTING_EXECUTION_ENABLED', '1');
    expect(() => service.executionEnabled()).toThrow(ServiceUnavailableException);
  });

  it('returns HTTP 410 and the stable code while legacy printing is off', () => {
    expect(() => service.assertLegacyPrintingEnabled()).toThrow(GoneException);
    try {
      service.assertLegacyPrintingEnabled();
    } catch (error) {
      const exception = error as GoneException;
      expect(exception.getStatus()).toBe(410);
      expect(exception.getResponse()).toEqual({
        code: 'LEGACY_PRINTING_DISABLED',
        message: '旧打印功能已停用，请使用打印中心。当前执行端尚未接入。',
      });
    }
  });

  it('rejects legacy direct printing with automatic task creation during startup validation', () => {
    values.set('LEGACY_PRINTING_ENABLED', 'true');
    values.set('PRINTING_AUTO_CREATE_ENABLED', 'true');

    expect(() => service.onModuleInit()).toThrow(ServiceUnavailableException);
    try {
      service.onModuleInit();
    } catch (error) {
      expect((error as ServiceUnavailableException).getResponse()).toEqual({
        code: 'PRINTING_DUAL_PATH_NOT_ALLOWED',
        message: '旧服务器直打与新打印任务创建或执行通道不能同时启用',
      });
    }
  });

  it('rejects legacy direct printing with the new execution path', () => {
    values.set('LEGACY_PRINTING_ENABLED', 'true');
    values.set('PRINTING_AUTO_CREATE_ENABLED', 'false');
    values.set('PRINTING_EXECUTION_ENABLED', 'true');

    expect(() => service.status()).toThrow(ServiceUnavailableException);
    expect(() => service.assertExecutionEnabled()).toThrow(
      ServiceUnavailableException,
    );

    try {
      service.assertExecutionEnabled();
    } catch (error) {
      expect((error as ServiceUnavailableException).getResponse()).toEqual({
        code: 'PRINTING_DUAL_PATH_NOT_ALLOWED',
        message: '旧服务器直打与新打印任务创建或执行通道不能同时启用',
      });
    }
  });
});
