import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  PRINTING_ERROR_CODES,
  PrintingErrorCode,
  sanitizePrintingError,
} from '../types/printing-errors';

export type CloudProvider = 'FEIE' | 'YILIAN';
export type CloudProviderTaskStatus =
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'PRINTED'
  | 'CANCELLED';
export type CloudProviderPrinterStatus = 'ONLINE' | 'OFFLINE' | 'ERROR';

export interface CloudProviderSubmission {
  providerTaskId: string;
  status: 'SUBMITTED';
}

export interface CloudProviderConfiguration {
  enabled: boolean;
  configured: boolean;
}

/**
 * A classified provider failure. `outcomeUnknown` is deliberately separate
 * from `retryable`: a timed-out submission may already have reached a printer
 * and therefore must never be retried automatically.
 */
export class CloudProviderError extends Error {
  constructor(
    public readonly code: PrintingErrorCode,
    message: string,
    public readonly options: {
      retryable: boolean;
      outcomeUnknown?: boolean;
      notConfigured?: boolean;
      providerCode?: string;
    },
  ) {
    super(sanitizePrintingError(message) ?? '云打印服务异常');
    this.name = 'CloudProviderError';
  }
}

type YilianToken = {
  value: string;
  expiresAt: number;
};

type ProviderPhase = 'AUTH' | 'DEVICE_QUERY' | 'SUBMIT' | 'TASK_QUERY' | 'VERIFY';

/** Server-only provider boundary. No provider secret is accepted from printer JSON. */
@Injectable()
export class CloudPrintingService {
  private yilianToken: YilianToken | null = null;
  private yilianTokenRequest: Promise<YilianToken> | null = null;

  configurationStatus() {
    return {
      FEIE: this.feieConfiguration(),
      YILIAN: this.yilianConfiguration(),
    } satisfies Record<CloudProvider, CloudProviderConfiguration>;
  }

  isConfigured(provider: CloudProvider) {
    return this.configurationStatus()[provider].configured;
  }

  async submit(
    provider: CloudProvider,
    deviceId: string,
    content: string,
    requestId: string,
  ): Promise<CloudProviderSubmission> {
    this.assertRequest(deviceId, content, requestId);
    return provider === 'FEIE'
      ? this.submitFeie(deviceId, content)
      : this.submitYilian(deviceId, content, requestId);
  }

  async queryTask(
    provider: CloudProvider,
    deviceId: string,
    providerTaskId: string,
  ): Promise<CloudProviderTaskStatus> {
    if (!deviceId.trim() || !providerTaskId.trim()) {
      throw this.configurationError('云打印设备号和厂商任务号不能为空');
    }
    return provider === 'FEIE'
      ? this.queryFeieTask(providerTaskId)
      : this.queryYilianTask(deviceId, providerTaskId);
  }

  async queryPrinter(
    provider: CloudProvider,
    deviceId: string,
  ): Promise<CloudProviderPrinterStatus> {
    if (!deviceId.trim()) throw this.configurationError('云打印设备号不能为空');
    return provider === 'FEIE'
      ? this.queryFeiePrinter(deviceId)
      : this.queryYilianPrinter(deviceId);
  }

  /**
   * Optional onboarding verification. Device keys are read only from the
   * server environment and are never persisted in Printer.connectionConfig.
   */
  async verifyDevice(provider: CloudProvider, deviceId: string) {
    const deviceKey = this.deviceKey(provider, deviceId);
    if (!deviceKey) return this.queryPrinter(provider, deviceId);
    if (provider === 'FEIE') {
      const result = await this.feieRequest('getModel', 'Open_getModel', {
        sn: deviceId,
        key: deviceKey,
      }, 'VERIFY');
      if (!isObject(result.data) || !Number.isInteger(result.data.model)) {
        throw this.providerRejected('飞鹅设备验证结果无效');
      }
      return 'ONLINE' as const;
    }
    await this.yilianRequest('/printer/addprinter', {
      machine_code: deviceId,
      msign: deviceKey,
    }, 'VERIFY');
    return this.queryYilianPrinter(deviceId);
  }

  private async submitFeie(sn: string, content: string) {
    if (Buffer.byteLength(content, 'utf8') > 5_000) {
      throw this.configurationError('飞鹅打印内容不能超过 5000 字节');
    }
    const result = await this.feieRequest('printMsg', 'Open_printMsg', {
      sn,
      content,
      times: '1',
    }, 'SUBMIT');
    if (typeof result.data !== 'string' || !result.data.trim()) {
      throw this.providerRejected('飞鹅未返回有效任务号');
    }
    return { providerTaskId: result.data.trim(), status: 'SUBMITTED' as const };
  }

