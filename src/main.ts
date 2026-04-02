import { NestFactory } from '@nestjs/core';
import 'dotenv/config';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });
  const bodyLimit = process.env.REQUEST_BODY_LIMIT ?? '2mb';
  app.use(json({ limit: bodyLimit }));
  app.use(
    urlencoded({
      limit: bodyLimit,
      extended: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
void bootstrap();
