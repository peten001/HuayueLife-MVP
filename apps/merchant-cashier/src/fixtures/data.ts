import type {
  CashierMenuCategory,
  CashierMenuProduct,
  DiningTable,
  MerchantOrder,
  MerchantProfile,
  MerchantStaffSession,
} from '@/types';

const now = Date.now();
const isoMinutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

export const demoStaffSession: MerchantStaffSession = {
  id: 'demo-staff',
  displayName: '演示员工 / Nhân viên demo',
  username: 'demo',
  role: 'MANAGER',
  mustChangePassword: false,
  demo: true,
  merchant: {
    id: 'demo-merchant',
    nameZh: '演示餐厅（非真实数据）',
    status: 'ACTIVE',
    merchantMode: 'QR_ORDER',
    capabilities: [
      { code: 'onlineOrderEnabled', nameZh: '在线下单', isEnabled: true },
      { code: 'pickupEnabled', nameZh: '到店自取', isEnabled: true },
      { code: 'deliveryEnabled', nameZh: '商家配送', isEnabled: true },
      { code: 'qrOrderEnabled', nameZh: '到店扫码点餐', isEnabled: true },
      { code: 'tableManagementEnabled', nameZh: '桌台管理', isEnabled: true },
      { code: 'voiceNotifyEnabled', nameZh: '语音提醒', isEnabled: true },
    ],
  },
};

export const demoMerchantProfile: MerchantProfile = {
  id: 'demo-merchant', nameZh: '演示餐厅（非真实数据）', nameVi: 'Nhà hàng demo (không phải dữ liệu thật)', nameEn: 'Demo Restaurant (not real data)', merchantType: 'RESTAURANT', merchantMode: 'QR_ORDER', contactName: 'Demo', contactPhone: '', province: 'Demo', city: 'Demo', addressDetail: 'Demo only', latitude: '0', longitude: '0', businessHours: { monday: ['00:00-23:59'], tuesday: ['00:00-23:59'], wednesday: ['00:00-23:59'], thursday: ['00:00-23:59'], friday: ['00:00-23:59'], saturday: ['00:00-23:59'], sunday: ['00:00-23:59'] }, minimumDeliveryAmountVnd: '0', deliveryFeeVnd: '0', deliveryRadiusKm: '0', dineInEnabled: true, pickupEnabled: true, deliveryEnabled: true, isVisibleOnClient: false, status: 'ACTIVE', capabilities: demoStaffSession.merchant.capabilities,
  images: [{ id: 'demo-store-image', imageType: 'STORE', imageUrl: '/uploads/merchants/merchant-1782718009620-2b540ff7290a49a18e9ddee540d3470d.png', sortOrder: 0, isVisible: true }],
};

export const demoMenuCategories: CashierMenuCategory[] = [
  { id: 'demo-category-main', nameZh: '招牌菜', nameVi: 'Món đặc trưng', sortOrder: 1, isActive: true },
  { id: 'demo-category-drink', nameZh: '饮品', nameVi: 'Đồ uống', sortOrder: 2, isActive: true },
];

export const demoMenuProducts: CashierMenuProduct[] = [
  {
    id: 'demo-product-beef',
    categoryId: 'demo-category-main',
    nameZh: '演示牛肉粉',
    nameVi: 'Phở bò demo',
    description: '演示数据 / Dữ liệu demo',
    imageUrl: null,
    priceVnd: '68000',
    sortOrder: 1,
    status: 'ON_SALE',
    productType: 'FOOD',
    category: demoMenuCategories[0],
  },
  {
    id: 'demo-product-rice',
    categoryId: 'demo-category-main',
    nameZh: '演示炒饭',
    nameVi: 'Cơm chiên demo',
    description: '演示数据 / Dữ liệu demo',
    imageUrl: null,
    priceVnd: '52000',
    sortOrder: 2,
    status: 'ON_SALE',
    productType: 'FOOD',
    category: demoMenuCategories[0],
  },
  {
    id: 'demo-product-tea',
    categoryId: 'demo-category-drink',
    nameZh: '演示柠檬茶',
    nameVi: 'Trà chanh demo',
    description: '演示数据 / Dữ liệu demo',
    imageUrl: null,
    priceVnd: '30000',
    sortOrder: 1,
    status: 'ON_SALE',
    productType: 'FOOD',
    category: demoMenuCategories[1],
  },
];

