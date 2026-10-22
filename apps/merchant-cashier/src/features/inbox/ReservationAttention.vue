<script setup lang="ts">
import { reservationText, type ReservationTextKey } from '@huayue-life/shared';
import { useReservationsStore } from '@/stores/reservations';
import { useI18n } from '@/i18n';
const store = useReservationsStore();
const { locale, t } = useI18n();
const rt = (key: ReservationTextKey) => reservationText(key, locale.value);
</script>
<template>
  <aside v-if="store.pending.length || store.unread.length" class="reservation-attention" aria-live="polite">
    <RouterLink v-if="store.unread.length" :to="{ path: '/reservations', query: { status: 'ALL', reservationId: store.unread[0]!.id, pane: 'chat' } }">{{ t('nav.reservations') }} · {{ rt('newMessages') }} <strong>{{ store.unread.length }}</strong> ›</RouterLink>
    <RouterLink v-if="store.pending.length" to="/reservations">{{ t('nav.reservations') }} · {{ t('reservations.filterPending') }} <strong>{{ store.pending.length }}</strong> ›</RouterLink>
  </aside>
</template>
<style scoped>
.reservation-attention{display:flex;flex:none;flex-wrap:wrap;align-items:center;gap:10px 24px;width:100%;box-sizing:border-box;padding:10px 20px;background:#253c2d;border-bottom:1px solid #3d5845;color:#d7e8d9;font-size:13px;line-height:1.6}.reservation-attention a{display:inline-flex;align-items:center;gap:8px;min-height:32px;color:inherit;text-decoration:none}.reservation-attention strong{font-variant-numeric:tabular-nums}.reservation-attention .due{color:#efcc8d}@media(max-width:899px){.reservation-attention{background:#eaf7ee;color:#2e7d32;border-color:#dbeadf;padding:8px 14px;font-size:12px}.reservation-attention .due{color:#8a6328}}
</style>
