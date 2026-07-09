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

function normalizeContext(context: CartContext): CartContext {
  const next: CartContext = {
    merchantId: context.merchantId,
    merchantName: context.merchantName || '',
    orderType: context.orderType,
  };
  if (context.orderType === 'DINE_IN') {
    next.tableToken = context.tableToken?.trim() || undefined;
    next.tableNo = context.tableNo?.trim() || undefined;
    next.tableName = context.tableName?.trim() || undefined;
  }
  return next;
}

function readStoredContext() {
  const stored = (uni.getStorageSync(CONTEXT_KEY) || null) as CartContext | null;
  if (!stored) return null;
  const normalized = normalizeContext(stored);
  uni.setStorageSync(CONTEXT_KEY, normalized);
  return normalized;
}

function persistContext(context: CartContext | null) {
  if (context) {
    uni.setStorageSync(CONTEXT_KEY, normalizeContext(context));
  } else {
    uni.removeStorageSync(CONTEXT_KEY);
  }
}

function sameContext(a: CartContext | null, b: CartContext) {
  if (!a) return false;
  const left = normalizeContext(a);
  const right = normalizeContext(b);
  if (left.merchantId !== right.merchantId || left.orderType !== right.orderType) {
    return false;
  }
  if (left.orderType !== 'DINE_IN') return true;
  return (
    (left.tableToken ?? '') === (right.tableToken ?? '')
  );
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '';
}

function isStaleContextError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes('商家当前不可用') ||
    message.includes('merchant not found') ||
    message.includes('merchant unavailable') ||
    message.includes('商家不存在') ||
    message.includes('商家已删除')
  );
}

