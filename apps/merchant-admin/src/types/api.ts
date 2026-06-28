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
  mustChangePassword?: boolean;
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
  isVisibleOnClient: boolean;
  dineInEnabled: boolean;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  homepageCategoryKeys: string[];
  manualPopular: boolean;
  status: 'PENDING' | 'ACTIVE' | 'DISABLED' | 'DELETED';
}

export interface UpdateMerchantProfilePayload {
  nameZh?: string;
  nameVi?: string;
  logoUrl?: string;
  coverUrl?: string;
  contactName?: string;
  contactPhone?: string;
  province?: string;
  city?: string;
  district?: string;
  addressDetail?: string;
  latitude?: number;
  longitude?: number;
  businessHours?: Record<string, string[]>;
  notice?: string;
  minimumDeliveryAmountVnd?: number;
  deliveryFeeVnd?: number;
  deliveryRadiusKm?: number;
  dineInEnabled?: boolean;
  pickupEnabled?: boolean;
  deliveryEnabled?: boolean;
  homepageCategoryKeys?: string[];
}

export type DailyReportLanguage = 'zh' | 'vi';

export interface MerchantReportFeatureResponse {
  enabled: boolean;
}

export interface MerchantReportSettings {
  enabled: boolean;
  zaloRecipient: string;
  pushTime: string;
  language: DailyReportLanguage;
  aiSuggestions: boolean;
}

export interface DailyReportSummary {
  orderCount: number;
  totalAmount: string;
  averageOrderAmount: string;
  dineInCount: number;
  pickupCount: number;
  deliveryCount: number;
  statusCounts: Record<string, number>;
  topProducts: Array<{
    name: string;
    quantity: number;
  }>;
  peakHour: string;
  peakHourOrderCount: number;
  suggestions: string[];
}

export interface DailyReportPreviewResponse {
  reportDate: string;
  language: DailyReportLanguage;
  merchantName: string;
  summary: DailyReportSummary;
  imageUrl: string;
}

export interface DailyReportSendResponse {
  success: boolean;
  mocked: boolean;
  message: string;
  logId: string;
  imageUrl: string;
}

export interface PlatformAdminAccount {
  username: string;
}

export interface PlatformMerchantListItem {
  id: string;
  nameZh: string;
  city: string;
  district?: string;
  contactPhone: string;
  homepageCategoryKeys: string[];
  manualPopular: boolean;
  isVisibleOnClient: boolean;
  reportFeatureEnabled: boolean;
  status: 'PENDING' | 'ACTIVE' | 'DISABLED' | 'DELETED';
  createdAt: string;
  updatedAt: string;
  ownerUsername: string;
  ownerMustChangePassword: boolean;
  ownerStatus: 'ACTIVE' | 'DISABLED';
  profileCompletion: number;
  missingProfileFields: string[];
  todayOrderCount: number;
  todayOrderAmount: string;
  pendingAcceptanceOrderCount: number;
  preparingOrderCount: number;
  last7DaysOrderCount: number;
  lastOrderAt?: string | null;
}

export interface PlatformMerchantDetailResponse {
  merchant: {
    id: string;
    name: string;
    account: string;
    phone: string;
    city: string;
    district?: string | null;
    address: string;
    status: 'PENDING' | 'ACTIVE' | 'DISABLED' | 'DELETED';
    isActive: boolean;
    logoUrl?: string | null;
    coverUrl?: string | null;
    homepageCategoryKeys: string[];
    manualPopular: boolean;
    isVisibleOnClient: boolean;
    reportFeatureEnabled: boolean;
    profileCompletion: number;
    createdAt: string;
    updatedAt: string;
  };
  metrics: {
    todayOrderCount: number;
    todayOrderAmount: string;
    pendingAcceptanceOrderCount: number;
    preparingOrderCount: number;
    last7DaysOrderCount: number;
    last7DaysOrderAmount: string;
    completedOrderCount: number;
    canceledOrderCount: number;
    completionRate: number | null;
    averageOrderAmount: string | null;
    lastOrderAt: string | null;
  };
  trend: Array<{
    date: string;
    orderCount: number;
    orderAmount: string;
  }>;
  operation: {
    menuCategoryCount: number;
    dishCount: number;
    activeDishCount: number;
    tableCount: number;
    activeTableCount: number;
  };
  recentOrders: Array<{
    id: string;
    orderNo: string;
    orderType: OrderType;
    status: OrderStatus;
    totalAmount: string;
    contactPhone?: string | null;
    createdAt: string;
  }>;
}

