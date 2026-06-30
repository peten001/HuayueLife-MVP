import type { UserProfile } from '@/types/api';
import { getLocalUserProfile, setLocalUserProfile } from '@/utils/storage';

export type DefaultAvatarStyle = 'neutral' | 'male' | 'female';
export type DefaultAvatarKey =
  | 'neutral-sprout'
  | 'neutral-smile'
  | 'neutral-star'
  | 'neutral-leaf'
  | 'boy-hoodie'
  | 'boy-cap'
  | 'boy-short-hair'
  | 'girl-bob'
  | 'girl-headband'
  | 'girl-beret';

// i18n-check-allow default-user-nickname-pool
const DEFAULT_NICKNAMES = [
  '鲜味小友',
  '探店小虎',
  '青柠食客',
  '米饭搭子',
  '香菜达人',
  '小店雷达',
  '绿意小友',
  '好店发现',
  '暖心小友',
  '元气小友',
  '本地小友',
  '北江小友',
  '北宁小友',
  '寻店小鹿',
  '逛店小友',
  '清新小友',
] as const;

const AVATAR_KEYS: Record<DefaultAvatarStyle, DefaultAvatarKey[]> = {
  neutral: ['neutral-sprout', 'neutral-smile', 'neutral-star', 'neutral-leaf'],
  male: ['boy-hoodie', 'boy-cap', 'boy-short-hair'],
  female: ['girl-bob', 'girl-headband', 'girl-beret'],
};

function hashSeed(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function isEmptyNickname(value?: string | null) {
  const normalized = value?.trim();
  return !normalized || normalized === '微信用户' || normalized.toLowerCase() === 'wechat user';
}

function genderStyle(user?: Pick<UserProfile, 'gender' | 'sex'> | null): DefaultAvatarStyle {
  const raw = String(user?.gender ?? user?.sex ?? '').trim().toLowerCase();
  if (['male', '男', '1', 'm'].includes(raw)) return 'male';
  if (['female', '女', '2', 'f'].includes(raw)) return 'female';
  return 'neutral';
}

export function getDefaultNickname(seed = '') {
  return DEFAULT_NICKNAMES[hashSeed(seed || 'huayue') % DEFAULT_NICKNAMES.length];
}

export function getDefaultAvatarProfile(user?: Pick<UserProfile, 'id' | 'gender' | 'sex'> | null) {
  const style = genderStyle(user);
  const pool = AVATAR_KEYS[style];
  const seed = String(user?.id ?? 'huayue');
  return {
    defaultAvatarStyle: style,
    defaultAvatarKey: pool[hashSeed(`${seed}:${style}`) % pool.length],
  };
}

export function ensureDefaultProfile(user: UserProfile | null): UserProfile | null {
  if (!user) return null;
  const cached = getLocalUserProfile();
  const seed = String(user.id || 'huayue');
  const defaultNickname = cached?.defaultNickname || user.defaultNickname || getDefaultNickname(seed);
  const avatarProfile = getDefaultAvatarProfile(user);
  const defaultAvatarStyle = cached?.defaultAvatarStyle || user.defaultAvatarStyle || avatarProfile.defaultAvatarStyle;
  const defaultAvatarKey = cached?.defaultAvatarKey || user.defaultAvatarKey || avatarProfile.defaultAvatarKey;
  const nickname = isEmptyNickname(cached?.nickname)
    ? isEmptyNickname(user.nickname)
      ? ''
      : user.nickname
    : cached?.nickname;

  setLocalUserProfile({
    defaultNickname,
    defaultAvatarKey,
    defaultAvatarStyle,
    ...(nickname ? { nickname } : {}),
    ...(cached?.avatarUrl || user.avatarUrl ? { avatarUrl: cached?.avatarUrl || user.avatarUrl } : {}),
    ...(cached?.phone || user.phone ? { phone: cached?.phone || user.phone } : {}),
  });

  return {
    ...user,
    nickname,
    avatarUrl: cached?.avatarUrl || user.avatarUrl,
    phone: cached?.phone || user.phone,
    defaultNickname,
    defaultAvatarKey,
    defaultAvatarStyle,
  };
}
