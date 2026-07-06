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
  {
    const body = normalizeOrderRequest(data);
    console.log('[orders api] preview request body', JSON.stringify(body));
    return request<OrderPreview>('/orders/preview', {
      method: 'POST',
      data: body,
    });
  };

export const createOrder = (data: OrderRequest, idempotencyKey: string) =>
  {
    const body = normalizeOrderRequest(data);
    console.log('[orders api] createOrder request body', JSON.stringify(body));
    console.log(
      '[orders api] delivery lat lng type',
      body.deliveryLatitude,
      typeof body.deliveryLatitude,
      body.deliveryLongitude,
      typeof body.deliveryLongitude,
    );
    return request<CreatedOrder>('/orders', {
      method: 'POST',
      data: body,
      header: { 'Idempotency-Key': idempotencyKey },
    });
  };

function normalizeOrderRequest(data: OrderRequest): OrderRequest {
  const body: OrderRequest = { ...data };
  if (!body.tableToken?.trim()) delete body.tableToken;
  if (!body.contactName?.trim()) delete body.contactName;
  if (!body.contactPhone?.trim()) delete body.contactPhone;
  if (!body.deliveryAddress?.trim()) delete body.deliveryAddress;
  const deliveryLatitude = Number(body.deliveryLatitude);
  const deliveryLongitude = Number(body.deliveryLongitude);
  if (Number.isFinite(deliveryLatitude)) {
    body.deliveryLatitude = deliveryLatitude;
  } else {
    delete body.deliveryLatitude;
  }
  if (Number.isFinite(deliveryLongitude)) {
    body.deliveryLongitude = deliveryLongitude;
  } else {
    delete body.deliveryLongitude;
  }
  if (!body.customerRemark?.trim()) delete body.customerRemark;
  return body;
}
