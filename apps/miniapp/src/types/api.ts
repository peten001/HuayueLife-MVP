export interface ApiResponse<T> {
  code: string;
  message: string;
  data: T;
  requestId: string;
}

export interface UserProfile {
  id: string;
  nickname?: string;
  avatarUrl?: string;
  phone?: string;
  status: string;
}

export interface MerchantSummary {
  id: string;
  nameZh: string;
  nameVi?: string;
  coverUrl?: string;
  addressDetail: string;
  city: string;
  distanceKm: number | null;
  isOpen: boolean;
  supportedOrderTypes: Array<'DINE_IN' | 'PICKUP' | 'DELIVERY'>;
  minimumDeliveryAmountVnd: string;
  deliveryFeeVnd: string;
}

export interface MerchantDetail extends MerchantSummary {
  logoUrl?: string;
  contactPhone: string;
  province: string;
  district?: string;
  notice?: string;
  businessHours: Record<string, string[]>;
}

export interface Product {
  id: string;
  nameZh: string;
  nameVi?: string;
  description?: string;
  imageUrl?: string;
  priceVnd: string;
  status: 'ON_SALE' | 'SOLD_OUT';
  merchant?: { id: string; nameZh: string };
}

export interface MenuCategory {
  id: string;
  nameZh: string;
  nameVi?: string;
  products: Product[];
}

export interface MenuResponse {
  merchant: {
    id: string;
    nameZh: string;
    nameVi?: string;
    isOpen: boolean;
  };
  categories: MenuCategory[];
}

export interface QrResolveResponse {
  merchant: { id: string; nameZh: string; nameVi?: string };
  table: { id: string; tableNo: string; tableName?: string };
  orderType: 'DINE_IN';
  tableToken: string;
}

export type OrderType = 'DINE_IN' | 'PICKUP' | 'DELIVERY';

export interface CartItem {
  id: string;
  quantity: number;
  remark: string;
  product: Product;
}

export interface Cart {
  id: string | null;
  merchantId: string;
  tableId: string | null;
  orderType: OrderType;
  merchant?: { id: string; nameZh: string };
  table?: {
    id: string;
    tableNo: string;
    tableName?: string;
    qrToken: string;
  };
  items: CartItem[];
  itemAmountVnd: string;
  totalQuantity: number;
}

export interface CartContext {
  merchantId: string;
  merchantName: string;
  orderType: OrderType;
  tableToken?: string;
  tableNo?: string;
  tableName?: string;
}

export interface OrderPreview {
  cartId: string;
  merchant: { id: string; nameZh: string };
  table: { id: string; tableNo: string; tableName?: string } | null;
  orderType: OrderType;
  items: Array<CartItem & { subtotalVnd: string }>;
  itemAmountVnd: string;
  deliveryFeeVnd: string;
  totalAmountVnd: string;
  deliveryRangeVerified: boolean;
  requiresPhoneConfirmation: boolean;
}

export interface CreatedOrder {
  id: string;
  orderNo: string;
  status: 'PENDING_ACCEPTANCE';
  orderType: OrderType;
  totalAmountVnd: string;
}
