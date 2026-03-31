import { Injectable } from '@nestjs/common';
import { BarberEmploymentType, PaymentMethod } from '../generated/prisma/enums';

export interface CommissionInput {
  grossAmount: number;
  employmentType: BarberEmploymentType;
  paymentMethod: PaymentMethod;
  service: { id: string; name: string; price: number; durationMin: number };
  staffBarberPercent?: number; // e.g. 60 means barber gets 60% of distributable
}

export interface CommissionResult {
  // V1 backward-compat
  totalAmount: number;
  platformFee: number;
  barberNet: number;
  // V2
  grossAmount: number;
  platformFeePercent: number;
  distributableAmount: number;
  barberAmount: number;
  shopAmount: number;
  netPayoutToBarber: number;
  serviceSnapshot: { id: string; name: string; price: number; durationMin: number };
}

@Injectable()
export class CommissionsService {
  calculate(input: CommissionInput): CommissionResult {
    const { grossAmount, employmentType, paymentMethod, service, staffBarberPercent } = input;

    // Platform fee rate
    let platformFeePercent = 0;
    if (paymentMethod !== PaymentMethod.CASH) {
      platformFeePercent = employmentType === BarberEmploymentType.INDEPENDENT ? 0.15 : 0.10;
    }

    const platformFee = round2(grossAmount * platformFeePercent);
    const distributableAmount = round2(grossAmount - platformFee);

    // Split between barber and shop (only for employees)
    let barberAmount = distributableAmount;
    let shopAmount = 0;

    if (employmentType === BarberEmploymentType.EMPLOYEE && staffBarberPercent != null) {
      barberAmount = round2(distributableAmount * (staffBarberPercent / 100));
      shopAmount = round2(distributableAmount - barberAmount);
    }

    return {
      // V1
      totalAmount: grossAmount,
      platformFee,
      barberNet: barberAmount,
      // V2
      grossAmount,
      platformFeePercent,
      distributableAmount,
      barberAmount,
      shopAmount,
      netPayoutToBarber: barberAmount,
      serviceSnapshot: {
        id: service.id,
        name: service.name,
        price: service.price,
        durationMin: service.durationMin,
      },
    };
  }
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}
