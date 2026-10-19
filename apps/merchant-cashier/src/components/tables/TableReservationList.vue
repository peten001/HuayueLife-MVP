<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { formatReservationTime, reservationText, type ArrivalReservation, type ReservationTextKey } from '@huayue-life/shared';
import { useI18n } from '@/i18n';
defineProps<{ reservations: ArrivalReservation[] }>();
const { locale } = useI18n();
const rt = (key: ReservationTextKey) => reservationText(key, locale.value);
</script>

<template>
  <section v-if="reservations.length" class="table-planned-visits" data-testid="table-planned-visits">
    <header><strong>{{ rt('plannedVisits') }}</strong><small>{{ rt('plannedOnly') }}</small></header>
    <RouterLink v-for="row in reservations" :key="row.id" :to="{ path: '/reservations', query: { reservationId: row.id } }" :aria-label="`${rt('viewReservation')} ${row.contactName}`">
      <strong>{{ formatReservationTime(row.scheduledFor, locale) }}</strong>
      <span>{{ row.contactName }} · {{ row.guestCount }} {{ rt('people') }} · {{ row.contactPhone }}</span>
      <small v-if="row.proposedScheduledFor">{{ rt('changeProposed') }} · {{ formatReservationTime(row.proposedScheduledFor, locale) }}</small>
    </RouterLink>
  </section>
</template>

<style scoped>
.table-planned-visits{display:grid;flex:none;gap:8px;max-height:30dvh;overflow-y:auto;margin-bottom:10px;border-radius:10px;padding:12px;background:rgb(125 162 118 / 12%);color:inherit}.table-planned-visits>header{display:grid;gap:4px}.table-planned-visits>header>strong{font-size:13px}.table-planned-visits small{color:var(--cashier-shell-muted,#728278);font-size:11px;line-height:1.5}.table-planned-visits a{display:grid;gap:5px;min-height:44px;padding:8px 0;border-top:1px solid var(--cashier-shell-border,#dce5df);color:inherit;text-decoration:none;font-size:12px;line-height:1.6;overflow-wrap:anywhere}.table-planned-visits a>strong{font-size:13px}.table-planned-visits a:hover{color:var(--cashier-green,#43a047)}.table-planned-visits a:focus-visible{outline:2px solid #43a047;outline-offset:2px}
</style>
