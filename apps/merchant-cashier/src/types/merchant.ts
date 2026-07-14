import type { MerchantCapabilityValue } from './auth';

export interface MerchantProfile {
  id: string;
  nameZh: string;
  nameVi?: string | null;
  nameEn?: string | null;
  merchantType: string;
  merchantMode?: string;
  logoUrl?: string | null;
  coverUrl?: string | null;
  contactName: string;
  contactPhone: string;
  province: string;
  city: string;
  district?: string | null;
  addressDetail: string;
  addressZh?: string | null;
  addressVi?: string | null;
  addressEn?: string | null;
  latitude: string;
  longitude: string;
  businessHours: Record<string, string[]>;
  openingHoursText?: string | null;
  notice?: string | null;
  minimumDeliveryAmountVnd: string;
  deliveryFeeVnd: string;
  deliveryRadiusKm: string;
  dineInEnabled: boolean;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  isVisibleOnClient: boolean;
  status: 'PENDING' | 'ACTIVE' | 'DISABLED' | 'DELETED';
  capabilities?: MerchantCapabilityValue[];
  images?: MerchantImage[];
}

export interface MerchantImage {
  id: string;
  imageType: string;
  imageUrl: string;
  titleZh?: string | null;
  titleVi?: string | null;
  titleEn?: string | null;
  sortOrder: number;
  isVisible: boolean;
}
