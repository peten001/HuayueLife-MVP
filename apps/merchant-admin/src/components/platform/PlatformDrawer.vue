<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import MerchantIcon from "@/components/MerchantIcon.vue";
import { usePlatformLocale } from "@/composables/usePlatformLocale";
const props = defineProps<{ open: boolean; title: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement>();
const { t } = usePlatformLocale();
let previous: HTMLElement | null = null;
let oldOverflow = "";
function keydown(event: KeyboardEvent) {
  if (!props.open) return;
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  }
  if (event.key !== "Tab" || !panel.value) return;
  const elements = [
    ...panel.value.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    ),
  ].filter((el) => el.offsetParent !== null);
  if (!elements.length) {
    event.preventDefault();
    panel.value.focus();
    return;
  }
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === panel.value)
  ) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
watch(
  () => props.open,
  async (open) => {
    if (open) {
      previous = document.activeElement as HTMLElement;
      oldOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", keydown);
      await nextTick();
      panel.value?.focus();
    } else {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    }
  },
);
onBeforeUnmount(() => {
  if (props.open) document.body.style.overflow = oldOverflow;
  document.removeEventListener("keydown", keydown);
});
</script>
<template>
  <Teleport to="body"
    ><Transition name="p-drawer">
      <div v-if="open" class="p-drawer-mask" @click.self="emit('close')">
        <section
          ref="panel"
          class="p-drawer"
          :class="{ 'p-drawer-wide': wide }"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          tabindex="-1"
        >
          <header>
            <h2>{{ title }}</h2>
            <button
              class="p-icon-button"
              :aria-label="t('关闭')"
              @click="emit('close')"
            >
              <MerchantIcon name="close" />
            </button>
          </header>
          <div class="p-drawer-body"><slot /></div>
          <footer v-if="$slots.footer"><slot name="footer" /></footer>
        </section>
      </div> </Transition
  ></Teleport>
</template>
