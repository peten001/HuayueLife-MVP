import { Prisma } from '@prisma/client';

export const INTERNAL_ORDER_STATUS_LOG_ACTIONS = [
  'MERCHANT_ADD_ITEMS',
  'ORDER_ITEM_DECREASED',
  'ORDER_ITEM_RETURNED',
] as const;

export type InternalOrderStatusLogAction =
  (typeof INTERNAL_ORDER_STATUS_LOG_ACTIONS)[number];

export type MerchantVisibleOrderActionMetadata = {
  productName?: string;
  beforeQuantity?: number;
  afterQuantity?: number;
  returnedQuantity?: number;
};

export function isInternalOrderStatusLogAction(
  action: string | null | undefined,
): action is InternalOrderStatusLogAction {
  return INTERNAL_ORDER_STATUS_LOG_ACTIONS.some(
    (internalAction) => internalAction === action,
  );
}

/**
 * Keep the merchant timeline useful without leaking the idempotency key or
 * internal entity identifiers stored in the audit metadata snapshot.
 */
export function toMerchantVisibleOrderStatusLog<
  T extends {
    action: string | null;
    metadata: Prisma.JsonValue | null;
    requestKey?: string | null;
    orderId?: unknown;
    operatorUserId?: unknown;
    operatorStaffId?: unknown;
    operatorStaff?: { id?: unknown; displayName: string } | null;
  },
>(log: T) {
  const {
    action,
    metadata,
    requestKey: _requestKey,
    ...publicLog
  } = log;

  if (!isInternalOrderStatusLogAction(action)) {
    // Preserve the established merchant status-log shape for ordinary state
    // transitions while still suppressing the newly introduced request key.
    return { ...publicLog, action, metadata: null };
  }

  const {
    orderId: _orderId,
    operatorUserId: _operatorUserId,
    operatorStaffId: _operatorStaffId,
    operatorStaff,
    ...actionLog
  } = publicLog;
  const publicMetadata = toMerchantVisibleActionMetadata(action, metadata);
  return {
    ...actionLog,
    ...(operatorStaff
      ? { operatorStaff: { displayName: operatorStaff.displayName } }
      : {}),
    action,
    ...(publicMetadata ? { metadata: publicMetadata } : {}),
  };
}

function toMerchantVisibleActionMetadata(
  action: InternalOrderStatusLogAction,
  metadata: Prisma.JsonValue | null,
): MerchantVisibleOrderActionMetadata | undefined {
  if (action === 'MERCHANT_ADD_ITEMS') {
    return undefined;
  }
  if (!isJsonObject(metadata)) {
    return undefined;
  }

  const productName = stringValue(metadata.productNameSnapshot);
  if (action === 'ORDER_ITEM_DECREASED') {
    const beforeQuantity = nonNegativeInteger(metadata.beforeQuantity);
    const afterQuantity = nonNegativeInteger(metadata.afterQuantity);
    if (
      productName === undefined ||
      beforeQuantity === undefined ||
      afterQuantity === undefined
    ) {
      return undefined;
    }
    return { productName, beforeQuantity, afterQuantity };
  }

  const returnedQuantity = nonNegativeInteger(metadata.returnedQuantity);
  if (productName === undefined || returnedQuantity === undefined) {
    return undefined;
  }
  return { productName, returnedQuantity };
}

function isJsonObject(
  value: Prisma.JsonValue | null,
): value is Prisma.JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: Prisma.JsonValue | undefined) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function nonNegativeInteger(value: Prisma.JsonValue | undefined) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}
