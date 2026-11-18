import { SmartCalculatorService } from './smart-calculator.service';

const calc = new SmartCalculatorService();
const member = (memberId: string, role: 'LEADER' | 'MEMBER', price: number) => ({
  memberId,
  role,
  items: [{ unitPrice: price, quantity: 1 }],
});

describe('SmartCalculatorService', () => {
  it.each(['EQUAL', 'PROPORTIONAL', 'HYBRID'] as const)('ΣR = 1 và Leader trả đúng 80%% tỷ trọng gốc (%s)', (mode) => {
    const members = [
      { id: 'L', role: 'LEADER' as const, subtotal: 50000 },
      { id: 'A', role: 'MEMBER' as const, subtotal: 120000 },
      { id: 'B', role: 'MEMBER' as const, subtotal: 30000 },
    ];
    const total = 200000;
    const base = mode === 'EQUAL' ? 1 / 3 : mode === 'PROPORTIONAL' ? 50000 / total : 0.3 / 3 + 0.7 * (50000 / total);
    const r = calc.shippingRatios(mode, members);
    expect(r.reduce((s, x) => s + x.ratio, 0)).toBeCloseTo(1, 12);
    expect(r.find((x) => x.id === 'L')!.ratio).toBeCloseTo(0.8 * base, 12);
  });

  it('Largest Remainder: tổng ship chia khớp từng đồng', () => {
    const out = calc.calculateCartSplit(
      30001,
      0,
      [member('L', 'LEADER', 33333), member('A', 'MEMBER', 77777), member('B', 'MEMBER', 11111)],
      'HYBRID',
    );
    expect(out.members.reduce((s, m) => s + m.shippingShare, 0)).toBe(30001);
    expect(out.members.reduce((s, m) => s + m.finalPayable, 0)).toBe(
      out.totalMerchandiseValue + 30001 - out.autoAppliedDiscount,
    );
  });

  it('Chỉ một người: không áp giảm Leader', () => {
    const out = calc.calculateCartSplit(30000, 0, [member('L', 'LEADER', 50000)], 'EQUAL');
    expect(out.members[0].shippingShare).toBe(30000);
  });
});
