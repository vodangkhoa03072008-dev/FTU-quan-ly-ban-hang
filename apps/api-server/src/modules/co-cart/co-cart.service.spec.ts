import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CoCartService } from './co-cart.service';

const future = () => new Date(Date.now() + 10 * 60_000);

/** Prisma giả tối thiểu: transaction chạy callback với chính đối tượng giả. */
function makePrisma(cart: any) {
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u' }) },
    coCart: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(cart)),
      findUniqueOrThrow: jest.fn().mockImplementation(() => Promise.resolve(cart)),
      update: jest.fn().mockResolvedValue({}),
    },
    cartMember: {
      create: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    joinRequest: {
      deleteMany: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  tx.$transaction = (fn: any) => fn(tx);
  return tx;
}

function makeService(cart: any) {
  const prisma = makePrisma(cart);
  const svc = new CoCartService(prisma, {} as any);
  jest.spyOn(svc, 'getCartState').mockResolvedValue({ cart: { joinCode: 'ABC123' } } as any);
  return { svc, prisma };
}

const baseCart = (over: any = {}) => ({
  id: 'c1',
  joinCode: 'ABC123',
  isPublic: true,
  requireApproval: false,
  status: 'OPEN',
  maxMembers: 3,
  expiresAt: future(),
  members: [{ id: 'm1', userId: 'leader', role: 'LEADER', aliasName: 'A', isPaid: false }],
  ...over,
});

describe('CoCartService.joinPublic', () => {
  it('bắt buộc xác nhận đồng ý trước khi tham gia với người lạ', async () => {
    const { svc, prisma } = makeService(baseCart());
    await expect(svc.joinPublic('u', 'c1', false)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.cartMember.create).not.toHaveBeenCalled();
  });

  it('không cho vào nhóm riêng tư qua Radar', async () => {
    const { svc } = makeService(baseCart({ isPublic: false }));
    await expect(svc.joinPublic('u', 'c1', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tạo CartMember khi đồng ý, dưới khóa advisory theo giỏ', async () => {
    const { svc, prisma } = makeService(baseCart());
    const r = await svc.joinPublic('u', 'c1', true);
    expect(r.pending).toBe(false);
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.cartMember.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cartId: 'c1', userId: 'u', role: 'MEMBER' }) }),
    );
  });

  it('không cho tham gia nhóm đã đầy', async () => {
    const members = ['a', 'b', 'c'].map((userId, i) => ({ id: `m${i}`, userId, aliasName: userId }));
    const { svc, prisma } = makeService(baseCart({ members }));
    await expect(svc.joinPublic('u', 'c1', true)).rejects.toThrow('đủ số thành viên');
    expect(prisma.cartMember.create).not.toHaveBeenCalled();
  });

  it('không cho nhóm hết hạn', async () => {
    const { svc } = makeService(baseCart({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(svc.joinPublic('u', 'c1', true)).rejects.toThrow('hết hạn');
  });

  it('một tài khoản không tham gia hai lần', async () => {
    const { svc, prisma } = makeService(baseCart({ members: [{ id: 'm1', userId: 'u', aliasName: 'A' }] }));
    await svc.joinPublic('u', 'c1', true);
    expect(prisma.cartMember.create).not.toHaveBeenCalled();
  });

  it('nhóm cần duyệt → tạo yêu cầu chờ, chưa thành thành viên', async () => {
    const { svc, prisma } = makeService(baseCart({ requireApproval: true }));
    const r = await svc.joinPublic('u', 'c1', true);
    expect(r.pending).toBe(true);
    expect(prisma.joinRequest.upsert).toHaveBeenCalled();
    expect(prisma.cartMember.create).not.toHaveBeenCalled();
  });
});

describe('CoCartService.joinByCode (mã mời cũ vẫn hoạt động)', () => {
  it('vào nhóm riêng tư bằng mã', async () => {
    const { svc, prisma } = makeService(baseCart({ isPublic: false }));
    await svc.joinByCode('u', ' abc123 ');
    expect(prisma.coCart.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { joinCode: 'ABC123' } }));
    expect(prisma.cartMember.create).toHaveBeenCalled();
  });
});

describe('CoCartService.leaveCart', () => {
  it('thành viên rời nhóm khi còn OPEN', async () => {
    const members = [
      { id: 'm1', userId: 'leader', role: 'LEADER', isPaid: false },
      { id: 'm2', userId: 'u', role: 'MEMBER', isPaid: false },
    ];
    const { svc, prisma } = makeService(baseCart({ members }));
    const r = await svc.leaveCart('u', 'c1');
    expect(prisma.cartMember.delete).toHaveBeenCalledWith({ where: { id: 'm2' } });
    expect(r.cancelled).toBe(false);
  });

  it('Trưởng nhóm rời → đôn người vào sớm nhất', async () => {
    const members = [
      { id: 'm1', userId: 'leader', role: 'LEADER', isPaid: false },
      { id: 'm2', userId: 'u', role: 'MEMBER', isPaid: false },
    ];
    const { svc, prisma } = makeService(baseCart({ members }));
    await svc.leaveCart('leader', 'c1');
    expect(prisma.cartMember.update).toHaveBeenCalledWith({ where: { id: 'm2' }, data: { role: 'LEADER' } });
  });

  it('không cho rời khi đã thanh toán hoặc đã chốt', async () => {
    const paid = makeService(baseCart({ members: [{ id: 'm2', userId: 'u', role: 'MEMBER', isPaid: true }] }));
    await expect(paid.svc.leaveCart('u', 'c1')).rejects.toBeInstanceOf(BadRequestException);
    const locked = makeService(baseCart({ status: 'LOCKED', members: [{ id: 'm2', userId: 'u', isPaid: false }] }));
    await expect(locked.svc.leaveCart('u', 'c1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('người ngoài nhóm không rời được', async () => {
    const { svc } = makeService(baseCart());
    await expect(svc.leaveCart('stranger', 'c1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
