import { nextTick } from 'vue';

export function beginImmediateTableSelectionTransition<T>(options: {
  primeSelection: () => void;
  navigate: () => Promise<T>;
  afterDomCommit?: () => void | Promise<void>;
}) {
  options.primeSelection();
  const navigation = options.navigate();
  if (options.afterDomCommit) {
    void navigation
      .then(() => nextTick())
      .then(options.afterDomCommit)
      .catch(() => undefined);
  }
  return navigation;
}