export const demoTables: DiningTable[] = [
  { id: 'demo-table-1', merchantId: 'demo-merchant', tableNo: 'A01', tableName: '演示桌 A01', qrToken: 'DEMO-NOT-A-REAL-TOKEN', qrVersion: 1, status: 'ACTIVE' },
  { id: 'demo-table-2', merchantId: 'demo-merchant', tableNo: 'A02', tableName: '演示桌 A02', qrToken: 'DEMO-NOT-A-REAL-TOKEN-2', qrVersion: 1, status: 'ACTIVE' },
  { id: 'demo-table-3', merchantId: 'demo-merchant', tableNo: 'A03', tableName: '演示桌 A03', qrToken: 'DEMO-NOT-A-REAL-TOKEN-3', qrVersion: 1, status: 'ACTIVE' },
  { id: 'demo-table-4', merchantId: 'demo-merchant', tableNo: 'A04', tableName: '演示桌 A04', qrToken: 'DEMO-NOT-A-REAL-TOKEN-4', qrVersion: 1, status: 'ACTIVE' },
  { id: 'demo-table-5', merchantId: 'demo-merchant', tableNo: 'A05', tableName: '演示桌 A05', qrToken: 'DEMO-NOT-A-REAL-TOKEN-5', qrVersion: 1, status: 'ACTIVE' },
  { id: 'demo-table-6', merchantId: 'demo-merchant', tableNo: 'A06', tableName: '演示桌 A06', qrToken: 'DEMO-NOT-A-REAL-TOKEN-6', qrVersion: 1, status: 'ACTIVE' },
  { id: 'demo-table-7', merchantId: 'demo-merchant', tableNo: 'B01', tableName: '演示桌 B01', qrToken: 'DEMO-NOT-A-REAL-TOKEN-7', qrVersion: 1, status: 'ACTIVE' },
  { id: 'demo-table-8', merchantId: 'demo-merchant', tableNo: 'B02', tableName: '演示桌 B02', qrToken: 'DEMO-NOT-A-REAL-TOKEN-8', qrVersion: 1, status: 'ACTIVE' },
  { id: 'demo-table-9', merchantId: 'demo-merchant', tableNo: 'B03', tableName: '演示桌 B03', qrToken: 'DEMO-NOT-A-REAL-TOKEN-9', qrVersion: 1, status: 'ACTIVE' },
  { id: 'demo-table-10', merchantId: 'demo-merchant', tableNo: 'B04', tableName: '演示桌 B04', qrToken: 'DEMO-NOT-A-REAL-TOKEN-10', qrVersion: 1, status: 'ACTIVE' },
  { id: 'demo-table-11', merchantId: 'demo-merchant', tableNo: 'B05', tableName: '演示桌 B05', qrToken: 'DEMO-NOT-A-REAL-TOKEN-11', qrVersion: 1, status: 'ACTIVE' },
  { id: 'demo-table-12', merchantId: 'demo-merchant', tableNo: 'B06', tableName: '演示桌 B06', qrToken: 'DEMO-NOT-A-REAL-TOKEN-12', qrVersion: 1, status: 'ACTIVE' },
  { id: 'demo-table-13', merchantId: 'demo-merchant', tableNo: 'C01', tableName: '演示桌 C01', qrToken: 'DEMO-NOT-A-REAL-TOKEN-13', qrVersion: 1, status: 'ACTIVE' },
  { id: 'demo-table-14', merchantId: 'demo-merchant', tableNo: 'C02', tableName: '演示桌 C02', qrToken: 'DEMO-NOT-A-REAL-TOKEN-14', qrVersion: 1, status: 'ACTIVE' },
  { id: 'demo-table-15', merchantId: 'demo-merchant', tableNo: 'C03', tableName: '演示停用桌', qrToken: 'DEMO-NOT-A-REAL-TOKEN-15', qrVersion: 1, status: 'DISABLED' },
];

