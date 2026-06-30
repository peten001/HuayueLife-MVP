import type { UserProfile } from '@/types/api';
import { request } from './http';

export function updateMe(data: {
  nickname?: string;
  avatarUrl?: string;
  phone?: string;
}) {
  return request<UserProfile>('/auth/me', {
    method: 'PATCH',
    data,
  });
}

export function wechatLogin(code: string, nickname?: string) {
  return request<{ accessToken: string; user: UserProfile }>(
    '/auth/wechat/login',
    {
      method: 'POST',
      data: nickname ? { code, nickname } : { code },
    },
  );
}

export function bindWechatPhone(data: {
  code: string;
  encryptedData?: string;
  iv?: string;
}) {
  return request<{ phone: string; user: UserProfile }>('/auth/wechat/phone', {
    method: 'POST',
    data,
  });
}

export function getMe() {
  return request<UserProfile>('/auth/me');
}
