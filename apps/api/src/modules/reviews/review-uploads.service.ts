import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readdir,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../../database/prisma.service';
import {
  createReviewImageVariants,
  createReviewThumbnail,
  reviewThumbnailFileName,
} from './review-image';
import { assertReviewEligible } from './review-policy';

export type ReviewUpload = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size?: number;
};

const MAX_REVIEW_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_REVIEW_IMAGES = 6;
const STAGING_TTL_MS = 24 * 60 * 60 * 1000;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const IMAGE_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_TOKEN_FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;

export type PreparedReviewImages = {
  urls: string[];
  finalPaths: string[];
  stagingDir: string | null;
};

@Injectable()
export class ReviewUploadsService implements OnModuleInit {
  private readonly logger = new Logger(ReviewUploadsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.cleanupExpiredStaging();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredStaging() {
    try {
      await this.removeExpiredTree(this.stagingRoot(), Date.now());
    } catch (error) {
      this.logger.warn(
        `Review staging cleanup failed error=${error instanceof Error ? error.name : 'UNKNOWN'}`,
      );
    }
  }

  async stage(userId: bigint, orderId: bigint, file: ReviewUpload) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: {
        status: true,
        completedAt: true,
        voidedAt: true,
        review: { select: { id: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    assertReviewEligible(order);

    return this.stageFile(this.stagingDir(userId, orderId.toString()), file);
  }

  async stageDirect(userId: bigint, merchantId: bigint, file: ReviewUpload) {
    const [merchant, existingReview] = await Promise.all([
      this.prisma.merchant.findFirst({
        where: {
          id: merchantId,
          status: 'ACTIVE',
          isVisibleOnClient: true,
        },
        select: { id: true },
      }),
      this.prisma.merchantReview.findUnique({
        where: { directReviewKey: this.directReviewKey(userId, merchantId) },
        select: { id: true },
      }),
    ]);
    if (!merchant) throw new NotFoundException('Merchant not found or unavailable');
    if (existingReview) throw new BadRequestException('你已经直接评价过这家商家');

    return this.stageFile(this.directStagingDir(userId, merchantId), file);
  }

  private async stageFile(targetDir: string, file: ReviewUpload) {
    const size = file.size ?? file.buffer.byteLength;
    if (size > MAX_REVIEW_IMAGE_SIZE) {
      throw new BadRequestException('评价图片不能超过 5MB');
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('仅支持 JPG、PNG 或 WebP 图片');
    }

    await mkdir(targetDir, { recursive: true });
    await this.removeExpiredStagingFiles(targetDir);
    const stagedFiles = (await readdir(targetDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && IMAGE_TOKEN_FILE_PATTERN.test(entry.name));
    if (stagedFiles.length >= MAX_REVIEW_IMAGES) {
      throw new BadRequestException('每条评价最多上传 6 张图片');
    }

    let variants: Awaited<ReturnType<typeof createReviewImageVariants>>;
    try {
      variants = await createReviewImageVariants(file.buffer);
    } catch {
      throw new BadRequestException('图片无法识别，请重新选择');
    }

    const token = randomUUID();
    const stagedPath = join(targetDir, `${token}.webp`);
    const stagedThumbnailPath = join(targetDir, `${token}-thumb.webp`);
    const writes = await Promise.allSettled([
      writeFile(stagedPath, variants.full),
      writeFile(stagedThumbnailPath, variants.thumbnail),
    ]);
    if (writes.some((result) => result.status === 'rejected')) {
      await Promise.all([
        rm(stagedPath, { force: true }).catch(() => undefined),
        rm(stagedThumbnailPath, { force: true }).catch(() => undefined),
      ]);
      throw new BadRequestException('评价图片保存失败，请重新选择');
    }
    return { token };
  }

  async prepare(userId: bigint, orderId: bigint, rawTokens: string[]) {
    return this.prepareFromDirectory(
      this.stagingDir(userId, orderId.toString()),
      rawTokens,
    );
  }

  async prepareDirect(userId: bigint, merchantId: bigint, rawTokens: string[]) {
    return this.prepareFromDirectory(
      this.directStagingDir(userId, merchantId),
      rawTokens,
    );
  }

  private async prepareFromDirectory(stagingDir: string, rawTokens: string[]) {
    if (!rawTokens.length) {
      return { urls: [], finalPaths: [], stagingDir: null } satisfies PreparedReviewImages;
    }
    const tokens = rawTokens.map((token) => token.trim());
    if (
      tokens.length > MAX_REVIEW_IMAGES
      || new Set(tokens).size !== tokens.length
      || tokens.some((token) => !IMAGE_TOKEN_PATTERN.test(token))
    ) {
      throw new BadRequestException('评价图片凭证无效');
    }

    const finalDir = join(process.cwd(), 'public', 'uploads', 'reviews');
    await mkdir(finalDir, { recursive: true });
    const prepared: PreparedReviewImages = { urls: [], finalPaths: [], stagingDir };

    try {
      for (const token of tokens) {
        const stagedPath = join(stagingDir, `${token}.webp`);
        const stagedFile = await stat(stagedPath);
        if (!stagedFile.isFile()) throw new Error('not a file');
        const stagedThumbnailPath = join(stagingDir, `${token}-thumb.webp`);
        const stagedThumbnail = await stat(stagedThumbnailPath).catch(() => null);

        const fileName = `review-${randomUUID()}.webp`;
        const thumbnailFileName = reviewThumbnailFileName(fileName);
        const finalPath = join(finalDir, fileName);
        const finalThumbnailPath = join(finalDir, thumbnailFileName);
        prepared.finalPaths.push(finalPath, finalThumbnailPath);
        await copyFile(stagedPath, finalPath);
        if (stagedThumbnail?.isFile()) {
          await copyFile(stagedThumbnailPath, finalThumbnailPath);
        } else {
          await writeFile(finalThumbnailPath, await createReviewThumbnail(stagedPath));
        }
        prepared.urls.push(`/uploads/reviews/${fileName}`);
      }
      return prepared;
    } catch {
      await this.rollback(prepared);
      throw new BadRequestException('评价图片凭证无效，请重新选择图片');
    }
  }

  async commit(prepared: PreparedReviewImages) {
    if (!prepared.stagingDir) return;
    await rm(prepared.stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }

  async rollback(prepared: PreparedReviewImages) {
    await Promise.all(
      prepared.finalPaths.map((path) => rm(path, { force: true }).catch(() => undefined)),
    );
  }

  private stagingDir(userId: bigint, contextKey: string) {
    return join(
      this.stagingRoot(),
      userId.toString(),
      contextKey,
    );
  }

  private directStagingDir(userId: bigint, merchantId: bigint) {
    return this.stagingDir(userId, `merchant-${merchantId.toString()}`);
  }

  private directReviewKey(userId: bigint, merchantId: bigint) {
    return `${userId.toString()}:${merchantId.toString()}`;
  }

  private stagingRoot() {
    return join(process.cwd(), '.review-upload-staging');
  }

  private async removeExpiredStagingFiles(targetDir: string) {
    const entries = await readdir(targetDir, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile()) return;
      const path = join(targetDir, entry.name);
      const metadata = await stat(path).catch(() => null);
      if (!metadata || Date.now() - metadata.mtimeMs > STAGING_TTL_MS) {
        await rm(path, { force: true });
      }
    }));
  }

  private async removeExpiredTree(directory: string, now: number, removeDirectory = false) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.removeExpiredTree(path, now, true);
        return;
      }
      const metadata = await stat(path).catch(() => null);
      if (!metadata || now - metadata.mtimeMs > STAGING_TTL_MS) {
        await rm(path, { force: true });
      }
    }));
    if (removeDirectory) await rmdir(directory).catch(() => undefined);
  }
}
