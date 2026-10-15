import { BadRequestException, ConflictException } from '@nestjs/common';

export type KitchenCounts = { quantity: number; madeQuantity: number; servedQuantity: number };
export type KitchenAction = 'START' | 'MAKE' | 'SERVE' | 'URGE';

export function applyKitchenAction(counts: KitchenCounts, action: KitchenAction, quantity: number, servingEnabled = true) {
  if (action === 'SERVE' && !servingEnabled) throw new ConflictException('当前门店未开启传菜');
  if (!Number.isInteger(quantity) || quantity < 1) throw new BadRequestException('份数必须为正整数');
  if (action === 'MAKE' && quantity > counts.quantity - counts.madeQuantity) {
    throw new ConflictException('本次划菜超过待完成份数，请刷新');
  }
  if (action === 'SERVE' && quantity > counts.madeQuantity - counts.servedQuantity) {
    throw new ConflictException('本次传菜超过已做好的份数，请刷新');
  }
  return {
    madeQuantity: counts.madeQuantity + (action === 'MAKE' ? quantity : 0),
    servedQuantity: action === 'MAKE' && !servingEnabled ? counts.madeQuantity + quantity
      : counts.servedQuantity + (action === 'SERVE' ? quantity : 0),
  };
}

export function reconcileKitchenQuantity(counts: KitchenCounts, quantity: number) {
  const madeQuantity = Math.min(counts.madeQuantity, quantity);
  const servedQuantity = Math.min(counts.servedQuantity, madeQuantity);
  return {
    quantity, madeQuantity, servedQuantity,
    cancelled: Math.max(0, counts.quantity - quantity),
    removedMade: counts.madeQuantity - madeQuantity,
    removedServed: counts.servedQuantity - servedQuantity,
  };
}
