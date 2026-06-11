export interface ApiResponse<T> {
  code: string;
  message: string;
  data: T;
  requestId: string;
  timestamp: string;
}

export type MerchantStaffRole = 'OWNER' | 'MANAGER' | 'STAFF';

export interface MerchantStaffAccount {
  id: string;
  displayName: string;
  role: MerchantStaffRole;
  merchant: {
    id: string;
    nameZh: string;
    status: string;
  };
}

export interface MerchantStaffListItem {
  id: string;
  username: string;
  displayName: string;
  role: MerchantStaffRole;
  status: 'ACTIVE' | 'DISABLED';
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
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

export type OrderStatus =
  | 'PENDING_ACCEPTANCE'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'DELIVERING'
  | 'COMPLETED'
  | 'CANCELLED';

export type OrderType = 'DINE_IN' | 'PICKUP' | 'DELIVERY';
export type SettlementStatus = 'UNSETTLED' | 'SETTLED';

export interface OrderItem {
  id: string;
  productNameZhSnapshot: string;
  imageUrlSnapshot?: string;
  unitPriceVnd: string;
  quantity: number;
  subtotalVnd: string;
  remark?: string;
}

export interface OrderStatusLog {
  id: string;
  fromStatus?: OrderStatus;
  toStatus: OrderStatus;
  operatorType: 'USER' | 'MERCHANT_STAFF' | 'SYSTEM';
  operatorStaffId?: string;
  operatorStaff?: {
    id: string;
    displayName: string;
  };
  remark?: string;
  createdAt: string;
}

export interface MerchantOrder {
  id: string;
  orderNo: string;
  merchantId: string;
  tableNoSnapshot?: string;
  orderType: OrderType;
  status: OrderStatus;
  contactName?: string;
  contactPhone?: string;
  deliveryAddress?: string;
  customerRemark?: string;
  itemAmountVnd: string;
  deliveryFeeVnd: string;
  totalAmountVnd: string;
  settlementStatus: SettlementStatus;
  cancelReason?: string;
  acceptedAt?: string;
  readyAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
  table?: {
    id: string;
    tableNo: string;
    tableName?: string;
  };
  user?: {
    id: string;
    nickname?: string;
    phone?: string;
  };
  items: OrderItem[];
  statusLogs?: OrderStatusLog[];
}
