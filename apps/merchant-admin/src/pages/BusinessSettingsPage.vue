<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import MerchantDialog from '@/components/MerchantDialog.vue';
import MerchantIcon from '@/components/MerchantIcon.vue';
import { useRouter } from 'vue-router';
import { errorMessage } from '@/api/http';
import { changeMerchantPassword, getProfile, updateProfile } from '@/api/merchant';
import { useI18n } from '@/i18n';
import { resolveMediaUrl } from '@/utils/media';
import { clearMerchantStaff, clearToken, getMerchantStaff } from '@/utils/storage';
import type { MerchantProfile } from '@/types/api';

type WeekdayKey = 'monday'|'tuesday'|'wednesday'|'thursday'|'friday'|'saturday'|'sunday';
interface Interval { start: string; end: string }
interface DaySchedule { key: WeekdayKey; enabled: boolean; intervals: Interval[] }
const keys: WeekdayKey[] = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const { locale, t } = useI18n();
const router = useRouter();
const section = ref('hours');
const coverFailed = ref(false);
const word = (zh:string,vi:string,en:string) => locale.value === 'zh' ? zh : locale.value === 'vi' ? vi : en;
const sections = computed(()=>[
 {key:'hours',label:hoursCopy.value.title,description:word('每周营业时段','Giờ mở cửa hàng tuần','Weekly opening hours'),icon:'calendar'},
 {key:'delivery',label:word('配送设置','Giao hàng','Delivery'),description:word('范围、起送价和费用','Phạm vi, tối thiểu và phí','Range, minimum and fee'),icon:'orders'},
 {key:'notice',label:word('商家公告','Thông báo','Store notice'),description:word('顾客可见的店铺说明','Thông tin khách hàng nhìn thấy','Customer-facing message'),icon:'records'},
 {key:'profile',label:word('店铺资料','Thông tin cửa hàng','Store profile'),description:word('名称、联系和地址','Tên, liên hệ và địa chỉ','Name, contact and address'),icon:'store'},
 {key:'security',label:word('账户安全','Bảo mật','Security'),description:word('修改当前登录密码','Đổi mật khẩu đăng nhập','Change sign-in password'),icon:'user'}
]);
const form = reactive({ notice: '', minimumDeliveryAmountVnd: 0, deliveryFeeVnd: 0, deliveryRadiusKm: 0 });
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' });
const schedule = ref<DaySchedule[]>(keys.map((key) => ({ key, enabled: true, intervals: [{ start: '09:00', end: '14:00' }, { start: '17:00', end: '22:00' }] })));
const message = ref(''); const saving = ref(false); const passwordSaving = ref(false); const dirty = ref(false); const copyOpen = ref(false); const copySource = ref<WeekdayKey>('monday'); const copyTarget = ref<WeekdayKey>('tuesday');
const profile = ref<MerchantProfile | null>(null);
const coverPreviewUrl = computed(() => resolveMediaUrl(profile.value?.coverUrl || profile.value?.images?.find((item) => item.imageType === 'COVER')?.imageUrl));
const currentRole = computed(() => getMerchantStaff()?.role ?? 'STAFF');
const canSaveSettings = computed(() => currentRole.value !== 'STAFF');
const hoursCopy = computed(() => locale.value === 'vi' ? {
  description: 'Có thể thêm nhiều khung giờ. Nếu giờ kết thúc sớm hơn giờ bắt đầu, hệ thống hiểu là ngày hôm sau.',
  title: 'Giờ mở cửa', weekday: 'Thứ', state: 'Trạng thái', segments: 'Khung giờ', rest: 'Nghỉ (không mở cửa)', start: 'bắt đầu', end: 'kết thúc', add: 'Thêm khung giờ', remove: 'Xóa khung giờ', nextDay: '→ hôm sau', needSegment: 'Vui lòng thêm ít nhất một khung giờ', sameTime: 'Giờ bắt đầu và kết thúc không được giống nhau', overlap: 'Các khung giờ không được chồng lấn, kể cả giữa hai ngày liền kề.', lastSegment: 'Muốn nghỉ cả ngày, hãy tắt trạng thái mở cửa.', openState: 'Trạng thái mở cửa', segment: 'khung giờ',
} : locale.value === 'en' ? {
  description: 'Add as many segments as needed. An end time earlier than its start means the next day.',
  title: 'Business hours', weekday: 'Day', state: 'Open status', segments: 'Business segments', rest: 'Closed', start: 'start', end: 'end', add: 'Add segment', remove: 'Remove segment', nextDay: '→ next day', needSegment: 'Add at least one business segment', sameTime: 'Start and end times cannot be equal', overlap: 'Segments cannot overlap, including across adjacent weekdays.', lastSegment: 'To close for the whole day, turn off the open status.', openState: 'open status', segment: 'segment',
} : {
  description: '可添加多个营业时段；结束时间早于开始时间时，表示营业至次日。',
  title: '营业时间', weekday: '星期', state: '营业状态', segments: '营业时段', rest: '休息（不营业）', start: '开始', end: '结束', add: '添加时段', remove: '删除时段', nextDay: '→ 次日', needSegment: '请至少添加一个营业时段', sameTime: '开始时间和结束时间不能相同', overlap: '营业时段不能重叠，包括相邻星期的跨天时段。', lastSegment: '如需当天休息，请关闭营业状态。', openState: '营业状态', segment: '时段',
});

