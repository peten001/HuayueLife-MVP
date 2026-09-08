<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MerchantDialog from '@/components/MerchantDialog.vue';
import MerchantIcon from '@/components/MerchantIcon.vue';
import { errorMessage } from '@/api/http';
import { useI18n } from '@/i18n';
import {
  createCategory,
  createProduct,
  disableCategory,
  disableProduct,
  getCategories,
  getProducts,
  updateCategory,
  updateProduct,
  updateProductStatus,
  uploadProductImage,
} from '@/api/merchant';
import type { Category, Product, ProductStatus } from '@/types/api';
import { resolveMediaUrl } from '@/utils/media';

type ManagementTab = 'products' | 'categories';
type ProductFilterStatus = 'ALL' | 'ON_SALE' | 'SOLD_OUT' | 'OFF_SALE';
type ProductSortMode = 'DEFAULT' | 'PRICE_ASC' | 'PRICE_DESC' | 'SORT_ASC' | 'NAME_ASC';

const route = useRoute();
const router = useRouter();
const { locale, t } = useI18n();

const categories = ref<Category[]>([]);
const products = ref<Product[]>([]);

const pageMessage = ref('');
const categoryMessage = ref('');
const productMessage = ref('');
const loading = ref(false);
const uploading = ref(false);
const showProductModal = ref(false);
const mobileFiltersOpen = ref(false);
const mobileSearchOpen = ref(false);
const mobileSortOpen = ref(false);
const productPendingDelete = ref<Product | null>(null);
const deletingProduct = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const mobileSearchInput = ref<HTMLInputElement | null>(null);
const deleteDialog = ref<HTMLElement | null>(null);
const deleteCancelButton = ref<HTMLButtonElement | null>(null);
const isMobileProductList = ref(false);
const selectedProductId = ref('');
const selectedProduct = computed(() => products.value.find(row => row.id === selectedProductId.value));
const categoryEditor = ref<HTMLElement>();
function word(zh: string, vi: string, en: string) { return ({ zh, vi, en })[locale.value]; }
function productName(row: Product) { return locale.value === 'vi' && row.nameVi ? row.nameVi : locale.value === 'en' && row.nameEn ? row.nameEn : row.nameZh; }
function secondaryProductName(row: Product) { return locale.value === 'zh' ? row.nameVi || pageCopy.value.missingVietnamese : row.nameZh; }
function editSelectedProduct() { const row = selectedProduct.value; selectedProductId.value = ''; if (row) editProduct(row); }
async function deleteSelectedProduct() { const row = selectedProduct.value; selectedProductId.value = ''; await nextTick(); if (row) void disableProductRow(row); }
async function openMobileSearch() {
  mobileSearchOpen.value = true;
  await nextTick();
  mobileSearchInput.value?.focus();
}
function closeMobileSearch() {
  searchKeyword.value = '';
  mobileSearchOpen.value = false;
}
function selectMobileSort(mode: ProductSortMode) {
  selectedSortMode.value = mode;
  mobileSortOpen.value = false;
}
let deleteTrigger: HTMLElement | null = null;
let productListMedia: MediaQueryList | null = null;

const searchKeyword = ref('');
const selectedCategoryId = ref<'all' | string>('all');
const selectedStatus = ref<ProductFilterStatus>('ALL');
const selectedSortMode = ref<ProductSortMode>('DEFAULT');

const categoryForm = reactive({
  id: '',
  nameZh: '',
  nameVi: '',
  nameEn: '',
  sortOrder: 0,
});

const productForm = reactive({
  id: '',
  categoryId: '',
  nameZh: '',
  nameVi: '',
  nameEn: '',
  description: '',
  imageUrl: '',
  priceVnd: 0,
  unit: '',
  sortOrder: 0,
});

