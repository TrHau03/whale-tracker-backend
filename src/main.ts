import { NestFactory } from '@nestjs/core';
import 'dotenv/config';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';
import { Request } from 'express';

type RequestWithRawBody = Request & { rawBody?: string };

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });
  const bodyLimit = process.env.REQUEST_BODY_LIMIT ?? '2mb';
  app.use(
    json({
      limit: bodyLimit,
      verify: (req, _res, buf) => {
        (req as RequestWithRawBody).rawBody = buf.toString('utf8');
      },
    }),
  );
  app.use(
    urlencoded({
      limit: bodyLimit,
      extended: true,
      verify: (req, _res, buf) => {
        (req as RequestWithRawBody).rawBody = buf.toString('utf8');
      },
    }),
  );
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
void bootstrap();