onMounted(async () => { try { const p = await getProfile(); profile.value = p; Object.assign(form, { notice: p.notice ?? '', minimumDeliveryAmountVnd: Number(p.minimumDeliveryAmountVnd), deliveryFeeVnd: Number(p.deliveryFeeVnd), deliveryRadiusKm: Number(p.deliveryRadiusKm) }); schedule.value = parseHours(p.businessHours); } catch (e) { message.value = errorMessage(e); } });
function parseHours(raw: Record<string, string[]> | undefined) { return keys.map((key) => { const values = raw?.[key] ?? []; const intervals = values.map(parseRange).filter(Boolean) as Interval[]; return { key, enabled: intervals.length > 0, intervals: intervals.length ? intervals : [{ start: '09:00', end: '22:00' }] }; }); }
function parseRange(value: string): Interval | null { const [start, end] = value.split('-'); return start && end ? { start, end } : null; }
function minutes(value: string) { const [h, m] = value.split(':').map(Number); return h * 60 + m; }
function validate() { const weekly: Array<{ id: string; start: number; end: number }> = []; for (const [dayIndex, day] of schedule.value.entries()) { if (!day.enabled) continue; if (!day.intervals.length) return `${t(day.key)}：${hoursCopy.value.needSegment}`; for (const [index, interval] of day.intervals.entries()) { const start = minutes(interval.start); const end = minutes(interval.end); if (start === end) return `${t(day.key)}：${hoursCopy.value.sameTime}`; weekly.push({ id: `${day.key}:${index}`, start: dayIndex * 1440 + start, end: dayIndex * 1440 + end + (end < start ? 1440 : 0) }); } } for (const interval of weekly) { for (const other of weekly) { if (interval.id === other.id) continue; for (const offset of [-10080, 0, 10080]) { if (Math.max(interval.start, other.start + offset) < Math.min(interval.end, other.end + offset)) return hoursCopy.value.overlap; } } } return ''; }
function payload() { return Object.fromEntries(schedule.value.map((day) => [day.key, day.enabled ? [...day.intervals].sort((a,b) => minutes(a.start)-minutes(b.start)).map((i) => `${i.start}-${i.end}`) : []])); }
function addInterval(day: DaySchedule) { day.intervals.push({ start: '09:00', end: '12:00' }); dirty.value = true; }
function removeInterval(day: DaySchedule, index: number) { if (day.intervals.length === 1) { message.value = hoursCopy.value.lastSegment; return; } day.intervals.splice(index, 1); dirty.value = true; }
function copyIntervals() { const source = schedule.value.find((d) => d.key === copySource.value); const target = schedule.value.find((d) => d.key === copyTarget.value); if (source && target) { target.intervals = source.intervals.map((i) => ({ ...i })); target.enabled = source.enabled; dirty.value = true; } copyOpen.value = false; }
async function save() {
  message.value = '';
  if (!canSaveSettings.value) {
    return;
  }
  const invalid = validate();
  if (invalid) {
    message.value = invalid;
    return;
  }
  saving.value = true;
  try {
    await updateProfile({
      notice: form.notice,
      minimumDeliveryAmountVnd: form.minimumDeliveryAmountVnd,
      deliveryFeeVnd: form.deliveryFeeVnd,
      deliveryRadiusKm: form.deliveryRadiusKm,
      businessHours: payload(),
    });
    message.value = '设置已保存';
    dirty.value = false;
  } catch (e) {
    message.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}
async function changePassword() {
  message.value = '';
  if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
    message.value = '请完整填写密码三项内容';
    return;
  }
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    message.value = '新密码与确认密码不一致';
    return;
  }
  passwordSaving.value = true;
  try {
    await changeMerchantPassword({
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
      confirmPassword: passwordForm.confirmPassword,
    });
    passwordForm.currentPassword = '';
    passwordForm.newPassword = '';
    passwordForm.confirmPassword = '';
    clearToken();
    clearMerchantStaff();
    await router.push('/login');
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    passwordSaving.value = false;
  }
}
</script>

