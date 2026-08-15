<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
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
  <form class="business-settings-page" @submit.prevent="save">
    <section class="store-profile-card">
      <header><h2>店铺资料（平台维护）</h2><div class="profile-badges"><span class="profile-badge">平台维护</span></div></header>
      <div class="store-profile-grid">
        <div class="profile-desktop-details"><h2>基础资料</h2><dl><dt>中文名称</dt><dd>{{ profile?.nameZh || '暂无' }}</dd><dt>越南语名称</dt><dd>{{ profile?.nameVi || '暂无' }}</dd><dt>英文名称</dt><dd>{{ profile?.nameEn || '暂无' }}</dd><dt>联系人</dt><dd>{{ profile?.contactName || '暂无' }}</dd><dt>联系电话</dt><dd>{{ profile?.contactPhone || '暂无' }}</dd></dl></div>
        <div class="profile-desktop-details"><h2>地址定位</h2><dl><dt>省份</dt><dd>{{ profile?.province || '暂无' }}</dd><dt>详细地址</dt><dd>{{ profile?.addressDetail || '暂无' }}</dd><dt>经度</dt><dd>{{ profile?.longitude || '暂无' }}</dd><dt>纬度</dt><dd>{{ profile?.latitude || '暂无' }}</dd></dl></div>
        <div><h2>商家封面</h2><div class="profile-cover"><img v-if="coverPreviewUrl" :src="coverPreviewUrl" alt="商家封面" /><span v-else>暂无封面图</span></div><p class="profile-maintenance-note">店铺资料由平台维护，如需修改请联系平台管理员。</p></div>
        <div class="profile-mobile-details"><dl><dt>中文名称</dt><dd>{{ profile?.nameZh || '暂无' }}</dd><dt>越南语名称</dt><dd>{{ profile?.nameVi || '暂无' }}</dd><dt>英文名称</dt><dd>{{ profile?.nameEn || '暂无' }}</dd><dt>详细地址</dt><dd>{{ profile?.addressDetail || '暂无' }}</dd><dt>经度</dt><dd>{{ profile?.longitude || '暂无' }}</dd><dt>纬度</dt><dd>{{ profile?.latitude || '暂无' }}</dd><dt>联系人</dt><dd>{{ profile?.contactName || '暂无' }}</dd><dt>联系电话</dt><dd>{{ profile?.contactPhone || '暂无' }}</dd></dl></div>
      </div>
    </section>
    <header class="business-settings-header"><div><h1>经营设置</h1><p v-if="message" class="settings-message" role="status" aria-live="polite">{{ message }}</p></div><div><button class="save-button" :disabled="saving || !canSaveSettings">{{ saving ? '保存中...' : '保存设置' }}</button></div></header>
    <div class="business-settings-grid">
      <main class="business-settings-left">
        <section class="settings-card notice-card"><h2>商家公告</h2><textarea v-model="form.notice" maxlength="300" @input="dirty = true" /><span class="counter">{{ form.notice.length }} / 300</span></section>
        <section class="settings-card"><h2>配送设置</h2><div class="delivery-fields"><label>起送价（VND）<input v-model.number="form.minimumDeliveryAmountVnd" type="number" min="0" @input="dirty = true" /></label><label>配送费（VND）<input v-model.number="form.deliveryFeeVnd" type="number" min="0" @input="dirty = true" /></label><label>配送半径（公里）<input v-model.number="form.deliveryRadiusKm" type="number" min="0" @input="dirty = true" /></label></div></section>
	        <section class="settings-card password-card">
	          <div class="password-card-title">
	            <h2>修改密码</h2>
	            <button type="button" class="password-action-button" :disabled="passwordSaving" @click="changePassword">
		              <span class="password-action-button__text">{{ passwordSaving ? '修改中' : '修改密码' }}</span>
	            </button>
	          </div>
	          <div class="password-fields">
	            <label>当前密码<input v-model="passwordForm.currentPassword" type="password" placeholder="请输入密码" /></label>
	            <label>新密码<input v-model="passwordForm.newPassword" type="password" placeholder="请输入密码" /></label>
	            <label>确认密码<input v-model="passwordForm.confirmPassword" type="password" placeholder="请输入密码" /></label>
	          </div>
	        </section>
      </main>
      <section class="settings-card hours-card">
        <div class="hours-title"><div><h2>{{ hoursCopy.title }}</h2><p>{{ hoursCopy.description }}</p></div></div>
        <div class="hours-table">
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
    </div>
    <div v-if="copyOpen" class="copy-modal" @click.self="copyOpen = false"><div class="copy-dialog"><h2>复制营业时间</h2><label>来源星期<select v-model="copySource"><option v-for="day in schedule" :key="day.key" :value="day.key">{{ t(day.key) }}</option></select></label><label>目标星期<select v-model="copyTarget"><option v-for="day in schedule" :key="day.key" :value="day.key">{{ t(day.key) }}</option></select></label><footer><button type="button" @click="copyOpen = false">取消</button><button type="button" class="save-button" @click="copyIntervals">确认复制</button></footer></div></div>
  </form>
