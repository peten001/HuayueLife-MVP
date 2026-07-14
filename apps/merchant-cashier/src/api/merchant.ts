import { demoRepository, isDemoSessionActive } from '@/fixtures';
import type { MerchantProfile } from '@/types';
import { requestApi } from './http';

export function getMerchantProfile(): Promise<MerchantProfile> {
  return isDemoSessionActive()
    ? Promise.resolve(demoRepository.profile())
    : requestApi<MerchantProfile>('/merchant/profile');
}
