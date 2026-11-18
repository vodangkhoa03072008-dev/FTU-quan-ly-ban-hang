'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { io, Socket } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import {
  ShieldCheck, Leaf, ShoppingBag, QrCode, Send, Flame, CheckCircle2, ScanLine, Users, Sparkles, CreditCard,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  API_URL, DEMO_USERS, SESSION_USER, formatVND, authedPost, getDemoUser, getSession, maskPhone, setDemoUser, tokenFor,
} from '../../../lib/api';

const TIERS = [
  { min: 120000, off: 10000 },
  { min: 200000, off: 20000 },
  { min: 300000, off: 35000 },
];
const REDIRECT_SECONDS = 8;
const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

const MODE_LABEL: Record<string, string> = {
  HYBRID: 'Kết hợp (30% đều + 70% theo giá trị)',
  EQUAL: 'Chia đều',
  PROPORTIONAL: 'Chia theo tỷ lệ',
};

export default function CoCartRoomPage() {
  const socketRef = useRef<Socket | null>(null);
  // Mã giỏ đang tham gia: khi đổi nhân vật sandbox, người khác sẽ vào lại giỏ này bằng mã.
  const codeRef = useRef<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [leftNotice, setLeftNotice] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [cartState, setCartState] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [menu, setMenu] = useState<any[]>([]);
  const [myMemberId, setMyMemberId] = useState<string | null>(null);
  const [hubName, setHubName] = useState('');
  const [merchantName, setMerchantName] = useState('');

  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatDestroyedNotice, setChatDestroyedNotice] = useState<string | null>(null);

  const [vietQrInfo, setVietQrInfo] = useState<any>(null);
  const [myQrData, setMyQrData] = useState<any>(null);
  const [scanTokenInput, setScanTokenInput] = useState('');
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrCopyMessage, setQrCopyMessage] = useState('');
  const [verifyingQr, setVerifyingQr] = useState(false);
  const verifyBusyRef = useRef(false);
  const qrInputRef = useRef<HTMLInputElement>(null);
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const router = useRouter();
  const [now, setNow] = useState(Date.now());
  const [showPayload, setShowPayload] = useState(false);
  const [showSlip, setShowSlip] = useState(false);
  const [redirectIn, setRedirectIn] = useState(REDIRECT_SECONDS);
  const [redirectPaused, setRedirectPaused] = useState(false);

  // 1) Đăng nhập demo → JWT. 2) Kết nối Socket.IO bằng JWT (server lấy danh tính từ token).
  useEffect(() => setUserId(getDemoUser()), []);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let socket: Socket | null = null;

    (async () => {
      try {
        const jwt = await tokenFor(userId);
        if (cancelled) return;
        setToken(jwt);

        const params = new URLSearchParams(window.location.search);
        const pathCode = decodeURIComponent(window.location.pathname.split('/').pop() || '');
        if (!codeRef.current && pathCode && pathCode !== 'new') codeRef.current = pathCode;

        socket = io(`${API_URL}/co-cart`, { transports: ['websocket'], auth: { token: jwt } });
        socketRef.current = socket;

        const onEntered = (res: any) => {
          if (res?.error) return setErrorMsg(res.error);
          codeRef.current = res.cart.joinCode;
          window.history.replaceState(null, '', `/cart/${res.cart.joinCode}`);
          setCartState(res.cart);
          setSummary(res.summary);
          setMenu(res.menuProducts || []);
          setMyMemberId(res.myMemberId);
          setHubName(res.hubName);
          setMerchantName(res.merchantName);
          setMessages(res.chatHistory || []);
          setRequests(res.pendingRequests || []);
          setChatDestroyedNotice(null);
        };
        const num = (k: string) => (params.get(k) ? Number(params.get(k)) : undefined);

        socket.on('connect', () => {
          if (codeRef.current) {
            socket!.emit('cart:join_room', { code: codeRef.current }, onEntered);
          } else {
            socket!.emit(
              'cart:create',
              {
                hubId: params.get('hub'),
                merchantId: params.get('merchant'),
                shippingMode: params.get('mode') || 'HYBRID',
                isPublic: params.get('public') === '1',
                requireApproval: params.get('approval') === '1',
                maxMembers: num('max'),
                windowMinutes: num('window'),
                pickupLabel: params.get('label') || undefined,
                rules: params.get('rules') || undefined,
                pickupLat: num('lat'),
                pickupLng: num('lng'),
              },
              onEntered,
            );
          }
        });
        socket.on('connect_error', () => setErrorMsg('Không kết nối được máy chủ real-time.'));
        socket.on('exception', (e: any) => setErrorMsg(e?.message || 'Lỗi xác thực WebSocket.'));
        socket.on('cart:state_updated', (data: any) => {
          setCartState(data.cart);
          setSummary(data.summary);
        });
        socket.on('cart:join_requests', (d: any) => setRequests(d.requests || []));
        socket.on('cart:removed', () => {
          setCartState(null);
          setLeftNotice('Bạn không còn là thành viên của nhóm này.');
        });
        socket.on('chat:message', (msg: any) => setMessages((prev) => [...prev, msg]));
        socket.on('chat:auto_destructed', (payload: any) => {
          setMessages([]);
          setChatDestroyedNotice(payload.message);
        });
      } catch (err: any) {
        setErrorMsg(err.message);
      }
    })();

    return () => {
      cancelled = true;
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [userId]);

  const me = cartState?.members?.find((m: any) => m.id === myMemberId);
  const locked = cartState?.status !== 'OPEN';
  const session = userId === SESSION_USER ? getSession() : null;

  // Đồng hồ đếm ngược đóng giỏ (server sweep() chạy mỗi 30 s khi hết giờ).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secondsLeft = cartState ? Math.max(0, Math.floor((new Date(cartState.expiresAt).getTime() - now) / 1000)) : 0;

  // Biên lai COMPLETED: tự quay về Trang chính sau 8 giây (có thể tạm dừng).
  const completed = cartState?.status === 'COMPLETED' && !!me && me.subtotal > 0;
  const goHome = () => router.push('/?tab=history');
  useEffect(() => {
    if (!completed || redirectPaused) return;
    if (redirectIn <= 0) return goHome();
    const t = setTimeout(() => setRedirectIn((x) => x - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed, redirectPaused, redirectIn]);

  // AI Cart Matching Assistant: chỉ dùng số liệu tổng hợp (Zero-PII).
  const activeCount = cartState?.members?.filter((m: any) => m.subtotal > 0).length || 0;
  const currentTotal = summary?.totalMerchandiseValue || 0;
  const nextTier = TIERS.find((t) => currentTotal < t.min);
  const gap = nextTier ? nextTier.min - currentTotal : 0;
  const addOn = gap > 0 ? [...menu].sort((a, b) => a.price - b.price).find((p) => p.price >= gap) : null;
  const hour = new Date(now).getHours();
  const peak = (hour >= 11 && hour < 13) || (hour >= 17 && hour < 20);
  const aiPayload = {
    hubZone: cartState?.hubId,
    storeId: cartState?.merchantId,
    currentTotal,
    activeMembersCount: activeCount,
    nextVoucherGap: gap,
    hourBucket: hour,
    piiIncluded: false,
  };

  // Phiếu đóng gói cho Cửa hàng / Điểm tập kết: tổng món + tem alias·4 ký tự cuối mã đơn.
  const packTotals = new Map<string, number>();
  cartState?.members?.forEach((m: any) =>
    m.items?.forEach((i: any) => packTotals.set(i.productName, (packTotals.get(i.productName) || 0) + i.quantity)),
  );
  const tag = (m: any) => `${m.aliasName} · #${m.id.replace(/-/g, '').slice(-4).toUpperCase()}`;

  // Tổng kết phiên: S = C_individual − C_group.
  const activeMembers = cartState?.members?.filter((m: any) => m.subtotal > 0) || [];
  const cIndividual = activeMembers.reduce((s: number, m: any) => s + m.subtotal + (cartState?.baseShippingFee || 0), 0);
  const cGroup = activeMembers.reduce((s: number, m: any) => s + m.finalPayable, 0);

  const emit = (event: string, payload: object) =>
    new Promise<any>((resolve) => socketRef.current?.emit(event, payload, resolve));

  const switchUser = (uid: string) => {
    setCartState(null);
    setSummary(null);
    setMyQrData(null);
    setQrError(null);
    setQrCopyMessage('');
    setScanTokenInput('');
    setVietQrInfo(null);
    setVerifyResult(null);
    setErrorMsg(null);
    setMyMemberId(null);
    setToken(null);
    setRequests([]);
    setLeftNotice(null);
    setDemoUser(uid);
    setUserId(uid);
  };

  const handleLeave = async () => {
    if (!cartState || !confirm('Rời nhóm này? Món bạn đã chọn sẽ bị xóa.')) return;
    const res = await emit('cart:leave', { cartId: cartState.id });
    if (res?.error) return setErrorMsg(res.error);
    window.location.href = '/';
  };

  const handleReview = async (requestId: string, approve: boolean) => {
    if (!cartState) return;
    const res = await emit('cart:review_request', { cartId: cartState.id, requestId, approve });
    setErrorMsg(res?.error || null);
  };

  const handleAdjustQuantity = async (productId: string, delta: number) => {
    if (!cartState || !me) return;
    const existing = me.items?.find((i: any) => i.productId === productId);
    const quantity = Math.max(0, (existing?.quantity || 0) + delta);
    const res = await emit('cart:update_item', { cartId: cartState.id, productId, quantity });
    setErrorMsg(res?.error || null);
  };

  const handleOpenVietQr = async () => {
    setErrorMsg(null);
    try {
      setVietQrInfo(await authedPost('/api/payment/vietqr', token!, { cartId: cartState.id }));
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleConfirmPayment = async () => {
    if (!cartState) return;
    const res = await emit('cart:pay', { cartId: cartState.id });
    setErrorMsg(res?.error || null);
    if (!res?.error) setVietQrInfo(null);
  };

  const handleCloseCart = async () => {
    if (!cartState) return;
    const res = await emit('cart:close', { cartId: cartState.id });
    setErrorMsg(res?.error || null);
  };

  const copyCode = async () => {
    await navigator.clipboard?.writeText(cartState.joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cartState || chatDestroyedNotice || !chatInput.trim()) return;
    const res = await emit('chat:send', { cartId: cartState.id, text: chatInput });
    if (res?.error) setErrorMsg(res.error);
    else setChatInput('');
  };

  const handleGenerateQr = async () => {
    setErrorMsg(null);
    setQrCopyMessage('');
    try {
      setMyQrData(await authedPost('/api/co-cart/qr/generate', token!, { cartId: cartState.id }));
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const copyQrToken = async () => {
    try {
      await navigator.clipboard.writeText(myQrData.qrToken);
      setQrCopyMessage('Đã sao chép mã nhận hàng.');
    } catch {
      setQrCopyMessage('Không sao chép tự động được. Hãy chọn toàn bộ mã phía trên để sao chép.');
    }
  };

  const handleLeaderVerifyQr = async () => {
    if (verifyBusyRef.current) return;
    setQrError(null);
    setVerifyResult(null);
    if (!scanTokenInput.trim()) {
      setQrError('Bạn hãy dán mã nhận hàng của thành viên trước nhé.');
      qrInputRef.current?.focus();
      return;
    }
    if (!token) {
      setQrError('Chưa kết nối được tài khoản. Bạn thử lại sau nhé.');
      return;
    }
    verifyBusyRef.current = true;
    setVerifyingQr(true);
    try {
      setVerifyResult(await authedPost('/api/co-cart/qr/verify-claim', token, { qrToken: scanTokenInput.trim() }));
    } catch (err: any) {
      setQrError(err.message || 'Chưa xác nhận được mã. Bạn thử lại nhé.');
    } finally {
      verifyBusyRef.current = false;
      setVerifyingQr(false);
    }
  };

  return (
    <div className="min-h-screen [&_button]:min-h-11 [&_button:disabled]:cursor-not-allowed [&_:focus-visible]:outline [&_:focus-visible]:outline-2 [&_:focus-visible]:outline-offset-2 [&_:focus-visible]:outline-[#2F855A] bg-[#FFF8F0] text-[#25312B] p-4 md:p-8 font-sans">
      <header className="max-w-7xl mx-auto mb-6 flex flex-wrap items-center justify-between gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <Link href="/" className="inline-flex items-center gap-2 text-2xl font-extrabold text-[#2F855A]"><img src="/logo.jpg" alt="" className="w-12 h-12 rounded-xl" /> Co-Cart</Link>
        <Link href="/" className="rounded-xl border border-[#D8D1C7] bg-white px-4 py-3 text-sm font-semibold">← Tiếp tục tìm nhóm</Link>
      </header>
      <div className="max-w-7xl mx-auto mb-6 bg-white border border-[#CDE2D3] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-[#2F855A]" />
          <div>
            <p className="text-sm font-semibold text-[#2F855A]">CÙNG MUA SẮM, CÙNG TIẾT KIỆM</p>
            <p className="text-xs text-[#626860]">
              Chế độ dùng thử: đổi tài khoản mẫu để trải nghiệm mua chung bằng biệt danh.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {getSession() && (
            <button
              disabled={verifyingQr || userId === SESSION_USER}
              onClick={() => switchUser(SESSION_USER)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${userId === SESSION_USER ? 'bg-[#F9734B] text-[#25312B]' : 'bg-[#F3EEE8] text-[#626860]'}`}
            >
              Tài khoản của tôi
            </button>
          )}
          {DEMO_USERS.map((uid, idx) => (
            <button
              key={uid}
              disabled={verifyingQr || userId === uid}
              onClick={() => switchUser(uid)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                userId === uid
                  ? 'bg-[#F9734B] text-[#25312B] shadow-lg shadow-orange-200/40'
                  : 'bg-[#F3EEE8] text-[#626860] hover:bg-[#E8E2D9]'
              }`}
            >
              Sinh viên #{idx + 1}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto mb-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-[#E8E2D9] rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#EAF4ED] text-[#2F855A] border border-[#CDE2D3] mb-3">
              <Sparkles className="w-3.5 h-3.5" /> Trạm giao nhận: {hubName || '...'}
            </span>
            <h1 className="text-2xl font-bold text-[#25312B]">{merchantName || 'Đang kết nối...'}</h1>
            {cartState && (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[#626860]">
                <span>
                  Mã tham gia:{' '}
                  <strong className="tracking-widest text-lg text-[#2F855A]">{cartState.joinCode}</strong>
                </span>
                <button onClick={copyCode} className="px-2.5 py-1 rounded bg-[#F3EEE8] hover:bg-[#E8E2D9]">
                  {copied ? 'Đã chép ✓' : 'Sao chép'}
                </button>
                <span className="text-[#626860]">
                  Cách chia ship: {MODE_LABEL[cartState.shippingMode] || cartState.shippingMode}
                  {cartState.isPublic ? ' · công khai trên Radar' : ' · riêng tư (chỉ mã mời)'}
                  {cartState.requireApproval ? ' · cần duyệt' : ''} · tối đa {cartState.maxMembers} người
                </span>
              </div>
            )}
            {cartState?.pickupLabel && <p className="mt-2 text-xs text-[#626860]">📍 Điểm nhận chung: <b>{cartState.pickupLabel}</b></p>}
            {cartState?.rules && <p className="mt-1 text-xs text-[#626860]">📋 Quy định: {cartState.rules}</p>}
            {leftNotice && <p className="mt-2 text-xs text-[#8A4B10]">{leftNotice}</p>}
          </div>
          {me && (
            <div className="mt-4 pt-4 border-t border-[#E8E2D9] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-[#25312B]"
                  style={{ backgroundColor: me.avatarColor }}
                >
                  {me.aliasName.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  {session && (
                    <p className="text-xs text-[#626860]">
                      🔒 Hồ sơ thật (Đã ẩn với nhóm): <b>{session.profile.fullName} · {maskPhone(session.profile.phoneNumber)}</b>
                    </p>
                  )}
                  <p className="text-xs text-[#626860]">🎭 Định danh ẩn danh trong giỏ:</p>
                  <p className="text-sm font-bold text-[#25312B]">
                    {me.aliasName}{' '}
                    <span className="text-xs font-normal px-2 py-0.5 rounded bg-[#F3EEE8] text-[#2F855A] ml-1">
                      {me.role === 'LEADER' ? 'Trưởng nhóm' : 'Thành viên'}
                    </span>
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-[#626860]">Trạng thái giỏ hàng</p>
                <span className="text-sm font-bold text-[#8A4B10]">{cartState?.status}</span>
                {(cartState?.status === 'OPEN' || cartState?.status === 'LOCKED') && (
                  <p className={`text-xs font-mono font-bold ${secondsLeft < 120 ? 'text-red-700' : 'text-[#2F855A]'}`}>
                    ⏱ Đóng giỏ sau {mmss(secondsLeft)}
                    {secondsLeft === 0 && ' · đang sweep()…'}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="bg-gradient-to-br from-[#FFF0E5] via-[#FFF8F0] to-white border border-[#CDE2D3] rounded-2xl p-6 flex flex-col justify-between">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#2F855A]">Gom đơn, giảm chuyến giao</span>
            <Leaf className="w-6 h-6 text-[#2F855A]" />
          </div>
          <div className="my-4 space-y-1">
            <p className="text-3xl font-extrabold text-[#25312B]">
              -{summary?.estimatedCo2SavedGrams || 0}g <span className="text-lg text-[#2F855A]">CO₂ (ước tính)</span>
            </p>
            <p className="text-xs text-[#626860]">
              Giảm <strong>{summary?.savedTripsCount || 0} chuyến giao lẻ</strong>. Giả định{' '}
              {summary?.co2GramsPerTripAssumption ?? 0} g/chuyến — chưa phải số đo thực tế.
            </p>
            <p className="text-xs text-[#626860]">
              Phí ship so với đặt lẻ: <strong>{formatVND(summary?.separateShippingTotal || 0)}</strong> →{' '}
              <strong className="text-[#2F855A]">{formatVND(summary?.baseShippingFee || 0)}</strong>{' '}
              (tiết kiệm {summary?.shippingSavedPercent || 0}%)
            </p>
          </div>
          <div className="text-xs bg-[#FFF8F0] rounded-lg p-2.5 text-[#626860] border border-[#CDE2D3]">
            Voucher gom đơn tự động:{' '}
            <strong className="text-[#2F855A]">-{formatVND(summary?.autoAppliedDiscount || 0)}</strong>
          </div>
          {cartState && (
            <div className="mt-2 text-xs rounded-lg p-2.5 bg-[#EAF4ED] border border-blue-500/30 text-[#24548A] space-y-1">
              <p className="font-bold">🤖 AI Cart Matching Assistant (Zero-PII)</p>
              {nextTier ? (
                <p>
                  🎯 Còn thiếu <b>{formatVND(gap)}</b> để mở khóa voucher −{formatVND(nextTier.off)}
                  {addOn && <> · gợi ý thêm 1× <b>{addOn.name}</b> ({formatVND(addOn.price)})</>}.
                </p>
              ) : (
                <p>🏆 Đã đạt bậc voucher cao nhất.</p>
              )}
              <p>
                🚚 Ship/người hiện tại ~{formatVND(Math.ceil((cartState.baseShippingFee || 0) / Math.max(1, activeCount)))}; thêm 1
                người → ~{formatVND(Math.ceil((cartState.baseShippingFee || 0) / (activeCount + 1)))}.
              </p>
              <p>{peak ? '🔥 Đang khung giờ cao điểm — giỏ dễ ghép đủ người.' : '🕒 Ngoài giờ cao điểm — nên mời bằng mã giỏ.'}</p>
              <button type="button" onClick={() => setShowPayload((v) => !v)} className="underline font-semibold !min-h-0">
                🔍 Xem Payload gửi AI (Zero-PII Proof)
              </button>
              {showPayload && (
                <pre className="mt-1 p-2 rounded bg-[#25312B] text-[#CDE2D3] overflow-auto">{JSON.stringify(aiPayload, null, 2)}</pre>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Thực đơn */}
        <div className="xl:col-span-4 bg-white border border-[#E8E2D9] rounded-2xl p-5">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-[#2F855A]" /> Chọn món & đồ dùng
          </h2>
          <div className="space-y-3">
            {menu.map((product: any) => {
              const myQty = me?.items?.find((i: any) => i.productId === product.id)?.quantity || 0;
              const canEdit = !!me && !locked && !me.isPaid;
              return (
                <div key={product.id} className="p-3.5 rounded-xl bg-[#FFF8F0] border border-[#E8E2D9] flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sm text-[#25312B]">{product.name}</p>
                    <p className="text-xs text-[#2F855A] font-bold mt-1">{formatVND(product.price)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      aria-label={`Giảm số lượng ${product.name}`}
                      disabled={!canEdit || myQty === 0}
                      onClick={() => handleAdjustQuantity(product.id, -1)}
                      className="w-11 h-11 shrink-0 rounded-lg bg-[#F3EEE8] hover:bg-[#E8E2D9] disabled:opacity-30 font-bold text-sm"
                    >
                      -
                    </button>
                    <span className="w-6 text-center text-sm font-bold">{myQty}</span>
                    <button
                      aria-label={`Tăng số lượng ${product.name}`}
                      disabled={!canEdit}
                      onClick={() => handleAdjustQuantity(product.id, 1)}
                      className="w-11 h-11 shrink-0 rounded-lg bg-[#F9734B] hover:bg-[#F9734B] disabled:opacity-30 text-[#25312B] font-bold text-sm"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {me && (locked || me.isPaid) && (
            <p className="mt-3 text-xs text-[#626860]">
              Giỏ đã khóa chỉnh sửa (Trưởng nhóm đã chốt, có người đã thanh toán hoặc đơn đã chốt) để số tiền không bị thay đổi.
            </p>
          )}
        </div>

        {/* Thành viên */}
        <div className="xl:col-span-5 bg-white border border-[#E8E2D9] rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Users className="w-5 h-5 text-[#2F855A]" /> Thành viên Ghép đơn ({cartState?.members?.length || 0})
              </h2>
              <span className="text-xs text-[#626860]">Ship gốc: {formatVND(cartState?.baseShippingFee || 0)}</span>
            </div>

            <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
              {cartState?.members?.map((member: any) => {
                const calcInfo = summary?.members?.find((m: any) => m.memberId === member.id);
                return (
                  <div key={member.id} className="p-4 rounded-xl bg-[#FFF8F0] border border-[#E8E2D9] space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="w-3.5 h-3.5 rounded-full inline-block" style={{ backgroundColor: member.avatarColor }} />
                        <span className="font-bold text-sm text-[#25312B]">{member.aliasName}</span>
                        {member.role === 'LEADER' && (
                          <span className="text-xs px-2 py-0.5 rounded bg-[#F9734B]/20 text-[#8A4B10] font-semibold">
                            Trưởng nhóm
                          </span>
                        )}
                      </div>
                      {member.pickedUpAt ? (
                        <span className="text-xs text-[#2F855A] font-semibold">📦 Đã nhận hàng</span>
                      ) : member.isPaid ? (
                        <span className="inline-flex items-center gap-1 text-xs text-[#2F855A] font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Đã thanh toán
                        </span>
                      ) : (
                        <span className="text-xs text-[#626860]">Đang chọn món</span>
                      )}
                    </div>

                    {member.items?.length > 0 ? (
                      <div className="text-xs text-[#626860] space-y-1 pl-6 border-l border-[#E8E2D9]">
                        {member.items.map((item: any) => (
                          <div key={item.id} className="flex justify-between">
                            <span>{item.quantity}x {item.productName}</span>
                            <span>{formatVND(item.unitPrice * item.quantity)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-[#626860] italic pl-6">Chưa chọn món</p>
                    )}

                    <div className="pt-2 border-t border-[#E8E2D9] flex flex-wrap items-center justify-between text-xs gap-2">
                      <span className="text-[#626860]">Ship chia: <strong className="text-[#25312B]">{formatVND(member.shippingShare)}</strong></span>
                      <span className="text-[#626860]">Giảm giá: <strong className="text-[#2F855A]">-{formatVND(member.discountShare)}</strong></span>
                      <span className="text-[#2F855A] font-medium">Tiết kiệm: {formatVND(calcInfo?.savedAmount || 0)}</span>
                      <span className="text-sm font-bold text-[#25312B]">Thực trả: {formatVND(member.finalPayable)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {(cartState?.status === 'ORDERED' || cartState?.status === 'COMPLETED') && (
              <div className="mt-4">
                <button
                  onClick={() => setShowSlip((v) => !v)}
                  className="w-full py-2 rounded-xl border border-[#2F855A] text-[#2F855A] font-bold text-xs"
                >
                  🏪 {showSlip ? 'Ẩn' : 'Xem'} Phiếu đóng gói cho Cửa hàng / Điểm tập kết
                </button>
                {showSlip && (
                  <div className="mt-3 p-4 rounded-xl border-2 border-dashed border-[#25312B] bg-white text-xs space-y-3 font-mono">
                    <p className="font-bold text-sm">PHIẾU ĐÓNG GÓI · {merchantName} · Giỏ {cartState.joinCode}</p>
                    <div>
                      <p className="font-bold">ĐƠN TỔNG ({[...packTotals.values()].reduce((a, b) => a + b, 0)} món):</p>
                      {[...packTotals].map(([name, q]) => (
                        <p key={name}>☐ {q} × {name}</p>
                      ))}
                    </div>
                    <div>
                      <p className="font-bold">TEM PHÂN LOẠI (alias · 4 ký tự cuối mã đơn):</p>
                      {activeMembers.map((m: any) => (
                        <p key={m.id} className="border-t border-[#E8E2D9] pt-1">
                          🏷 <b>{tag(m)}</b>: {m.items.map((i: any) => `${i.quantity}×${i.productName}`).join(', ')}
                        </p>
                      ))}
                    </div>
                    <p className="text-[#626860]">Không có họ tên / SĐT / địa chỉ — chia hàng chỉ theo tem.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-5 pt-4 border-t border-[#E8E2D9] space-y-3">
            {errorMsg && (
              <div role="alert" className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-700">{errorMsg}</div>
            )}

            {vietQrInfo && me && !me.isPaid && (
              <div className="p-4 rounded-xl bg-white text-[#25312B] flex flex-col items-center space-y-2">
                <p className="text-xs font-bold text-[#25312B]">Quét VietQR Napas 247 ({formatVND(vietQrInfo.amount)})</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={vietQrInfo.vietQrImageUrl} alt="VietQR" className="w-44 h-44 object-contain border rounded-lg" />
                <p className="text-xs text-[#626860]">
                  Nội dung CK: <strong>{vietQrInfo.paymentRef}</strong>
                </p>
                <p className="text-xs text-[#626860] text-center">
                  Bản thử nghiệm: thao tác bên dưới chỉ mô phỏng xác nhận thanh toán.
                </p>
                <button onClick={handleConfirmPayment} className="w-full py-2 rounded-lg bg-[#F9734B] text-[#25312B] font-bold text-xs hover:bg-[#F9734B]">
                  Xác nhận thanh toán mẫu (demo)
                </button>
              </div>
            )}

            {me?.role === 'LEADER' && requests.length > 0 && (
              <div className="p-3 rounded-xl bg-[#EAF4ED] border border-blue-500/30 space-y-2">
                <p className="text-xs font-bold text-[#24548A]">Yêu cầu tham gia chờ duyệt ({requests.length})</p>
                {requests.map((r: any) => (
                  <div key={r.requestId} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span>{r.label}</span>
                    <span className="flex gap-1">
                      <button onClick={() => handleReview(r.requestId, true)} className="px-2 py-1 rounded bg-[#F9734B] text-[#25312B] font-bold">Duyệt</button>
                      <button onClick={() => handleReview(r.requestId, false)} className="px-2 py-1 rounded bg-[#E8E2D9]">Từ chối</button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {me && !me.isPaid && cartState?.status === 'OPEN' && (
              <button onClick={handleLeave} className="w-full py-2 rounded-xl bg-[#F3EEE8] hover:bg-red-500/30 text-red-700 font-bold text-xs">
                Rời nhóm
              </button>
            )}

            {me?.role === 'LEADER' && cartState?.status === 'OPEN' && (
              <button onClick={handleCloseCart} className="w-full py-2.5 rounded-xl bg-[#F9734B] hover:bg-[#F58260] text-[#25312B] font-bold text-xs">
                🔒 Chốt giỏ hàng (ngừng sửa món, chuyển sang thanh toán)
              </button>
            )}

            <div className="flex flex-wrap gap-2">
              {me && !me.isPaid ? (
                <>
                  <button
                    onClick={handleOpenVietQr}
                    disabled={me.subtotal === 0 || cartState?.status === 'ORDERED'}
                    className="flex-1 py-3 px-3 rounded-xl bg-[#F3EEE8] hover:bg-[#E8E2D9] disabled:opacity-40 text-[#25312B] font-bold text-xs flex items-center justify-center gap-1.5"
                  >
                    <CreditCard className="w-4 h-4 text-[#2F855A]" /> Hiện Mã VietQR
                  </button>
                  <button
                    onClick={handleConfirmPayment}
                    disabled={me.subtotal === 0 || cartState?.status === 'ORDERED'}
                    className="flex-1 py-3 px-3 rounded-xl bg-[#F9734B] hover:bg-[#F9734B] disabled:bg-[#F3EEE8] disabled:text-[#626860] text-[#25312B] font-bold text-xs transition"
                  >
                    Thanh toán mẫu (demo): ({formatVND(me.finalPayable || 0)})
                  </button>
                </>
              ) : me ? (
                <button
                  onClick={handleGenerateQr}
                  disabled={cartState?.status !== 'ORDERED' || !!me.pickedUpAt}
                  className="w-full py-3 rounded-xl bg-[#F9734B] hover:bg-[#F58260] disabled:opacity-40 text-[#25312B] font-bold text-sm flex items-center justify-center gap-2"
                >
                  <QrCode className="w-4 h-4" />{' '}
                  {cartState?.status === 'ORDERED' ? 'Lấy mã QR nhận hàng' : 'Chờ các thành viên còn lại thanh toán / hết giờ...'}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Chat + QR */}
        <div className="xl:col-span-3 space-y-6">
          <div className="bg-white border border-[#E8E2D9] rounded-2xl p-4 flex flex-col h-[320px]">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E8E2D9]">
              <h3 className="text-sm font-bold flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-[#B83D20]" /> Chat Ẩn Danh Tự Hủy
              </h3>
              <span className="text-xs px-2 py-0.5 rounded bg-orange-500/10 text-[#B83D20]">Chat tạm thời</span>
            </div>

            <div className="flex-1 overflow-y-auto py-3 space-y-2.5 text-xs">
              {chatDestroyedNotice ? (
                <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/30 text-[#B83D20] text-center">
                  {chatDestroyedNotice}
                </div>
              ) : messages.length === 0 ? (
                <p className="text-[#626860] text-center mt-8">
                  Mọi tin nhắn tại đây chỉ hiển thị biệt danh ảo và tự động xóa vĩnh viễn khi đơn được chốt.
                </p>
              ) : (
                messages.map((m: any) => (
                  <div key={m.id} className="bg-[#FFF8F0] p-2.5 rounded-lg border border-[#E8E2D9]">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold" >{m.aliasName}</span>
                      <span className="text-xs text-[#626860]">{m.timestamp}</span>
                    </div>
                    <p className="text-[#25312B]">{m.text}</p>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleSendMessage} className="pt-2 flex gap-2">
              <input
                type="text"
                value={chatInput}
                maxLength={250}
                disabled={!!chatDestroyedNotice || !cartState}
                aria-label="Tin nhắn cho nhóm"
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Nhắn tin ẩn danh..."
                className="min-w-0 flex-1 bg-[#FFF8F0] border border-[#E8E2D9] rounded-lg px-3 py-2 text-xs text-[#25312B] focus:outline-none focus:border-[#2F855A]"
              />
              <button type="submit" aria-label="Gửi tin nhắn" disabled={!!chatDestroyedNotice || !cartState || !chatInput.trim()} className="p-2 rounded-lg bg-[#F9734B] text-[#25312B] hover:bg-[#F9734B]">
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>

          <div className="bg-white border border-[#E8E2D9] rounded-2xl p-4 space-y-4">
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <ScanLine className="w-4 h-4 text-[#2F855A]" /> Nhận hàng bằng QR
            </h3>

            {myQrData && (
              <div className="p-4 bg-white rounded-xl text-[#25312B] flex flex-col items-center text-center space-y-2">
                <QRCodeSVG value={myQrData.qrToken} size={180} className="max-w-full h-auto" />
                <p className="text-xs font-bold mt-2">{myQrData.aliasName}</p>
                <p className="text-xs text-[#626860] break-all select-all bg-[#F3EEE8] p-1.5 rounded max-h-20 overflow-auto">
                  {myQrData.qrToken}
                </p>
                <button type="button" onClick={copyQrToken} className="w-full rounded-lg border border-[#D8D1C7] bg-[#FFF8F0] px-3 py-2 text-sm font-semibold">Sao chép mã nhận hàng</button>
                <p role="status" className="text-xs text-[#2F855A]">{qrCopyMessage}</p>
                <p className="text-xs text-[#2F855A] font-semibold">
                  Đưa mã này cho Trưởng nhóm tại điểm nhận hàng. Mã dùng một lần và có hạn đến {new Date(myQrData.expiresAt).toLocaleTimeString('vi-VN')}.
                </p>
              </div>
            )}

            {me?.role === 'LEADER' && (
              <div className="space-y-2 pt-2 border-t border-[#E8E2D9]">
                <label htmlFor="pickup-token" className="block text-sm text-[#8A4B10] font-semibold">Trưởng nhóm: xác nhận nhận hàng</label>
                <input
                  type="text"
                  id="pickup-token"
                  ref={qrInputRef}
                  disabled={verifyingQr}
                  aria-invalid={!!qrError}
                  aria-describedby={qrError ? 'pickup-error' : undefined}
                  value={scanTokenInput}
                  onChange={(e) => { setScanTokenInput(e.target.value); setQrError(null); setVerifyResult(null); }}
                  placeholder="Dán mã nhận hàng của thành viên..."
                  className="w-full bg-[#FFF8F0] border border-[#E8E2D9] rounded-lg px-3 py-2 text-xs text-[#25312B]"
                />
                <button disabled={verifyingQr} onClick={handleLeaderVerifyQr} className="w-full py-2 rounded-lg bg-[#F9734B] hover:bg-[#F58260] text-[#25312B] font-bold text-xs">
                  {verifyingQr ? 'Đang xác nhận…' : 'Xác nhận nhận hàng'}
                </button>

                {qrError && <p id="pickup-error" role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{qrError}</p>}

                {verifyResult && (
                  <div className="p-3 rounded-xl bg-[#EAF4ED] border border-[#CDE2D3] text-xs space-y-1">
                    <p className="font-bold text-[#2F855A]">✓ Xác thực thành công cho: {verifyResult.memberPersona.aliasName}</p>
                    <p className="text-[#626860] font-semibold">Các món cần đưa:</p>
                    <ul className="list-disc pl-4 text-[#25312B]">
                      {verifyResult.itemsToDeliver.map((item: any, idx: number) => (
                        <li key={idx}>{item.quantity}x {item.productName}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {completed && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-3xl bg-white p-6 space-y-4 text-sm">
            <h2 className="text-xl font-extrabold text-[#2F855A]">🎉 Tổng kết Phiên Ghép Đơn — COMPLETED</h2>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-[#FFF8F0] p-3">Tổng tiền hàng<br /><b>{formatVND(summary?.totalMerchandiseValue || 0)}</b></div>
              <div className="rounded-xl bg-[#FFF8F0] p-3">Phí ship thực trả<br /><b>{formatVND(cartState.baseShippingFee)}</b></div>
              <div className="col-span-2 rounded-xl bg-[#EAF4ED] p-3">
                Tiết kiệm cả nhóm: <b className="text-lg text-[#2F855A]">{formatVND(cIndividual - cGroup)}</b>
                <br />
                <span className="text-xs text-[#626860]">S = C<sub>riêng lẻ</sub> {formatVND(cIndividual)} − C<sub>ghép</sub> {formatVND(cGroup)}</span>
              </div>
              <div className="col-span-2 rounded-xl bg-[#EAF4ED] p-3">
                🌿 Giảm <b>{summary?.savedTripsCount || 0}</b> chuyến giao lẻ · tránh ~<b>{summary?.estimatedCo2SavedGrams || 0} g CO₂</b> (ước tính)
              </div>
            </div>
            <div>
              <p className="font-bold mb-1">Xác nhận nhận hàng (QR ký số HMAC-SHA256):</p>
              {activeMembers.map((m: any) => (
                <p key={m.id} className="text-xs">✅ {m.aliasName} — {m.pickedUpAt ? new Date(m.pickedUpAt).toLocaleTimeString('vi-VN') : '—'}</p>
              ))}
              <p className="text-xs text-[#2F855A] mt-1 font-semibold">
                {cGroup === (summary?.totalMerchandiseValue || 0) + cartState.baseShippingFee - (summary?.autoAppliedDiscount || 0)
                  ? '0 lỗi phân chia'
                  : 'Có thành viên bị loại khi hết giờ — số đã trả giữ nguyên'}{' '}
                · 0 lộ thông tin cá nhân
              </p>
            </div>
            <button onClick={goHome} className="w-full py-3 rounded-xl bg-[#F9734B] font-extrabold">
              🏠 Hoàn tất & Quay về Trang chính ({redirectIn}s)
            </button>
            <button onClick={() => setRedirectPaused((v) => !v)} className="w-full py-2 rounded-xl bg-[#F3EEE8] text-xs font-bold">
              {redirectPaused ? '▶ Tiếp tục đếm ngược' : '⏸ Tạm dừng để xem lâu hơn'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