  private async queryFeieTask(providerTaskId: string) {
    const result = await this.feieRequest(
      'queryOrderState',
      'Open_queryOrderState',
      { orderid: providerTaskId },
      'TASK_QUERY',
    );
    if (result.data === true) return 'PRINTED' as const;
    if (result.data === false) return 'ACCEPTED' as const;
    throw this.providerQueryError('飞鹅任务状态暂时无法确认');
  }

  private async queryFeiePrinter(sn: string) {
    const result = await this.feieRequest(
      'queryPrinterStatus',
      'Open_queryPrinterStatus',
      { sn },
      'DEVICE_QUERY',
    );
    const value = typeof result.data === 'string' ? result.data : '';
    if (/离线|offline/i.test(value)) return 'OFFLINE' as const;
    if (/在线.*不正常|异常|缺纸|error/i.test(value)) return 'ERROR' as const;
    if (/在线|online/i.test(value)) return 'ONLINE' as const;
    throw this.providerQueryError('飞鹅打印机状态暂时无法确认');
  }

  private async feieRequest(
    endpoint: string,
    apiName: string,
    privateParameters: Record<string, string>,
    phase: ProviderPhase,
  ) {
    const configuration = this.feieConfiguration();
    if (!configuration.configured) {
      throw this.notConfigured('飞鹅云服务尚未配置');
    }
    const user = process.env.FEIE_USER!.trim();
    const ukey = process.env.FEIE_UKEY!;
    const stime = Math.floor(Date.now() / 1_000).toString();
    const sig = createHash('sha1').update(user + ukey + stime).digest('hex');
    const body = new URLSearchParams({
      user,
      stime,
      sig,
      apiname: apiName,
      ...privateParameters,
    });
    const result = await this.postForm(
      providerUrl(this.feieBaseUrl(), endpoint),
      body,
      phase,
    ) as { ret?: unknown; msg?: unknown; data?: unknown };
    if (result.ret !== 0) {
      throw this.mapFeieError(result.ret, result.msg, phase);
    }
    return result;
  }

  private async submitYilian(
    machineCode: string,
    content: string,
    requestId: string,
  ) {
    const result = await this.yilianRequest('/print/index', {
      machine_code: machineCode,
      origin_id: requestId,
      content,
      idempotence: '1',
    }, 'SUBMIT');
    const body = isObject(result.body) ? result.body : {};
    const taskId = body.id;
    if ((typeof taskId !== 'string' && typeof taskId !== 'number') || !String(taskId)) {
      throw this.providerRejected('易联云未返回有效任务号');
    }
    return { providerTaskId: String(taskId), status: 'SUBMITTED' as const };
  }

  private async queryYilianTask(machineCode: string, providerTaskId: string) {
    const result = await this.yilianRequest('/printer/getorderstatus', {
      machine_code: machineCode,
      order_id: providerTaskId,
    }, 'TASK_QUERY');
    const body = isObject(result.body) ? result.body : {};
    if (body.status === 1 || body.status === '1') return 'PRINTED' as const;
    if (body.status === 0 || body.status === '0') return 'ACCEPTED' as const;
    if (body.status === 2 || body.status === '2') return 'CANCELLED' as const;
    throw this.providerQueryError('易联云任务状态暂时无法确认');
  }

  private async queryYilianPrinter(machineCode: string) {
    const result = await this.yilianRequest('/printer/getprintstatus', {
      machine_code: machineCode,
    }, 'DEVICE_QUERY');
    const body = isObject(result.body) ? result.body : {};
    if (body.state === 1 || body.state === '1') return 'ONLINE' as const;
    if (body.state === 0 || body.state === '0') return 'OFFLINE' as const;
    if (body.state === 2 || body.state === '2') return 'ERROR' as const;
    throw this.providerQueryError('易联云打印机状态暂时无法确认');
  }

  private async yilianRequest(
    path: string,
    privateParameters: Record<string, string>,
    phase: ProviderPhase,
    tokenRefreshAllowed = true,
  ): Promise<{ error?: unknown; error_description?: unknown; body?: unknown }> {
    const configuration = this.yilianConfiguration();
    if (!configuration.configured) {
      throw this.notConfigured('易联云服务尚未配置');
    }
    const token = await this.yilianAccessToken();
    const clientId = process.env.YILIAN_CLIENT_ID!.trim();
    const clientSecret = process.env.YILIAN_CLIENT_SECRET!;
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const body = new URLSearchParams({
      client_id: clientId,
      sign: md5(clientId + timestamp + clientSecret),
      timestamp,
      id: randomUUID(),
      access_token: token.value,
      ...privateParameters,
    });
    const result = await this.postForm(
      providerUrl(this.yilianBaseUrl(), path),
      body,
      phase,
    ) as { error?: unknown; error_description?: unknown; body?: unknown };
    const errorCode = Number(result.error);
    if (errorCode === 0) return result;
    if (errorCode === 3003 && tokenRefreshAllowed) {
      this.yilianToken = null;
      await this.yilianAccessToken(true);
      return this.yilianRequest(path, privateParameters, phase, false);
    }
    throw this.mapYilianError(errorCode, result.error_description, phase);
  }