export const initialDemoOrders: MerchantOrder[] = [
  makeOrder('demo-order-1001', 'DEMO-1001', 'ACCEPTED', 'DINE_IN', 3, 171000, 'A01', 3),
  makeOrder('demo-order-1004', 'DEMO-1004', 'PENDING_ACCEPTANCE', 'PICKUP', 6, 76000, undefined, 2),
  makeOrder('demo-order-1005', 'DEMO-1005', 'PENDING_ACCEPTANCE', 'DELIVERY', 9, 245000, undefined, 4),
  makeOrder('demo-order-1002', 'DEMO-1002', 'PREPARING', 'PICKUP', 14, 92000, undefined, 2),
  makeOrder('demo-order-1003', 'DEMO-1003', 'READY', 'DELIVERY', 28, 215000, undefined, 3),
  makeOrder('demo-order-1006', 'DEMO-1006', 'ACCEPTED', 'DINE_IN', 18, 171000, 'A01', 2),
  makeOrder('demo-order-1007', 'DEMO-1007', 'PREPARING', 'DELIVERY', 24, 156000, undefined, 3),
  makeOrder('demo-order-1008', 'DEMO-1008', 'READY', 'PICKUP', 31, 88000, undefined, 2),
  makeOrder('demo-order-0999', 'DEMO-0999', 'ACCEPTED', 'DINE_IN', 90, 171000, 'A01', 2),
  makeOrder('demo-order-0998', 'DEMO-0998', 'CANCELLED', 'PICKUP', 125, 65000, undefined, 1),
  makeOrder('demo-order-0995', 'DEMO-0995', 'COMPLETED', 'DINE_IN', 175, 513000, 'A01', 4),
  makeOrder('demo-order-0997', 'DEMO-0997', 'COMPLETED', 'DELIVERY', 160, 230000, undefined, 4),
  makeOrder('demo-order-0996', 'DEMO-0996', 'COMPLETED', 'PICKUP', 190, 513000, undefined, 1),
];

