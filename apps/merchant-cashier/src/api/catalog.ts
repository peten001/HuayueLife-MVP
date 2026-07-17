import { demoRepository, isDemoSessionActive } from '@/fixtures';
import type { CashierMenuCategory, CashierMenuProduct } from '@/types';
import { requestApi } from './http';

export function listCashierMenuCategories(): Promise<CashierMenuCategory[]> {
  return isDemoSessionActive()
    ? Promise.resolve(demoRepository.categories())
    : requestApi<CashierMenuCategory[]>('/merchant/categories');
}

export function listCashierMenuProducts(): Promise<CashierMenuProduct[]> {
  return isDemoSessionActive()
    ? Promise.resolve(demoRepository.products())
    : requestApi<CashierMenuProduct[]>('/merchant/products', {
      query: { status: 'ON_SALE' },
    });
}