  private async yilianAccessToken(force = false) {
    const now = Date.now();
    if (force) this.yilianToken = null;
    if (!force && this.yilianToken && this.yilianToken.expiresAt > now + 60_000) {
      return this.yilianToken;
    }
    if (this.yilianTokenRequest) return this.yilianTokenRequest;
    const request = this.fetchYilianToken();
    this.yilianTokenRequest = request;
    try {
      this.yilianToken = await request;
      return this.yilianToken;
    } finally {
      if (this.yilianTokenRequest === request) this.yilianTokenRequest = null;
    }
  }

  private async fetchYilianToken(): Promise<YilianToken> {
    const configuration = this.yilianConfiguration();
    if (!configuration.configured) {
      throw this.notConfigured('易联云服务尚未配置');
    }
    const clientId = process.env.YILIAN_CLIENT_ID!.trim();
    const clientSecret = process.env.YILIAN_CLIENT_SECRET!;
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'client_credentials',
      sign: md5(clientId + timestamp + clientSecret),
      scope: 'all',
      timestamp,
      id: randomUUID(),
    });
    const result = await this.postForm(
      providerUrl(this.yilianBaseUrl(), '/oauth/oauth'),
      body,
      'AUTH',
    ) as { error?: unknown; error_description?: unknown; body?: unknown };
    const errorCode = Number(result.error);
    if (errorCode !== 0) {
      throw this.mapYilianError(errorCode, result.error_description, 'AUTH');
    }
    const responseBody = isObject(result.body) ? result.body : {};
    if (typeof responseBody.access_token !== 'string' || !responseBody.access_token) {
      throw this.credentialsError('易联云授权响应无有效调用凭证');
    }
    const expiresIn = Number(responseBody.expires_in);
    const ttl = Number.isFinite(expiresIn) && expiresIn > 300
      ? expiresIn * 1_000 - 60_000
      : 24 * 60 * 60 * 1_000;
    return { value: responseBody.access_token, expiresAt: Date.now() + ttl };
  }

  private async postForm(url: URL, body: URLSearchParams, phase: ProviderPhase) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs()),
      });
    } catch {
      throw this.transportError(phase);
    }
    if (!response.ok) throw this.transportError(phase);
    try {
      return await response.json() as unknown;
    } catch {
      throw this.transportError(phase);
    }
  }

  private mapFeieError(ret: unknown, message: unknown, phase: ProviderPhase) {
    const providerCode = typeof ret === 'number' || typeof ret === 'string'
      ? String(ret)
      : 'UNKNOWN';
    const safeMessage = sanitizePrintingError(
      typeof message === 'string' ? message : '飞鹅云请求失败',
    ) ?? '飞鹅云请求失败';
    if (/帐号|账户|user|ukey|签名|授权|未注册/i.test(safeMessage)) {
      return this.credentialsError('飞鹅云开发者凭据无效', providerCode);
    }
    if (/打印机|设备|SN|编号|不存在|未添加|识别码/i.test(safeMessage)) {
      return this.deviceError('飞鹅打印机编号或设备密钥无效', providerCode);
    }
    if (/离线|缺纸/i.test(safeMessage)) {
      return new CloudProviderError(
        PRINTING_ERROR_CODES.PRINTER_OFFLINE,
        '飞鹅打印机当前离线或异常',
        { retryable: phase !== 'TASK_QUERY', providerCode },
      );
    }
    return this.providerRejected('飞鹅云拒绝了本次请求', providerCode);
  }

  private mapYilianError(code: number, message: unknown, phase: ProviderPhase) {
    const providerCode = Number.isFinite(code) ? String(code) : 'UNKNOWN';
    if (code === 3003 || phase === 'AUTH') {
      return this.credentialsError('易联云开发者凭据或调用凭证无效', providerCode);
    }
    if (code === 6001) {
      return new CloudProviderError(
        PRINTING_ERROR_CODES.PRINTER_OFFLINE,
        '易联云打印机当前离线、未绑定或异常',
        { retryable: phase === 'SUBMIT' || phase === 'DEVICE_QUERY', providerCode },
      );
    }
    if (code === 6002 || code === 3002) {
      return this.deviceError('易联云终端号、设备密钥或权限无效', providerCode);
    }
    if (code === 999 || code === 9999) {
      return new CloudProviderError(
        PRINTING_ERROR_CODES.CLOUD_PROVIDER_UNAVAILABLE,
        '易联云服务暂时不可用',
        {
          retryable: phase !== 'SUBMIT',
          outcomeUnknown: phase === 'SUBMIT',
          providerCode,
        },
      );
    }
    return this.providerRejected(
      sanitizePrintingError(typeof message === 'string' ? message : undefined) ??
        '易联云拒绝了本次请求',
      providerCode,
    );
  }

  private feieConfiguration(): CloudProviderConfiguration {
    const enabled = enabledFlag(process.env.FEIE_ENABLED);
    return {
      enabled,
      configured: enabled && Boolean(process.env.FEIE_USER?.trim() && process.env.FEIE_UKEY),
    };
  }

  private yilianConfiguration(): CloudProviderConfiguration {
    const enabled = enabledFlag(process.env.YILIAN_ENABLED);
    return {
      enabled,
      configured:
        enabled &&
        Boolean(
          process.env.YILIAN_CLIENT_ID?.trim() &&
          process.env.YILIAN_CLIENT_SECRET,
        ),
    };
  }

  private feieBaseUrl() {
    return process.env.FEIE_API_BASE_URL || 'https://api.feieyun.cn/Api/Open/';
  }

  private yilianBaseUrl() {
    return process.env.YILIAN_API_BASE_URL || 'https://open-api-os.10ss.net/v2/';
  }

  private timeoutMs() {
    return boundedInteger(process.env.CLOUD_PRINT_PROVIDER_TIMEOUT_MS, 8_000, 1_000, 30_000);
  }

  private deviceKey(provider: CloudProvider, deviceId: string) {
    const raw = provider === 'FEIE'
      ? process.env.FEIE_DEVICE_KEYS_JSON
      : process.env.YILIAN_DEVICE_KEYS_JSON;
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isObject(parsed)) return null;
      const value = parsed[deviceId];
      return typeof value === 'string' && value ? value : null;
    } catch {
      throw this.configurationError(`${provider} 设备密钥映射不是有效 JSON`);
    }
  }

  private assertRequest(deviceId: string, content: string, requestId: string) {
    if (!deviceId.trim()) throw this.configurationError('云打印设备号不能为空');
    if (!content.trim()) throw this.configurationError('云打印内容不能为空');
    if (!requestId.trim() || Buffer.byteLength(requestId, 'utf8') > 64) {
      throw this.configurationError('云打印幂等请求号不能为空且不能超过 64 字节');
    }
  }

  private notConfigured(message: string) {
    return new CloudProviderError(
      PRINTING_ERROR_CODES.CLOUD_PROVIDER_NOT_CONFIGURED,
      message,
      { retryable: false, notConfigured: true },
    );
  }

  private configurationError(message: string) {
    return new CloudProviderError(
      PRINTING_ERROR_CODES.CONFIG_INVALID,
      message,
      { retryable: false },
    );
  }

  private credentialsError(message: string, providerCode?: string) {
    return new CloudProviderError(
      PRINTING_ERROR_CODES.CLOUD_CREDENTIALS_INVALID,
      message,
      { retryable: false, providerCode },
    );
  }

  private deviceError(message: string, providerCode?: string) {
    return new CloudProviderError(
      PRINTING_ERROR_CODES.CLOUD_DEVICE_INVALID,
      message,
      { retryable: false, providerCode },
    );
  }

  private providerRejected(message: string, providerCode?: string) {
    return new CloudProviderError(
      PRINTING_ERROR_CODES.CLOUD_PROVIDER_REJECTED,
      message,
      { retryable: false, providerCode },
    );
  }

  private providerQueryError(message: string) {
    return new CloudProviderError(
      PRINTING_ERROR_CODES.CLOUD_RESULT_PENDING,
      message,
      { retryable: true },
    );
  }

  private transportError(phase: ProviderPhase) {
    const submissionUnknown = phase === 'SUBMIT';
    return new CloudProviderError(
      submissionUnknown
        ? PRINTING_ERROR_CODES.PRINT_OUTCOME_UNKNOWN
        : PRINTING_ERROR_CODES.CLOUD_PROVIDER_UNAVAILABLE,
      submissionUnknown
        ? '云打印提交结果暂时无法确认'
        : '云打印服务暂时不可用',
      {
        retryable: !submissionUnknown,
        outcomeUnknown: submissionUnknown,
      },
    );
  }
}

function providerUrl(base: string, path: string) {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return new URL(path.replace(/^\//, ''), normalizedBase);
}

function enabledFlag(value: string | undefined) {
  return value?.trim().toLowerCase() === 'true';
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

function md5(value: string) {
  return createHash('md5').update(value).digest('hex');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
