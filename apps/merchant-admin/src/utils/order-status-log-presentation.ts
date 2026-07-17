import type { TranslationKey } from '@/i18n';
import type { OrderStatusLog } from '@/types/api';

export interface OrderStatusLogActionPresentation {
  labelKey: TranslationKey;
  params?: Record<string, string | number>;
}

function productName(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function quantity(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

/**
 * Converts the three internal item actions into a deliberately small UI model.
 * Only fields from the merchant-facing DTO allow-list are read; raw metadata,
 * request keys, and internal identifiers never reach the rendered timeline.
 */
export function orderStatusLogActionPresentation(
  log: Pick<OrderStatusLog, 'action' | 'metadata'>,
): OrderStatusLogActionPresentation | null {
  if (log.action === 'MERCHANT_ADD_ITEMS') {
    return { labelKey: 'merchantAddItemsAction' };
  }

  const name = productName(log.metadata?.productName);

  if (log.action === 'ORDER_ITEM_DECREASED') {
    const beforeQuantity = quantity(log.metadata?.beforeQuantity);
    const afterQuantity = quantity(log.metadata?.afterQuantity);
    if (name && beforeQuantity !== null && afterQuantity !== null) {
      return {
        labelKey: 'orderItemDecreasedAction',
        params: { name, beforeQuantity, afterQuantity },
      };
    }
    return { labelKey: 'orderItemDecreasedActionFallback' };
  }

  if (log.action === 'ORDER_ITEM_RETURNED') {
    const returnedQuantity = quantity(log.metadata?.returnedQuantity);
    if (name && returnedQuantity !== null) {
      return {
        labelKey: 'orderItemReturnedAction',
        params: { name, returnedQuantity },
      };
    }
    return { labelKey: 'orderItemReturnedActionFallback' };
  }

  return null;
}
