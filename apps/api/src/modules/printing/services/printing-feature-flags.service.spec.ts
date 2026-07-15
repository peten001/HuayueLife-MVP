import { ServiceUnavailableException } from '@nestjs/common';
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

  it('accepts explicit boolean-like values without unsafe truthiness', () => {
    values.set('PRINTING_AUTO_CREATE_ENABLED', 'true');
    values.set('PRINTING_EXECUTION_ENABLED', '1');
    expect(service.automaticCreationEnabled()).toBe(true);
    expect(service.executionEnabled()).toBe(true);

    values.set('PRINTING_AUTO_CREATE_ENABLED', 'false');
    values.set('PRINTING_EXECUTION_ENABLED', 'off');
    expect(service.automaticCreationEnabled()).toBe(false);
    expect(service.executionEnabled()).toBe(false);
  });
});
