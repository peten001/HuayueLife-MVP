<script setup lang="ts">
</script>

<template>
  <slot />
</template>

<style>
page {
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
