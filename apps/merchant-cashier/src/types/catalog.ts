export interface CashierMenuCategory {
  id: string;
  nameZh: string;
  nameVi?: string | null;
  sortOrder: number;
  isActive: boolean;
}

export type CashierProductStatus = 'DRAFT' | 'ON_SALE' | 'SOLD_OUT' | 'OFF_SALE';

export interface CashierMenuProduct {
  id: string;
  categoryId: string;
  nameZh: string;
  nameVi?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  priceVnd: string;
  sortOrder: number;
  status: CashierProductStatus;
  productType: 'FOOD';
  category?: CashierMenuCategory | null;
}
