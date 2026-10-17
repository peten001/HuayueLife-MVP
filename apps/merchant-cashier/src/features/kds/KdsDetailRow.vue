<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChefHat } from '@lucide/vue';
import { resolveMediaUrl } from '@/domain/media';

const props = defineProps<{ title: string; selected?: boolean; menuThumbnailUrl?: string | null; returned?: boolean; returnLabel?: string }>();
const thumbnailUrl = computed(() => resolveMediaUrl(props.menuThumbnailUrl));
const failedThumbnailUrl = ref('');
</script>

<template>
  <article class="kds-detail-card" :class="{ selected, 'kds-detail-card--returned': returned, 'kds-detail-card--readonly': !$slots.controls }">
    <span class="kds-detail-thumbnail">
      <img v-if="thumbnailUrl && thumbnailUrl !== failedThumbnailUrl" :key="thumbnailUrl" :src="thumbnailUrl"
        :alt="title" width="48" height="48" loading="lazy" decoding="async" @error="failedThumbnailUrl = thumbnailUrl" />
      <ChefHat v-else :size="22" aria-hidden="true" />
    </span>
    <div class="kds-detail-main">
      <header><slot name="title"><strong class="kds-return-title">{{ title }}</strong></slot><slot name="badges" /></header>
      <div class="kds-task-progress"><slot name="progress" /></div>
      <small v-if="returnLabel" class="kds-return-note">{{ returnLabel }}</small>
      <slot name="notes" />
    </div>
    <div v-if="$slots.controls" class="kds-quantity-row"><slot name="controls" /></div>
  </article>
</template>
