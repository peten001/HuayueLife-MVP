export type FavoriteLoginOutcome = 'success' | 'cancelled' | 'failed';

export type FavoriteGateResult =
  | 'completed'
  | 'cancelled'
  | 'login-failed'
  | 'favorite-failed'
  | 'context-changed'
  | 'ignored';

type PendingFavoriteIntent = {
  merchantId: string;
  desiredState: boolean;
  reauthAttempts: 0 | 1;
};

type ToggleFavoriteInput = {
  merchantId: string;
  currentState: boolean;
};

type MerchantFavoriteGateDependencies = {
  isAuthenticated: () => boolean;
  requestLogin: (forceLogin: boolean) => Promise<FavoriteLoginOutcome>;
  persistFavorite: (merchantId: string, desiredState: boolean) => Promise<void>;
  isContextCurrent: (merchantId: string) => boolean;
  onStateChanged: (desiredState: boolean) => void;
  onFavoriteFailure: () => void;
};

function errorStatusCode(error: unknown) {
  if (!(error instanceof Error)) return undefined;
  return (error as Error & { statusCode?: number }).statusCode;
}

export function createMerchantFavoriteGate(dependencies: MerchantFavoriteGateDependencies) {
  let active = true;
  let interactionInFlight = false;
  let pendingIntent: PendingFavoriteIntent | null = null;

  function clearPending() {
    pendingIntent = null;
  }

  function intentIsCurrent(intent: PendingFavoriteIntent) {
    return active && dependencies.isContextCurrent(intent.merchantId);
  }

  async function consumePending(): Promise<FavoriteGateResult> {
    const intent = pendingIntent;
    if (!intent) return 'ignored';

    // Consume before the asynchronous write so duplicate login callbacks cannot replay it.
    clearPending();
    if (!intentIsCurrent(intent)) return 'context-changed';

    try {
      await dependencies.persistFavorite(intent.merchantId, intent.desiredState);
      if (!intentIsCurrent(intent)) return 'context-changed';
      dependencies.onStateChanged(intent.desiredState);
      return 'completed';
    } catch (error) {
      if (errorStatusCode(error) === 401 && intent.reauthAttempts === 0 && intentIsCurrent(intent)) {
        pendingIntent = { ...intent, reauthAttempts: 1 };
        return loginAndContinue(true);
      }
      dependencies.onFavoriteFailure();
      return 'favorite-failed';
    }
  }

  async function loginAndContinue(forceLogin: boolean): Promise<FavoriteGateResult> {
    const loginOutcome = await dependencies.requestLogin(forceLogin);
    if (!pendingIntent) return 'ignored';
    if (loginOutcome === 'cancelled') {
      clearPending();
      return 'cancelled';
    }
    if (loginOutcome === 'failed' || !dependencies.isAuthenticated()) {
      clearPending();
      return 'login-failed';
    }
    return consumePending();
  }

  return {
    setActive(nextActive: boolean) {
      active = nextActive;
      if (!active) clearPending();
    },
    async toggle(input: ToggleFavoriteInput): Promise<FavoriteGateResult> {
      if (!active || interactionInFlight || pendingIntent) return 'ignored';

      pendingIntent = {
        merchantId: input.merchantId,
        desiredState: !input.currentState,
        reauthAttempts: 0,
      };
      interactionInFlight = true;
      try {
        if (!dependencies.isAuthenticated()) return await loginAndContinue(false);
        return await consumePending();
      } finally {
        interactionInFlight = false;
        if (!active) clearPending();
      }
    },
    continueAfterLogin() {
      return consumePending();
    },
  };
}
