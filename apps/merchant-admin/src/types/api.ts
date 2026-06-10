export interface ApiResponse<T> {
  code: string;
  message: string;
  data: T;
  requestId: string;
  timestamp: string;
}

export interface MerchantProfile {
  id: string;
  nameZh: string;
  nameVi?: string;
  merchantType: 'RESTAURANT';
  logoUrl?: string;
  coverUrl?: string;
  contactName: string;
  contactPhone: string;
  province: string;
  city: string;
  district?: string;
  addressDetail: string;
  latitude: string;
  longitude: string;
  businessHours: Record<string, string[]>;
  notice?: string;
  minimumDeliveryAmountVnd: string;
  deliveryFeeVnd: string;
  deliveryRadiusKm: string;
  dineInEnabled: boolean;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  status: string;
}

export interface Category {
  id: string;
  nameZh: string;
  nameVi?: string;
  sortOrder: number;
  isActive: boolean;
  _count?: { products: number };
}

export type ProductStatus = 'DRAFT' | 'ON_SALE' | 'SOLD_OUT' | 'OFF_SALE';

export interface Product {
  id: string;
  categoryId: string;
  nameZh: string;
  nameVi?: string;
  description?: string;
  imageUrl?: string;
  priceVnd: string;
  sortOrder: number;
  status: ProductStatus;
  productType: 'FOOD';
  category: Category;
}

export interface DiningTable {
  id: string;
  tableNo: string;
  tableName?: string;
  qrToken: string;
  qrVersion: number;
  status: 'ACTIVE' | 'DISABLED';
}
