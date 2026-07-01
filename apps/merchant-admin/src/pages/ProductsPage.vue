<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
const fileInput = ref<HTMLInputElement | null>(null);

const searchKeyword = ref('');
const selectedCategoryId = ref<'all' | string>('all');
const selectedStatus = ref<ProductFilterStatus>('ALL');
const selectedSortMode = ref<ProductSortMode>('DEFAULT');

const categoryForm = reactive({
  id: '',
  nameZh: '',
  nameVi: '',
  sortOrder: 0,
});

const productForm = reactive({
  id: '',
  categoryId: '',
  nameZh: '',
  nameVi: '',
  description: '',
  imageUrl: '',
  priceVnd: 0,
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
      item.description ?? '',
      item.category?.nameZh ?? '',
      item.category?.nameVi ?? '',
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

function categoryName(category?: Category | null) {
  if (!category) return '—';
  if (locale.value === 'vi' && category.nameVi) return category.nameVi;
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
  return product.imageUrl ? resolveMediaUrl(product.imageUrl) : '';
}

function resetCategoryForm() {
  Object.assign(categoryForm, {
    id: '',
    nameZh: '',
    nameVi: '',
    sortOrder: 0,
  });
}

function resetProductForm() {
  Object.assign(productForm, {
    id: '',
    categoryId: activeCategories.value[0]?.id ?? '',
    nameZh: '',
    nameVi: '',
    description: '',
    imageUrl: '',
    priceVnd: 0,
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
    description: row.description ?? '',
    imageUrl: row.imageUrl ?? '',
    priceVnd: Number(row.priceVnd ?? 0),
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

async function saveProduct() {
  productMessage.value = '';

  try {
    const payload = {
      categoryId: productForm.categoryId,
      nameZh: productForm.nameZh.trim(),
      nameVi: productForm.nameVi.trim(),
      description: productForm.description.trim() || undefined,
      imageUrl: productForm.imageUrl.trim() || undefined,
      priceVnd: productForm.priceVnd,
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
  if (!confirm(t('disableProductConfirm', { name: row.nameZh }))) return;

  try {
    await disableProduct(row.id);
    await loadData();
  } catch (error) {
    productMessage.value = errorMessage(error);
  }
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
  await loadData();
  resetCategoryForm();
  resetProductForm();
});
</script>

<template>
  <div class="menu-page">
    <div class="menu-tabs">
      <button
        type="button"
        :class="['menu-tab', activeTab === 'products' && 'is-active']"
        @click="setTab('products')"
      >
        {{ pageCopy.productsTab }}
      </button>
      <button
        type="button"
        :class="['menu-tab', activeTab === 'categories' && 'is-active']"
        @click="setTab('categories')"
      >
        {{ pageCopy.categoriesTab }}
      </button>
    </div>

    <p v-if="pageMessage" class="page-message">{{ pageMessage }}</p>

    <section v-if="activeTab === 'products'" class="products-dashboard">
      <div class="products-sidebar">
        <div class="card filter-card">
          <div class="card-title">{{ pageCopy.filterTitle }}</div>

          <label class="field">
            <span class="field-label">{{ pageCopy.categoryFilterLabel }}</span>
            <select v-model="selectedCategoryId">
              <option value="all">{{ pageCopy.allCategories }}</option>
              <option v-for="item in sortedCategories" :key="item.id" :value="item.id">
                {{ categoryName(item) }}
              </option>
            </select>
          </label>

          <div class="field">
            <span class="field-label">{{ pageCopy.statusFilterLabel }}</span>
            <div class="status-filter-group">
              <button
                type="button"
                :class="['status-filter', selectedStatus === 'ALL' && 'is-active']"
                @click="selectedStatus = 'ALL'"
              >
                {{ pageCopy.allStatus }}
              </button>
              <button
                type="button"
                :class="['status-filter', 'is-success', selectedStatus === 'ON_SALE' && 'is-active']"
                @click="selectedStatus = 'ON_SALE'"
              >
                {{ t('onSale') }}
              </button>
              <button
                type="button"
                :class="['status-filter', 'is-warning', selectedStatus === 'SOLD_OUT' && 'is-active']"
                @click="selectedStatus = 'SOLD_OUT'"
              >
                {{ t('soldOut') }}
              </button>
              <button
                type="button"
                :class="['status-filter', 'is-neutral', selectedStatus === 'OFF_SALE' && 'is-active']"
                @click="selectedStatus = 'OFF_SALE'"
              >
                {{ t('offSale') }}
              </button>
            </div>
          </div>

          <label class="field">
            <span class="field-label">{{ pageCopy.sortLabel }}</span>
            <select v-model="selectedSortMode">
              <option
                v-for="item in sortOptions"
                :key="item.value"
                :value="item.value"
              >
                {{ item.label }}
              </option>
            </select>
          </label>
        </div>

        <div class="card stats-card">
          <div class="card-title">{{ pageCopy.statsTitle }}</div>
          <div class="stats-list">
            <div v-for="item in statsRows" :key="item.key" class="stats-row">
              <span :class="['stats-icon', `stats-icon--${item.tone}`]"></span>
              <span class="stats-label">{{ item.label }}</span>
              <strong class="stats-value">{{ item.value }}</strong>
            </div>
          </div>
        </div>
      </div>

      <div class="card list-card">
        <div class="list-toolbar">
          <label class="search-box">
            <input v-model="searchKeyword" :placeholder="pageCopy.searchPlaceholder" />
          </label>
          <button type="button" class="primary-action" @click="openCreateProductModal">
            {{ pageCopy.addProductButton }}
          </button>
        </div>

        <p v-if="productMessage" class="section-message">{{ productMessage }}</p>

        <div class="table-shell">
          <table class="product-table">
            <thead>
              <tr>
                <th>{{ t('product') }}</th>
                <th>{{ t('category') }}</th>
                <th>{{ t('priceVnd') }}</th>
                <th>{{ t('sortOrder') }}</th>
                <th>{{ t('status') }}</th>
                <th>{{ t('actions') }}</th>
              </tr>
            </thead>
            <tbody v-if="filteredProducts.length">
              <tr v-for="row in filteredProducts" :key="row.id">
                <td>
                  <div class="product-cell">
                    <div class="product-thumb">
                      <img v-if="productImage(row)" :src="productImage(row)" :alt="row.nameZh" />
                      <span v-else>{{ pageCopy.noImage }}</span>
                    </div>
                    <div class="product-copy">
                      <strong>{{ row.nameZh }}</strong>
                      <small>{{ row.nameVi?.trim() || pageCopy.missingVietnamese }}</small>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="category-copy">
                    <strong>{{ row.category?.nameZh || '—' }}</strong>
                    <small>{{ categorySecondaryName(row.category) }}</small>
                  </div>
                </td>
                <td class="numeric-cell">{{ productPrice(row) }}</td>
                <td class="numeric-cell">{{ row.sortOrder }}</td>
                <td>
                  <div class="status-stack">
                    <span :class="['status-pill', productStatusClass(row.status)]">
                      {{ productStatusLabel(row.status) }}
                    </span>
                    <div class="status-actions">
                      <button
                        v-if="row.status !== 'ON_SALE'"
                        type="button"
                        class="mini-chip success"
                        @click="setProductStatus(row, 'ON_SALE')"
                      >
                        {{ t('onSale') }}
                      </button>
                      <button
                        v-if="row.status !== 'SOLD_OUT'"
                        type="button"
                        class="mini-chip warning"
                        @click="setProductStatus(row, 'SOLD_OUT')"
                      >
                        {{ t('soldOut') }}
                      </button>
                      <button
                        v-if="row.status !== 'OFF_SALE'"
                        type="button"
                        class="mini-chip neutral"
                        @click="setProductStatus(row, 'OFF_SALE')"
                      >
                        {{ t('offSale') }}
                      </button>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="table-actions">
                    <button type="button" class="icon-action" @click="editProduct(row)" aria-label="edit">
                      <span aria-hidden="true">✎</span>
                    </button>
                    <button type="button" class="icon-action danger" @click="disableProductRow(row)" aria-label="disable">
                      <span aria-hidden="true">🗑</span>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
            <tbody v-else>
              <tr>
                <td colspan="6">
                  <div class="empty-state">
                    <strong>{{ pageCopy.listTitle }}</strong>
                    <p>{{ pageCopy.searchPlaceholder }}</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="table-footer">
          <span>{{ pageCopy.totalLabel }} {{ filteredProducts.length }} {{ pageCopy.productCountText }}</span>
        </div>
      </div>
    </section>

    <section v-else class="category-dashboard">
      <div class="card category-form-card">
        <div class="card-head-block">
          <h2>{{ pageCopy.categoryFormTitle }}</h2>
          <p>{{ pageCopy.categoryFormDescription }}</p>
        </div>

        <form class="stack-form" @submit.prevent="saveCategory">
          <label class="field">
            <span class="field-label">
              {{ t('chineseCategoryName') }}
              <em>{{ t('required') }}</em>
            </span>
            <input
              v-model="categoryForm.nameZh"
              :placeholder="t('chineseCategoryName')"
              required
            />
          </label>

          <label class="field">
            <span class="field-label">
              {{ t('vietnameseCategoryName') }}
              <em>{{ t('required') }}</em>
            </span>
            <input
              v-model="categoryForm.nameVi"
              :placeholder="t('vietnameseCategoryName')"
              required
            />
          </label>

          <label class="field">
            <span class="field-label">{{ t('sortOrder') }}</span>
            <input v-model.number="categoryForm.sortOrder" type="number" min="0" />
            <small class="field-hint">{{ pageCopy.categorySortHint }}</small>
          </label>

          <div class="stack-actions">
            <button type="submit" class="primary-action block-action">
              {{ categoryForm.id ? t('saveChanges') : pageCopy.addCategoryButton }}
            </button>
            <button
              v-if="categoryForm.id"
              type="button"
              class="ghost-action block-action"
              @click="resetCategoryForm"
            >
              {{ t('cancel') }}
            </button>
          </div>
        </form>

        <p v-if="categoryMessage" class="section-message">{{ categoryMessage }}</p>
      </div>

      <div class="card category-list-card">
        <div class="card-head-block">
          <h2>{{ pageCopy.categoryListTitle }}</h2>
          <p>{{ pageCopy.categoryListHint }}</p>
        </div>

        <div class="table-shell">
          <table class="category-table">
            <thead>
              <tr>
                <th>{{ t('category') }}</th>
                <th>{{ t('sortOrder') }}</th>
                <th>{{ t('product') }}</th>
                <th>{{ t('status') }}</th>
                <th>{{ t('actions') }}</th>
              </tr>
            </thead>
            <tbody v-if="sortedCategories.length">
              <tr v-for="row in sortedCategories" :key="row.id">
                <td>
                  <div class="category-copy">
                    <strong>{{ row.nameZh }}</strong>
                    <small>{{ row.nameVi?.trim() || pageCopy.missingVietnamese }}</small>
                  </div>
                </td>
                <td class="numeric-cell">{{ row.sortOrder }}</td>
                <td class="numeric-cell">{{ row._count?.products ?? 0 }}</td>
                <td>
                  <span :class="['status-pill', row.isActive ? 'badge-success' : 'badge-neutral']">
                    {{ row.isActive ? t('enabled') : t('disabledStatus') }}
                  </span>
                </td>
                <td>
                  <div class="category-actions">
                    <button type="button" class="text-action" @click="editCategory(row)">
                      {{ t('edit') }}
                    </button>
                    <button
                      v-if="row.isActive"
                      type="button"
                      class="text-action danger"
                      @click="disableCategoryRow(row)"
                    >
                      {{ t('disable') }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
            <tbody v-else>
              <tr>
                <td colspan="5">
                  <div class="empty-state">
                    <strong>{{ pageCopy.categoryListTitle }}</strong>
                    <p>{{ pageCopy.categoryFormDescription }}</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <div v-if="showProductModal" class="dialog-backdrop" @click.self="closeProductModal">
      <div class="dialog-card">
        <div class="dialog-head">
          <div>
            <h3>{{ productModalTitle }}</h3>
            <p>{{ t('productsDescription') }}</p>
          </div>
          <button type="button" class="dialog-close" @click="closeProductModal">×</button>
        </div>

        <form class="dialog-form" @submit.prevent="saveProduct">
          <div class="dialog-grid">
            <label class="field">
              <span class="field-label">
                {{ t('category') }}
                <em>{{ t('required') }}</em>
              </span>
              <select v-model="productForm.categoryId" required>
                <option v-for="item in productFormCategories" :key="item.id" :value="item.id">
                  {{ categoryName(item) }}
                </option>
              </select>
            </label>

            <label class="field">
              <span class="field-label">
                {{ t('priceVnd') }}
                <em>{{ t('required') }}</em>
              </span>
              <input v-model.number="productForm.priceVnd" type="number" min="0" required />
            </label>

            <label class="field">
              <span class="field-label">
                {{ t('chineseProductName') }}
                <em>{{ t('required') }}</em>
              </span>
              <input v-model="productForm.nameZh" required />
            </label>

            <label class="field">
              <span class="field-label">
                {{ t('vietnameseProductName') }}
                <em>{{ t('required') }}</em>
              </span>
              <input v-model="productForm.nameVi" required />
            </label>

            <label class="field">
              <span class="field-label">{{ t('sortOrder') }}</span>
              <input v-model.number="productForm.sortOrder" type="number" min="0" />
            </label>

            <label class="field field-span-2">
              <span class="field-label">{{ t('imageUrl') }}</span>
              <input v-model="productForm.imageUrl" :placeholder="t('imageUrl')" />
              <small class="field-hint">{{ pageCopy.imageHint }}</small>
            </label>

            <div class="field field-span-2 image-upload-field">
              <div class="image-upload-actions">
                <button type="button" class="ghost-action" :disabled="uploading" @click="openImagePicker">
                  {{ productForm.imageUrl ? t('replaceImage') : t('uploadImage') }}
                </button>
                <button type="button" class="ghost-action" :disabled="uploading || !productForm.imageUrl" @click="clearImage">
                  {{ t('clearImage') }}
                </button>
              </div>
              <input
                ref="fileInput"
                class="hidden-file"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                @change="onImageSelected"
              />
              <div class="image-preview-box">
                <img v-if="imagePreviewUrl" :src="imagePreviewUrl" :alt="pageCopy.imagePlaceholder" />
                <span v-else>{{ pageCopy.imagePlaceholder }}</span>
              </div>
            </div>

          </div>

          <p v-if="productMessage" class="section-message">{{ productMessage }}</p>

          <div class="dialog-actions">
            <button type="button" class="ghost-action" @click="closeProductModal">
              {{ t('cancel') }}
            </button>
            <button type="submit" class="primary-action">
              {{ productForm.id ? t('saveChanges') : t('addProduct') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="loading" class="loading-mask"></div>
  </div>
</template>

<style scoped>
.menu-page {
  position: relative;
  display: grid;
  gap: 22px;
}

.menu-tabs {
  display: inline-flex;
  align-items: flex-end;
  margin: 0 0 2px;
  border-radius: 14px;
  background: #eef5f0;
  overflow: hidden;
}

.menu-tab {
  width: 190px;
  height: 56px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #64748b;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
}

.menu-tab.is-active {
  background: #ffffff;
  color: #15803d;
  border-bottom-color: #16a34a;
}

.page-message,
.section-message {
  margin: 0;
  color: #b45309;
  font-size: 13px;
}

.products-dashboard,
.category-dashboard {
  display: grid;
  gap: 20px;
  align-items: start;
}

.products-dashboard {
  grid-template-columns: 300px minmax(0, 1fr);
}

.category-dashboard {
  grid-template-columns: 360px minmax(0, 1fr);
}

.products-sidebar {
  display: grid;
  gap: 16px;
}

.card {
  border: 1px solid #edf1ef;
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
}

.filter-card,
.stats-card,
.category-form-card,
.category-list-card,
.list-card {
  padding: 22px;
}

.card-title,
.card-head-block h2 {
  margin: 0;
  color: #0f2a1d;
  font-size: 20px;
  font-weight: 800;
}

.card-head-block {
  display: grid;
  gap: 6px;
}

.card-head-block p {
  margin: 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.5;
}

.filter-card,
.category-form-card {
  display: grid;
  gap: 16px;
}

.field {
  display: grid;
  gap: 8px;
}

.field-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #0f172a;
  font-size: 14px;
  font-weight: 700;
}

.field-label em {
  font-style: normal;
  color: #dc2626;
  font-size: 12px;
}

.field input,
.field select,
.field textarea,
.search-box input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid #dbe3df;
  border-radius: 10px;
  background: #ffffff;
  color: #0f172a;
  font-size: 14px;
}

.field input,
.field select,
.search-box input {
  height: 44px;
  padding: 0 12px;
}

.field textarea {
  padding: 12px;
  resize: vertical;
}

.field-hint {
  color: #64748b;
  font-size: 12px;
}

.status-filter-group {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.status-filter {
  height: 36px;
  padding: 0 14px;
  border: 1px solid #dbe3df;
  border-radius: 10px;
  background: #ffffff;
  color: #475569;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.status-filter.is-active {
  border-color: #16a34a;
  background: #16a34a;
  color: #ffffff;
}

.status-filter.is-warning:not(.is-active) {
  border-color: #fdba74;
  color: #c2410c;
}

.status-filter.is-neutral:not(.is-active) {
  border-color: #cbd5e1;
  color: #475569;
}

.stats-card {
  display: grid;
  gap: 16px;
}

.stats-list {
  display: grid;
  gap: 10px;
}

.stats-row {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 44px;
}

.stats-icon {
  width: 36px;
  height: 36px;
  border-radius: 12px;
}

.stats-icon--green {
  background: #dcfce7;
}

.stats-icon--emerald {
  background: #bbf7d0;
}

.stats-icon--orange {
  background: #ffedd5;
}

.stats-icon--slate {
  background: #e2e8f0;
}

.stats-label {
  color: #0f172a;
  font-size: 14px;
  font-weight: 600;
}

.stats-value {
  color: #0f172a;
  font-size: 16px;
  font-weight: 800;
}

.list-card {
  display: grid;
  gap: 18px;
}

.list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.search-box {
  width: min(420px, 100%);
}

.primary-action,
.ghost-action,
.block-action,
.text-action,
.icon-action,
.mini-chip {
  cursor: pointer;
  transition: 0.2s ease;
}

.primary-action {
  height: 44px;
  padding: 0 16px;
  border: 0;
  border-radius: 10px;
  background: #16a34a;
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
}

.ghost-action {
  height: 40px;
  padding: 0 14px;
  border: 1px solid #dbe3df;
  border-radius: 10px;
  background: #ffffff;
  color: #334155;
  font-size: 14px;
  font-weight: 700;
}

.block-action {
  width: 100%;
}

.stack-form {
  display: grid;
  gap: 14px;
}

.stack-actions {
  display: grid;
  gap: 10px;
}

.table-shell {
  width: 100%;
  overflow-x: auto;
}

.product-table,
.category-table {
  width: 100%;
  border-collapse: collapse;
}

.product-table {
  min-width: 900px;
}

.category-table {
  min-width: 700px;
}

.product-table thead th,
.category-table thead th {
  padding: 14px 12px;
  border-bottom: 1px solid #e5ebe8;
  background: #f8faf9;
  color: #475569;
  font-size: 13px;
  font-weight: 800;
  text-align: left;
}

.product-table tbody td,
.category-table tbody td {
  padding: 14px 12px;
  border-bottom: 1px solid #eef2f1;
  color: #0f172a;
  font-size: 14px;
  vertical-align: middle;
}

.product-cell {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.product-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  flex: 0 0 64px;
  overflow: hidden;
  border: 1px solid #e5ebe8;
  border-radius: 10px;
  background: #f8faf9;
  color: #94a3b8;
  font-size: 12px;
  text-align: center;
}

.product-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.product-copy,
.category-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.product-copy strong,
.category-copy strong {
  color: #0f172a;
  font-size: 14px;
  font-weight: 800;
}

.product-copy small,
.category-copy small {
  color: #64748b;
  font-size: 12px;
  line-height: 1.4;
}

.numeric-cell {
  white-space: nowrap;
  font-weight: 700;
}

.status-stack {
  display: grid;
  gap: 8px;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.badge-success {
  background: #dcfce7;
  color: #15803d;
}

.badge-warning {
  background: #ffedd5;
  color: #c2410c;
}

.badge-neutral {
  background: #e2e8f0;
  color: #475569;
}

.badge-muted {
  background: #ede9fe;
  color: #6d28d9;
}

.status-actions,
.table-actions,
.category-actions,
.dialog-actions,
.image-upload-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mini-chip {
  height: 24px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: #ffffff;
  font-size: 12px;
  font-weight: 700;
}

.mini-chip.success {
  border-color: #86efac;
  background: #f0fdf4;
  color: #15803d;
}

.mini-chip.warning {
  border-color: #fdba74;
  background: #fff7ed;
  color: #c2410c;
}

.mini-chip.neutral {
  border-color: #cbd5e1;
  background: #f8fafc;
  color: #475569;
}

.icon-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid #dbe3df;
  border-radius: 10px;
  background: #ffffff;
  color: #334155;
  font-size: 14px;
}

.icon-action.danger {
  border-color: #fecaca;
  color: #dc2626;
}

.text-action {
  height: 32px;
  padding: 0 10px;
  border: 1px solid #dbe3df;
  border-radius: 10px;
  background: #ffffff;
  color: #334155;
  font-size: 13px;
  font-weight: 700;
}

.text-action.danger {
  border-color: #fecaca;
  color: #dc2626;
}

.table-footer {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  color: #64748b;
  font-size: 13px;
}

.empty-state {
  display: grid;
  place-items: center;
  gap: 8px;
  min-height: 160px;
  color: #64748b;
  text-align: center;
}

.empty-state strong {
  color: #0f172a;
  font-size: 16px;
}

.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.4);
}

.dialog-card {
  width: min(920px, 100%);
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 24px;
  border-radius: 20px;
  background: #ffffff;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.2);
}

.dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.dialog-head h3 {
  margin: 0;
  color: #0f2a1d;
  font-size: 22px;
  font-weight: 800;
}

.dialog-head p {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.5;
}

.dialog-close {
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 999px;
  background: #f1f5f9;
  color: #334155;
  font-size: 24px;
  cursor: pointer;
}

.dialog-form {
  display: grid;
  gap: 18px;
  margin-top: 20px;
}

.dialog-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.field-span-2 {
  grid-column: span 2;
}

.image-upload-field {
  gap: 12px;
}

.hidden-file {
  display: none;
}

.image-preview-box {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 160px;
  height: 120px;
  overflow: hidden;
  border: 1px dashed #d8e2dc;
  border-radius: 12px;
  background: #f8faf9;
  color: #94a3b8;
  font-size: 13px;
}

.image-preview-box img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.loading-mask {
  position: fixed;
  right: 24px;
  bottom: 24px;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: rgba(22, 163, 74, 0.85);
  box-shadow: 0 0 0 10px rgba(22, 163, 74, 0.14);
}

@media (max-width: 1180px) {
  .products-dashboard,
  .category-dashboard {
    grid-template-columns: 1fr;
  }

  .dialog-grid {
    grid-template-columns: 1fr;
  }

  .field-span-2 {
    grid-column: auto;
  }
}

@media (max-width: 760px) {
  .menu-tab {
    width: 160px;
  }

  .list-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .search-box {
    width: 100%;
  }

  .filter-card,
  .stats-card,
  .category-form-card,
  .category-list-card,
  .list-card,
  .dialog-card {
    padding: 18px;
  }
}
</style>
