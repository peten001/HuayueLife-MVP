import { http } from './http';
import type {
  ApiResponse,
  Category,
  DiningTable,
  MerchantProfile,
  MerchantStaffAccount,
  MerchantStaffListItem,
  MerchantStaffRole,
  Product,
  ProductStatus,
} from '@/types/api';

export async function login(username: string, password: string) {
  const response = await http.post<ApiResponse<{
    accessToken: string;
    staff: MerchantStaffAccount;
  }>>(
    '/merchant/auth/login',
    { username, password },
  );
  return response.data.data;
}

export async function getMerchantMe() {
  const response = await http.get<ApiResponse<{
    user: {
      sub: string;
      accountType: 'MERCHANT_STAFF';
      merchantId?: string;
      role?: 'OWNER' | 'MANAGER' | 'STAFF';
      username?: string;
      mustChangePassword?: boolean;
      merchant?: {
        id: string;
        nameZh: string;
        status: string;
      };
    };
  }>>('/merchant/me');
  return response.data.data;
}

export async function changeMerchantPassword(payload: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}) {
  const response = await http.post<ApiResponse<{
    mustChangePassword: boolean;
  }>>('/merchant/profile/change-password', payload);
  return response.data.data;
}

export async function getProfile() {
  const response = await http.get<ApiResponse<MerchantProfile>>('/merchant/profile');
  return response.data.data;
}

export async function updateProfile(payload: Record<string, unknown>) {
  const response = await http.patch<ApiResponse<MerchantProfile>>(
    '/merchant/profile',
    payload,
  );
  return response.data.data;
}

export async function getCategories() {
  const response = await http.get<ApiResponse<Category[]>>('/merchant/categories');
  return response.data.data;
}

export async function createCategory(payload: Partial<Category>) {
  const response = await http.post<ApiResponse<Category>>(
    '/merchant/categories',
    payload,
  );
  return response.data.data;
}

export async function updateCategory(id: string, payload: Partial<Category>) {
  const response = await http.patch<ApiResponse<Category>>(
    `/merchant/categories/${id}`,
    payload,
  );
  return response.data.data;
}

export async function disableCategory(id: string) {
  await http.delete(`/merchant/categories/${id}`);
}

export async function getProducts() {
  const response = await http.get<ApiResponse<Product[]>>('/merchant/products');
  return response.data.data;
}

export async function createProduct(payload: Record<string, unknown>) {
  const response = await http.post<ApiResponse<Product>>('/merchant/products', payload);
  return response.data.data;
}

export async function updateProduct(id: string, payload: Record<string, unknown>) {
  const response = await http.patch<ApiResponse<Product>>(
    `/merchant/products/${id}`,
    payload,
  );
  return response.data.data;
}

export async function uploadProductImage(file: File) {
  return uploadMerchantImage(file, 'product');
}

export async function uploadMerchantImage(
  file: File,
  kind: 'product' | 'merchant-logo' | 'merchant-cover',
) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await http.post<ApiResponse<{ url: string }>>(
    '/uploads/image',
    formData,
    {
      params: {
        kind,
      },
    },
  );
  return response.data.data;
}

export async function updateProductStatus(id: string, status: ProductStatus) {
  await http.patch(`/merchant/products/${id}/status`, { status });
}

export async function disableProduct(id: string) {
  await http.delete(`/merchant/products/${id}`);
}

export async function getTables() {
  const response = await http.get<ApiResponse<DiningTable[]>>('/merchant/tables');
  return response.data.data;
}

export async function createTable(payload: Partial<DiningTable>) {
  const response = await http.post<ApiResponse<DiningTable>>(
    '/merchant/tables',
    payload,
  );
  return response.data.data;
}

export async function updateTable(id: string, payload: Partial<DiningTable>) {
  const response = await http.patch<ApiResponse<DiningTable>>(
    `/merchant/tables/${id}`,
    payload,
  );
  return response.data.data;
}

export async function disableTable(id: string) {
  await http.delete(`/merchant/tables/${id}`);
}

export async function enableTable(id: string) {
  await http.post(`/merchant/tables/${id}/enable`);
}

export async function rotateTableQr(id: string) {
  await http.post(`/merchant/tables/${id}/rotate-qr`);
}

export async function getTableQrBlob(id: string) {
  const response = await http.get(`/merchant/tables/${id}/qr-image`, {
    responseType: 'blob',
  });
  return response.data as Blob;
}

export async function downloadTableQr(table: DiningTable) {
  const blob = await getTableQrBlob(table.id);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `table-${table.tableNo}.png`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function getStaffList() {
  const response = await http.get<ApiResponse<MerchantStaffListItem[]>>(
    '/merchant/staff',
  );
  return response.data.data;
}

export async function createStaff(payload: {
  username: string;
  displayName: string;
  password: string;
  role: Exclude<MerchantStaffRole, 'OWNER'>;
}) {
  const response = await http.post<ApiResponse<MerchantStaffListItem>>(
    '/merchant/staff',
    payload,
  );
  return response.data.data;
}

export async function updateStaff(
  id: string,
  payload: {
    displayName?: string;
    role?: Exclude<MerchantStaffRole, 'OWNER'>;
  },
) {
  const response = await http.patch<ApiResponse<MerchantStaffListItem>>(
    `/merchant/staff/${id}`,
    payload,
  );
  return response.data.data;
}

export async function disableStaff(id: string) {
  const response = await http.post<ApiResponse<MerchantStaffListItem>>(
    `/merchant/staff/${id}/disable`,
  );
  return response.data.data;
}

export async function resetStaffPassword(id: string) {
  const response = await http.post<ApiResponse<{ newPassword: string }>>(
    `/merchant/staff/${id}/reset-password`,
  );
  return response.data.data;
}
