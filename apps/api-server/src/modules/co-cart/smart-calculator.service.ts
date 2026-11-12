import { Injectable } from '@nestjs/common';
import { MemberRole, ShippingMode } from '@prisma/client';

export interface MemberCalcInput {
  memberId: string;
  role: MemberRole;
  items: { unitPrice: number; quantity: number }[];
}

export interface MemberCalcOutput {
  memberId: string;
  subtotal: number;
  shippingShare: number;
  discountShare: number;
  finalPayable: number;
  /** Tiết kiệm so với việc tự đặt riêng (trả đủ phí ship gốc, không voucher). */
  savedAmount: number;
}

export interface Suggestion {
  type: 'VOUCHER_TIER' | 'INVITE_MORE';
  text: string;
  /** Gợi ý do quy tắc (rule-based), không phải AI. Luôn để người dùng tự quyết định. */
  source: 'rule-based';
}

export interface CartCalculationSummary {
  totalMerchandiseValue: number;
  baseShippingFee: number;
  autoAppliedDiscount: number;
  /** Số liệu đo lường cho pilot: so với kịch bản mỗi người tự đặt riêng. */
  separateShippingTotal: number;
  shippingSavedAmount: number;
  shippingSavedPercent: number;
  savedTripsCount: number;
  /** ƯỚC TÍNH dựa trên giả định gram CO2/chuyến (CO2_GRAMS_PER_TRIP), không phải số đo thực tế. */
  estimatedCo2SavedGrams: number;
  co2GramsPerTripAssumption: number;
  members: MemberCalcOutput[];
  suggestions: Suggestion[];
}

const TIERS = [
  { min: 120000, off: 10000 },
  { min: 200000, off: 20000 },
  { min: 300000, off: 35000 },
];

@Injectable()
export class SmartCalculatorService {
  private readonly FIXED_WEIGHT = 0.3;
  private readonly PROPORTIONAL_WEIGHT = 0.7;
  private readonly LEADER_DISCOUNT_FACTOR = 0.8;

  private get co2PerTrip() {
    const v = Number(process.env.CO2_GRAMS_PER_TRIP);
    return Number.isFinite(v) && v >= 0 && process.env.CO2_GRAMS_PER_TRIP ? v : 420;
  }

  public computeTieredDiscount(totalMerchandiseValue: number, manualDiscount = 0): number {
    let tier = 0;
    for (const t of TIERS) if (totalMerchandiseValue >= t.min) tier = t.off;
    return Math.max(tier, manualDiscount);
  }

  /** Trọng số chia phí ship cho 1 thành viên theo chế độ của giỏ. */
  private shippingWeight(mode: ShippingMode, role: MemberRole, activeCount: number, valueShare: number) {
    const equal = 1 / activeCount;
    let w: number;
    if (mode === 'EQUAL') w = equal;
    else if (mode === 'PROPORTIONAL') w = valueShare;
    else w = this.FIXED_WEIGHT * equal + this.PROPORTIONAL_WEIGHT * valueShare;
    if (role === MemberRole.LEADER && activeCount > 1) w *= this.LEADER_DISCOUNT_FACTOR;
    return w;
  }

  public calculateCartSplit(
    baseShippingFee: number,
    manualDiscount: number,
    membersInput: MemberCalcInput[],
    mode: ShippingMode = 'HYBRID',
  ): CartCalculationSummary {
    const subtotals = membersInput.map((m) => ({
      memberId: m.memberId,
      role: m.role,
      subtotal: m.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
    }));

    const activeMembers = subtotals.filter((m) => m.subtotal > 0);
    const activeCount = activeMembers.length;
    const total = activeMembers.reduce((sum, m) => sum + m.subtotal, 0);

    const empty = (memberId: string): MemberCalcOutput => ({
      memberId, subtotal: 0, shippingShare: 0, discountShare: 0, finalPayable: 0, savedAmount: 0,
    });

    if (activeCount === 0) {
      return this.finish(baseShippingFee, 0, 0, 0, subtotals.map((m) => empty(m.memberId)));
    }

    const discount = this.computeTieredDiscount(total, manualDiscount);
    const weights = activeMembers.map((m) => ({
      id: m.memberId,
      w: this.shippingWeight(mode, m.role, activeCount, m.subtotal / total),
    }));
    const sumW = weights.reduce((s, x) => s + x.w, 0);

    const shipMap = this.allocateExactInteger(
      baseShippingFee,
      weights.map((x) => ({ id: x.id, ratio: x.w / sumW })),
    );
    const discMap = this.allocateExactInteger(
      discount,
      activeMembers.map((m) => ({ id: m.memberId, ratio: m.subtotal / total })),
    );

    const out = subtotals.map((m): MemberCalcOutput => {
      if (m.subtotal === 0) return empty(m.memberId);
      const ship = shipMap.get(m.memberId) ?? 0;
      const disc = discMap.get(m.memberId) ?? 0;
      return {
        memberId: m.memberId,
        subtotal: m.subtotal,
        shippingShare: ship,
        discountShare: disc,
        finalPayable: Math.max(0, m.subtotal + ship - disc),
        savedAmount: Math.max(0, baseShippingFee - ship + disc),
      };
    });

    return this.finish(baseShippingFee, total, discount, activeCount, out);
  }

