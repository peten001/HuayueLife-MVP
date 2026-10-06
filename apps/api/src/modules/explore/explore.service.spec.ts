import 'reflect-metadata';
import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request = require('supertest');
import { PrismaService } from '../../database/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { DEFAULT_EXPLORE_CATEGORIES, EXPLORE_BUSINESS_TYPES, matchesExploreCategory, merchantContentTemplate } from './explore-content';
import { DEFAULT_BUSINESS_TYPES } from '../platform/platform-dictionary-seed';
import { ExploreService } from './explore.service';
import { PublicExploreController, PlatformExploreController } from './explore.controller';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DINING_CATEGORY_DEFINITIONS, HOMEPAGE_CATEGORY_KEYS, RETIRED_HOMEPAGE_CATEGORY_KEYS, parseHomepageCategoryKeys } from '../shared/homepage-category-keys';
import { UpdatePlatformMerchantDto } from '../platform/dto/update-platform-merchant.dto';
import { CreateDisplayMerchantDto } from '../platform/dto/create-display-merchant.dto';
import { CreatePlatformMerchantDto } from '../platform/dto/create-platform-merchant.dto';
import { ExploreCategoryDto, ExploreTopicDto, ServiceItemDto } from './explore.dto';

function fixture() {
  const settings = new Map<string, object>();
  const businessTypes = new Map([...DEFAULT_EXPLORE_CATEGORIES.flatMap(item => item.businessTypeCodes), ...EXPLORE_BUSINESS_TYPES.map(item => item.code)].map(code => [code, { code }]));
  const items: any[] = [];
  const merchant = { id: 1n, status: 'ACTIVE', isVisibleOnClient: true, merchantType: 'SERVICE', businessType: { code: 'MASSAGE_SPA' } };
  const db: any = {
    platformSetting: {
      findMany: jest.fn(async ({ where }) => [...settings].filter(([key]) => key.startsWith(where.key.startsWith)).map(([key, value]) => ({ key, value }))),
      upsert: jest.fn(async ({ where, create, update }) => { settings.set(where.key, settings.has(where.key) ? update.value : create.value); return { key: where.key }; }),
      deleteMany: jest.fn(async ({ where }) => { settings.delete(where.key); return { count: 1 }; }),
      createMany: jest.fn(async ({ data }) => { let count = 0; for (const item of data) if (!settings.has(item.key)) { settings.set(item.key, item.value); count++; } return { count }; }),
    },
    promotionTag: { findMany: jest.fn(async () => [{ code: 'RELAX' }]) },
    merchantBusinessType: {
      findMany: jest.fn(async ({ where }) => [...businessTypes.values()].filter(item => where.code.in.includes(item.code))),
      count: jest.fn(async ({ where }) => where.code.in.filter((code: string) => businessTypes.has(code)).length),
      createMany: jest.fn(async ({ data }) => { for (const item of data) if (!businessTypes.has(item.code)) businessTypes.set(item.code, item); }),
    },
    merchant: { findFirst: jest.fn(async ({ where }) => where.id === merchant.id && (!where.isVisibleOnClient || merchant.isVisibleOnClient) ? merchant : null) },
    merchantServiceItem: {
      findMany: jest.fn(async ({ where }) => items.filter(item => item.merchantId === where.merchantId && (where.isVisible === undefined || item.isVisible === where.isVisible)).sort((a, b) => a.sortOrder - b.sortOrder)),
      findFirst: jest.fn(async ({ where }) => items.find(item => item.id === where.id && item.merchantId === where.merchantId) ?? null),
      create: jest.fn(async ({ data }) => { const item = { ...data, id: BigInt(items.length + 1), createdAt: new Date(), updatedAt: new Date() }; items.push(item); return item; }),
      update: jest.fn(async ({ where, data }) => Object.assign(items.find(item => item.id === where.id), data)),
      delete: jest.fn(async ({ where }) => { items.splice(items.findIndex(item => item.id === where.id), 1); }),
    },
  };
  return { db, settings, businessTypes, items, merchant, service: new ExploreService(db) };
}
const itemDto = (overrides = {}): ServiceItemDto => ({ nameZh: '足部放松', priceMode: 'INQUIRY', sortOrder: 10, isVisible: true, ...overrides });
const topicDto = (overrides = {}): ExploreTopicDto => ({ code: 'relax', nameZh: '放松一下', imageUrl: '/uploads/merchant/relax.jpg', regions: ['北江'], promotionTagCode: 'RELAX', sortOrder: 1, enabled: true, ...overrides });