export interface PlatformDashboardData {
  overview: {
    todayOrderCount: number;
    todayOrderAmount: string;
    todayActiveMerchantCount: number;
    todayNewMerchantCount: number;
    pendingAcceptanceOrderCount: number;
    preparingOrderCount: number;
  };
  alerts: {
    longPendingOrderCount: number;
    highCancelRateMerchantCount: number;
    merchantsMissingHomepageCategoryCount: number;
  };
  trends: Array<{
    date: string;
    orderCount: number;
    orderAmount: string;
    activeMerchantCount: number;
  }>;
  rankings: Array<{
    merchantId: string;
    merchantName: string;
    city: string;
    district?: string | null;
    businessStatus: 'PENDING' | 'ACTIVE' | 'DISABLED' | 'DELETED';
    orderCount: number;
    orderAmount: string;
  }>;
}

export interface PlatformOrderListItem {
  id: string;
  orderNo: string;
  merchantId: string;
  merchantName: string;
  merchantCity?: string;
  merchantDistrict?: string | null;
  orderType: OrderType;
  status: OrderStatus;
  totalAmount: string;
  contactName?: string | null;
  contactPhone?: string | null;
  tableName?: string | null;
  tableNo?: string | null;
  deliveryAddress?: string | null;
  pickupName?: string | null;
  customerRemark?: string | null;
  cancelReason?: string | null;
  createdAt: string;
  acceptedAt?: string | null;
  readyAt?: string | null;
  completedAt?: string | null;
  canceledAt?: string | null;
  items: Array<{
    id: string;
    productNameZhSnapshot: string;
    unitPriceVnd: string;
    quantity: number;
    subtotalVnd: string;
    remark?: string | null;
  }>;
  statusLogs: Array<{
    id: string;
    fromStatus?: OrderStatus | null;
    toStatus: OrderStatus;
    operatorType: 'USER' | 'MERCHANT_STAFF' | 'SYSTEM';
    remark?: string | null;
    createdAt: string;
  }>;
}

export interface PlatformUserListItem {
  id: string;
  nickname: string | null;
  phone: string | null;
  avatarUrl: string | null;
  city: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  orderCount: number;
  orderAmount: string;
  completedOrderCount: number;
  canceledOrderCount: number;
  lastOrderAt: string | null;
}

export interface PlatformUsersSummary {
  userCount: number;
  boundPhoneUserCount: number;
  todayNewUserCount: number;
  orderUserCount: number;
}

export interface PlatformUsersResponse {
  items: PlatformUserListItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: PlatformUsersSummary;
}

export interface PlatformUserDetailResponse {
  user: {
    id: string;
    nickname: string | null;
    phone: string | null;
    avatarUrl: string | null;
    city: string | null;
    createdAt: string;
    lastLoginAt: string | null;
  };
  metrics: {
    orderCount: number;
    orderAmount: string;
    completedOrderCount: number;
    canceledOrderCount: number;
    lastOrderAt: string | null;
    averageOrderAmount: string | null;
  };
  recentOrders: Array<{
    id: string;
    orderNo: string;
    merchantId: string;
    merchantName: string;
    orderType: OrderType;
    status: OrderStatus;
    totalAmount: string;
    createdAt: string;
  }>;
}

