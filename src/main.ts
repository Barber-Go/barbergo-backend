import './instrument';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { validateEnv } from './shared/env.validation';

async function bootstrap() {
  // Primera línea ejecutable: validar env antes de levantar el contenedor Nest.
  // Si falla, validateEnv hace process.exit(1) por sí solo; no capturamos el error.
  validateEnv(process.env);

  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`BarberGo API running on http://localhost:${port}/api`);
}

bootstrap();
