import { defineStore } from 'pinia';
import {
  addCartItem,
  clearCart as clearCartApi,
  deleteCartItem,
  getCart,
  updateCartItem,
} from '@/api/cart';
import { useI18n } from '@/i18n';
import type { Cart, CartContext } from '@/types/api';
import { useAuthStore } from './auth';

const CONTEXT_KEY = 'huayue_cart_context';

export type ContextSwitchResult = 'ready' | 'switched' | 'cancelled' | 'failed';

function sameContext(a: CartContext | null, b: CartContext) {
  if (!a) return false;
  return (
    a.merchantId === b.merchantId &&
    a.orderType === b.orderType &&
    (a.tableToken ?? '') === (b.tableToken ?? '')
  );
}

export const useCartStore = defineStore('cart', {
  state: () => ({
    context: (uni.getStorageSync(CONTEXT_KEY) || null) as CartContext | null,
    cart: null as Cart | null,
    loading: false,
  }),
  actions: {
    async ensureLoaded() {
      console.log('[cart] ensureLoaded', {
        currentContext: this.context,
        cart: this.cart,
        itemsLength: this.cart?.items?.length ?? 0,
      });
      if (this.context && !this.cart) {
        console.log('[cart] ensureLoaded loading current cart', {
          currentContext: this.context,
        });
        await this.load();
      }
      console.log('[cart] ensureLoaded done', {
        currentContext: this.context,
        cart: this.cart,
        itemsLength: this.cart?.items?.length ?? 0,
      });
    },
    hasItems() {
      const result = (this.cart?.totalQuantity ?? 0) > 0;
      console.log('[cart] hasItems', {
        currentContext: this.context,
        cart: this.cart,
        itemsLength: this.cart?.items?.length ?? 0,
        totalQuantity: this.cart?.totalQuantity ?? 0,
        result,
      });
      return result;
    },
    needsContextSwitch(next: CartContext) {
      const result = Boolean(this.context && !sameContext(this.context, next));
      console.log('[cart] needsContextSwitch', {
        currentContext: this.context,
        nextContext: next,
        cart: this.cart,
        itemsLength: this.cart?.items?.length ?? 0,
        result,
      });
      return result;
    },
    async switchContext(next: CartContext): Promise<ContextSwitchResult> {
      const current = this.context;
      console.log('[cart] switchContext start', {
        currentContext: current,
        nextContext: next,
        cart: this.cart,
        itemsLength: this.cart?.items?.length ?? 0,
      });
      try {
        await this.ensureLoaded();
      } catch (error) {
        console.error('[cart] switchContext failed', {
          reason: 'load-current-cart-failed',
          current,
          next,
          error,
        });
        return 'failed';
      }

      if (!current) {
        console.log('[cart] switchContext no current context', {
          nextContext: next,
        });
        return this.activateContext(next, 'switched');
      }

      if (sameContext(current, next)) {
        console.log('[cart] switchContext same context', {
          currentContext: current,
          nextContext: next,
        });
        if (!this.cart) {
          try {
            await this.load();
          } catch (error) {
            console.error('[cart] switchContext failed', {
              reason: 'load-current-cart-failed',
              current,
              next,
              error,
            });
            return 'failed';
          }
        }
        return 'ready';
      }

      if (this.hasItems()) {
        console.error('[cart] switchContext failed', {
          reason: 'context-switch-with-items',
          current,
          next,
          totalQuantity: this.cart?.totalQuantity ?? 0,
        });
        return 'failed';
      }

      console.log('[cart] switchContext activate next', {
        currentContext: current,
        nextContext: next,
      });
      return this.activateContext(next, 'switched');
    },
    async activateContext(next: CartContext, result: 'ready' | 'switched') {
      console.log('[cart] activateContext', {
        nextContext: next,
        result,
        previousContext: this.context,
      });
      this.context = next;
      uni.setStorageSync(CONTEXT_KEY, next);
      try {
        await this.load();
        console.log('[cart] activateContext loaded', {
          nextContext: next,
          cart: this.cart,
          itemsLength: this.cart?.items?.length ?? 0,
        });
        return result;
      } catch (error) {
        console.error('[cart] switchContext failed', {
          reason: 'load-next-cart-failed',
          next,
          error,
        });
        return 'failed';
      }
    },
    async load() {
      console.log('[cart] load start', {
        context: this.context,
      });
      if (!this.context) return;
      await useAuthStore().ensureLogin();
      this.loading = true;
      try {
        this.cart = await getCart(this.context);
        console.log('[cart] load success', {
          context: this.context,
          cart: this.cart,
          itemsLength: this.cart?.items?.length ?? 0,
          totalQuantity: this.cart?.totalQuantity ?? 0,
        });
      } finally {
        this.loading = false;
      }
    },
    async add(productId: string, quantity = 1, remark = '') {
      const { t } = useI18n();
      if (!this.context) throw new Error(t('missingCartContext'));
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
    async clearCart() {
      console.log('[cart] clearCart', {
        context: this.context,
        cart: this.cart,
        itemsLength: this.cart?.items?.length ?? 0,
      });
      if (!this.context) return;
      this.cart = await clearCartApi(this.context);
      console.log('[cart] clearCart done', {
        context: this.context,
        cart: this.cart,
        itemsLength: this.cart?.items?.length ?? 0,
      });
    },
    async clear() {
      await this.clearCart();
    },
    resetAfterOrder() {
      this.cart = null;
      this.context = null;
      uni.removeStorageSync(CONTEXT_KEY);
    },
  },
});