export interface PlatformOrdersResponse {
  items: PlatformOrderListItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: {
    todayOrderCount: number;
    pendingOrderCount: number;
    completedRate: number | null;
    todayOrderAmount: string;
  };
}

export interface PlatformAnalyticsResponse {
  summary: {
    orderCount: number;
    orderAmount: string;
    completedOrderCount: number;
    canceledOrderCount: number;
    pendingOrderCount: number;
    averageOrderAmount: string | null;
    completionRate: number | null;
    cancelRate: number | null;
  };
  trend: Array<{
    date: string;
    orderCount: number;
    orderAmount: string;
  }>;
  orderTypeDistribution: Array<{
    type: OrderType;
    count: number;
    amount: string;
  }>;
  statusDistribution: Array<{
    status: OrderStatus;
    count: number;
    amount: string;
  }>;
  merchantRankingByOrders: Array<{
    merchantId: string;
    merchantName: string;
    city: string;
    orderCount: number;
    orderAmount: string;
  }>;
  merchantRankingByAmount: Array<{
    merchantId: string;
    merchantName: string;
    city: string;
    orderCount: number;
    orderAmount: string;
  }>;
  cityStats: Array<{
    city: string;
    orderCount: number;
    orderAmount: string;
    merchantCount: number;
  }>;
}

export interface PlatformAnalyticsFilters {
  dateFrom?: string;
  dateTo?: string;
  city?: string;
  merchantId?: string;
}

export interface PlatformOrderFilters {
  page?: number;
  pageSize?: number;
  dateFrom?: string;
  dateTo?: string;
  merchantKeyword?: string;
  city?: string;
  orderType?: OrderType | '';
  status?: OrderStatus | '';
  phone?: string;
  orderNo?: string;
}

export interface PlatformUsersFilters {
  page?: number;
  pageSize?: number;
  keyword?: string;
  phone?: string;
  city?: string;
  dateFrom?: string;
  dateTo?: string;
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
export type PrinterStatus = 'UNKNOWN' | 'ONLINE' | 'OFFLINE';
export type PrintLogStatus = 'PENDING' | 'PRINTING' | 'SUCCESS' | 'FAILED';
export type PrintLanguage = 'zh' | 'vi' | 'en';
export type PaperWidth = 'WIDTH_58' | 'WIDTH_80';
export type PrinterUsageType = 'FRONT_DESK' | 'KITCHEN' | 'BAR' | 'GENERAL';
export type PrinterEncoding = 'UTF8' | 'GBK' | 'CP1258';

export interface PrinterSetting {
  id: string;
  merchantId: string;
  name: string;
  type: 'NETWORK';
  usageType: PrinterUsageType;
  encoding: PrinterEncoding;
  ipAddress: string;
  port: number;
  paperWidth: PaperWidth;
  copies: number;
  language: PrintLanguage;
  autoPrintEnabled: boolean;
  isDefault: boolean;
  status: PrinterStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PrinterPayload {
  name: string;
  ipAddress: string;
  port?: number;
  paperWidth?: 58 | 80;
  usageType?: PrinterUsageType;
  encoding?: PrinterEncoding;
  copies?: number;
  language?: PrintLanguage;
  autoPrintEnabled?: boolean;
  isDefault?: boolean;
}

export interface PrintLog {
  id: string;
  printerId?: string | null;
  status: PrintLogStatus;
  errorMessage?: string | null;
  printedBy: 'SYSTEM' | 'MERCHANT';
  createdAt: string;
  printer?: {
    id: string;
    name: string;
    ipAddress: string;
    port: number;
  } | null;
}

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

export interface MerchantOrderChatConversation {
  id: string;
  status: OrderChatConversationStatus;
  merchantUnreadCount: number;
  customerUnreadCount: number;
  lastMessageAt?: string | null;
  lastMessageId?: string | null;
  merchantLastReadAt?: string | null;
  customerLastReadAt?: string | null;
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
  chatConversation?: MerchantOrderChatConversation | null;
  printLogs?: PrintLog[];
}
