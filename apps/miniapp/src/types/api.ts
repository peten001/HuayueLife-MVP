export interface ApiResponse<T> {
  code: string;
  message: string;
  data: T;
  requestId: string;
}

export interface TranslationEntry {
  name?: string;
  title?: string;
  description?: string;
}

export interface LocalizedNameMap {
  zh?: string;
  vi?: string;
  en?: string;
}

export interface LocalizedTranslationMap {
  zh?: TranslationEntry;
  vi?: TranslationEntry;
  en?: TranslationEntry;
}

export interface LocalizedFields {
  name?: string;
  title?: string;
  description?: string;
  nameZh?: string;
  nameVi?: string;
  nameEn?: string;
  zhName?: string;
  viName?: string;
  enName?: string;
  name_zh?: string;
  name_vi?: string;
  name_en?: string;
  titleZh?: string;
  titleVi?: string;
  titleEn?: string;
  title_zh?: string;
  title_vi?: string;
  title_en?: string;
  descriptionZh?: string;
  descriptionVi?: string;
  descriptionEn?: string;
  description_zh?: string;
  description_vi?: string;
  description_en?: string;
  localizedName?: LocalizedNameMap;
  localizedText?: LocalizedNameMap;
  translations?: LocalizedTranslationMap;
}

export interface MerchantLocalizedRef extends LocalizedFields {
  id: string;
  nameZh: string;
  nameVi?: string;
  nameEn?: string;
  logoUrl?: string;
}

export interface ProductNameSnapshot extends LocalizedFields {
  productNameZhSnapshot: string;
  productNameViSnapshot?: string;
  productNameEnSnapshot?: string;
}

export interface UserProfile {
  id: string;
  nickname?: string;
  avatarUrl?: string;
  phone?: string;
  defaultNickname?: string;
  defaultAvatarKey?: string;
  defaultAvatarStyle?: 'neutral' | 'male' | 'female';
  gender?: string | number | null;
  sex?: string | number | null;
  status: string;
}

export interface MerchantSummary extends LocalizedFields {
  id: string;
  nameZh: string;
  nameVi?: string;
  nameEn?: string;
  merchantMode?: 'DISPLAY' | 'MANAGED' | 'DISPLAY_ONLY' | 'PRODUCT_DISPLAY' | 'ONLINE_ORDER' | 'QR_ORDER';
  businessType?: {
    id: string;
    code: string;
    nameZh: string;
    nameVi?: string | null;
    nameEn?: string | null;
  } | null;
  coverUrl?: string;
  logoUrl?: string;
  addressDetail: string;
  addressZh?: string;
  addressVi?: string;
  addressEn?: string;
  openingHoursText?: string;
  descriptionZh?: string;
  descriptionVi?: string;
  descriptionEn?: string;
  province?: string;
  city: string;
  district?: string;
  status?: string;
  distanceKm: number | null;
  isOpen: boolean;
  supportedOrderTypes: Array<'DINE_IN' | 'PICKUP' | 'DELIVERY'>;
  minimumDeliveryAmountVnd: string;
  deliveryFeeVnd: string;
  latitude: string;
  longitude: string;
  deliveryRadiusKm: string;
  homepageCategoryKeys?: string[];
  manualPopular?: boolean;
  isNew?: boolean;
  promotionTags?: Array<{
    id: string;
    code: string;
    nameZh: string;
    nameVi?: string | null;
    nameEn?: string | null;
    iconText?: string | null;
    color?: string | null;
  }>;
  capabilities?: Array<{
    id: string;
    code: string;
    nameZh: string;
    nameVi?: string | null;
    nameEn?: string | null;
    isEnabled: boolean;
  }>;
  images?: Array<{
    id: string;
    imageType: string;
    imageUrl: string;
    titleZh?: string | null;
    titleVi?: string | null;
    titleEn?: string | null;
    sortOrder: number;
  }>;
}

export interface MerchantDetail extends MerchantSummary {
  logoUrl?: string;
  contactPhone: string;
  province: string;
  district?: string;
  notice?: string;
  businessHours: Record<string, string[]>;
}

export interface Product extends LocalizedFields {
  id: string;
  nameZh: string;
  nameVi?: string;
  description?: string;
  imageUrl?: string;
  priceVnd: string;
  status: 'ON_SALE' | 'SOLD_OUT';
  merchant?: MerchantLocalizedRef;
}

export interface MenuCategory extends LocalizedFields {
  id: string;
  nameZh: string;
  nameVi?: string;
  products: Product[];
}

export interface MenuResponse {
  merchant: MerchantLocalizedRef & {
    isOpen: boolean;
  };
  categories: MenuCategory[];
}

export interface QrResolveResponse {
  merchant: MerchantLocalizedRef;
  table: { id: string; tableNo: string; tableName?: string };
  orderType: 'DINE_IN';
  tableToken: string;
}

export type OrderType = 'DINE_IN' | 'PICKUP' | 'DELIVERY';
export type OrderStatus =
  | 'PENDING_ACCEPTANCE'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'DELIVERING'
  | 'COMPLETED'
  | 'CANCELLED';

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
  merchant?: MerchantLocalizedRef;
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
  merchant: MerchantLocalizedRef;
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

export interface UserOrderItem extends ProductNameSnapshot {
  id: string;
  imageUrlSnapshot?: string;
  unitPriceVnd: string;
  quantity: number;
  subtotalVnd: string;
  remark?: string;
}

export interface UserOrderStatusLog {
  id: string;
  fromStatus?: OrderStatus;
  toStatus: OrderStatus;
  operatorType: 'USER' | 'MERCHANT_STAFF' | 'SYSTEM';
  remark?: string;
  createdAt: string;
}

export type OrderChatConversationStatus = 'ACTIVE' | 'CLOSED';
export type OrderChatSenderType = 'CUSTOMER' | 'MERCHANT';

export interface OrderChatMessage {
  id: string;
  conversationId: string;
  orderId: string;
  senderType: OrderChatSenderType;
  senderId: string;
  content: string;
  readAt?: string | null;
  createdAt: string;
}

export interface UserOrderChatConversation {
  id: string;
  status: OrderChatConversationStatus;
  customerUnreadCount: number;
  merchantUnreadCount: number;
  lastMessageAt?: string | null;
  lastMessageId?: string | null;
  customerLastReadAt?: string | null;
  merchantLastReadAt?: string | null;
}

export interface UserOrder {
  id: string;
  orderNo: string;
  orderType: OrderType;
  status: OrderStatus;
  merchantName?: string;
  merchantNameZh?: string;
  merchantNameVi?: string;
  merchantNameEn?: string;
  merchantNameZhSnapshot?: string;
  merchantNameViSnapshot?: string;
  merchantNameEnSnapshot?: string;
  tableNoSnapshot?: string;
  contactName?: string;
  contactPhone?: string;
  deliveryAddress?: string;
  customerRemark?: string;
  itemAmountVnd: string;
  deliveryFeeVnd: string;
  totalAmountVnd: string;
  settlementStatus: 'UNSETTLED' | 'SETTLED';
  cancelReason?: string;
  acceptedAt?: string;
  readyAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
  merchant?: MerchantLocalizedRef;
  table?: {
    id: string;
    tableNo: string;
    tableName?: string;
  };
  items: UserOrderItem[];
  statusLogs?: UserOrderStatusLog[];
  chatConversation?: UserOrderChatConversation | null;
}
