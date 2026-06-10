import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns service health information', () => {
    const result = new HealthController().check();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('huayue-life-mvp-api');
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
