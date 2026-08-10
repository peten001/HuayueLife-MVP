import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMerchantSignatureDishDto } from './dto/merchant-signature-dish.dto';
import { PlatformMerchantSignatureDishesService } from './platform-merchant-signature-dishes.service';

const now = new Date('2026-08-10T00:00:00.000Z');
type Dish = { id: bigint; merchantId: bigint; nameZh: string; nameVi: string | null; nameEn: string | null; imageUrl: string; sortOrder: number; isVisible: boolean; createdAt: Date; updatedAt: Date };

function fixture() {
  const rows: Dish[] = [];
  let nextId = 1n;
  const ordered = (merchantId: bigint) => rows.filter((x) => x.merchantId === merchantId).sort((a, b) => a.sortOrder - b.sortOrder || Number(a.id - b.id));
  const dish = {
    findMany: jest.fn(async ({ where }: any) => ordered(where.merchantId)),
    findFirst: jest.fn(async ({ where }: any) => rows.find((x) => x.id === where.id && x.merchantId === where.merchantId) ?? null),
    count: jest.fn(async ({ where }: any) => rows.filter((x) => x.merchantId === where.merchantId).length),
    aggregate: jest.fn(async ({ where }: any) => ({ _max: { sortOrder: Math.max(-1, ...rows.filter((x) => x.merchantId === where.merchantId).map((x) => x.sortOrder)) } })),
    create: jest.fn(async ({ data }: any) => { const item: Dish = { id: nextId++, createdAt: now, updatedAt: now, isVisible: true, ...data }; rows.push(item); return item; }),
    update: jest.fn(async ({ where, data }: any) => { const item = rows.find((x) => x.id === where.id)!; Object.assign(item, data, { updatedAt: now }); return item; }),
    delete: jest.fn(async ({ where }: any) => { const index = rows.findIndex((x) => x.id === where.id); return rows.splice(index, 1)[0]; }),
  };
  const prisma: any = { merchant: { findUnique: jest.fn(async ({ where }: any) => where.id === 1n || where.id === 2n ? { id: where.id } : null) }, merchantSignatureDish: dish, $transaction: jest.fn(async (cb: any) => cb({ merchantSignatureDish: dish })) };
  return { rows, dish, service: new PlatformMerchantSignatureDishesService(prisma) };
}

describe('PlatformMerchantSignatureDishesService', () => {
  it('requires a Chinese name and image while allowing the optional Vietnamese and English names', async () => {
    const invalid = await validate(plainToInstance(CreateMerchantSignatureDishDto, {}));
    expect(invalid.map((error) => error.property)).toEqual(expect.arrayContaining(['nameZh', 'imageUrl']));

    const valid = plainToInstance(CreateMerchantSignatureDishDto, {
      nameZh: ' 招牌菜 ',
      imageUrl: ' /signature.png ',
    });
    expect(await validate(valid)).toHaveLength(0);
    expect(valid).toMatchObject({ nameZh: '招牌菜', imageUrl: '/signature.png' });
  });

  it('supports a DISPLAY merchant without MerchantStaff and normalizes optional names', async () => {
    const { service } = fixture();
    const item = await service.create(1n, { nameZh: ' 招牌菜 ', imageUrl: ' /a.png ', nameVi: undefined, nameEn: undefined });
    expect(item).toMatchObject({ nameZh: '招牌菜', nameVi: null, nameEn: null, imageUrl: '/a.png', sortOrder: 0 });
  });

  it('enforces all-row 15 limit including hidden rows and releases quota after hard delete', async () => {
    const { service, rows } = fixture();
    for (let i = 0; i < 15; i += 1) await service.create(1n, { nameZh: `菜${i}`, imageUrl: `/a${i}.png` });
    rows[14].isVisible = false;
    await expect(service.create(1n, { nameZh: '第16道', imageUrl: '/16.png' })).rejects.toBeInstanceOf(BadRequestException);
    const deletedId = rows[0].id;
    await expect(service.remove(1n, deletedId)).resolves.toEqual({ id: deletedId.toString(), deleted: true });
    expect(rows).toHaveLength(14);
    await expect(service.create(1n, { nameZh: '新第15道', imageUrl: '/new.png' })).resolves.toMatchObject({ nameZh: '新第15道' });
    expect(rows).toHaveLength(15);
  });

  it('lists hidden rows, hides/restores, moves adjacent rows, and protects merchant ownership', async () => {
    const { service, rows } = fixture();
    const a = await service.create(1n, { nameZh: 'A', imageUrl: '/a.png' });
    const b = await service.create(1n, { nameZh: 'B', imageUrl: '/b.png' });
    const c = await service.create(1n, { nameZh: 'C', imageUrl: '/c.png' });
    await service.update(1n, BigInt(b.id), { isVisible: false, nameEn: '' });
    expect((await service.list(1n)).items).toHaveLength(3);
    await service.move(1n, BigInt(b.id), { direction: 'UP' });
    expect(rows.find((x) => x.id === BigInt(b.id))?.sortOrder).toBe(0);
    await service.move(1n, BigInt(b.id), { direction: 'DOWN' });
    await expect(service.move(1n, BigInt(a.id), { direction: 'UP' })).resolves.toBeDefined();
    await expect(service.move(1n, BigInt(c.id), { direction: 'DOWN' })).resolves.toBeDefined();
    await expect(service.update(2n, BigInt(a.id), { nameZh: 'bad' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(2n, BigInt(a.id))).rejects.toBeInstanceOf(NotFoundException);
    await service.update(1n, BigInt(b.id), { isVisible: true });
    expect(rows.find((x) => x.id === BigInt(b.id))?.isVisible).toBe(true);
  });
});
