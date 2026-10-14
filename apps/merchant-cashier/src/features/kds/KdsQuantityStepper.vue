<script setup lang="ts">
defineProps<{ modelValue: number; max: number; disabled: boolean; label: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: number] }>();
</script>

<template>
  <span class="kds-stepper">
    <button :disabled="disabled || modelValue <= 0" :aria-label="`− ${label}`" @click="emit('update:modelValue', modelValue - 1)">−</button>
    <input :value="modelValue" type="number" min="0" :max="max" :disabled="disabled" :aria-label="label"
      @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))" />
    <button :disabled="disabled || modelValue >= max" :aria-label="`+ ${label}`" @click="emit('update:modelValue', modelValue + 1)">+</button>
  </span>
</template>
