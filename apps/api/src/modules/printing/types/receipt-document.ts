export const RECEIPT_TYPES = ['ORDER_CUSTOMER', 'TABLE_BILL'] as const;
export type ReceiptTypeValue = (typeof RECEIPT_TYPES)[number];

export interface ReceiptDocument {
  schemaVersion: 1;
  receiptType: ReceiptTypeValue;
  generatedAt: string;
  merchant: {
    id: string;
    name: string;
    address?: string;
    phone?: string;
  };
  order?: {
    id: string;
    orderNo: string;
    orderType: string;
    tableName?: string;
    guestCount?: number;
    createdAt: string;
    completedAt?: string;
  };
  tableSession?: {
    id: string;
    sessionNo: string;
    tableName: string;
    openedAt: string;
    closedAt?: string;
    orderNos: string[];
  };
  items: Array<{
    name: string;
    nameVi?: string;
    nameEn?: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    specification?: string;
    note?: string;
  }>;
  totals: {
    subtotal: number;
    discount?: number;
    serviceFee?: number;
    total: number;
    currency: 'VND';
  };
  note?: string;
}

export const RECEIPT_TEMPLATE_SECTION_TYPES = [
  'MERCHANT_HEADER',
  'ORDER_INFO',
  'TABLE_INFO',
  'ITEMS',
  'TOTALS',
  'FOOTER',
] as const;

export interface ReceiptTemplateDefinition {
  schemaVersion: 1;
  sections: Array<{
    type: (typeof RECEIPT_TEMPLATE_SECTION_TYPES)[number];
    enabled?: boolean;
    title?: string;
  }>;
}