  /** Tóm tắt từ số liệu ĐÃ LƯU (không tính lại) — dùng khi giỏ đã khóa/chốt. */
  public summarizeStored(
    baseShippingFee: number,
    members: { id: string; subtotal: number; shippingShare: number; discountShare: number; finalPayable: number }[],
  ): CartCalculationSummary {
    const active = members.filter((m) => m.subtotal > 0);
    return this.finish(
      baseShippingFee,
      active.reduce((s, m) => s + m.subtotal, 0),
      members.reduce((s, m) => s + m.discountShare, 0),
      active.length,
      members.map((m) => ({
        memberId: m.id,
        subtotal: m.subtotal,
        shippingShare: m.shippingShare,
        discountShare: m.discountShare,
        finalPayable: m.finalPayable,
        savedAmount: m.subtotal > 0 ? Math.max(0, baseShippingFee - m.shippingShare + m.discountShare) : 0,
      })),
    );
  }

  private finish(
    baseShippingFee: number,
    total: number,
    discount: number,
    activeCount: number,
    members: MemberCalcOutput[],
  ): CartCalculationSummary {
    const separateShippingTotal = baseShippingFee * activeCount;
    const shippingSavedAmount = Math.max(0, separateShippingTotal - baseShippingFee);
    const trips = Math.max(0, activeCount - 1);
    return {
      totalMerchandiseValue: total,
      baseShippingFee,
      autoAppliedDiscount: discount,
      separateShippingTotal,
      shippingSavedAmount,
      shippingSavedPercent: separateShippingTotal > 0 ? Math.round((shippingSavedAmount / separateShippingTotal) * 100) : 0,
      savedTripsCount: trips,
      estimatedCo2SavedGrams: trips * this.co2PerTrip,
      co2GramsPerTripAssumption: this.co2PerTrip,
      members,
      suggestions: this.buildSuggestions(total, activeCount),
    };
  }

  /** Gợi ý dựa trên quy tắc đơn giản (không dùng AI). Chỉ dùng số liệu tổng hợp, không có dữ liệu cá nhân. */
  public buildSuggestions(total: number, activeCount: number): Suggestion[] {
    const out: Suggestion[] = [];
    const next = TIERS.find((t) => total < t.min);
    if (total > 0 && next) {
      out.push({
        type: 'VOUCHER_TIER',
        source: 'rule-based',
        text: `Thêm ${(next.min - total).toLocaleString('vi-VN')}₫ hàng nữa để mở khóa voucher −${next.off.toLocaleString('vi-VN')}₫.`,
      });
    }
    if (activeCount === 1) {
      out.push({
        type: 'INVITE_MORE',
        source: 'rule-based',
        text: 'Mời thêm người cùng điểm nhận hàng bằng mã giỏ để chia phí ship.',
      });
    }
    return out;
  }

  /** Largest Remainder Method: tổng các phần chia luôn bằng đúng totalAmount (từng đồng). */
  private allocateExactInteger(totalAmount: number, shares: { id: string; ratio: number }[]): Map<string, number> {
    if (totalAmount <= 0 || shares.length === 0) return new Map();
    const quotas = shares.map((s) => {
      const exact = totalAmount * s.ratio;
      const floored = Math.floor(exact);
      return { id: s.id, floored, remainder: exact - floored };
    });
    const remainderUnits = totalAmount - quotas.reduce((sum, q) => sum + q.floored, 0);
    quotas.sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < remainderUnits; i++) quotas[i % quotas.length].floored += 1;
    return new Map(quotas.map((q) => [q.id, q.floored]));
  }
}
