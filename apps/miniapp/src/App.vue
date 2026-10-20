<script setup lang="ts">
</script>

<template>
  <slot />
</template>

<style>
page {
  --hy-primary: #43a047;
  --hy-primary-strong: #2e7d32;
  --hy-page: #f6faf7;
  --hy-surface: #ffffff;
  --hy-text: #1f2d24;
  --hy-muted: #666666;
  --hy-soft: #eaf7ee;
  --hy-border: #eeeeee;
  --hy-error: #b4233a;
  --explore-green: #2e7d32;
  --explore-ink: #1f2d24;
  --explore-muted: #66736b;
  --explore-soft: #eaf7ee;
  --explore-radius: 22rpx;
  background: #f6f3ef;
  color: #222;
}

button::after {
  border: 0;
}
</style>
