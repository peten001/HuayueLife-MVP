export interface CashierMenuCategory {
  id: string;
  nameZh: string;
  nameVi?: string | null;
  nameEn?: string | null;
  sortOrder: number;
  isActive: boolean;
}

export type CashierProductStatus = 'DRAFT' | 'ON_SALE' | 'SOLD_OUT' | 'OFF_SALE';

export interface CashierMenuProduct {
  id: string;
  categoryId: string;
  nameZh: string;
  nameVi?: string | null;
  nameEn?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  menuThumbnailUrl?: string | null;
  priceVnd: string;
  unit?: string | null;
  sortOrder: number;
  status: CashierProductStatus;
  productType: 'FOOD';
  category?: CashierMenuCategory | null;
}

export interface CashierOrderingDraftLine {
  lineId: string;
  mergeKey?: string;
  product: CashierMenuProduct;
  quantity: number;
  firstAddedAt?: string;
  firstAddedSequence?: number;
  sourceItemId?: string;
  remark?: string;
}
