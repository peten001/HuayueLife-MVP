import { createHash } from 'node:crypto';
import {
  CloudPrintingService,
} from './cloud-printing.service';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';

describe('CloudPrintingService official provider contracts', () => {
  const originalEnvironment = captureEnvironment([
    'FEIE_ENABLED',
    'FEIE_USER',
    'FEIE_UKEY',
    'FEIE_API_BASE_URL',
    'FEIE_DEVICE_KEYS_JSON',
    'YILIAN_ENABLED',
    'YILIAN_API_BASE_URL',
    'YILIAN_CLIENT_ID',
    'YILIAN_CLIENT_SECRET',
    'YILIAN_DEVICE_KEYS_JSON',
    'CLOUD_PRINT_PROVIDER_TIMEOUT_MS',
  ]);

  afterEach(() => {
    jest.restoreAllMocks();
    restoreEnvironment(originalEnvironment);
  });

  describe('Feie Open API', () => {
    beforeEach(() => {
      process.env.FEIE_ENABLED = 'true';
      process.env.FEIE_USER = 'contract-user';
      process.env.FEIE_UKEY = 'contract-ukey';
      process.env.FEIE_API_BASE_URL = 'https://feie.invalid/Api/Open/';
      jest.spyOn(Date, 'now').mockReturnValue(1_722_222_222_000);
    });

    it('fails closed without emitting credentials when server configuration is absent', async () => {
      delete process.env.FEIE_UKEY;

      await expect(
        new CloudPrintingService().submit(
          'FEIE',
          'SN-TEST',
          '<CB>测试 / Kiểm tra</CB>',
          'job-1',
        ),
      ).rejects.toMatchObject({
        code: PRINTING_ERROR_CODES.CLOUD_PROVIDER_NOT_CONFIGURED,
        options: { notConfigured: true },
      });
      expect(global.fetch).toBeDefined();
    });

    it('signs and submits Open_printMsg as form data and treats the returned order id as submitted only', async () => {
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
        response({ ret: 0, msg: 'ok', data: 'feie-order-1' }),
      );

      await expect(
        new CloudPrintingService().submit(
          'FEIE',
          'SN-TEST',
          '<CB>测试 / Kiểm tra</CB>',
          'job-1',
        ),
      ).resolves.toEqual({ providerTaskId: 'feie-order-1', status: 'SUBMITTED' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe('https://feie.invalid/Api/Open/printMsg');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual({
        'content-type': 'application/x-www-form-urlencoded',
      });
      const body = init?.body as URLSearchParams;
      expect(body.get('apiname')).toBe('Open_printMsg');
      expect(body.get('user')).toBe('contract-user');
      expect(body.get('sn')).toBe('SN-TEST');
      expect(body.get('content')).toContain('Kiểm tra');
      expect(body.get('times')).toBe('1');
      expect(body.has('requestID')).toBe(false);
      expect(body.get('sig')).toBe(
        createHash('sha1')
          .update('contract-usercontract-ukey1722222222')
          .digest('hex'),
      );
    });

    it('queries printer and order state instead of promoting API acceptance to physical success', async () => {
      const fetchMock = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce(
          response({ ret: 0, msg: 'ok', data: '在线，工作状态正常' }),
        )
        .mockResolvedValueOnce(response({ ret: 0, msg: 'ok', data: false }))
        .mockResolvedValueOnce(response({ ret: 0, msg: 'ok', data: true }));
      const service = new CloudPrintingService();

      await expect(service.queryPrinter('FEIE', 'SN-TEST')).resolves.toBe('ONLINE');
      await expect(service.queryTask('FEIE', 'SN-TEST', 'order-1')).resolves.toBe(
        'ACCEPTED',
      );
      await expect(service.queryTask('FEIE', 'SN-TEST', 'order-1')).resolves.toBe(
        'PRINTED',
      );

      expect(
        (fetchMock.mock.calls[1][1]?.body as URLSearchParams).get('apiname'),
      ).toBe('Open_queryOrderState');
    });

    it('maps a timed-out submission to outcome unknown and forbids blind retry', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('socket timeout'));

      await expect(
        new CloudPrintingService().submit('FEIE', 'SN-TEST', '测试', 'job-timeout'),
      ).rejects.toMatchObject({
        code: PRINTING_ERROR_CODES.PRINT_OUTCOME_UNKNOWN,
        options: { outcomeUnknown: true, retryable: false },
      });
    });

    it('maps explicit credential rejection to a merchant-safe error without leaking the UKEY', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(
        response({
          ret: 1001,
          msg: '签名错误 ukey=contract-ukey',
          data: null,
        }),
      );

      const error = await new CloudPrintingService()
        .submit('FEIE', 'SN-TEST', '测试', 'job-rejected')
        .catch((value) => value);

      expect(error).toMatchObject({
        code: PRINTING_ERROR_CODES.CLOUD_CREDENTIALS_INVALID,
        options: { retryable: false },
      });
      expect(JSON.stringify(error)).not.toContain('contract-ukey');
    });

    it('uses a server-only device key for Open_getModel verification without returning it', async () => {
      process.env.FEIE_DEVICE_KEYS_JSON = JSON.stringify({
        'SN-TEST': 'device-key-contract-only',
      });
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
        response({ ret: 0, msg: 'ok', data: { model: 0 } }),
      );

      await expect(
        new CloudPrintingService().verifyDevice('FEIE', 'SN-TEST'),
      ).resolves.toBe('ONLINE');

      const body = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
      expect(body.get('apiname')).toBe('Open_getModel');
      expect(body.get('key')).toBe('device-key-contract-only');
      expect(JSON.stringify(await new CloudPrintingService().configurationStatus())).not.toContain(
        'device-key-contract-only',
      );
    });
  });

  describe('Yilian OAuth v2 API', () => {
    beforeEach(() => {
      process.env.YILIAN_ENABLED = 'true';
      process.env.YILIAN_CLIENT_ID = '1000000001';
      process.env.YILIAN_CLIENT_SECRET = 'contract-secret';
      process.env.YILIAN_API_BASE_URL = 'https://yilian.invalid/v2/';
      jest.spyOn(Date, 'now').mockReturnValue(1_722_222_222_000);
    });

    it('fails closed when the application is not configured', async () => {
      delete process.env.YILIAN_CLIENT_SECRET;

      await expect(
        new CloudPrintingService().submit(
          'YILIAN',
          'MACHINE-TEST',
          '测试 / Kiểm tra',
          'job-2',
        ),
      ).rejects.toMatchObject({
        code: PRINTING_ERROR_CODES.CLOUD_PROVIDER_NOT_CONFIGURED,
      });
    });

    it('gets and caches a client_credentials token, signs form requests, and sends origin_id idempotency', async () => {
      const fetchMock = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce(tokenResponse('access-token-contract'))
        .mockResolvedValueOnce(
          response({ error: 0, error_description: 'success', body: { id: 2099743426, origin_id: 'job-2' } }),
        )
        .mockResolvedValueOnce(
          response({ error: 0, error_description: 'success', body: { state: 1 } }),
        );
      const service = new CloudPrintingService();

      await expect(
        service.submit('YILIAN', 'MACHINE-TEST', '测试 / Kiểm tra', 'job-2'),
      ).resolves.toEqual({ providerTaskId: '2099743426', status: 'SUBMITTED' });
      await expect(service.queryPrinter('YILIAN', 'MACHINE-TEST')).resolves.toBe(
        'ONLINE',
      );

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(String(fetchMock.mock.calls[0][0])).toBe(
        'https://yilian.invalid/v2/oauth/oauth',
      );
      const auth = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
      expect(auth.get('grant_type')).toBe('client_credentials');
      expect(auth.get('scope')).toBe('all');
      expect(auth.get('sign')).toBe(
        createHash('md5')
          .update('10000000011722222222contract-secret')
          .digest('hex'),
      );
      const print = fetchMock.mock.calls[1][1]?.body as URLSearchParams;
      expect(String(fetchMock.mock.calls[1][0])).toBe(
        'https://yilian.invalid/v2/print/index',
      );
      expect(print.get('access_token')).toBe('access-token-contract');
      expect(print.get('machine_code')).toBe('MACHINE-TEST');
      expect(print.get('origin_id')).toBe('job-2');
      expect(print.get('idempotence')).toBe('1');
      expect(print.has('client_secret')).toBe(false);
    });

    it('uses one in-flight token request for concurrent calls', async () => {
      let resolveToken!: (value: Response) => void;
      const pendingToken = new Promise<Response>((resolve) => {
        resolveToken = resolve;
      });
      const fetchMock = jest.spyOn(global, 'fetch')
        .mockImplementationOnce(() => pendingToken)
        .mockResolvedValue(response({ error: 0, body: { state: 1 } }));
      const service = new CloudPrintingService();
      const first = service.queryPrinter('YILIAN', 'MACHINE-1');
      const second = service.queryPrinter('YILIAN', 'MACHINE-2');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      resolveToken(tokenResponse('shared-token'));

      await expect(Promise.all([first, second])).resolves.toEqual(['ONLINE', 'ONLINE']);
      expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/oauth/oauth')))
        .toHaveLength(1);
    });

    it('refreshes an invalid token exactly once and resubmits with the same origin id', async () => {
      const fetchMock = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce(tokenResponse('expired-token'))
        .mockResolvedValueOnce(response({ error: 3003, error_description: 'access_token有误', body: [] }))
        .mockResolvedValueOnce(tokenResponse('fresh-token'))
        .mockResolvedValueOnce(response({ error: 0, body: { id: 'yly-job-2', origin_id: 'job-refresh' } }));

      await expect(
        new CloudPrintingService().submit(
          'YILIAN',
          'MACHINE-TEST',
          '测试',
          'job-refresh',
        ),
      ).resolves.toEqual({ providerTaskId: 'yly-job-2', status: 'SUBMITTED' });

      expect(fetchMock).toHaveBeenCalledTimes(4);
      const firstPrint = fetchMock.mock.calls[1][1]?.body as URLSearchParams;
      const secondPrint = fetchMock.mock.calls[3][1]?.body as URLSearchParams;
      expect(firstPrint.get('origin_id')).toBe('job-refresh');
      expect(secondPrint.get('origin_id')).toBe('job-refresh');
      expect(firstPrint.get('access_token')).toBe('expired-token');
      expect(secondPrint.get('access_token')).toBe('fresh-token');
    });

    it('maps official order states without treating status zero as printed', async () => {
      jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce(tokenResponse('status-token'))
        .mockResolvedValueOnce(response({ error: 0, body: { id: 1, status: 0 } }))
        .mockResolvedValueOnce(response({ error: 0, body: { id: 1, status: 1 } }))
        .mockResolvedValueOnce(response({ error: 0, body: { id: 1, status: 2 } }));
      const service = new CloudPrintingService();

      await expect(service.queryTask('YILIAN', 'MACHINE', '1')).resolves.toBe(
        'ACCEPTED',
      );
      await expect(service.queryTask('YILIAN', 'MACHINE', '1')).resolves.toBe(
        'PRINTED',
      );
      await expect(service.queryTask('YILIAN', 'MACHINE', '1')).resolves.toBe(
        'CANCELLED',
      );
    });

    it('classifies a print transport timeout as unknown even though origin_id is idempotent', async () => {
      jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce(tokenResponse('timeout-token'))
        .mockRejectedValueOnce(new Error('timeout'));

      await expect(
        new CloudPrintingService().submit('YILIAN', 'MACHINE', '测试', 'job-timeout'),
      ).rejects.toMatchObject({
        code: PRINTING_ERROR_CODES.PRINT_OUTCOME_UNKNOWN,
        options: { outcomeUnknown: true, retryable: false },
      });
    });

    it('maps offline, paper-error, and explicit device rejection without exposing the client secret', async () => {
      const fetchMock = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce(tokenResponse('status-token'))
        .mockResolvedValueOnce(response({ error: 0, body: { state: 0 } }))
        .mockResolvedValueOnce(response({ error: 0, body: { state: 2 } }))
        .mockResolvedValueOnce(
          response({
            error: 6002,
            error_description: 'device rejected client_secret=contract-secret',
            body: [],
          }),
        );
      const service = new CloudPrintingService();

      await expect(service.queryPrinter('YILIAN', 'MACHINE')).resolves.toBe('OFFLINE');
      await expect(service.queryPrinter('YILIAN', 'MACHINE')).resolves.toBe('ERROR');
      const error = await service
        .submit('YILIAN', 'MACHINE', '测试', 'job-device-error')
        .catch((value) => value);

      expect(error).toMatchObject({
        code: PRINTING_ERROR_CODES.CLOUD_DEVICE_INVALID,
        options: { retryable: false },
      });
      expect(JSON.stringify(error)).not.toContain('contract-secret');
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });
});

function response(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

function tokenResponse(accessToken: string) {
  return response({
    error: 0,
    error_description: 'success',
    body: {
      client_id: '1000000001',
      access_token: accessToken,
      refresh_token: 'not-logged-refresh-token',
      expires_in: 2_592_000,
      refresh_expires_in: 3_024_000,
      scope: 'all',
    },
  });
}

function captureEnvironment(names: string[]) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnvironment(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
