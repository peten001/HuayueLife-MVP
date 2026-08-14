export type OneTapLoginUiOutcome = 'success' | 'cancelled' | 'failed';

type OneTapLoginUiControllerOptions = {
  onVisibilityChange?: (visible: boolean) => void;
};

export function createOneTapLoginUiController(
  options: OneTapLoginUiControllerOptions = {},
) {
  let visible = false;
  let pendingPromise: Promise<OneTapLoginUiOutcome> | null = null;
  let resolvePending: ((outcome: OneTapLoginUiOutcome) => void) | null = null;

  function setVisible(nextVisible: boolean) {
    if (visible === nextVisible) return;
    visible = nextVisible;
    options.onVisibilityChange?.(visible);
  }

  return {
    get visible() {
      return visible;
    },
    open() {
      if (pendingPromise) return pendingPromise;
      setVisible(true);
      pendingPromise = new Promise<OneTapLoginUiOutcome>((resolve) => {
        resolvePending = resolve;
      });
      return pendingPromise;
    },
    finish(outcome: OneTapLoginUiOutcome) {
      if (!resolvePending) return false;
      const resolve = resolvePending;
      resolvePending = null;
      pendingPromise = null;
      setVisible(false);
      resolve(outcome);
      return true;
    },
  };
}