const pageCopy = computed(() => {
  if (locale.value === 'vi') {
    return {
      productsTab: 'Quản lý món ăn',
      categoriesTab: 'Quản lý danh mục',
      filterTitle: 'Bộ lọc',
      statsTitle: 'Thống kê món ăn',
      categoryFilterLabel: 'Lọc theo danh mục',
      statusFilterLabel: 'Lọc theo trạng thái',
      sortLabel: 'Sắp xếp',
      allStatus: 'Tất cả',
      defaultSort: 'Mặc định',
      sortPriceAsc: 'Giá tăng dần',
      sortPriceDesc: 'Giá giảm dần',
      sortByOrder: 'Thứ tự tăng dần',
      sortByName: 'Tên món A-Z',
      allCategories: 'Tất cả danh mục',
      searchPlaceholder: 'Tìm tên món ăn...',
      addProductButton: '+ Thêm món ăn',
      listTitle: 'Danh sách món ăn',
      totalLabel: 'Tổng số món',
      totalCountLabel: 'Tổng món ăn',
      onSaleCountLabel: 'Đang bán',
      soldOutCountLabel: 'Hết món',
      offSaleCountLabel: 'Đã gỡ',
      noImage: 'Chưa có ảnh',
      missingVietnamese: 'Chưa có tên tiếng Việt',
      productCountText: 'mục',
      categoryFormTitle: 'Quản lý danh mục',
      categoryFormDescription: 'Thao tác xóa chỉ tắt danh mục, không xóa dữ liệu cũ',
      categoryListTitle: 'Danh sách danh mục',
      categoryListHint: 'Hiển thị theo thứ tự. Số nhỏ hơn sẽ lên trước.',
      categorySortHint: 'Số nhỏ hơn sẽ được ưu tiên hiển thị.',
      addCategoryButton: '+ Thêm danh mục',
      newProductTitle: 'Thêm món ăn',
      editProductTitle: 'Sửa món ăn',
      imageHint: 'Có thể nhập URL hoặc tải ảnh trực tiếp.',
      imagePlaceholder: 'Xem trước ảnh',
      deleteTitle: 'Xóa món ăn?',
      deleteDescription: 'Sau khi xóa, món ăn sẽ không còn trong thực đơn hiện tại hoặc màn hình gọi món. Lịch sử đơn hàng vẫn được giữ nguyên.',
      deleteConfirm: 'Xóa món ăn',
      deleteSuccess: 'Đã xóa món ăn.',
    };
  }

  if (locale.value === 'en') {
    return {
      productsTab: 'Product Management',
      categoriesTab: 'Category Management',
      filterTitle: 'Filters',
      statsTitle: 'Product Stats',
      categoryFilterLabel: 'Category',
      statusFilterLabel: 'Status',
      sortLabel: 'Sort By',
      allStatus: 'All',
      defaultSort: 'Default',
      sortPriceAsc: 'Price Low to High',
      sortPriceDesc: 'Price High to Low',
      sortByOrder: 'Sort Order',
      sortByName: 'Name A-Z',
      allCategories: 'All Categories',
      searchPlaceholder: 'Search products...',
      addProductButton: '+ Add Product',
      listTitle: 'Product List',
      totalLabel: 'Total',
      totalCountLabel: 'All Products',
      onSaleCountLabel: 'On Sale',
      soldOutCountLabel: 'Sold Out',
      offSaleCountLabel: 'Off Sale',
      noImage: 'No image',
      missingVietnamese: 'Vietnamese name not filled',
      productCountText: 'items',
      categoryFormTitle: 'Category Management',
      categoryFormDescription: 'Disabling only hides a category and keeps historical data.',
      categoryListTitle: 'Category List',
      categoryListHint: 'Displayed by sort order. Smaller numbers appear first.',
      categorySortHint: 'Smaller numbers are shown first.',
      addCategoryButton: '+ Add Category',
      newProductTitle: 'Add Product',
      editProductTitle: 'Edit Product',
      imageHint: 'Use either an image URL or direct upload.',
      imagePlaceholder: 'Image Preview',
      deleteTitle: 'Delete this product?',
      deleteDescription: 'After deletion, this product will no longer appear in the current menu or cashier ordering. Historical orders will remain intact.',
      deleteConfirm: 'Delete product',
      deleteSuccess: 'Product deleted.',
    };
  }

  return {
    productsTab: '菜品管理',
    categoriesTab: '分类管理',
    filterTitle: '筛选条件',
    statsTitle: '菜品统计',
    categoryFilterLabel: '分类筛选',
    statusFilterLabel: '状态筛选',
    sortLabel: '排序',
    allStatus: '全部',
    defaultSort: '默认排序',
    sortPriceAsc: '价格从低到高',
    sortPriceDesc: '价格从高到低',
    sortByOrder: '排序值升序',
    sortByName: '菜品名称 A-Z',
    allCategories: '全部分类',
    searchPlaceholder: '搜索菜品名称...',
    addProductButton: '+ 新增菜品',
    listTitle: '菜品列表',
    totalLabel: '共',
    totalCountLabel: '全部菜品',
    onSaleCountLabel: '上架中',
    soldOutCountLabel: '售罄',
    offSaleCountLabel: '下架中',
    noImage: '暂无图片',
    missingVietnamese: '未填写越南语',
    productCountText: '条',
    categoryFormTitle: '分类管理',
    categoryFormDescription: '删除操作只停用分类，不删除历史数据',
    categoryListTitle: '分类列表',
    categoryListHint: '按排序数字显示，数字越小越靠前。',
    categorySortHint: '数字越小，排序越靠前',
    addCategoryButton: '+ 新增分类',
    newProductTitle: '新增菜品',
    editProductTitle: '编辑菜品',
    imageHint: '可填写图片 URL，也可直接上传图片。',
    imagePlaceholder: '图片预览',
    deleteTitle: '确认删除菜品？',
    deleteDescription: '删除后将不再出现在当前菜单和收银点单中，历史订单记录不会被删除。',
    deleteConfirm: '删除菜品',
    deleteSuccess: '菜品已删除。',
  };
});

const activeTab = computed<ManagementTab>(() => {
  const queryTab = Array.isArray(route.query.tab) ? route.query.tab[0] : route.query.tab;
  return queryTab === 'categories' ? 'categories' : 'products';
});

const sortedCategories = computed(() =>
  [...categories.value].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.nameZh.localeCompare(b.nameZh, 'zh-Hans-CN');
  }),
);

const activeCategories = computed(() =>
  sortedCategories.value.filter((item) => item.isActive),
);

const productFormCategories = computed(() => {
  const current = sortedCategories.value.find((item) => item.id === productForm.categoryId);
  if (!current || current.isActive) return activeCategories.value;
  return [current, ...activeCategories.value];
});

const filteredProducts = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase();

  return sortedProducts.value.filter((item) => {
    if (selectedCategoryId.value !== 'all' && item.categoryId !== selectedCategoryId.value) {
      return false;
    }

    if (selectedStatus.value !== 'ALL' && item.status !== selectedStatus.value) {
      return false;
    }

    if (!keyword) return true;

    return [
      item.nameZh,
      item.nameVi ?? '',
      item.nameEn ?? '',
      item.unit ?? '',
      item.description ?? '',
      item.category?.nameZh ?? '',
      item.category?.nameVi ?? '',
      item.category?.nameEn ?? '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(keyword);
  });
});

