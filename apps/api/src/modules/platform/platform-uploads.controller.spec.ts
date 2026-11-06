import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PlatformAdminGuard } from "../../common/guards/platform-admin.guard";
import { PlatformUploadsController } from "./platform-uploads.controller";
import { PlatformUploadsService } from "./platform-uploads.service";

describe("Platform image multipart boundary", () => {
  let app: INestApplication;
  const saveMerchantImage = jest.fn(async (_file: { buffer: Buffer }) => ({
    imageUrl: "/uploads/test.webp",
  }));

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PlatformUploadsController],
      providers: [
        { provide: PlatformUploadsService, useValue: { saveMerchantImage } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PlatformAdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => app?.close());
  beforeEach(() => saveMerchantImage.mockClear());

  it("passes exactly 20MB through the real multipart parser", async () => {
    await request(app.getHttpServer())
      .post("/platform/uploads/merchant-image")
      .attach("file", Buffer.alloc(20 * 1024 * 1024), {
        filename: "boundary.jpg",
        contentType: "image/jpeg",
      })
      .expect(201);
    expect(saveMerchantImage).toHaveBeenCalledTimes(1);
    expect(saveMerchantImage.mock.calls[0]?.[0]?.buffer.byteLength).toBe(
      20 * 1024 * 1024,
    );
  });

  it("rejects a source one byte over 20MB before processing", async () => {
    await request(app.getHttpServer())
      .post("/platform/uploads/merchant-image")
      .attach("file", Buffer.alloc(20 * 1024 * 1024 + 1), {
        filename: "oversized.jpg",
        contentType: "image/jpeg",
      })
      .expect(413);
    expect(saveMerchantImage).not.toHaveBeenCalled();
  });
});
