import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { reservationErrorText, reservationText, type ArrivalReservation, type ArrivalChatSummary } from '@huayue-life/shared';
import { listReservations, updateReservation, type ReservationAction } from '@/api/reservations';
import { useAuthStore } from './auth';
import { useI18n } from '@/i18n';
import { useUiStore } from './ui';
import { useSoundStore } from './sound';
import { useLegacySoundStore } from './legacy-sound';
import { isDesktopSoundPresentation } from '@/features/sound/sound-presentation';
import { reservationsByTable } from '@/domain/reservation-queue';

export const useReservationsStore = defineStore('cashier-reservations', () => {
  const arrivals = ref<ArrivalReservation[]>([]);
  const reservations = computed(() => arrivals.value.filter(row => row.kind === 'DINE_IN'));
  const byTable = computed(() => reservationsByTable(reservations.value));
  const loading = ref(false);
  const error = ref('');
  const actionId = ref('');
  const serverNow = ref(Date.now());
  let inFlight: Promise<void> | null = null;
  let generation = 0;
  let merchantSnapshot = '';
  let seen = new Set<string>();
  const pending = computed(() => reservations.value.filter(row => row.status === 'PENDING'));
  const unread = computed(() => reservations.value.filter(row => (row.chatConversation?.merchantUnreadCount ?? 0) > 0));
  const attentionCount = computed(() => reservations.value.filter(row => row.status === 'PENDING' || (row.chatConversation?.merchantUnreadCount ?? 0) > 0).length);
  function load() {
    if (inFlight) return inFlight;
    const auth = useAuthStore();
    const merchantId = auth.merchant?.id ?? '';
    if (!auth.isAuthenticated || !merchantId) return Promise.resolve();
    const currentGeneration = generation;
    loading.value = true;
    const request = listReservations().then(result => {
      if (currentGeneration !== generation || useAuthStore().merchant?.id !== merchantId) return;
      if (merchantSnapshot !== merchantId) { seen = new Set(); merchantSnapshot = merchantId; }
      arrivals.value = result.reservations;
      serverNow.value = new Date(result.serverTime).getTime();
      error.value = '';
      const pendingDining = result.reservations.filter(row => row.kind === 'DINE_IN' && row.status === 'PENDING');
      if (pendingDining.some(row => !seen.has(row.id))) {
        const { locale } = useI18n();
        useUiStore().pushToast(reservationText('newReservation', locale.value), 'info', 8000);
      }
      seen = new Set(pendingDining.map(row => row.id));
      const sound = isDesktopSoundPresentation() ? useSoundStore('cashier') : useLegacySoundStore();
      sound.notifyNewOrders(pendingDining.map(row => row.id), `reservations:${merchantId}`);
    }).catch(caught => {
      if (currentGeneration === generation) error.value = reservationErrorText(caught instanceof Error ? caught.message : 'REQUEST_FAILED', useI18n().locale.value);
    }).finally(() => {
      if (inFlight === request) inFlight = null;
      if (currentGeneration === generation) loading.value = false;
    });
    inFlight = request;
    return request;
  }
  async function act(row: ArrivalReservation, input: ReservationAction) {
    if (actionId.value) return;
    actionId.value = `${row.kind}:${row.id}`;
    const mutationGeneration = ++generation;
    const merchantId = useAuthStore().merchant?.id;
    inFlight = null;
    error.value = '';
    try {
      const result = await updateReservation(row.kind, row.id, input);
      if (mutationGeneration !== generation || useAuthStore().merchant?.id !== merchantId) return;
      arrivals.value = arrivals.value.map(candidate => candidate.kind === row.kind && candidate.id === row.id ? result : candidate);
      await load();
      return result;
    } catch (caught) {
      if (mutationGeneration === generation) error.value = reservationErrorText(caught instanceof Error ? caught.message : 'REQUEST_FAILED', useI18n().locale.value);
      throw caught;
    } finally { if (mutationGeneration === generation) actionId.value = ''; }
  }
  function updateChatSummary(id: string, conversation: ArrivalChatSummary | null) {
    if (!conversation) return;
    arrivals.value = arrivals.value.map(row => row.kind === 'DINE_IN' && row.id === id ? { ...row, chatConversation: conversation } : row);
  }
  function reset() { generation += 1; arrivals.value = []; error.value = ''; actionId.value = ''; inFlight = null; loading.value = false; seen.clear(); merchantSnapshot = ''; }
  return { reservations, byTable, loading, error, actionId, serverNow, pending, unread, attentionCount, updateChatSummary, load, act, reset };
});
