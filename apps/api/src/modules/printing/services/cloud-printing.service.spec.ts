import { ServiceUnavailableException } from '@nestjs/common';
import { CloudPrintingService } from './cloud-printing.service';

describe('CloudPrintingService', () => {
  const originalEnvironment = {
    FEIE_USER: process.env.FEIE_USER,
    FEIE_UKEY: process.env.FEIE_UKEY,
    FEIE_API_BASE_URL: process.env.FEIE_API_BASE_URL,
    YILIAN_API_BASE_URL: process.env.YILIAN_API_BASE_URL,
    YILIAN_CLIENT_ID: process.env.YILIAN_CLIENT_ID,
    YILIAN_CLIENT_SECRET: process.env.YILIAN_CLIENT_SECRET,
  };

  afterEach(() => {
    jest.restoreAllMocks();
    restoreEnvironment(originalEnvironment);
  });

  it('fails closed when Feie server credentials are absent', async () => {
    delete process.env.FEIE_USER;
    delete process.env.FEIE_UKEY;

    await expect(
      new CloudPrintingService().submit('FEIE', 'SN-TEST', '<CB>测试</CB>', 'job-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('submits a signed Feie request without embedding credentials in printer config', async () => {
    process.env.FEIE_USER = 'unit-test-user';
    process.env.FEIE_UKEY = 'unit-test-key';
    process.env.FEIE_API_BASE_URL = 'https://feie.invalid/Api/Open/';
    jest.spyOn(Date, 'now').mockReturnValue(1_722_222_222_000);
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ret: 0, data: 'feie-job-1' }),
    } as Response);

    await expect(
      new CloudPrintingService().submit('FEIE', 'SN-TEST', '<CB>测试</CB>', 'job-1'),
    ).resolves.toEqual({ providerJobId: 'feie-job-1', status: 'SUBMITTED' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://feie.invalid/Api/Open/printMsg');
    expect(init?.method).toBe('POST');
    const body = init?.body as URLSearchParams;
    expect(body.get('user')).toBe('unit-test-user');
    expect(body.get('sn')).toBe('SN-TEST');
    expect(body.get('requestID')).toBe('job-1');
    expect(body.get('sig')).toMatch(/^[a-f0-9]{40}$/);
  });

  it('fails closed when Yilian server credentials are absent', async () => {
    delete process.env.YILIAN_API_BASE_URL;
    delete process.env.YILIAN_CLIENT_ID;
    delete process.env.YILIAN_CLIENT_SECRET;

    await expect(
      new CloudPrintingService().submit('YILIAN', 'MACHINE-TEST', '测试', 'job-2'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('maps a successful Yilian response to a submitted provider job', async () => {
    process.env.YILIAN_API_BASE_URL = 'https://yilian.invalid/print';
    process.env.YILIAN_CLIENT_ID = 'unit-test-client';
    process.env.YILIAN_CLIENT_SECRET = 'unit-test-secret';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, body: { id: 'yilian-job-2' } }),
    } as Response);

    await expect(
      new CloudPrintingService().submit('YILIAN', 'MACHINE-TEST', '测试', 'job-2'),
    ).resolves.toEqual({ providerJobId: 'yilian-job-2', status: 'SUBMITTED' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://yilian.invalid/print');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      client_id: 'unit-test-client',
      client_secret: 'unit-test-secret',
      machine_code: 'MACHINE-TEST',
      content: '测试',
      request_id: 'job-2',
    });
  });
});

function restoreEnvironment(
  values: Record<string, string | undefined>,
) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
