import { Module } from '@nestjs/common';
import { BarberEmployeeController } from './barber-employee.controller';
import { BarberEmployeeService } from './barber-employee.service';

@Module({
  controllers: [BarberEmployeeController],
  providers: [BarberEmployeeService],
})
export class BarberEmployeeModule {}
