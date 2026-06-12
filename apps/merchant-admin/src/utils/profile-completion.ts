import type { MerchantProfile } from '@/types/api';

export type ProfileMissingField =
  | 'merchantName'
  | 'logoUrl'
  | 'coverUrl'
  | 'addressDetail'
  | 'businessHoursSection'
  | 'contactPhone';

export interface ProfileCompletionResult {
  completion: number;
  missingFields: ProfileMissingField[];
}

export function computeProfileCompletion(
  profile: Pick<
    MerchantProfile,
    | 'nameZh'
    | 'logoUrl'
    | 'coverUrl'
    | 'province'
    | 'city'
    | 'addressDetail'
    | 'businessHours'
    | 'contactPhone'
  >,
): ProfileCompletionResult {
  const total = 6;
  const missingFields: ProfileMissingField[] = [];

  if (!profile.nameZh?.trim() || profile.nameZh.startsWith('新商户-')) {
    missingFields.push('merchantName');
  }
  if (!profile.logoUrl?.trim()) {
    missingFields.push('logoUrl');
  }
  if (!profile.coverUrl?.trim()) {
    missingFields.push('coverUrl');
  }
  if (
    !profile.province?.trim() ||
    profile.province === '待完善' ||
    !profile.city?.trim() ||
    profile.city === '待完善' ||
    !profile.addressDetail?.trim() ||
    profile.addressDetail === '待完善'
  ) {
    missingFields.push('addressDetail');
  }
  if (!hasBusinessHours(profile.businessHours)) {
    missingFields.push('businessHoursSection');
  }
  if (!profile.contactPhone?.trim()) {
    missingFields.push('contactPhone');
  }

  const completion = Math.max(
    0,
    Math.min(100, Math.round(((total - missingFields.length) / total) * 100)),
  );
  return { completion, missingFields };
}

function hasBusinessHours(value: MerchantProfile['businessHours']) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).some(
    (items) =>
      Array.isArray(items) &&
      items.some((item) => typeof item === 'string' && item.trim().length > 0),
  );
}