</template>

<style scoped>
:global(.merchant-sidebar + .content){background:#f6f8f9}
.business-settings-page{display:grid;gap:14px;max-width:1640px;color:#10213d}.business-settings-header{display:flex;justify-content:space-between;align-items:start}.business-settings-header h1{margin:0;font-size:30px}.business-settings-header p,.settings-card p{margin:6px 0;color:#536b8b}.business-settings-header>div:last-child{display:grid;justify-items:end;gap:6px}.business-settings-header small{color:#536b8b}.save-button{border:0;border-radius:11px;background:#159447;color:#fff;padding:12px 22px;font:inherit;font-weight:700}.save-button:disabled{opacity:.65}.business-settings-grid{display:grid;grid-template-columns:1fr 1.48fr;gap:16px}.business-settings-left{display:grid;gap:16px}.settings-card{border:1px solid #e0e8e5;border-radius:16px;background:#fff;padding:20px;box-shadow:0 5px 18px #10213d08}.settings-card h2{margin:0;font-size:18px}.notice-card{min-height:264px}.notice-card textarea{width:100%;min-height:166px;margin-top:14px;resize:none}.counter{display:block;text-align:right;color:#637491;font-size:12px}.delivery-fields,.password-fields{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:18px}.settings-card label{display:grid;gap:8px;color:#536b8b;font-size:13px;font-weight:600}.settings-card input,.settings-card textarea,.settings-card select{box-sizing:border-box;border:1px solid #dce5e2;border-radius:10px;padding:11px 14px;background:#fff;color:#18263d;font:inherit}.password-hint{display:block;margin-top:18px;color:#159447}.password-actions{display:flex;justify-content:flex-end}.hours-card{padding:20px}.hours-title{display:flex;justify-content:space-between;align-items:start}.copy-button{border:1px solid #bfe2cb;border-radius:9px;background:#f7fcf8;color:#159447;padding:9px 15px;font-weight:700}.hours-table{margin-top:18px;border:1px solid #e0e8e5;border-radius:10px;overflow:hidden}.hours-head,.hours-row{display:grid;grid-template-columns:105px 145px 1fr 58px;align-items:center;gap:14px;padding:12px 16px}.hours-head{background:#f7fafb;color:#536b8b;font-size:13px;font-weight:700}.hours-row{min-height:66px;border-top:1px solid #e5ece9}.switch{position:relative}.switch input{position:absolute;width:1px;height:1px;margin:0;opacity:0}.switch i{display:block;width:42px;height:24px;border-radius:20px;background:#dfe5e7;position:relative}.switch i:after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.15s}.switch input:checked+i{background:#159447}.switch input:checked+i:after{left:21px}.switch input:focus-visible+i{outline:3px solid #8ccca3;outline-offset:3px}.intervals{display:grid;gap:8px}.interval{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.interval input{width:105px;padding:8px}.interval b{color:#536b8b}.add-interval{border:0;background:none;color:#159447;font-weight:700}.remove-interval{border:0;background:none;color:#536b8b;font-size:20px}.mobile-interval-actions{display:none}.rest{color:#536b8b}.settings-message{margin:0;color:#159447}.copy-modal{position:fixed;inset:0;display:grid;place-items:center;background:#10213d33;z-index:10}.copy-dialog{display:grid;gap:14px;width:340px;padding:22px;border-radius:16px;background:#fff;box-shadow:0 20px 60px #10213d33}.copy-dialog h2{margin:0}.copy-dialog footer{display:flex;justify-content:end;gap:10px}.copy-dialog footer button{padding:10px 14px;border:1px solid #dce5e2;border-radius:9px;background:#fff}@media(max-width:1100px){.business-settings-grid{grid-template-columns:1fr}.hours-card{order:-1}}@media(max-width:700px){.business-settings-header{display:grid;gap:12px}.business-settings-header>div:last-child{justify-items:start}.delivery-fields,.password-fields{grid-template-columns:1fr}.hours-head{display:none}.hours-row{grid-template-columns:70px 50px 1fr 30px;padding:12px 8px}.interval input{width:88px}}
.store-profile-card{border:1px solid #e0e8e5;border-radius:16px;background:#fff;padding:20px;box-shadow:0 5px 18px #10213d08}.store-profile-card>header{display:flex;justify-content:space-between;align-items:center}.store-profile-card h1{margin:0;font-size:24px}.store-profile-card header p{margin:4px 0 0;color:#536b8b}.profile-badge{padding:6px 10px;border-radius:999px;color:#17693c;background:#e4f4e9;font-size:12px;font-weight:700}.store-profile-grid{display:grid;grid-template-columns:1fr 1fr 240px;gap:28px;margin-top:18px}.store-profile-grid h2{margin:0 0 10px;font-size:16px}.store-profile-grid dl{display:grid;grid-template-columns:88px 1fr;gap:7px 12px;margin:0}.store-profile-grid dt{color:#7a8796;font-size:12px}.store-profile-grid dd{margin:0;color:#18263d;font-size:13px;font-weight:600}.profile-cover{height:110px;display:grid;place-items:center;overflow:hidden;border:1px solid #e0e8e5;border-radius:10px;background:#f7fafb;color:#7a8796;font-size:12px}.profile-cover img{width:100%;height:100%;object-fit:cover}
.intervals{display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px 18px}.add-interval{flex-basis:100%;text-align:left}
.notice-card textarea{min-height:140px}
.hours-head,.hours-row{padding-top:9px;padding-bottom:9px}
.hours-row{min-height:62px}
.hours-title p{display:block;max-width:62ch;font-size:13px;line-height:1.5}
.intervals{flex-wrap:wrap;position:relative;padding-bottom:24px;gap:8px 18px}
.interval{flex:0 0 calc((100% - 18px) / 2);flex-wrap:nowrap}
.hours-head{grid-template-columns:72px 92px minmax(0,1fr) 42px}
.hours-row{grid-template-columns:72px 92px minmax(0,1fr) 42px}
.hours-head > :nth-child(-n+2),.hours-row > strong,.hours-row > .switch{justify-self:end}
.interval input{width:105px;appearance:none}
.add-interval{position:absolute;left:0;bottom:0;flex-basis:auto}
.remove-interval{display:grid;place-items:center;width:32px;height:32px;border:0;background:none;color:#536b8b}
.remove-interval svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.business-settings-page{gap:10px}
.store-profile-card{padding:20px;border-radius:16px}
.store-profile-card>header{align-items:center}
.store-profile-card>header h2{margin:0;font-size:20px}
.profile-badges{display:flex;align-items:center;gap:8px}
.store-profile-grid{gap:28px;margin-top:18px}
.store-profile-grid h2{margin-bottom:10px}
.store-profile-grid dl{gap:7px 12px}
.store-profile-card{padding:18px 20px 20px;border-radius:18px}
.profile-mobile-details{display:none}
.store-profile-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(300px,.92fr);gap:18px;margin-top:18px}
.store-profile-grid dl{grid-template-columns:1fr;gap:12px;margin:0}
.profile-cover{height:auto;min-height:148px;border:1px solid #dbe3df;border-radius:12px;background:#f8fafc;aspect-ratio:16 / 9}
.profile-maintenance-note{margin-top:10px;padding:8px 10px;border:1px solid #fde68a;border-radius:10px;background:#fffbeb;color:#92400e;font-size:12px;line-height:1.5}
.settings-card{padding:16px;border-radius:14px}
.business-settings-grid{gap:12px}
.business-settings-left{gap:12px}
.notice-card{min-height:0}
.notice-card textarea{min-height:112px;margin-top:10px}
.delivery-fields,.password-fields{gap:12px;margin-top:12px}
.password-card-title{display:flex;justify-content:space-between;align-items:center;gap:10px}
.password-action-button{height:38px;padding:0 16px;min-width:94px;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid #159447;border-radius:11px;background:#fff;color:#159447;font:inherit;font-size:14px;font-weight:700;cursor:pointer;line-height:1.1}
.password-action-button__icon{font-size:14px;line-height:1}
.password-action-button:hover:not(:disabled){background:#f4fbf4}
.password-action-button:disabled{opacity:.72;cursor:not-allowed}
.hours-card{padding:16px}
.hours-table{margin-top:12px}
.hours-head,.hours-row{gap:10px;padding-top:7px;padding-bottom:7px}
.hours-row{min-height:56px}
.intervals{gap:6px 12px;padding-bottom:20px}
.interval{gap:6px}
.interval input{width:96px;padding:7px 9px}
.add-interval{font-size:12px}
.remove-interval{width:28px;height:28px}
.business-settings-grid{grid-template-columns:minmax(0,1fr) minmax(0,1.5fr);gap:16px;align-items:start}
.business-settings-left{gap:16px;align-content:start}
.settings-card{min-height:0}
.notice-card{min-height:0}
.notice-card textarea{height:140px;min-height:140px;margin-top:10px}
.delivery-fields,.password-fields{margin-top:12px;gap:12px}
.password-hint{display:none}
.hours-card{align-self:start}
.hours-table{margin-top:12px}
.hours-head,.hours-row{grid-template-columns:70px 80px minmax(0,1fr);gap:8px}
.hours-head,.hours-row{padding-left:14px;padding-right:14px}
.hours-head > :nth-child(-n+2),.hours-row > strong,.hours-row > .switch{justify-self:end}
.hours-head,.hours-row{padding-top:8px;padding-bottom:8px}
.hours-row{min-height:76px}
.intervals{display:flex;flex-wrap:wrap;align-items:flex-start;gap:6px 12px;position:relative;padding-bottom:20px}
.interval{display:flex;flex:0 0 calc((100% - 12px) / 2);align-items:center;gap:6px;flex-wrap:nowrap;min-width:0}
.interval input{width:100px;height:34px;padding:6px 8px}
.interval b{flex:0 0 auto}
.add-interval{position:absolute;left:0;bottom:0;flex-basis:auto;font-size:12px;line-height:16px}
.remove-interval{align-self:center;justify-self:center}
.copy-button{padding:7px 12px;font-size:12px}
.hours-head{border-bottom:1px solid #edf1ef}
.hours-row{border-top-color:#edf1ef}
.intervals{position:static;display:flex;flex-wrap:wrap;align-items:flex-start;gap:5px 16px;padding:0}
.interval{flex:0 0 calc((100% - 16px) / 2);gap:7px}
.interval input{width:100px;height:32px;padding:5px 7px;font-size:12px}
.add-interval{position:static;display:block;flex:0 0 auto;margin-top:0;font-size:12px;line-height:16px;text-align:left;white-space:nowrap}
.hours-row{min-height:76px;font-size:13px}
.hours-head{font-size:12px}
.hours-head > :nth-child(3){text-align:center}
.remove-interval svg{width:16px;height:16px}
.interval-remove{display:grid;flex:0 0 36px;width:36px;height:36px;place-items:center;border:0;border-radius:9px;background:#f1f4f2;color:#68766e;cursor:pointer}
.interval-remove svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.interval-remove:focus-visible,.add-interval:focus-visible{outline:3px solid #8ccca3;outline-offset:2px}
.hours-title h2{font-size:16px}
@media(max-width:1100px) and (min-width:769px){
  .business-settings-grid{grid-template-columns:minmax(0,1fr)}
  .hours-card{order:-1}
  .intervals{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));align-items:start}
  .interval{width:100%;min-width:0}
  .add-interval{grid-column:1/-1}
}
@media(max-width:768px){
  .business-settings-page{width:100%;min-width:0;gap:10px}
  .store-profile-card{min-width:0;padding:14px;border-radius:14px}
  .store-profile-card>header{align-items:flex-start;gap:10px;flex-wrap:wrap}
  .store-profile-card>header h2{font-size:17px}
  .profile-badge{white-space:nowrap}
  .store-profile-grid{grid-template-columns:minmax(0,1fr);gap:14px;margin-top:14px}
  .store-profile-grid>div{min-width:0;padding-top:14px;border-top:1px solid #edf1ef}
  .store-profile-grid>div:nth-child(3){order:-1;padding-top:0;border-top:0}
  .profile-desktop-details{display:none}
  .profile-mobile-details{display:block}
  .store-profile-grid dl{grid-template-columns:88px minmax(0,1fr);gap:8px 10px}
  .store-profile-grid dd{overflow-wrap:anywhere}
  .profile-cover{min-height:0;aspect-ratio:16/9}
  .business-settings-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:2px}
  .business-settings-header h1{font-size:22px}
  .business-settings-header>div:last-child{justify-items:end}
  .save-button{min-height:44px;padding:9px 14px;white-space:nowrap}
  .business-settings-grid{grid-template-columns:minmax(0,1fr);gap:10px}
  .business-settings-left{gap:10px}
  .settings-card{min-width:0;padding:14px;border-radius:14px}
  .settings-card h2{font-size:16px}
  .notice-card textarea{height:112px;min-height:112px}
  .delivery-fields,.password-fields{grid-template-columns:minmax(0,1fr);gap:12px}
  .settings-card input,.settings-card textarea,.settings-card select{min-height:44px;font-size:16px}
  .password-card-title{align-items:center}
  .password-action-button{min-width:96px;min-height:44px;height:44px;padding:0 13px;white-space:nowrap}
  .hours-card{order:0;padding:14px}
  .hours-table{display:grid;gap:8px;margin-top:10px;overflow:visible;border:0;border-radius:0}
  .hours-head{display:none}
  .hours-row{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:'day switch' 'intervals intervals';gap:8px;min-height:0;padding:10px 11px;border:1px solid #e4ebe7;border-radius:11px;background:#fbfdfb}
  .hours-row+ .hours-row{border-top:1px solid #e4ebe7}
  .hours-row>strong{grid-area:day;justify-self:start;align-self:center}
  .hours-row>.switch{grid-area:switch;justify-self:end}
  .hours-row>.intervals,.hours-row>.rest{grid-area:intervals}
  .hours-row>.desktop-remove-interval,.hours-row>span:last-child{display:none}
  .intervals{display:grid;position:static;gap:6px;padding:0}
  .interval{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr) 44px;gap:6px}
  .interval input{width:100%;min-width:0;height:44px;padding:7px 8px;font-size:16px}
  .desktop-add-interval{display:none}
  .add-interval{position:static;min-height:44px;margin-top:2px;padding:0 10px;border-radius:9px;background:#edf8f0;text-align:center}
  .interval-remove{width:44px;height:44px}
  .mobile-interval-actions{display:flex;gap:4px}
  .mobile-add-interval,.mobile-remove-interval{display:grid;width:44px;height:44px;place-items:center;border:0;border-radius:9px;color:#159447;background:#edf8f0;font:inherit;font-size:18px;font-weight:800}
  .mobile-remove-interval{color:#68766e;background:#f1f4f2}
  .mobile-remove-interval svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .switch{min-width:44px;min-height:44px;place-items:center}
  .switch i{margin:auto}
  .copy-dialog{width:min(340px,calc(100vw - 24px));padding:18px}
}
</style>
