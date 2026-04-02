import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  const originalOutboxSetting = process.env.OUTBOX_PROCESSOR_ENABLED;

  beforeEach(async () => {
    process.env.OUTBOX_PROCESSOR_ENABLED = 'false';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();

    if (originalOutboxSetting === undefined) {
      delete process.env.OUTBOX_PROCESSOR_ENABLED;
      return;
    }

    process.env.OUTBOX_PROCESSOR_ENABLED = originalOutboxSetting;
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
