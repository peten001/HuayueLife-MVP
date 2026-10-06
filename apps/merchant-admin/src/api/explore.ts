import { exploreRequest } from './platform';

export interface ExploreCategory {
  code: string; nameZh: string; nameVi?: string; nameEn?: string; iconKey: string;
  sortOrder: number; enabled: boolean; businessTypeCodes: string[]; legacyKeys: string[]; navigationOnly?: boolean;
}
export interface ExploreTopic {
  code: string; nameZh: string; nameVi?: string; nameEn?: string;
  subtitleZh?: string; subtitleVi?: string; subtitleEn?: string; imageUrl?: string;
  regions: string[]; categoryCode?: string; promotionTagCode?: string; sortOrder: number; enabled: boolean;
}
export interface ServiceItem {
  id?: string; nameZh: string; nameVi?: string | null; nameEn?: string | null;
  descriptionZh?: string | null; descriptionVi?: string | null; descriptionEn?: string | null;
  imageUrl?: string | null; durationMinutes?: number | null; priceMode: 'INQUIRY' | 'FIXED' | 'FROM';
  amountVnd?: string | null; unit?: string | null; sortOrder: number; isVisible: boolean;
}
export const listExploreCategories = () => exploreRequest<ExploreCategory[]>('get', '/platform/explore/categories');
export const saveExploreCategory = (item: ExploreCategory) => exploreRequest<ExploreCategory>('put', '/platform/explore/categories', item);
export const listExploreTopics = () => exploreRequest<ExploreTopic[]>('get', '/platform/explore/topics');
export const saveExploreTopic = (item: ExploreTopic) => exploreRequest<ExploreTopic>('put', '/platform/explore/topics', item);
export const deleteExploreTopic = (code: string) => exploreRequest('delete', `/platform/explore/topics/${code}`);
export const initializeExplore = () => exploreRequest<{ businessTypesCreated: number; settingsCreated: number }>('post', '/platform/explore/initialize');
export const listServiceItems = (merchantId: string) => exploreRequest<{ items: ServiceItem[] }>('get', `/platform/merchants/${merchantId}/service-items`);
export const saveServiceItem = (merchantId: string, item: ServiceItem) => {
  const { id, ...body } = item;
  return exploreRequest<ServiceItem>(id ? 'put' : 'post', `/platform/merchants/${merchantId}/service-items${id ? `/${id}` : ''}`, body);
};
export const deleteServiceItem = (merchantId: string, id: string) => exploreRequest('delete', `/platform/merchants/${merchantId}/service-items/${id}`);