export function assertReceiptDocument(value: unknown): asserts value is ReceiptDocument {
  if (!isPlainObject(value)) {
    throw new Error('Receipt document must be an object');
  }
  if (
    !hasOnlyKeys(value, [
      'schemaVersion',
      'receiptType',
      'generatedAt',
      'merchant',
      'order',
      'tableSession',
      'items',
      'totals',
      'note',
    ])
  ) {
    throw new Error('Receipt document contains unsupported fields');
  }
  const document = value as Partial<ReceiptDocument>;
  if (
    document.schemaVersion !== 1 ||
    !document.receiptType ||
    !RECEIPT_TYPES.includes(document.receiptType) ||
    !document.generatedAt ||
    !isPlainObject(document.merchant) ||
    !Array.isArray(document.items) ||
    !isPlainObject(document.totals) ||
    document.totals.currency !== 'VND'
  ) {
    throw new Error('Receipt document does not match schema version 1');
  }
  if (
    !hasOnlyKeys(document.merchant, ['id', 'name', 'address', 'phone']) ||
    !/^\d+$/.test(document.merchant.id) ||
    !isBoundedText(document.merchant.name, 1, 120) ||
    (document.merchant.address !== undefined &&
      !isBoundedText(document.merchant.address, 0, 300)) ||
    (document.merchant.phone !== undefined &&
      !isBoundedText(document.merchant.phone, 0, 32)) ||
    Number.isNaN(Date.parse(document.generatedAt)) ||
    (document.receiptType === 'ORDER_CUSTOMER' &&
      (!document.order || document.tableSession !== undefined)) ||
    (document.receiptType === 'TABLE_BILL' &&
      (!document.tableSession || document.order !== undefined))
  ) {
    throw new Error('Receipt document scope or context is invalid');
  }
  if (
    document.order &&
    (!isPlainObject(document.order) ||
      !hasOnlyKeys(document.order, [
        'id',
        'orderNo',
        'orderType',
        'tableName',
        'guestCount',
        'createdAt',
        'completedAt',
      ]) ||
      !/^\d+$/.test(document.order.id) ||
      !isBoundedText(document.order.orderNo, 1, 32) ||
      !isBoundedText(document.order.orderType, 1, 32) ||
      (document.order.tableName !== undefined &&
        !isBoundedText(document.order.tableName, 0, 64)) ||
      (document.order.guestCount !== undefined &&
        (!Number.isSafeInteger(document.order.guestCount) ||
          document.order.guestCount < 0)) ||
      Number.isNaN(Date.parse(document.order.createdAt)) ||
      (document.order.completedAt !== undefined &&
        Number.isNaN(Date.parse(document.order.completedAt))))
  ) {
    throw new Error('Receipt order context is invalid');
  }
  if (
    document.tableSession &&
    (!isPlainObject(document.tableSession) ||
      !hasOnlyKeys(document.tableSession, [
        'id',
        'sessionNo',
        'tableName',
        'openedAt',
        'closedAt',
        'orderNos',
      ]) ||
      !/^\d+$/.test(document.tableSession.id) ||
      !isBoundedText(document.tableSession.sessionNo, 1, 32) ||
      !isBoundedText(document.tableSession.tableName, 1, 64) ||
      Number.isNaN(Date.parse(document.tableSession.openedAt)) ||
      (document.tableSession.closedAt !== undefined &&
        Number.isNaN(Date.parse(document.tableSession.closedAt))) ||
      !Array.isArray(document.tableSession.orderNos) ||
      document.tableSession.orderNos.length > 1_000 ||
      document.tableSession.orderNos.some((orderNo) => !isBoundedText(orderNo, 1, 32)))
  ) {
    throw new Error('Receipt table session context is invalid');
  }
  if (
    document.items.length === 0 ||
    document.items.length > 500 ||
    document.items.some(
      (item) =>
        !isPlainObject(item) ||
        !hasOnlyKeys(item, [
          'name',
          'nameVi',
          'nameEn',
          'quantity',
          'unitPrice',
          'lineTotal',
          'specification',
          'note',
        ]) ||
        !isBoundedText(item.name, 1, 120) ||
        (item.nameVi !== undefined && !isBoundedText(item.nameVi, 0, 120)) ||
        (item.nameEn !== undefined && !isBoundedText(item.nameEn, 0, 120)) ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity <= 0 ||
        !Number.isSafeInteger(item.unitPrice) ||
        item.unitPrice < 0 ||
        !Number.isSafeInteger(item.lineTotal) ||
        item.lineTotal < 0 ||
        (item.specification !== undefined &&
          !isBoundedText(item.specification, 0, 120)) ||
        (item.note !== undefined && !isBoundedText(item.note, 0, 200)),
    )
  ) {
    throw new Error('Receipt item data is invalid');
  }
  if (
    !hasOnlyKeys(document.totals, [
      'subtotal',
      'discount',
      'serviceFee',
      'total',
      'currency',
    ]) ||
    !Number.isSafeInteger(document.totals.subtotal) ||
    document.totals.subtotal < 0 ||
    !Number.isSafeInteger(document.totals.total) ||
    document.totals.total < 0 ||
    (document.totals.discount !== undefined &&
      (!Number.isSafeInteger(document.totals.discount) || document.totals.discount < 0)) ||
    (document.totals.serviceFee !== undefined &&
      (!Number.isSafeInteger(document.totals.serviceFee) ||
        document.totals.serviceFee < 0)) ||
    (document.note !== undefined && !isBoundedText(document.note, 0, 500))
  ) {
    throw new Error('Receipt totals are invalid');
  }
}

function isBoundedText(value: unknown, min: number, max: number) {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

export function assertReceiptTemplateDefinition(
  value: unknown,
): asserts value is ReceiptTemplateDefinition {
  if (!isPlainObject(value)) {
    throw new Error('Template definition must be an object');
  }
  if (!hasOnlyKeys(value, ['schemaVersion', 'sections'])) {
    throw new Error('Template definition contains unsupported fields');
  }
  const definition = value as Partial<ReceiptTemplateDefinition>;
  if (definition.schemaVersion !== 1 || !Array.isArray(definition.sections)) {
    throw new Error('Template definition must use schemaVersion 1 and sections');
  }
  if (
    definition.sections.length === 0 ||
    definition.sections.length > RECEIPT_TEMPLATE_SECTION_TYPES.length ||
    definition.sections.some(
      (section) =>
        !isPlainObject(section) ||
        !hasOnlyKeys(section, ['type', 'enabled', 'title']) ||
        !RECEIPT_TEMPLATE_SECTION_TYPES.includes(section.type) ||
        (section.enabled !== undefined && typeof section.enabled !== 'boolean') ||
        (section.title !== undefined &&
          (!isBoundedText(section.title, 0, 120) || /[<>]/.test(section.title))),
    )
  ) {
    throw new Error('Template sections are invalid');
  }
  if (new Set(definition.sections.map((section) => section.type)).size !== definition.sections.length) {
    throw new Error('Template sections must not contain duplicate types');
  }
}

export function immutableJsonSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