const sortedProducts = computed(() => {
  const rows = [...products.value];

  if (selectedSortMode.value === 'PRICE_ASC') {
    return rows.sort((a, b) => Number(a.priceVnd) - Number(b.priceVnd));
  }

  if (selectedSortMode.value === 'PRICE_DESC') {
    return rows.sort((a, b) => Number(b.priceVnd) - Number(a.priceVnd));
  }

  if (selectedSortMode.value === 'SORT_ASC') {
    return rows.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  if (selectedSortMode.value === 'NAME_ASC') {
    return rows.sort((a, b) => a.nameZh.localeCompare(b.nameZh, 'zh-Hans-CN'));
  }

  return rows.sort((a, b) => {
    const categoryOrder = (a.category?.sortOrder ?? 0) - (b.category?.sortOrder ?? 0);
    if (categoryOrder !== 0) return categoryOrder;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.nameZh.localeCompare(b.nameZh, 'zh-Hans-CN');
  });
});

const productsOnSaleCount = computed(
  () => products.value.filter((item) => item.status === 'ON_SALE').length,
);
const productsSoldOutCount = computed(
  () => products.value.filter((item) => item.status === 'SOLD_OUT').length,
);
const productsOffSaleCount = computed(
  () => products.value.filter((item) => item.status === 'OFF_SALE').length,
);

const failedPreviewUrl = ref('');
const imagePreviewUrl = computed(() =>
  productForm.imageUrl ? resolveMediaUrl(productForm.imageUrl) : '',
);

const productModalTitle = computed(() =>
  productForm.id ? pageCopy.value.editProductTitle : pageCopy.value.newProductTitle,
);

const sortOptions = computed(() => [
  { value: 'DEFAULT', label: pageCopy.value.defaultSort },
  { value: 'PRICE_ASC', label: pageCopy.value.sortPriceAsc },
  { value: 'PRICE_DESC', label: pageCopy.value.sortPriceDesc },
  { value: 'SORT_ASC', label: pageCopy.value.sortByOrder },
  { value: 'NAME_ASC', label: pageCopy.value.sortByName },
]);

const statsRows = computed(() => [
  { key: 'all', label: pageCopy.value.totalCountLabel, value: products.value.length, tone: 'green' },
  { key: 'sale', label: pageCopy.value.onSaleCountLabel, value: productsOnSaleCount.value, tone: 'emerald' },
  { key: 'sold', label: pageCopy.value.soldOutCountLabel, value: productsSoldOutCount.value, tone: 'orange' },
  { key: 'off', label: pageCopy.value.offSaleCountLabel, value: productsOffSaleCount.value, tone: 'slate' },
]);

function setTab(tab: ManagementTab) {
  router.replace({
    path: '/menu/products',
    query: tab === 'categories' ? { tab: 'categories' } : {},
  });
}

async function openCreateCategoryWorkspace() {
  resetCategoryForm();
  await router.replace({ path: '/menu/products', query: { tab: 'categories' } });
  await nextTick();
  categoryEditor.value?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function categoryName(category?: Category | null) {
  if (!category) return '—';
  if (locale.value === 'vi' && category.nameVi) return category.nameVi;
  if (locale.value === 'en' && category.nameEn) return category.nameEn;
  return category.nameZh;
}

function categorySecondaryName(category?: Category | null) {
  if (!category) return '';
  return category.nameVi?.trim() || pageCopy.value.missingVietnamese;
}

function productPrice(product: Product) {
  return Number(product.priceVnd || 0).toLocaleString();
}

function productStatusLabel(status: ProductStatus) {
  const labels: Record<ProductStatus, string> = {
    DRAFT: t('draft'),
    ON_SALE: t('onSale'),
    SOLD_OUT: t('soldOut'),
    OFF_SALE: t('offSale'),
  };
  return labels[status];
}

function productStatusClass(status: ProductStatus) {
  return {
    DRAFT: 'badge-muted',
    ON_SALE: 'badge-success',
    SOLD_OUT: 'badge-warning',
    OFF_SALE: 'badge-neutral',
  }[status];
}

function productImage(product: Product) {
  const thumbnailUrl = product.menuThumbnailUrl?.trim();
  const source = thumbnailUrl && !failedListImageUrls.value.has(thumbnailUrl)
    ? thumbnailUrl
    : product.imageUrl;
  return source && !failedListImageUrls.value.has(source.trim()) ? resolveMediaUrl(source) : '';
}

const failedListImageUrls = ref(new Set<string>());

function handleListImageError(product: Product) {
  const thumbnailUrl = product.menuThumbnailUrl?.trim();
  const originalUrl = product.imageUrl?.trim();
  const failed = thumbnailUrl && !failedListImageUrls.value.has(thumbnailUrl) ? thumbnailUrl : originalUrl;
  if (failed) failedListImageUrls.value = new Set([...failedListImageUrls.value, failed]);
}

function resetCategoryForm() {
  Object.assign(categoryForm, {
    id: '',
    nameZh: '',
    nameVi: '',
    nameEn: '',
    sortOrder: 0,
  });
}

function resetProductForm() {
  Object.assign(productForm, {
    id: '',
    categoryId: activeCategories.value[0]?.id ?? '',
    nameZh: '',
    nameVi: '',
    nameEn: '',
    description: '',
    imageUrl: '',
    priceVnd: 0,
    unit: '',
    sortOrder: 0,
  });

  if (fileInput.value) {
    fileInput.value.value = '';
  }
}

function openCreateProductModal() {
  productMessage.value = '';
  resetProductForm();
  showProductModal.value = true;
}

function closeProductModal() {
  showProductModal.value = false;
  resetProductForm();
}

function editCategory(row: Category) {
  categoryMessage.value = '';
  Object.assign(categoryForm, {
    id: row.id,
    nameZh: row.nameZh,
    nameVi: row.nameVi ?? '',
    nameEn: row.nameEn ?? '',
    sortOrder: row.sortOrder,
  });
}

function editProduct(row: Product) {
  productMessage.value = '';
  Object.assign(productForm, {
    id: row.id,
    categoryId: row.categoryId,
    nameZh: row.nameZh,
    nameVi: row.nameVi ?? '',
    nameEn: row.nameEn ?? '',
    description: row.description ?? '',
    imageUrl: row.imageUrl ?? '',
    priceVnd: Number(row.priceVnd ?? 0),
    unit: row.unit ?? '',
    sortOrder: row.sortOrder,
  });
  showProductModal.value = true;
}

async function loadData() {
  loading.value = true;
  pageMessage.value = '';

  try {
    const [categoryRows, productRows] = await Promise.all([
      getCategories(),
      getProducts(),
    ]);

    categories.value = categoryRows;
    products.value = productRows;

    if (!productForm.id && !productForm.categoryId) {
      productForm.categoryId = categoryRows.find((item) => item.isActive)?.id ?? '';
    }
  } catch (error) {
    pageMessage.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}

async function saveCategory() {
  categoryMessage.value = '';

  try {
    const payload = {
      nameZh: categoryForm.nameZh.trim(),
      nameVi: categoryForm.nameVi.trim(),
      nameEn: categoryForm.nameEn.trim() || null,
      sortOrder: categoryForm.sortOrder,
    };

    if (categoryForm.id) {
      await updateCategory(categoryForm.id, payload);
    } else {
      await createCategory(payload);
    }

    resetCategoryForm();
    await loadData();
    categoryMessage.value = t('categorySaved');
  } catch (error) {
    categoryMessage.value = errorMessage(error);
  }
}

async function disableCategoryRow(row: Category) {
  if (!confirm(t('disableCategoryConfirm', { name: row.nameZh }))) return;

  try {
    await disableCategory(row.id);
    await loadData();
  } catch (error) {
    categoryMessage.value = errorMessage(error);
  }
}

function isCategoryEnabled(row: Category) {
  return Boolean(row.isActive);
}

function isSignatureCategory(row: Category) {
  return Boolean(row.isSignature);
}

function signatureCategoryLabel() {
  if (locale.value === 'vi') return 'Danh mục hệ thống';
  if (locale.value === 'en') return 'System category';
  return '系统招牌菜';
}

function getCategoryToggleLabel(row: Category) {
  if (isCategoryEnabled(row)) {
    return t('disable');
  }

  if (locale.value === 'vi') return 'Bật';
  if (locale.value === 'en') return 'Enable';
  return '启用';
}

async function enableCategoryRow(row: Category) {
  const enableConfirmText =
    locale.value === 'vi'
      ? `Bật lại danh mục “${row.nameZh}”?`
      : locale.value === 'en'
        ? `Enable category "${row.nameZh}" again?`
        : `确认启用分类“${row.nameZh}”？`;

  if (!confirm(enableConfirmText)) return;

  try {
    await updateCategory(row.id, {
      nameZh: row.nameZh,
      nameVi: row.nameVi ?? '',
      nameEn: row.nameEn ?? null,
      sortOrder: row.sortOrder,
      isActive: true,
    });
    await loadData();
  } catch (error) {
    categoryMessage.value = errorMessage(error);
  }
}

async function toggleCategoryRow(row: Category) {
  if (isCategoryEnabled(row)) {
    await disableCategoryRow(row);
    return;
  }

  await enableCategoryRow(row);
}

async function saveProduct() {
  productMessage.value = '';

  try {
    const payload = {
      categoryId: productForm.categoryId,
      nameZh: productForm.nameZh.trim(),
      nameVi: productForm.nameVi.trim(),
      nameEn: productForm.nameEn.trim() || null,
      description: productForm.description.trim() || undefined,
      imageUrl: productForm.imageUrl.trim() || undefined,
      priceVnd: productForm.priceVnd,
      unit: productForm.unit.trim() || null,
      sortOrder: productForm.sortOrder,
    };

    if (productForm.id) {
      await updateProduct(productForm.id, payload);
    } else {
      await createProduct(payload);
    }

    await loadData();
    closeProductModal();
    productMessage.value = t('productSaved');
  } catch (error) {
    productMessage.value = errorMessage(error);
  }
}

async function setProductStatus(row: Product, status: ProductStatus) {
  if (row.status === status) return;

  try {
    await updateProductStatus(row.id, status);
    await loadData();
  } catch (error) {
    productMessage.value = errorMessage(error);
  }
}

async function disableProductRow(row: Product) {
  productMessage.value = '';
  deleteTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  productPendingDelete.value = row;
  await nextTick();
  deleteCancelButton.value?.focus();
}

function closeDeleteProductDialog() {
  if (deletingProduct.value) return;
  productPendingDelete.value = null;
  productMessage.value = '';
  deleteTrigger?.focus();
  deleteTrigger = null;
}

async function confirmDeleteProduct() {
  const row = productPendingDelete.value;
  if (!row || deletingProduct.value) return;

  deletingProduct.value = true;
  try {
    await disableProduct(row.id);
    products.value = products.value.filter((item) => item.id !== row.id);
    productPendingDelete.value = null;
    pageMessage.value = pageCopy.value.deleteSuccess;
    deleteTrigger?.focus();
    deleteTrigger = null;
  } catch (error) {
    productMessage.value = errorMessage(error);
  } finally {
    deletingProduct.value = false;
  }
}

function onDeleteDialogKeydown(event: KeyboardEvent) {
  if (!productPendingDelete.value) return;
  if (event.key === 'Escape') { closeDeleteProductDialog(); return; }
  if (event.key !== 'Tab' || !deleteDialog.value) return;
  const focusable = [...deleteDialog.value.querySelectorAll<HTMLElement>('button:not(:disabled)')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
window.addEventListener('keydown', onDeleteDialogKeydown);
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onDeleteDialogKeydown);
  productListMedia?.removeEventListener('change', syncProductListLayout);
});

function syncProductListLayout(event?: MediaQueryListEvent) {
  isMobileProductList.value = event?.matches ?? productListMedia?.matches ?? false;
}

function openImagePicker() {
  fileInput.value?.click();
}

async function onImageSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  uploading.value = true;
  productMessage.value = '';

  try {
    const result = await uploadProductImage(file);
    productForm.imageUrl = result.url;
  } catch (error) {
    productMessage.value = errorMessage(error);
  } finally {
    uploading.value = false;
    input.value = '';
  }
}

function clearImage() {
  productForm.imageUrl = '';
  if (fileInput.value) {
    fileInput.value.value = '';
  }
}

onMounted(async () => {
  productListMedia = window.matchMedia('(max-width: 768px)');
  syncProductListLayout();
  productListMedia.addEventListener('change', syncProductListLayout);
  await loadData();
  resetCategoryForm();
  resetProductForm();
});
</script>

<template>
  <div class="menu-page mx-catalog-page">
    <header v-if="!isMobileProductList || activeTab === 'categories'" class="mx-heading"><div><h1>{{ activeTab === 'products' ? word('菜品','Món','Menu') : word('菜品分类','Nhóm món','Categories') }}<span class="mx-count">{{ activeTab === 'products' ? products.length : categories.length }}</span></h1><p>{{ word('管理餐厅菜单、售价与供应状态','Quản lý thực đơn, giá bán và trạng thái món','Manage your menu, prices and availability') }}</p></div><div class="mx-heading-actions"><button v-if="activeTab === 'products'" type="button" class="primary-action mx-desktop-add-product" @click="openCreateProductModal"><MerchantIcon name="plus" />{{ pageCopy.addProductButton }}</button></div></header>
    <nav class="mx-module-tabs" :class="{ 'mx-module-tabs--mobile-hidden': activeTab === 'products' }" :aria-label="word('菜品管理','Quản lý thực đơn','Menu management')"><button type="button" :aria-pressed="activeTab === 'products'" @click="setTab('products')">{{ word('菜品管理','Món','Dishes') }}</button><button type="button" :aria-pressed="activeTab === 'categories'" @click="setTab('categories')">{{ word('分类管理','Nhóm món','Categories') }}</button></nav>
    <p v-if="pageMessage" class="page-message" role="status">{{ pageMessage }}</p>
    <section v-if="activeTab === 'products'" class="mx-catalog-layout">
      <aside v-if="!isMobileProductList" class="mx-catalog-rail">
        <h2>{{ t('category') }}</h2>
        <button type="button" :aria-pressed="selectedCategoryId === 'all'" @click="selectedCategoryId='all'"><span>{{ pageCopy.allCategories }}</span><b>{{ products.length }}</b></button>
        <button v-for="category in sortedCategories" :key="category.id" type="button" :aria-pressed="selectedCategoryId === category.id" @click="selectedCategoryId=category.id"><span :title="categoryName(category)">{{ categoryName(category) }}</span><b>{{ products.filter(p=>p.categoryId===category.id).length }}</b></button>
        <button type="button" class="mx-manage-category" @click="setTab('categories')"><MerchantIcon name="settings" />{{ pageCopy.categoriesTab }}</button>
      </aside>
      <section class="mx-catalog-content">
        <div v-if="isMobileProductList" class="mx-mobile-menu-titlebar">
          <h1 v-if="!mobileSearchOpen">{{ word('菜单','Thực đơn','Menu') }}</h1>
          <label v-else class="mx-mobile-menu-search"><MerchantIcon name="search" /><input ref="mobileSearchInput" v-model="searchKeyword" type="search" :aria-label="pageCopy.searchPlaceholder" :placeholder="pageCopy.searchPlaceholder" @blur="!searchKeyword && (mobileSearchOpen=false)" /></label>
          <div class="mx-mobile-menu-actions">
            <button v-if="!mobileSearchOpen" type="button" :aria-label="pageCopy.searchPlaceholder" @click="openMobileSearch"><MerchantIcon name="search" /></button>
            <button v-else type="button" class="mx-mobile-menu-search-close" :aria-label="word('关闭搜索','Đóng tìm kiếm','Close search')" @click="closeMobileSearch">×</button>
            <button type="button" :aria-label="pageCopy.sortLabel" :aria-pressed="selectedSortMode !== 'DEFAULT'" @click="mobileSortOpen=true"><MerchantIcon name="sort" /></button>
          </div>
        </div>
        <nav v-if="isMobileProductList" class="m-product-category-pills" :aria-label="t('category')"><button type="button" class="secondary" :aria-pressed="selectedCategoryId === 'all'" @click="selectedCategoryId='all'">{{ pageCopy.allCategories }}</button><button v-for="category in sortedCategories" :key="category.id" type="button" class="secondary" :aria-pressed="selectedCategoryId === category.id" @click="selectedCategoryId=category.id">{{ categoryName(category) }}</button><button type="button" class="secondary m-product-category-add" @click="openCreateCategoryWorkspace"><MerchantIcon name="plus" />{{ word('添加分类','Thêm nhóm','Add category') }}</button></nav>
        <div v-if="!isMobileProductList" class="mx-catalog-toolbar"><label class="mx-search-field"><div><MerchantIcon name="search" /><input v-model="searchKeyword" type="search" :aria-label="pageCopy.searchPlaceholder" :placeholder="pageCopy.searchPlaceholder" /></div></label><label class="mx-sort"><span>{{ pageCopy.sortLabel }}</span><select v-model="selectedSortMode" :aria-label="pageCopy.sortLabel"><option v-for="item in sortOptions" :key="item.value" :value="item.value">{{ item.label }}</option></select></label></div>
        <div class="mx-catalog-status-tabs"><button v-for="(status,index) in (['ALL','ON_SALE','SOLD_OUT','OFF_SALE'] as const)" :key="status" type="button" :aria-pressed="selectedStatus === status" @click="selectedStatus=status">{{ status === 'ALL' ? pageCopy.allStatus : productStatusLabel(status) }}<span>{{ statsRows[index].value }}</span></button></div>
        <p v-if="productMessage" class="section-message" role="status">{{ productMessage }}</p>
        <div v-if="loading" role="status" :aria-label="word('加载菜品','Đang tải món','Loading menu')"><div v-for="n in 5" :key="n" class="mx-skeleton"><i></i><i></i><i></i></div></div>
        <div v-else-if="!isMobileProductList" class="mx-catalog-table-wrap">
          <table class="mx-catalog-table product-table"><colgroup><col class="product-column" /><col class="category-column" /><col class="price-column" /><col class="sort-column" /><col class="status-column" /><col class="actions-column" /></colgroup><thead><tr><th>{{ t('product') }}</th><th>{{ t('category') }}</th><th class="numeric-heading">{{ t('priceVnd') }}</th><th class="numeric-heading">{{ t('sortOrder') }}</th><th>{{ t('status') }}</th><th>{{ t('actions') }}</th></tr></thead><tbody><tr v-for="row in filteredProducts" :key="row.id"><td><button type="button" class="mx-product-identity" @click="selectedProductId=row.id"><span class="mx-product-thumb"><img v-if="productImage(row)" :src="productImage(row)" :alt="productName(row)" loading="lazy" decoding="async" @error="handleListImageError(row)" /><MerchantIcon v-else name="products" /></span><span><strong :title="productName(row)">{{ productName(row) }}</strong><small :title="[row.nameZh,row.nameVi,row.nameEn].filter(Boolean).join(' / ')">{{ secondaryProductName(row) }}</small></span></button></td><td><div class="mx-category-copy"><strong :title="categoryName(row.category)">{{ categoryName(row.category) }}</strong><small :title="[row.category?.nameZh,row.category?.nameVi,row.category?.nameEn].filter(Boolean).join(' / ')">{{ categorySecondaryName(row.category) }}</small></div></td><td class="numeric-cell"><strong>{{ productPrice(row) }}</strong><small v-if="row.unit?.trim()" class="mx-unit">{{ row.unit }}</small></td><td class="numeric-cell">{{ row.sortOrder }}</td><td><select class="mx-status-select" :class="productStatusClass(row.status)" :value="row.status" :aria-label="productName(row)+' '+t('status')" @change="setProductStatus(row, ($event.target as HTMLSelectElement).value as ProductStatus)"><option v-if="row.status==='DRAFT'" value="DRAFT" disabled>{{ productStatusLabel('DRAFT') }}</option><option value="ON_SALE">{{ t('onSale') }}</option><option value="SOLD_OUT">{{ t('soldOut') }}</option><option value="OFF_SALE">{{ t('offSale') }}</option></select></td><td><div class="mx-row-actions"><button type="button" class="text-action menu-row-action" :aria-label="t('edit')+' '+row.nameZh" @click="editProduct(row)">{{ t('edit') }}</button><button type="button" class="text-action danger menu-row-action" :aria-label="t('delete')+' '+row.nameZh" @click="disableProductRow(row)">{{ t('delete') }}</button></div></td></tr></tbody></table>
        </div>
        <div v-else class="mx-mobile-catalog"><button v-for="row in filteredProducts" :key="row.id" type="button" class="mx-mobile-product" :aria-label="[productName(row), productPrice(row), row.unit, productStatusLabel(row.status)].filter(Boolean).join(' ')" @click="selectedProductId=row.id"><span class="mx-product-thumb"><img v-if="productImage(row)" :src="productImage(row)" :alt="productName(row)" loading="lazy" decoding="async" @error="handleListImageError(row)" /><MerchantIcon v-else name="products" /></span><span class="mx-mobile-product-copy"><strong>{{ productName(row) }}</strong></span><span class="mx-mobile-product-price"><strong>{{ productPrice(row) }}</strong><small>{{ row.unit ? '/'+row.unit : '' }}</small></span></button></div>
        <div v-if="!loading && !filteredProducts.length" class="m-empty"><MerchantIcon name="products" /><strong>{{ word('未找到菜品','Không tìm thấy món','No matching dishes') }}</strong><p>{{ pageCopy.searchPlaceholder }}</p></div>
        <footer class="mx-catalog-footer">{{ pageCopy.totalLabel }} {{ filteredProducts.length }} {{ pageCopy.productCountText }}</footer>
      </section>
    </section>

    <button v-if="activeTab === 'products'" type="button" class="mx-product-fab" :aria-label="pageCopy.addProductButton" @click="openCreateProductModal"><MerchantIcon name="plus" /></button>
    <section v-else class="mx-category-workspace">
      <div class="mx-category-directory"><article v-for="row in sortedCategories" :key="row.id" class="mx-category-card"><div class="mx-category-card-head"><span class="mx-category-symbol"><MerchantIcon name="products" /></span><div><h2>{{ categoryName(row) }}</h2><span :class="['status-pill',isCategoryEnabled(row) ? 'badge-success' : 'badge-neutral']">{{ isCategoryEnabled(row) ? t('enabled') : t('disabledStatus') }}</span><span v-if="isSignatureCategory(row)" class="signature-category-badge">{{ signatureCategoryLabel() }}</span></div><strong>{{ row._count?.products ?? products.filter(p=>p.categoryId===row.id).length }}<small>{{ t('product') }}</small></strong></div><dl class="mx-category-names"><div><dt>中文</dt><dd>{{ row.nameZh }}</dd></div><div><dt>Tiếng Việt</dt><dd>{{ row.nameVi || '—' }}</dd></div><div v-if="row.nameEn"><dt>English</dt><dd>{{ row.nameEn }}</dd></div></dl><footer><span>{{ t('sortOrder') }} {{ row.sortOrder }}</span><div><button type="button" class="secondary" @click="editCategory(row);categoryEditor?.scrollIntoView({block:'start',behavior:'auto'})">{{ t('edit') }}</button><button v-if="!isSignatureCategory(row)" type="button" :class="['secondary',isCategoryEnabled(row) && 'danger']" @click="toggleCategoryRow(row)">{{ getCategoryToggleLabel(row) }}</button></div></footer></article><div v-if="!sortedCategories.length" class="m-empty"><strong>{{ pageCopy.categoryListTitle }}</strong>{{ pageCopy.categoryFormDescription }}</div></div>
      <aside ref="categoryEditor" class="mx-panel mx-category-editor"><div class="mx-section-title"><h2>{{ categoryForm.id ? t('edit') : pageCopy.addCategoryButton }}</h2><button v-if="categoryForm.id" type="button" class="secondary" @click="resetCategoryForm">{{ t('cancel') }}</button></div><p class="mx-detail-reference">{{ pageCopy.categoryFormDescription }}</p><form class="mx-form" @submit.prevent="saveCategory"><label>{{ t('chineseCategoryName') }} *<input v-model="categoryForm.nameZh" required /></label><label>{{ t('vietnameseCategoryName') }} *<input v-model="categoryForm.nameVi" required /></label><label>English<input v-model="categoryForm.nameEn" placeholder="English name" maxlength="80" /></label><label>{{ t('sortOrder') }}<input v-model.number="categoryForm.sortOrder" type="number" min="0" /><small>{{ pageCopy.categorySortHint }}</small></label><p v-if="categoryMessage" class="section-message" role="status">{{ categoryMessage }}</p><button type="submit" class="primary-action">{{ categoryForm.id ? t('saveChanges') : pageCopy.addCategoryButton }}</button></form></aside>
    </section>

    <MerchantDialog :open="mobileFiltersOpen" :title="pageCopy.filterTitle" @close="mobileFiltersOpen=false"><div class="mx-form"><label>{{ pageCopy.categoryFilterLabel }}<select v-model="selectedCategoryId"><option value="all">{{ pageCopy.allCategories }}</option><option v-for="item in sortedCategories" :key="item.id" :value="item.id">{{ categoryName(item) }}</option></select></label><label>{{ pageCopy.statusFilterLabel }}<select v-model="selectedStatus"><option value="ALL">{{ pageCopy.allStatus }}</option><option value="ON_SALE">{{ t('onSale') }}</option><option value="SOLD_OUT">{{ t('soldOut') }}</option><option value="OFF_SALE">{{ t('offSale') }}</option></select></label><label>{{ pageCopy.sortLabel }}<select v-model="selectedSortMode"><option v-for="item in sortOptions" :key="item.value" :value="item.value">{{ item.label }}</option></select></label><button type="button" @click="mobileFiltersOpen=false">{{ word('完成','Xong','Done') }}</button></div></MerchantDialog>
    <MerchantDialog :open="mobileSortOpen" :title="pageCopy.sortLabel" @close="mobileSortOpen=false"><div class="mx-mobile-sort-options"><button v-for="item in sortOptions" :key="item.value" type="button" :aria-pressed="selectedSortMode === item.value" @click="selectMobileSort(item.value as ProductSortMode)"><span>{{ item.label }}</span><span v-if="selectedSortMode === item.value" aria-hidden="true">✓</span></button></div></MerchantDialog>
    <MerchantDialog :open="!!selectedProduct" :title="word('菜品详情','Chi tiết món','Dish details')" variant="drawer" hide-header @close="selectedProductId=''"><template v-if="selectedProduct"><div class="mx-product-profile"><div class="mx-product-profile-image"><img v-if="productImage(selectedProduct)" :src="productImage(selectedProduct)" :alt="productName(selectedProduct)" @error="handleListImageError(selectedProduct)" /><MerchantIcon v-else name="products" /></div><div><span class="mx-detail-reference">{{ categoryName(selectedProduct.category) }}</span><h2>{{ productName(selectedProduct) }}</h2><strong>{{ productPrice(selectedProduct) }} ₫<small v-if="selectedProduct.unit"> / {{ selectedProduct.unit }}</small></strong></div><button type="button" class="mx-product-detail-back" @click="selectedProductId=''"><MerchantIcon name="back" />{{ word('返回','Quay lại','Back') }}</button></div><div class="mx-form-section"><h3>{{ word('基本信息','Thông tin cơ bản','Basic information') }}</h3><dl class="mx-facts"><div><dt>{{ t('chineseProductName') }}</dt><dd>{{ selectedProduct.nameZh }}</dd></div><div><dt>{{ t('vietnameseProductName') }}</dt><dd>{{ selectedProduct.nameVi || '—' }}</dd></div><div v-if="selectedProduct.nameEn"><dt>English</dt><dd>{{ selectedProduct.nameEn }}</dd></div><div><dt>{{ t('sortOrder') }}</dt><dd>{{ selectedProduct.sortOrder }}</dd></div><div v-if="selectedProduct.description"><dt>{{ t('remark') }}</dt><dd>{{ selectedProduct.description }}</dd></div></dl></div><div class="mx-product-detail-actions"><button v-for="status in (['ON_SALE','SOLD_OUT','OFF_SALE'] as const)" :key="status" type="button" class="secondary" :aria-pressed="selectedProduct.status===status" :disabled="selectedProduct.status===status" @click="setProductStatus(selectedProduct,status)">{{ productStatusLabel(status) }}</button><button type="button" @click="editSelectedProduct">{{ t('edit') }}</button><button type="button" class="danger" @click="deleteSelectedProduct">{{ t('delete') }}</button></div></template></MerchantDialog>
    <MerchantDialog :open="showProductModal" :title="productModalTitle" variant="drawer" @close="closeProductModal">
      <form class="mx-product-editor" @submit.prevent="saveProduct">
        <div class="mx-editor-main">
          <fieldset class="mx-form-section"><legend>{{ word('菜品信息','Thông tin món','Dish information') }}</legend><div class="mx-form"><label>{{ t('chineseProductName') }} *<input v-model="productForm.nameZh" required /></label><label>{{ t('vietnameseProductName') }} *<input v-model="productForm.nameVi" required /></label><label>English<input v-model="productForm.nameEn" placeholder="English name" maxlength="120" /></label><label>{{ t('category') }} *<select v-model="productForm.categoryId" required><option v-for="item in productFormCategories" :key="item.id" :value="item.id">{{ categoryName(item) }}</option></select></label></div></fieldset>
          <fieldset class="mx-form-section"><legend>{{ word('售价与展示','Giá và hiển thị','Price and display') }}</legend><div class="mx-form mx-form--pair"><label>{{ t('priceVnd') }} *<input v-model.number="productForm.priceVnd" type="number" min="0" required /></label><label>{{ t('productUnit') }}<input v-model="productForm.unit" :placeholder="t('productUnitPlaceholder')" maxlength="32" /></label><label>{{ t('sortOrder') }}<input v-model.number="productForm.sortOrder" type="number" min="0" /></label></div></fieldset>
          <fieldset class="mx-form-section"><legend>{{ t('imageUrl') }}</legend><div class="mx-form"><label>{{ t('imageUrl') }}<input v-model="productForm.imageUrl" :placeholder="t('imageUrl')" /><small>{{ pageCopy.imageHint }}</small></label><div class="mx-choice-row"><button type="button" class="secondary" :disabled="uploading" @click="openImagePicker">{{ productForm.imageUrl ? t('replaceImage') : t('uploadImage') }}</button><button type="button" class="secondary" :disabled="uploading || !productForm.imageUrl" @click="clearImage">{{ t('clearImage') }}</button></div><input ref="fileInput" class="hidden-file" type="file" accept="image/jpeg,image/png,image/webp" @change="onImageSelected" /></div></fieldset>
        </div>
        <aside class="mx-editor-preview"><h3>{{ word('展示预览','Xem trước','Display preview') }}</h3><div class="mx-dish-preview-image"><img v-if="imagePreviewUrl && failedPreviewUrl!==imagePreviewUrl" :src="imagePreviewUrl" :alt="pageCopy.imagePlaceholder" @error="failedPreviewUrl=imagePreviewUrl" /><MerchantIcon v-else name="products" /></div><strong>{{ productForm.nameZh || word('菜品名称','Tên món','Dish name') }}</strong><span>{{ productForm.nameVi || '—' }}</span><b>{{ Number(productForm.priceVnd || 0).toLocaleString() }} ₫<small v-if="productForm.unit"> / {{ productForm.unit }}</small></b><p>{{ word('仅预览本次输入，保存后生效','Nội dung nhập chỉ có hiệu lực sau khi lưu','Preview of your input. Changes take effect after saving.') }}</p></aside>
        <p v-if="productMessage" class="section-message" role="status">{{ productMessage }}</p>
        <div class="mx-editor-actions"><button type="button" class="secondary" @click="closeProductModal">{{ t('cancel') }}</button><button type="submit" class="primary-action">{{ productForm.id ? t('saveChanges') : t('addProduct') }}</button></div>
      </form>
    </MerchantDialog>
    <div
      v-if="productPendingDelete"
      class="dialog-backdrop"
      @click.self="closeDeleteProductDialog"
    >
      <div ref="deleteDialog" class="dialog-card delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-product-dialog-title" aria-describedby="delete-product-dialog-description">
        <div class="dialog-head">
          <div>
            <h3 id="delete-product-dialog-title">{{ pageCopy.deleteTitle }}</h3>
            <p>{{ productPendingDelete.nameZh }}</p>
          </div>
          <button
            type="button"
            class="dialog-close"
            :aria-label="t('cancel')"
            :disabled="deletingProduct"
            @click="closeDeleteProductDialog"
          >×</button>
        </div>
        <p id="delete-product-dialog-description" class="delete-warning">{{ pageCopy.deleteDescription }}</p>
        <p v-if="productMessage" class="section-message" role="alert">{{ productMessage }}</p>
        <div class="dialog-actions">
          <button ref="deleteCancelButton" type="button" class="ghost-action" :disabled="deletingProduct" @click="closeDeleteProductDialog">
            {{ t('cancel') }}
          </button>
          <button type="button" class="danger-action" :disabled="deletingProduct" @click="confirmDeleteProduct">
            {{ deletingProduct ? `${pageCopy.deleteConfirm}…` : pageCopy.deleteConfirm }}
          </button>
        </div>
      </div>
    </div>


  </div>
</template>

<style scoped>
/* finesse · register=product · catalog-directory, responsive detail drawer · SPECTACLE=1 */
.menu-page{position:relative;display:grid;grid-template-columns:minmax(0,1fr);gap:16px;width:100%;min-width:0}
.section-message{margin:12px 0;color:var(--m-danger);font-size:13px;overflow-wrap:anywhere}
.primary-action{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;background:var(--m-accent);color:var(--m-surface)}
.status-pill,.signature-category-badge{display:inline-flex;align-items:center;justify-content:center;max-width:100%;width:fit-content;padding:4px 8px;border-radius:6px;font-size:12px;font-weight:600}
.badge-success{background:var(--m-selected);color:var(--m-accent)}
.badge-warning{background:var(--mx-gold-soft);color:var(--mx-warning)}
.badge-neutral,.badge-muted{background:var(--m-soft);color:var(--m-muted)}
.signature-category-badge{background:var(--mx-gold-soft);color:var(--mx-warning);margin-left:6px}
.hidden-file{display:none}
.numeric-cell{font-variant-numeric:tabular-nums}
.dialog-backdrop{position:fixed;inset:0;z-index:70;display:grid;place-items:center;padding:20px;background:var(--mx-mask)}
.dialog-card{width:min(480px,100%);max-height:calc(100dvh - 40px);overflow-y:auto;padding:24px;border-radius:16px;background:var(--m-surface);box-shadow:var(--mx-shadow)}
.dialog-head{display:flex;align-items:start;justify-content:space-between;gap:16px;margin-bottom:20px}
.dialog-head>div{min-width:0}.dialog-head h3{margin:0;font-size:20px}.dialog-head p{margin:8px 0 0;color:var(--m-muted);overflow-wrap:anywhere}
.dialog-close{display:grid;place-items:center;width:44px;min-height:44px;flex:none;padding:0;background:var(--m-soft);color:var(--m-ink);font-size:24px}
.delete-warning{margin:0;font-size:14px;line-height:1.7;color:var(--m-muted)}
.dialog-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:12px;margin-top:24px}.dialog-actions button{min-height:44px}
.ghost-action{background:var(--m-soft);color:var(--m-ink)}.danger-action{background:var(--m-danger);color:var(--m-surface)}
@media(max-width:768px){.dialog-card{padding:20px}.dialog-actions button{flex:1}.primary-action{font-size:13px}}
</style>