describe('explore content and service contracts', () => {
  it('has the approved 2×5 defaults, with navigation independent from business types', () => {
    expect(DEFAULT_EXPLORE_CATEGORIES.slice(0, 10).map(item => item.code)).toEqual(['food','coffee','massage','hotel','ktv','beauty','shop','fresh','sport','all']);
    expect(DEFAULT_EXPLORE_CATEGORIES[9].businessTypeCodes).toEqual([]);
  });
  it('maps every old key, retaining flowers/fresh as distinct categories', () => {
    for (const key of ['popular_food','chinese_dining','noodles_snacks','coffee_milk_tea','flowers_gifts','fresh_fruit','convenience_store','vietnamese_food']) expect(DEFAULT_EXPLORE_CATEGORIES.some(item => item.legacyKeys.includes(key))).toBe(true);
    expect(matchesExploreCategory({ homepageCategoryKeys: ['fresh_fruit'] }, DEFAULT_EXPLORE_CATEGORIES[7])).toBe(true);
  });
  it.each(DINING_CATEGORY_DEFINITIONS)('filters $nameZh by explicit merchant tags and keeps restaurant behavior', ({ key }) => {
    const category = DEFAULT_EXPLORE_CATEGORIES.find(item => item.code === key)!;
    expect(category).toBeDefined();
    expect(category.businessTypeCodes).toEqual([]);
    expect(matchesExploreCategory({ merchantType: 'RESTAURANT', homepageCategoryKeys: JSON.stringify([key]) }, category)).toBe(true);
    expect(matchesExploreCategory({ merchantType: 'RESTAURANT', homepageCategoryKeys: ['chinese_dining'] }, category)).toBe(false);
    expect(merchantContentTemplate('FOOD_SERVICE', 'RESTAURANT')).toBe('RESTAURANT');
  });
  it('accepts all cuisine keys when editing or creating merchants and rejects unsupported tags', () => {
    const keys = DINING_CATEGORY_DEFINITIONS.map(item => item.key);
    for (const Dto of [CreatePlatformMerchantDto, CreateDisplayMerchantDto, UpdatePlatformMerchantDto] as Array<new () => object>) {
      const errors = validateSync(plainToInstance(Dto, { homepageCategoryKeys: keys }));
      expect(errors.some(error => error.property === 'homepageCategoryKeys')).toBe(false);
      expect(validateSync(plainToInstance(Dto, { homepageCategoryKeys: ['unknown_cuisine'] })).some(error => error.property === 'homepageCategoryKeys')).toBe(true);
    }
    expect(parseHomepageCategoryKeys('["japanese_food","chinese","japanese_food","unknown_cuisine"]')).toEqual(['japanese_food', 'chinese_dining']);
    expect(new Set(HOMEPAGE_CATEGORY_KEYS).size).toBe(HOMEPAGE_CATEGORY_KEYS.length);
    expect(new Set(DEFAULT_EXPLORE_CATEGORIES.map(item => item.code)).size).toBe(DEFAULT_EXPLORE_CATEGORIES.length);
  });
  it('roundtrips cuisine settings without turning them into all-restaurant queries', async () => {
    const f = fixture(); const japanese = DEFAULT_EXPLORE_CATEGORIES.find(item => item.code === 'japanese_food')!;
    await f.service.saveCategory({ ...japanese, sortOrder: 117 });
    expect((await f.service.categories()).find(item => item.code === 'japanese_food')).toEqual({ ...japanese, sortOrder: 117 });
    await expect(f.service.saveCategory({ ...japanese, legacyKeys: ['unknown_cuisine'] })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('does not resurrect retired entrances from stored settings or seeding, while retaining custom categories', async () => {
    const f = fixture();
    for (const code of RETIRED_HOMEPAGE_CATEGORY_KEYS) {
      f.settings.set(`explore.category.${code}`, { ...DEFAULT_EXPLORE_CATEGORIES[0], code, legacyKeys: [code] });
    }
    const custom = { ...DEFAULT_EXPLORE_CATEGORIES[0], code: 'family-dining', nameZh: '家庭聚餐' };
    await f.service.saveCategory(custom);
    await f.service.seedDefaults();
    for (const includeDisabled of [false, true]) {
      const categories = await f.service.categories(includeDisabled);
      expect(categories.some(item => RETIRED_HOMEPAGE_CATEGORY_KEYS.includes(item.code))).toBe(false);
      expect(categories.find(item => item.code === custom.code)).toEqual(custom);
    }
    for (const code of RETIRED_HOMEPAGE_CATEGORY_KEYS) {
      await expect(f.service.resolveFilter(code)).rejects.toBeInstanceOf(NotFoundException);
      await expect(f.service.saveCategory({ ...custom, code })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(f.db.merchant.findFirst).not.toHaveBeenCalled();
  });
  it.each(EXPLORE_BUSINESS_TYPES.map(item => [item.code]))('%s is a service template independently of claim', code => expect(merchantContentTemplate(code, 'RESTAURANT')).toBe('SERVICE'));
  it('defaults reference real dictionaries and retain legacy types without invented industry codes', () => {
    const allowed = new Set([...DEFAULT_BUSINESS_TYPES, ...EXPLORE_BUSINESS_TYPES].map(item => item.code));
    for (const category of DEFAULT_EXPLORE_CATEGORIES) for (const code of category.businessTypeCodes) expect(allowed.has(code)).toBe(true);
    expect(matchesExploreCategory({ merchantType: 'RESTAURANT' }, DEFAULT_EXPLORE_CATEGORIES[0])).toBe(true);
    expect(matchesExploreCategory({ merchantType: 'CAKE' }, DEFAULT_EXPLORE_CATEGORIES[0])).toBe(true);
    expect(matchesExploreCategory({ merchantType: 'MILK_TEA' }, DEFAULT_EXPLORE_CATEGORIES[1])).toBe(true);
  });
  it('uses only scene and operational tags as topic targets', async () => {
    const f = fixture(); await f.service.saveTopic(topicDto()); await f.service.topics();
    expect(f.db.promotionTag.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { enabled: true, scope: { in: ['OPERATIONAL', 'SCENE'] } } }));
  });
  it('unknown industry falls back safely without guessing its name', () => expect(merchantContentTemplate('UNKNOWN', 'RESTAURANT')).toBe('GENERAL'));
  it('matches explicit codes or old keys, without name inference', () => {
    expect(matchesExploreCategory({ businessType: { code: 'HOTEL' } }, DEFAULT_EXPLORE_CATEGORIES[3])).toBe(true);
    expect(matchesExploreCategory({ businessType: { code: 'MASSAGE_SPA' } }, DEFAULT_EXPLORE_CATEGORIES[0])).toBe(false);
  });
  it('roundtrips category visibility and order without modifying merchant records', async () => {
    const f = fixture(); const dto = { ...DEFAULT_EXPLORE_CATEGORIES[2], sortOrder: 1, enabled: false };
    await f.service.saveCategory(dto); expect((await f.service.categories()).some(item => item.code === 'massage')).toBe(false);
    expect((await f.service.categories(true)).find(item => item.code === 'massage')).toEqual(dto);
    expect(f.db.merchant.findFirst).not.toHaveBeenCalled();
  });
  it('rejects unknown mappings and changes to all-services semantics', async () => {
    const f = fixture(); await expect(f.service.saveCategory({ ...DEFAULT_EXPLORE_CATEGORIES[2], businessTypeCodes: ['UNKNOWN'] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(f.service.saveCategory({ ...DEFAULT_EXPLORE_CATEGORIES[9], navigationOnly: false })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('hides invalid/disabled topics and does not expose inactive templates', async () => {
    const f = fixture(); await f.service.seedDefaults(); expect(await f.service.topics()).toEqual([]);
    await f.service.saveTopic(topicDto()); expect(await f.service.topics()).toHaveLength(1);
    f.db.promotionTag.findMany.mockResolvedValue([]); expect(await f.service.topics()).toEqual([]);
  });
  it('requires an image and valid internal target when enabling', async () => {
    const f = fixture(); await expect(f.service.saveTopic(topicDto({ imageUrl: '' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(f.service.saveTopic(topicDto({ promotionTagCode: 'DELETED' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(f.service.saveTopic(topicDto({ imageUrl: 'javascript:alert(1)' }))).rejects.toBeInstanceOf(BadRequestException);
  });
  it('resolves category AND topic, checks region, and supports global keyword queries', async () => {
    const f = fixture(); await f.service.saveTopic(topicDto({ categoryCode: 'massage' }));
    const result = await f.service.resolveFilter('hotel', 'relax', '北江'); expect(result.category?.code).toBe('hotel'); expect(result.topicCategory?.code).toBe('massage'); expect(result.promotionTagCode).toBe('RELAX');
    await expect(f.service.resolveFilter(undefined, 'relax', '北宁')).rejects.toBeInstanceOf(BadRequestException);
    await expect(f.service.resolveFilter(undefined, 'relax', undefined, true)).resolves.toBeDefined();
    await expect(f.service.resolveFilter('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('seeds missing rows idempotently without overwriting content', async () => {
    const f = fixture(); for (const item of EXPLORE_BUSINESS_TYPES) f.businessTypes.delete(item.code);
    const first = await f.service.seedDefaults(); expect(first.businessTypesCreated).toBe(5); expect(first.settingsCreated).toBe(DEFAULT_EXPLORE_CATEGORIES.length + 2);
    await f.service.saveTopic(topicDto()); const second = await f.service.seedDefaults(); expect(second.businessTypesCreated).toBe(0); expect(second.settingsCreated).toBe(0); expect(await f.service.topics()).toHaveLength(1);
    expect(f.db.merchant.findFirst).not.toHaveBeenCalled();
  });
  it('roundtrips multilingual service, order, visibility, image replacement and deletion', async () => {
    const f = fixture(); const created = await f.service.saveService(1n, itemDto({ nameVi: 'Thư giãn chân', durationMinutes: 60, imageUrl: '/uploads/relax.jpg' }));
    expect(created.amountVnd).toBeNull(); expect(created.nameVi).toBe('Thư giãn chân');
    await f.service.saveService(1n, itemDto({ imageUrl: '/uploads/replacement.jpg', sortOrder: 1, isVisible: false }), BigInt(created.id));
    expect((await f.service.listServices(1n, true)).items).toEqual([]);
    expect((await f.service.listServices(1n)).items[0].imageUrl).toBe('/uploads/replacement.jpg');
    await f.service.deleteService(1n, BigInt(created.id)); expect(f.items).toHaveLength(0);
  });
  it('keeps unknown price null; rejects inconsistent prices and allows explicit zero', async () => {
    const f = fixture(); await expect(f.service.saveService(1n, itemDto({ amountVnd: '0' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(f.service.saveService(1n, itemDto({ priceMode: 'FROM' }))).rejects.toBeInstanceOf(BadRequestException);
    const saved = await f.service.saveService(1n, itemDto({ priceMode: 'FIXED', amountVnd: '0' })); expect(saved.amountVnd).toBe('0');
  });
  it('rejects cross-merchant writes and restaurant content', async () => {
    const f = fixture(); f.items.push({ id: 3n, merchantId: 2n });
    await expect(f.service.saveService(1n, itemDto(), 3n)).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.service.deleteService(1n, 3n)).rejects.toBeInstanceOf(NotFoundException);
    f.merchant.businessType.code = 'CHINESE_RESTAURANT'; await expect(f.service.saveService(1n, itemDto())).rejects.toBeInstanceOf(BadRequestException);
  });
  it('public service response excludes hidden content and internal fields', async () => {
    const f = fixture(); await f.service.saveService(1n, itemDto()); const result = await f.service.listServices(1n, true);
    expect(result.items[0]).not.toHaveProperty('merchantId'); expect(result.items[0]).not.toHaveProperty('createdAt');
    f.merchant.isVisibleOnClient = false; await expect(f.service.listServices(1n, true)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('explore HTTP authorization and validation', () => {
  let app: any; const jwt = new JwtService({ secret: 'isolated-explore-test-only' });
  beforeAll(async () => {
    const f = fixture();
    const module = await Test.createTestingModule({ controllers: [PublicExploreController, PlatformExploreController], providers: [ExploreService, JwtAuthGuard, PlatformAdminGuard, { provide: PrismaService, useValue: f.db }, { provide: JwtService, useValue: jwt }] }).compile();
    app = module.createNestApplication(); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })); await app.init();
  });
  afterAll(() => app.close());
  it('allows public configuration without auth', () => request(app.getHttpServer()).get('/public/explore').expect(200));
  it('rejects anonymous global edits', () => request(app.getHttpServer()).put('/platform/explore/categories').send(DEFAULT_EXPLORE_CATEGORIES[0]).expect(401));
  it('rejects merchant staff editing global config or other service records', async () => {
    const token = jwt.sign({ accountType: 'MERCHANT_STAFF', merchantId: '1' });
    await request(app.getHttpServer()).put('/platform/explore/categories').set('Authorization', `Bearer ${token}`).send(DEFAULT_EXPLORE_CATEGORIES[0]).expect(403);
    await request(app.getHttpServer()).post('/platform/merchants/1/service-items').set('Authorization', `Bearer ${token}`).send(itemDto()).expect(403);
  });
  it('admin saves and reads back controlled content', async () => {
    const token = jwt.sign({ accountType: 'PLATFORM_ADMIN' });
    await request(app.getHttpServer()).post('/platform/merchants/1/service-items').set('Authorization', `Bearer ${token}`).send(itemDto()).expect(201);
    const result = await request(app.getHttpServer()).get('/platform/merchants/1/service-items').set('Authorization', `Bearer ${token}`).expect(200); expect(result.body.items).toHaveLength(1);
  });
  it('allows admin category mappings to include all active keys beyond the previous eight-key cap', async () => {
    const token = jwt.sign({ accountType: 'PLATFORM_ADMIN' });
    const category = { ...DEFAULT_EXPLORE_CATEGORIES[0], code: 'active-tags', legacyKeys: HOMEPAGE_CATEGORY_KEYS };
    await request(app.getHttpServer()).put('/platform/explore/categories').set('Authorization', `Bearer ${token}`).send(category).expect(200);
    const result = await request(app.getHttpServer()).get('/platform/explore/categories').set('Authorization', `Bearer ${token}`).expect(200);
    expect(result.body.find((item: ExploreCategoryDto) => item.code === 'active-tags').legacyKeys).toEqual(category.legacyKeys);
  });
  it('rejects invalid enum, duration and ordering fields at the HTTP boundary', async () => {
    const token = jwt.sign({ accountType: 'PLATFORM_ADMIN' });
    for (const bad of [{ durationMinutes: -1 }, { priceMode: 'FREE' }, { sortOrder: 0.5 }, { amountVnd: '-1' }, { bookingEnabled: true }]) await request(app.getHttpServer()).post('/platform/merchants/1/service-items').set('Authorization', `Bearer ${token}`).send(itemDto(bad)).expect(400);
  });
});
