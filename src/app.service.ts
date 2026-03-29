import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth(): object {
    return { status: 'ok', app: 'BarberGo API', version: '1.0.0' };
  }
}