function makeOrder(
  id: string,
  orderNo: string,
  status: MerchantOrder['status'],
  orderType: MerchantOrder['orderType'],
  minutesAgo: number,
  total: number,
  tableNo?: string,
  quantity = 1,
): MerchantOrder {
  const fixtureAmount = orderType === 'DELIVERY' && id === 'demo-order-0997'
    ? 99_999_999
    : import.meta.env.VITE_CASHIER_LARGE_AMOUNT_FIXTURE === 'true' && orderType === 'DINE_IN'
      ? id === 'demo-order-1001' ? 14_000_000 : id === 'demo-order-1006' ? 99_999_999 : total
      : total;
  const fixtureRounding = id === 'demo-order-0996' ? 3000 : 0;
  const fixtureQuantity = fixtureAmount === 14_000_000 ? 2 : quantity;
  const activeTableLink = tableNo && status !== 'COMPLETED';
  const fixturePaymentMethod = status === 'COMPLETED'
    ? id === 'demo-order-0995' ? 'CASH' : id === 'demo-order-0997' ? 'BANK_TRANSFER' : null
    : null;
  return {
    id, orderNo, userId: orderType === 'DINE_IN' ? null : `demo-user-${id}`, createdByStaffId: id === 'demo-order-1006' ? 'demo-staff-1' : null, merchantId: 'demo-merchant', tableId: activeTableLink ? 'demo-table-1' : null, tableSessionId: activeTableLink ? 'demo-session-1' : null, tableNoSnapshot: tableNo ?? null, orderType, status,
    contactName: orderType === 'DINE_IN' ? null : 'Demo Customer', contactPhone: orderType === 'DINE_IN' ? null : '000-000-000', deliveryAddress: orderType === 'DELIVERY' ? id === 'demo-order-1005' ? '12 Nguyễn Huệ, phường Bến Nghé, quận 1, Thành phố Hồ Chí Minh, Việt Nam' : 'Demo address (not real)' : null,
    customerRemark: '演示数据 / Dữ liệu demo / Demo data', itemAmountVnd: String(fixtureAmount), deliveryFeeVnd: '0', totalAmountVnd: String(fixtureAmount), originalAmountVnd: String(fixtureAmount), roundingAmountVnd: String(fixtureRounding), payableAmountVnd: String(fixtureAmount - fixtureRounding), roundingApplied: fixtureRounding > 0, roundingAppliedByStaffId: fixtureRounding > 0 ? 'demo-staff' : null, roundingAppliedAt: fixtureRounding > 0 ? isoMinutesAgo(Math.max(0, minutesAgo - 1)) : null, settlementStatus: 'UNSETTLED', createdAt: isoMinutesAgo(minutesAgo), updatedAt: isoMinutesAgo(minutesAgo),
    paymentMethod: fixturePaymentMethod,
    acceptedAt: status === 'PENDING_ACCEPTANCE' ? null : isoMinutesAgo(Math.max(0, minutesAgo - 2)),
    readyAt: ['READY', 'DELIVERING', 'COMPLETED'].includes(status) ? isoMinutesAgo(Math.max(0, minutesAgo - 5)) : null,
    pickupCode: orderType === 'PICKUP' ? orderNo.replace(/\D/g, '').slice(-4) : null,
    estimatedReadyAt: orderType === 'PICKUP' ? new Date(Date.parse(isoMinutesAgo(minutesAgo)) + 30 * 60_000).toISOString() : null,
    table: tableNo ? { id: 'demo-table-1', tableNo, tableName: '演示桌 A01' } : null,
    items: [{ id: `${id}-item`, productNameZhSnapshot: fixtureAmount === 14_000_000 ? '演示大额菜品（非真实）' : '演示菜品（非真实）', productNameViSnapshot: 'Món ăn demo (dữ liệu giả)', productNameEnSnapshot: 'Demo dish (not real data)', quantity: fixtureQuantity, unitPriceVnd: String(fixtureAmount / fixtureQuantity), subtotalVnd: String(fixtureAmount), remark: 'Demo' }],
    statusLogs: id === 'demo-order-0995' ? [{
      id: `log-${id}`,
      action: 'TABLE_SESSION_CHECKOUT',
      fromStatus: 'READY',
      toStatus: 'COMPLETED',
      operatorType: 'MERCHANT_STAFF',
      operatorStaffId: 'demo-staff',
      remark: '桌台结账，订单自动完成',
      createdAt: isoMinutesAgo(Math.max(0, minutesAgo - 1)),
      metadata: {
        tableSessionId: 'demo-session-1',
        originalAmountVnd: String(fixtureAmount),
        itemAmountVnd: String(fixtureAmount),
        discountPayableRateBps: null,
        discountAmountVnd: '0',
        afterDiscountAmountVnd: String(fixtureAmount),
        nonDiscountableFeeVnd: '0',
        roundingAmountVnd: String(fixtureRounding),
        finalPayableAmountVnd: String(fixtureAmount - fixtureRounding),
        payableAmountVnd: String(fixtureAmount - fixtureRounding),
      },
    }] : undefined,
    chatConversation: orderType === 'DINE_IN' ? null : {
      id: `demo-chat-${id}`,
      status: ['COMPLETED', 'CANCELLED'].includes(status) ? 'CLOSED' : 'ACTIVE',
      merchantUnreadCount: ['PENDING_ACCEPTANCE', 'PREPARING', 'READY'].includes(status) ? 2 : 0,
      customerUnreadCount: 0,
      lastMessageAt: isoMinutesAgo(Math.max(0, minutesAgo - 1)),
      lastMessageId: `demo-message-${id}`,
    },
  };
}
