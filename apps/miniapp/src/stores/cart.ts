import { defineStore } from 'pinia';
import {
  addCartItem,
  clearCart,
  deleteCartItem,
  getCart,
  updateCartItem,
} from '@/api/cart';
import type { Cart, CartContext } from '@/types/api';
import { useAuthStore } from './auth';

const CONTEXT_KEY = 'huayue_cart_context';

export const useCartStore = defineStore('cart', {
  state: () => ({
    context: (uni.getStorageSync(CONTEXT_KEY) || null) as CartContext | null,
    cart: null as Cart | null,
    loading: false,
  }),
  actions: {
    async openContext(next: CartContext) {
      const current = this.context;
      if (current && !this.cart) {
        await this.load();
      }
      const changed =
        current &&
        (current.merchantId !== next.merchantId ||
          current.orderType !== next.orderType ||
          (current.tableToken ?? '') !== (next.tableToken ?? ''));

      if (changed && (this.cart?.totalQuantity ?? 0) > 0) {
        const confirmed = await confirmSwitch();
        if (!confirmed) return false;
        await clearCart(current);
      }

      this.context = next;
      uni.setStorageSync(CONTEXT_KEY, next);
      await this.load();
      return true;
    },
    async load() {
      if (!this.context) return;
      await useAuthStore().ensureLogin();
      this.loading = true;
      try {
        this.cart = await getCart(this.context);
      } finally {
        this.loading = false;
      }
    },
    async add(productId: string, quantity = 1, remark = '') {
      if (!this.context) throw new Error('缺少购物车上下文');
      await useAuthStore().ensureLogin();
      this.cart = await addCartItem(this.context, productId, quantity, remark);
    },
    async setQuantity(itemId: string, quantity: number) {
      if (quantity <= 0) {
        this.cart = await deleteCartItem(itemId);
      } else {
        this.cart = await updateCartItem(itemId, { quantity });
      }
    },
    async remove(itemId: string) {
      this.cart = await deleteCartItem(itemId);
    },
    async clear() {
      if (!this.context) return;
      this.cart = await clearCart(this.context);
    },
    resetAfterOrder() {
      this.cart = null;
      this.context = null;
      uni.removeStorageSync(CONTEXT_KEY);
    },
  },
});

function confirmSwitch() {
  return new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '切换点餐场景',
      content: '切换商家、桌台或订单类型会清空当前购物车，是否继续？',
      confirmText: '清空并切换',
      success: (result) => resolve(result.confirm),
      fail: () => resolve(false),
    });
  });
}
