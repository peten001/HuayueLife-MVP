import type {
  Cart,
  CartContext,
  CreatedOrder,
  OrderPreview,
} from '@/types/api';
import { request } from './http';

function contextQuery(context: CartContext) {
  return [
    `merchantId=${encodeURIComponent(context.merchantId)}`,
    `orderType=${encodeURIComponent(context.orderType)}`,
    context.tableToken
      ? `tableToken=${encodeURIComponent(context.tableToken)}`
      : '',
  ]
    .filter(Boolean)
    .join('&');
}

export const getCart = (context: CartContext) =>
  request<Cart>(`/cart?${contextQuery(context)}`);

export const addCartItem = (
  context: CartContext,
  productId: string,
  quantity = 1,
  remark = '',
) =>
  request<Cart>('/cart/items', {
    method: 'POST',
    data: {
      merchantId: context.merchantId,
      orderType: context.orderType,
      tableToken: context.tableToken,
      productId,
      quantity,
      remark,
    },
  });

export const updateCartItem = (
  itemId: string,
  data: { quantity?: number; remark?: string },
) =>
  request<Cart>(`/cart/items/${itemId}`, {
    method: 'PATCH' as never,
    data,
  });

export const deleteCartItem = (itemId: string) =>
  request<Cart>(`/cart/items/${itemId}`, { method: 'DELETE' });

export const clearCart = (context: CartContext) =>
  request<Cart>(`/cart?${contextQuery(context)}`, { method: 'DELETE' });

export interface OrderRequest {
  merchantId: string;
  orderType: CartContext['orderType'];
  tableToken?: string;
  contactName?: string;
  contactPhone?: string;
  deliveryAddress?: string;
  deliveryLatitude?: number;
  deliveryLongitude?: number;
  customerRemark?: string;
}

export const previewOrder = (data: OrderRequest) =>
  request<OrderPreview>('/orders/preview', { method: 'POST', data });

export const createOrder = (data: OrderRequest, idempotencyKey: string) =>
  request<CreatedOrder>('/orders', {
    method: 'POST',
    data,
    header: { 'Idempotency-Key': idempotencyKey },
  });
