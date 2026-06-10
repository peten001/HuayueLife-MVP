import { http } from './http';
import type {
  ApiResponse,
  Category,
  DiningTable,
  MerchantProfile,
  Product,
  ProductStatus,
} from '@/types/api';

export async function login(username: string, password: string) {
  const response = await http.post<ApiResponse<{ accessToken: string }>>(
    '/merchant/auth/login',
    { username, password },
  );
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

export async function rotateTableQr(id: string) {
  await http.post(`/merchant/tables/${id}/rotate-qr`);
}

export async function downloadTableQr(table: DiningTable) {
  const response = await http.get(`/merchant/tables/${table.id}/qr-image`, {
    responseType: 'blob',
  });
  const url = URL.createObjectURL(response.data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `table-${table.tableNo}.png`;
  anchor.click();
  URL.revokeObjectURL(url);
}