export const useCartStore = defineStore('cart', {
  state: () => ({
    context: readStoredContext(),
    cart: null as Cart | null,
    loading: false,
  }),
  actions: {
    async ensureLoaded() {
      const currentContext = this.context;
      console.log('[cart] ensureLoaded', {
        currentContext,
        cart: this.cart,
        itemsLength: this.cart?.items?.length ?? 0,
      });
      if (!currentContext) {
        console.log('[cart] ensureLoaded done', {
          currentContext: this.context,
          cart: this.cart,
          itemsLength: this.cart?.items?.length ?? 0,
        });
        return;
      }
      try {
        console.log('[cart] ensureLoaded loading current cart', {
          currentContext,
        });
        await this.load();
      } catch (error) {
        if (isStaleContextError(error)) {
          this.clearStaleContext('ensureLoaded-current-context-invalid', error);
          return;
        }
        console.error('[cart] ensureLoaded failed', {
          currentContext,
          error,
        });
        throw error;
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
      const normalizedNext = normalizeContext(next);
      const result = Boolean(this.context && !sameContext(this.context, normalizedNext));
      console.log('[cart] needsContextSwitch', {
        currentContext: this.context,
        nextContext: normalizedNext,
        cart: this.cart,
        itemsLength: this.cart?.items?.length ?? 0,
        result,
      });
      return result;
    },
    async switchContext(next: CartContext): Promise<ContextSwitchResult> {
      const normalizedNext = normalizeContext(next);
      const current = this.context;
      console.log('[cart] switchContext start', {
        currentContext: current,
        nextContext: normalizedNext,
        cart: this.cart,
        itemsLength: this.cart?.items?.length ?? 0,
      });
      try {
        await this.ensureLoaded();
      } catch (error) {
        console.error('[cart] switchContext failed', {
          reason: 'load-current-cart-failed',
          current,
          next: normalizedNext,
          error,
        });
        return 'failed';
      }

      const activeCurrent = this.context;

      if (!activeCurrent) {
        console.log('[cart] switchContext no current context', {
          nextContext: normalizedNext,
        });
        return this.activateContext(normalizedNext, 'switched');
      }

      if (sameContext(activeCurrent, normalizedNext)) {
        console.log('[cart] switchContext same context', {
          currentContext: activeCurrent,
          nextContext: normalizedNext,
        });
        if (!this.cart) {
          try {
            await this.load();
          } catch (error) {
            console.error('[cart] switchContext failed', {
              reason: 'load-current-cart-failed',
              current,
              next: normalizedNext,
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
          next: normalizedNext,
          totalQuantity: this.cart?.totalQuantity ?? 0,
        });
        return 'failed';
      }

      console.log('[cart] switchContext activate next', {
        currentContext: current,
        nextContext: normalizedNext,
      });
      return this.activateContext(normalizedNext, 'switched');
    },
    async clearAndSwitchContext(next: CartContext): Promise<ContextSwitchResult> {
      const normalizedNext = normalizeContext(next);
      const previousContext = this.context ? normalizeContext(this.context) : null;
      const previousCart = this.cart;
      const previousLoading = this.loading;
      if (!previousContext) return this.activateContext(normalizedNext, 'switched');
      if (sameContext(previousContext, normalizedNext)) {
        return this.switchContext(normalizedNext);
      }
      console.log('[cart] clearAndSwitchContext start', {
        previousContext,
        nextContext: normalizedNext,
        previousCart,
        itemsLength: previousCart?.items?.length ?? 0,
      });
      this.loading = true;
      try {
        const nextCart = await this.fetchCartForContext(normalizedNext);
        persistContext(normalizedNext);
        await clearCartApi(previousContext);
        this.context = normalizedNext;
        this.cart = nextCart;
        console.log('[cart] clearAndSwitchContext success', {
          nextContext: normalizedNext,
          cart: this.cart,
          itemsLength: this.cart?.items?.length ?? 0,
        });
        return 'switched';
      } catch (error) {
        console.error('[cart] clearAndSwitchContext failed', {
          previousContext,
          nextContext: normalizedNext,
          error,
        });
        this.context = previousContext;
        this.cart = previousCart;
        this.loading = previousLoading;
        try {
          persistContext(previousContext);
        } catch (restoreError) {
          console.error('[cart] restore previous context failed', restoreError);
        }
        return 'failed';
      } finally {
        this.loading = false;
      }
    },
    async activateContext(next: CartContext, result: 'ready' | 'switched') {
      const normalizedNext = normalizeContext(next);
      const previousContext = this.context ? normalizeContext(this.context) : null;
      const previousCart = this.cart;
      const previousLoading = this.loading;
      console.log('[cart] activateContext', {
        nextContext: normalizedNext,
        result,
        previousContext: this.context,
      });
      this.loading = true;
      try {
        const nextCart = await this.fetchCartForContext(normalizedNext);
        persistContext(normalizedNext);
        this.context = normalizedNext;
        this.cart = nextCart;
        console.log('[cart] activateContext loaded', {
          nextContext: normalizedNext,
          cart: this.cart,
          itemsLength: this.cart?.items?.length ?? 0,
        });
        return result;
      } catch (error) {
        console.error('[cart] switchContext failed', {
          reason: 'load-next-cart-failed',
          next: normalizedNext,
          error,
        });
        this.context = previousContext;
        this.cart = previousCart;
        this.loading = previousLoading;
        try {
          persistContext(previousContext);
        } catch (restoreError) {
          console.error('[cart] restore previous context failed', restoreError);
        }
        return 'failed';
      } finally {
        this.loading = false;
      }
    },
    async fetchCartForContext(context: CartContext) {
      await useAuthStore().ensureLogin();
      return getCart(normalizeContext(context));
    },
    syncContextMetadata(next: CartContext) {
      const normalizedNext = normalizeContext(next);
      if (!this.context || !sameContext(this.context, normalizedNext)) return;
      this.context = normalizedNext;
      persistContext(normalizedNext);
      console.log('[cart] syncContextMetadata', {
        context: this.context,
      });
    },
    async load() {
      if (this.context) {
        this.context = normalizeContext(this.context);
        persistContext(this.context);
      }
      console.log('[cart] load start', {
        context: this.context,
      });
      if (!this.context) return;
      this.loading = true;
      try {
        this.cart = await this.fetchCartForContext(this.context);
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
      this.context = normalizeContext(this.context);
      persistContext(this.context);
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
      if (this.context) {
        this.context = normalizeContext(this.context);
        persistContext(this.context);
      }
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
    clearStaleContext(reason: string, error?: unknown) {
      const context = this.context;
      console.warn('[cart] stale context cleared', {
        context,
        reason,
        error,
      });
      this.cart = null;
      this.context = null;
      this.loading = false;
      persistContext(null);
    },
    resetAfterOrder() {
      this.cart = null;
      this.context = null;
      persistContext(null);
    },
  },
});
