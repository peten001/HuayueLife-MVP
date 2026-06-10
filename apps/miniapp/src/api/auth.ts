import type { UserProfile } from '@/types/api';
import { request } from './http';

export function wechatLogin(code: string) {
  return request<{ accessToken: string; user: UserProfile }>(
    '/auth/wechat/login',
    {
      method: 'POST',
      data: { code },
    },
  );
}

export function getMe() {
  return request<UserProfile>('/me');
}
