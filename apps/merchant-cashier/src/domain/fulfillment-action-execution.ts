import type { RouteLocationRaw } from 'vue-router';

import type { MerchantOrder, MerchantOrderAction, PaymentMethod } from '@/types';

export type FulfillmentAftercareStage = 'refresh' | 'navigation';

export interface FulfillmentActionExecutionInput {
  order: MerchantOrder;
  actions: readonly MerchantOrderAction[];
  paymentMethod?: PaymentMethod;
  runAction: (
    orderId: string,
    action: MerchantOrderAction,
    paymentMethod?: PaymentMethod,
  ) => Promise<MerchantOrder>;
  refresh: () => Promise<unknown>;
  resolveLocation: (order: MerchantOrder) => RouteLocationRaw;
  navigate: (location: RouteLocationRaw) => Promise<unknown>;
}

export interface FulfillmentActionExecutionResult {
  order: MerchantOrder;
  aftercareFailures: FulfillmentAftercareStage[];
}

/**
 * The state-changing API calls are the primary operation. Refresh and route
 * repair happen only after the server has returned the committed order and
 * cannot turn that success into an actionable retry prompt.
 */
export async function executeFulfillmentActionSequence(
  input: FulfillmentActionExecutionInput,
): Promise<FulfillmentActionExecutionResult> {
  let updated = input.order;
  for (const action of input.actions) {
    updated = await input.runAction(
      input.order.id,
      action,
      action === 'complete' ? input.paymentMethod : undefined,
    );
  }

  const aftercareFailures: FulfillmentAftercareStage[] = [];
  try {
    await input.refresh();
  } catch {
    aftercareFailures.push('refresh');
  }
  if (['COMPLETED', 'CANCELLED'].includes(updated.status)) {
    try {
      await input.navigate(input.resolveLocation(updated));
    } catch {
      aftercareFailures.push('navigation');
    }
  }
  return { order: updated, aftercareFailures };
}
