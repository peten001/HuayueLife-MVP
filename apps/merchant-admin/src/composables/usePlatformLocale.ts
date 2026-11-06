import { platformLongCopy } from "./platform-copy-long";
import { platformExtraCopy } from "./platform-copy-extra";
import { commonInterfaceTranslations } from "@/i18n";
import { platformCopy } from "./platform-copy";
import { computed, ref } from "vue";
export type PlatformLocale = "zh" | "vi" | "en";
const saved = localStorage.getItem("yunqiao_platform_locale");
const locale = ref<PlatformLocale>(
  saved === "vi" || saved === "en" ? saved : "zh",
);
const words: Record<string, [string, string]> = {
  运营总览: ["Tổng quan", "Overview"],
  商家中心: ["Nhà bán hàng", "Merchants"],
  商家列表: ["Danh sách cửa hàng", "Merchant directory"],
  新增与导入: ["Thêm và nhập", "Create & import"],
  内容运营: ["Nội dung", "Content"],
  生活分类: ["Danh mục khám phá", "Discovery categories"],
  首页推荐: ["Đề xuất trang chủ", "Home recommendations"],
  标签库: ["Thư viện nhãn", "Tag library"],
  交易: ["Giao dịch", "Transactions"],
  订单管理: ["Đơn hàng", "Orders"],
  评价审核: ["Duyệt đánh giá", "Review moderation"],
  用户: ["Người dùng", "Users"],
  用户档案: ["Hồ sơ người dùng", "User profiles"],
  数据: ["Dữ liệu", "Data"],
  营业分析: ["Phân tích kinh doanh", "Business analytics"],
  系统: ["Hệ thống", "System"],
  行业与能力: ["Ngành và tính năng", "Industries & capabilities"],
  平台设置: ["Cài đặt nền tảng", "Platform settings"],
  平台管理员: ["Quản trị viên", "Platform administrator"],
  个人中心: ["Tài khoản", "Account"],
  退出登录: ["Đăng xuất", "Sign out"],
  关闭: ["Đóng", "Close"],
  "搜索商家、订单、用户": [
    "Tìm cửa hàng, đơn hàng, người dùng",
    "Search merchants, orders, users",
  ],
  搜索: ["Tìm kiếm", "Search"],
  搜索结果: ["Kết quả tìm kiếm", "Search results"],
  暂无匹配结果: ["Không tìm thấy kết quả", "No matching results"],
  待处理事项: ["Công việc cần xử lý", "Work queue"],
  "加载中…": ["Đang tải…", "Loading…"],
  请输入至少两个字: ["Nhập ít nhất 2 ký tự", "Enter at least 2 characters"],
  长时间未接单: ["Đơn chưa được nhận", "Orders awaiting acceptance"],
  待审核评价: ["Đánh giá chờ duyệt", "Reviews to moderate"],
  待完善商家: ["Hồ sơ chưa hoàn thiện", "Incomplete profiles"],
  查看: ["Xem", "View"],
  刷新: ["Làm mới", "Refresh"],
  保存: ["Lưu", "Save"],
  取消: ["Hủy", "Cancel"],
  返回: ["Quay lại", "Back"],
  重试: ["Thử lại", "Retry"],
  今天: ["Hôm nay", "Today"],
  "近 7 天": ["7 ngày qua", "Last 7 days"],
  "近 30 天": ["30 ngày qua", "Last 30 days"],
  已完成订单额: ["Giá trị đơn hoàn tất", "Completed order amount"],
  下单数: ["Số đơn đặt", "Orders placed"],
  取消订单: ["Đơn đã hủy", "Cancelled orders"],
  进行中订单额: ["Giá trị đơn đang xử lý", "Active order amount"],
  上期: ["Kỳ trước", "Previous period"],
  本期: ["Kỳ này", "Current period"],
  全部城市: ["Tất cả thành phố", "All cities"],
  全部商家: ["Tất cả cửa hàng", "All merchants"],
  查询: ["Áp dụng", "Apply"],
  高级筛选: ["Bộ lọc nâng cao", "Advanced filters"],
  暂无数据: ["Chưa có dữ liệu", "No data"],
  已更新: ["Đã cập nhật", "Updated"],
};
export function platformText(text: string): string {
  if (locale.value === "zh") return text;
  const pair =
    words[text] ||
    platformCopy[text] ||
    platformExtraCopy[text] ||
    platformLongCopy[text] ||
    commonInterfaceTranslations[text];
  return pair ? pair[locale.value === "vi" ? 0 : 1] : text;
}
export function usePlatformLocale() {
  function setLocale(value: PlatformLocale) {
    locale.value = value;
    localStorage.setItem("yunqiao_platform_locale", value);
    document.documentElement.lang = value === "zh" ? "zh-CN" : value;
  }
  return { locale: computed(() => locale.value), setLocale, t: platformText };
}
