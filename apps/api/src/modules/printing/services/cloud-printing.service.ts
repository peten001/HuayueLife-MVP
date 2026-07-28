import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export type CloudProvider = 'FEIE' | 'YILIAN';

/** Server-only cloud adapter boundary. Secrets come from environment, never printer JSON. */
@Injectable()
export class CloudPrintingService {
  async submit(provider: CloudProvider, deviceId: string, content: string, requestId: string) {
    if (provider === 'FEIE') return this.submitFeie(deviceId, content, requestId);
    return this.submitYilian(deviceId, content, requestId);
  }

  private async submitFeie(sn: string, content: string, requestId: string) {
    const user = process.env.FEIE_USER;
    const ukey = process.env.FEIE_UKEY;
    if (!user || !ukey) throw new ServiceUnavailableException('飞鹅云服务端凭据尚未配置');
    const stime = Math.floor(Date.now() / 1000).toString();
    const sig = createHash('sha1').update(user + ukey + stime).digest('hex');
    const base = process.env.FEIE_API_BASE_URL || 'https://api.feieyun.cn/Api/Open/';
    const body = new URLSearchParams({ user, stime, sig, apiname: 'Open_printMsg', sn, content, times: '1', requestID: requestId });
    const response = await fetch(new URL('printMsg', base), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new ServiceUnavailableException('飞鹅云服务暂时不可用');
    const result = await response.json() as { ret?: number; msg?: string; data?: unknown };
    if (result.ret !== 0) throw new ServiceUnavailableException('飞鹅云打印请求失败');
    return { providerJobId: typeof result.data === 'string' ? result.data : requestId, status: 'SUBMITTED' as const };
  }

  private async submitYilian(deviceId: string, content: string, requestId: string) {
    const url = process.env.YILIAN_API_BASE_URL;
    const clientId = process.env.YILIAN_CLIENT_ID;
    const clientSecret = process.env.YILIAN_CLIENT_SECRET;
    if (!url || !clientId || !clientSecret) throw new ServiceUnavailableException('易联云服务端凭据尚未配置');
    // 易联云 OAuth 新接口由官方应用配置决定；保留服务端契约，不在客户端伪造签名或成功。
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, machine_code: deviceId, content, request_id: requestId }), signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new ServiceUnavailableException('易联云服务暂时不可用');
    const result = await response.json() as { code?: number; body?: { id?: string }; msg?: string };
    if (result.code !== 0 || !result.body?.id) throw new ServiceUnavailableException('易联云打印请求失败');
    return { providerJobId: result.body.id, status: 'SUBMITTED' as const };
  }
}