<template>
  <form class="business-settings-page mx-settings" @submit.prevent="save">
    <header class="mx-heading"><div><h1>{{ word('店铺设置','Thiết lập cửa hàng','Store settings') }}</h1><p>{{ word('营业规则与店铺资料','Giờ mở cửa và thông tin cửa hàng','Trading settings and store information') }}</p></div><span v-if="dirty" class="mx-unsaved">{{ word('有未保存的修改','Có thay đổi chưa lưu','Unsaved changes') }}</span></header>
    <p v-if="message" class="message" role="status">{{ message }}</p>
    <div class="mx-settings-layout"><nav class="mx-settings-nav" :aria-label="word('设置分类','Mục thiết lập','Settings sections')"><button v-for="tab in sections" :key="tab.key" type="button" :aria-pressed="section===tab.key" @click="section=tab.key"><span class="mx-settings-nav-icon"><MerchantIcon :name="tab.icon" /></span><span class="mx-settings-nav-copy"><strong>{{ tab.label }}</strong><small>{{ tab.description }}</small></span><span class="mx-settings-nav-chevron" aria-hidden="true">›</span></button></nav>
    <div class="mx-settings-content">
      <section v-show="section==='hours'" class="mx-panel hours-card"><header class="mx-panel-heading"><div><h2>{{ hoursCopy.title }}</h2><p>{{ hoursCopy.description }}</p></div></header>        <div class="hours-table">
          <div class="hours-head"><span>{{ hoursCopy.weekday }}</span><span>{{ hoursCopy.state }}</span><span>{{ hoursCopy.segments }}</span></div>
          <div v-for="day in schedule" :key="day.key" class="hours-row">
            <strong>{{ t(day.key) }}</strong>
            <label class="switch"><input v-model="day.enabled" type="checkbox" :aria-label="`${t(day.key)} ${hoursCopy.openState}`" @change="dirty = true" /><i /></label>
            <div v-if="day.enabled" class="intervals">
              <div v-for="(interval, index) in day.intervals" :key="index" class="interval">
                <input v-model="interval.start" type="time" :aria-label="`${t(day.key)} ${index + 1} ${hoursCopy.segment} ${hoursCopy.start}`" @change="dirty = true" />
                <b>{{ minutes(interval.end) < minutes(interval.start) ? hoursCopy.nextDay : '–' }}</b>
                <input v-model="interval.end" type="time" :aria-label="`${t(day.key)} ${index + 1} ${hoursCopy.segment} ${hoursCopy.end}`" @change="dirty = true" />
                <button type="button" class="interval-remove" :aria-label="`${hoursCopy.remove}：${t(day.key)} ${index + 1} ${hoursCopy.segment}`" @click="removeInterval(day, index)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2m-8 0 1 13h8l1-13M10 10v7m4-7v7" /></svg>
                </button>
              </div>
              <button type="button" class="add-interval" @click="addInterval(day)">＋ {{ hoursCopy.add }}</button>
            </div>
            <span v-else class="rest">{{ hoursCopy.rest }}</span>
          </div>
        </div>
      </section>
      <section v-show="section==='delivery'" class="mx-panel mx-form"><header class="mx-panel-heading"><div><h2>{{ word('配送设置','Giao hàng','Delivery') }}</h2><p>{{ word('金额以越南盾计，距离以公里计','Số tiền bằng VND, khoảng cách tính bằng km','Amounts in VND; distances in kilometres') }}</p></div></header><div class="mx-form-section"><label>{{ word('起送价','Giá trị đơn tối thiểu','Minimum order') }} · VND<input v-model.number="form.minimumDeliveryAmountVnd" type="number" min="0" @input="dirty=true" /></label><label>{{ word('配送费','Phí giao hàng','Delivery fee') }} · VND<input v-model.number="form.deliveryFeeVnd" type="number" min="0" @input="dirty=true" /></label><label>{{ word('配送半径','Bán kính giao hàng','Delivery radius') }} · km<input v-model.number="form.deliveryRadiusKm" type="number" min="0" @input="dirty=true" /></label></div></section>
      <section v-show="section==='notice'" class="mx-panel mx-form"><header class="mx-panel-heading"><h2>{{ word('商家公告','Thông báo cửa hàng','Store notice') }}</h2></header><label>{{ word('公告内容','Nội dung thông báo','Notice') }}<textarea v-model="form.notice" rows="6" maxlength="300" @input="dirty=true" /></label><small class="mx-right">{{ form.notice.length }} / 300</small></section>
      <section v-show="section==='profile'" class="mx-panel"><header class="mx-panel-heading"><h2>{{ word('店铺资料','Thông tin cửa hàng','Store profile') }}</h2><span class="mx-dot-status">{{ word('平台维护','Do nền tảng quản lý','Managed by platform') }}</span></header><div class="mx-store-profile"><div class="mx-store-cover"><img v-if="coverPreviewUrl&&!coverFailed" :src="coverPreviewUrl" :alt="profile?.nameZh||word('店铺封面','Ảnh cửa hàng','Store cover')" @error="coverFailed=true" /><MerchantIcon v-else name="store" /></div><dl class="mx-facts"><div><dt>{{ word('中文名称','Tên tiếng Trung','Chinese name') }}</dt><dd>{{ profile?.nameZh||'—' }}</dd></div><div><dt>{{ word('越南语名称','Tên tiếng Việt','Vietnamese name') }}</dt><dd>{{ profile?.nameVi||'—' }}</dd></div><div><dt>{{ word('英文名称','Tên tiếng Anh','English name') }}</dt><dd>{{ profile?.nameEn||'—' }}</dd></div><div><dt>{{ word('联系人','Người liên hệ','Contact') }}</dt><dd>{{ profile?.contactName||'—' }}</dd></div><div><dt>{{ word('联系电话','Điện thoại','Phone') }}</dt><dd>{{ profile?.contactPhone||'—' }}</dd></div><div><dt>{{ word('省份','Tỉnh / Thành phố','Province') }}</dt><dd>{{ profile?.province||'—' }}</dd></div><div><dt>{{ word('详细地址','Địa chỉ','Address') }}</dt><dd>{{ profile?.addressDetail||'—' }}</dd></div><div><dt>{{ word('经度 / 纬度','Kinh độ / Vĩ độ','Longitude / Latitude') }}</dt><dd>{{ profile?.longitude??'—' }} / {{ profile?.latitude??'—' }}</dd></div></dl></div><p class="mx-note">{{ word('资料由平台维护，如需修改请联系平台管理员。','Liên hệ quản trị viên nền tảng để cập nhật thông tin.','Contact the platform administrator to update these details.') }}</p></section>
      <section v-show="section==='security'" class="mx-panel mx-form"><header class="mx-panel-heading"><div><h2>{{ word('修改密码','Đổi mật khẩu','Change password') }}</h2><p>{{ word('修改成功后需重新登录','Đăng nhập lại sau khi đổi mật khẩu','Sign in again after changing your password') }}</p></div></header><div class="mx-form-section"><label>{{ word('当前密码','Mật khẩu hiện tại','Current password') }}<input v-model="passwordForm.currentPassword" type="password" autocomplete="current-password" /></label><label>{{ word('新密码','Mật khẩu mới','New password') }}<input v-model="passwordForm.newPassword" type="password" autocomplete="new-password" /></label><label>{{ word('确认密码','Xác nhận mật khẩu','Confirm password') }}<input v-model="passwordForm.confirmPassword" type="password" autocomplete="new-password" /></label></div><div class="mx-editor-actions"><button type="button" :disabled="passwordSaving" @click="changePassword">{{ passwordSaving?word('修改中…','Đang đổi…','Changing…'):word('修改密码','Đổi mật khẩu','Change password') }}</button></div></section>
      <footer v-if="!['profile','security'].includes(section)" class="mx-settings-save"><span>{{ !canSaveSettings ? word('当前角色仅可查看','Chỉ có quyền xem','Read-only access') : word('修改后请保存设置','Lưu sau khi chỉnh sửa','Save after making changes') }}</span><button type="submit" :disabled="saving||!canSaveSettings">{{ saving?word('保存中…','Đang lưu…','Saving…'):word('保存设置','Lưu thiết lập','Save settings') }}</button></footer>
    </div></div>
    <MerchantDialog :open="copyOpen" :title="word('复制营业时间','Sao chép giờ mở cửa','Copy business hours')" @close="copyOpen=false"><div class="mx-form"><label>{{ word('来源星期','Ngày nguồn','From day') }}<select v-model="copySource"><option v-for="day in schedule" :key="day.key" :value="day.key">{{ t(day.key) }}</option></select></label><label>{{ word('目标星期','Ngày đích','To day') }}<select v-model="copyTarget"><option v-for="day in schedule" :key="day.key" :value="day.key">{{ t(day.key) }}</option></select></label><button type="button" @click="copyIntervals">{{ word('确认复制','Sao chép','Copy hours') }}</button></div></MerchantDialog>
  </form>
</template>
