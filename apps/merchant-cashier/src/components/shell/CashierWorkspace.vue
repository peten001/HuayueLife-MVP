<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
  eyebrow?: string;
}>();
</script>

<template>
  <section class="cashier-workspace">
    <header class="workspace-heading">
      <div>
        <span v-if="eyebrow" class="workspace-heading__eyebrow">{{ eyebrow }}</span>
        <h2>{{ title }}</h2>
        <p v-if="description">{{ description }}</p>
      </div>
      <div class="workspace-heading__actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="cashier-workspace__content">
      <slot />
    </div>
  </section>
</template>
