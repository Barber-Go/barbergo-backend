import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHealth(): object {
    return this.appService.getHealth();
  }

  // TODO(0.5): BORRAR este endpoint después de verificar que Sentry captura errores en prod.
  // Tracked: Biblia Bloque 0.5, paso de validación final.
  @Get('test-sentry-error')
  triggerSentryTestError(): void {
    throw new Error('Sentry test error - delete this endpoint after verification');
  }
}
