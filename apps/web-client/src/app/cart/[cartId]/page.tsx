'use client';

import React, { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import {
  ShieldCheck, Leaf, ShoppingBag, QrCode, Send, Flame, CheckCircle2, ScanLine, Users, Sparkles, CreditCard,
} from 'lucide-react';
import { API_URL, DEMO_USERS, formatVND, demoLogin, authedPost, getDemoUser, setDemoUser } from '../../../lib/api';

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
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 1) Đăng nhập demo → JWT. 2) Kết nối Socket.IO bằng JWT (server lấy danh tính từ token).
  useEffect(() => setUserId(getDemoUser()), []);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let socket: Socket | null = null;

    (async () => {
      try {
        const jwt = await demoLogin(userId);
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

  const emit = (event: string, payload: object) =>
    new Promise<any>((resolve) => socketRef.current?.emit(event, payload, resolve));

  const switchUser = (uid: string) => {
    setCartState(null);
    setSummary(null);
    setMyQrData(null);
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
    if (!cartState || !chatInput.trim()) return;
    const res = await emit('chat:send', { cartId: cartState.id, text: chatInput });
    if (res?.error) setErrorMsg(res.error);
    else setChatInput('');
  };

  const handleGenerateQr = async () => {
    setErrorMsg(null);
    try {
      setMyQrData(await authedPost('/api/co-cart/qr/generate', token!, { cartId: cartState.id }));
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleLeaderVerifyQr = async () => {
    setErrorMsg(null);
    setVerifyResult(null);
    try {
      setVerifyResult(
        await authedPost('/api/co-cart/qr/verify-claim', token!, { qrToken: scanTokenInput.trim() }),
      );
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto mb-6 bg-slate-900/90 border border-emerald-500/30 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-emerald-400" />
          <div>
            <p className="text-sm font-semibold text-emerald-400">SANDBOX ĐA NGƯỜI DÙNG (MUA CHUNG BẢO VỆ RIÊNG TƯ)</p>
            <p className="text-xs text-slate-400">
              Danh tính lấy từ JWT. Tên thật, SĐT và số phòng KTX bị khóa ở tầng Server bằng @Exclude().
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {DEMO_USERS.map((uid, idx) => (
            <button
              key={uid}
              onClick={() => switchUser(uid)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                userId === uid
                  ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Sinh viên #{idx + 1}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto mb-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mb-3">
              <Sparkles className="w-3.5 h-3.5" /> Trạm giao nhận: {hubName || '...'}
            </span>
            <h1 className="text-2xl font-bold text-white">{merchantName || 'Đang kết nối...'}</h1>
            {cartState && (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-300">
                <span>
                  Mã tham gia:{' '}
                  <strong className="tracking-widest text-lg text-emerald-300">{cartState.joinCode}</strong>
                </span>
                <button onClick={copyCode} className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700">
                  {copied ? 'Đã chép ✓' : 'Sao chép'}
                </button>
                <span className="text-slate-500">
                  Cách chia ship: {MODE_LABEL[cartState.shippingMode] || cartState.shippingMode}
                  {cartState.isPublic ? ' · công khai trên Radar' : ' · riêng tư (chỉ mã mời)'}
                  {cartState.requireApproval ? ' · cần duyệt' : ''} · tối đa {cartState.maxMembers} người
                </span>
              </div>
            )}
            {cartState?.pickupLabel && <p className="mt-2 text-xs text-slate-300">📍 Điểm nhận chung: <b>{cartState.pickupLabel}</b></p>}
            {cartState?.rules && <p className="mt-1 text-xs text-slate-400">📋 Quy định: {cartState.rules}</p>}
            {leftNotice && <p className="mt-2 text-xs text-amber-300">{leftNotice}</p>}
          </div>
          {me && (
            <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-slate-950"
                  style={{ backgroundColor: me.avatarColor }}
                >
                  {me.aliasName.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-xs text-slate-400">Định danh ẩn danh của bạn trong phiên này:</p>
                  <p className="text-sm font-bold text-white">
                    {me.aliasName}{' '}
                    <span className="text-xs font-normal px-2 py-0.5 rounded bg-slate-800 text-emerald-400 ml-1">
                      {me.role}
                    </span>
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400">Trạng thái giỏ hàng</p>
                <span className="text-sm font-bold text-amber-400">{cartState?.status}</span>
              </div>
            </div>
          )}
        </div>

        <div className="bg-gradient-to-br from-emerald-950 via-slate-900 to-slate-900 border border-emerald-500/30 rounded-2xl p-6 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">Tác động Vận chuyển Xanh (ESG)</span>
            <Leaf className="w-6 h-6 text-emerald-400" />
          </div>
          <div className="my-4 space-y-1">
            <p className="text-3xl font-extrabold text-white">
              -{summary?.estimatedCo2SavedGrams || 0}g <span className="text-lg text-emerald-400">CO₂ (ước tính)</span>
            </p>
            <p className="text-xs text-slate-300">
              Giảm <strong>{summary?.savedTripsCount || 0} chuyến giao lẻ</strong>. Giả định{' '}
              {summary?.co2GramsPerTripAssumption ?? 0} g/chuyến — chưa phải số đo thực tế.
            </p>
            <p className="text-xs text-slate-300">
              Phí ship so với đặt lẻ: <strong>{formatVND(summary?.separateShippingTotal || 0)}</strong> →{' '}
              <strong className="text-emerald-400">{formatVND(summary?.baseShippingFee || 0)}</strong>{' '}
              (tiết kiệm {summary?.shippingSavedPercent || 0}%)
            </p>
          </div>
          <div className="text-xs bg-slate-950/60 rounded-lg p-2.5 text-slate-300 border border-emerald-500/20">
            Voucher gom đơn tự động:{' '}
            <strong className="text-emerald-400">-{formatVND(summary?.autoAppliedDiscount || 0)}</strong>
          </div>
          {summary?.suggestions?.length > 0 && (
            <div className="mt-2 text-xs rounded-lg p-2.5 bg-blue-500/10 border border-blue-500/30 text-blue-200 space-y-1">
              {summary.suggestions.map((sg: any, i: number) => (
                <p key={i}>💡 {sg.text} <span className="text-blue-300/60">(gợi ý theo quy tắc, không phải AI)</span></p>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Thực đơn */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-emerald-400" /> Thực đơn Cửa hàng
          </h2>
          <div className="space-y-3">
            {menu.map((product: any) => {
              const myQty = me?.items?.find((i: any) => i.productId === product.id)?.quantity || 0;
              const canEdit = !!me && !locked && !me.isPaid;
              return (
                <div key={product.id} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm text-white">{product.name}</p>
                    <p className="text-xs text-emerald-400 font-bold mt-1">{formatVND(product.price)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={!canEdit || myQty === 0}
                      onClick={() => handleAdjustQuantity(product.id, -1)}
                      className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 font-bold text-sm"
                    >
                      -
                    </button>
                    <span className="w-6 text-center text-sm font-bold">{myQty}</span>
                    <button
                      disabled={!canEdit}
                      onClick={() => handleAdjustQuantity(product.id, 1)}
                      className="w-7 h-7 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-30 text-slate-950 font-bold text-sm"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {me && (locked || me.isPaid) && (
            <p className="mt-3 text-xs text-slate-500">
              Giỏ đã khóa chỉnh sửa (Trưởng nhóm đã chốt, có người đã thanh toán hoặc đơn đã chốt) để số tiền không bị thay đổi.
            </p>
          )}
        </div>

        {/* Thành viên */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-400" /> Thành viên Ghép đơn ({cartState?.members?.length || 0})
              </h2>
              <span className="text-xs text-slate-400">Ship gốc: {formatVND(cartState?.baseShippingFee || 0)}</span>
            </div>

            <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
              {cartState?.members?.map((member: any) => {
                const calcInfo = summary?.members?.find((m: any) => m.memberId === member.id);
                return (
                  <div key={member.id} className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="w-3.5 h-3.5 rounded-full inline-block" style={{ backgroundColor: member.avatarColor }} />
                        <span className="font-bold text-sm text-white">{member.aliasName}</span>
                        {member.role === 'LEADER' && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold">
                            Proxy Leader (-20% Ship)
                          </span>
                        )}
                      </div>
                      {member.pickedUpAt ? (
                        <span className="text-xs text-emerald-400 font-semibold">📦 Đã nhận hàng</span>
                      ) : member.isPaid ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Đã thanh toán
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Đang chọn món</span>
                      )}
                    </div>

                    {member.items?.length > 0 ? (
                      <div className="text-xs text-slate-300 space-y-1 pl-6 border-l border-slate-800">
                        {member.items.map((item: any) => (
                          <div key={item.id} className="flex justify-between">
                            <span>{item.quantity}x {item.productName}</span>
                            <span>{formatVND(item.unitPrice * item.quantity)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 italic pl-6">Chưa chọn món</p>
                    )}

                    <div className="pt-2 border-t border-slate-900 flex flex-wrap items-center justify-between text-xs gap-2">
                      <span className="text-slate-400">Ship chia: <strong className="text-slate-200">{formatVND(member.shippingShare)}</strong></span>
                      <span className="text-slate-400">Giảm giá: <strong className="text-emerald-400">-{formatVND(member.discountShare)}</strong></span>
                      <span className="text-emerald-400 font-medium">Tiết kiệm: {formatVND(calcInfo?.savedAmount || 0)}</span>
                      <span className="text-sm font-bold text-white">Thực trả: {formatVND(member.finalPayable)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-800 space-y-3">
            {errorMsg && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">{errorMsg}</div>
            )}

            {vietQrInfo && me && !me.isPaid && (
              <div className="p-4 rounded-xl bg-white text-slate-950 flex flex-col items-center space-y-2">
                <p className="text-xs font-bold text-slate-800">Quét VietQR Napas 247 ({formatVND(vietQrInfo.amount)})</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={vietQrInfo.vietQrImageUrl} alt="VietQR" className="w-44 h-44 object-contain border rounded-lg" />
                <p className="text-[11px] text-slate-600">
                  Nội dung CK: <strong>{vietQrInfo.paymentRef}</strong>
                </p>
                <p className="text-[10px] text-slate-500 text-center">
                  Đơn được xác nhận tự động khi ngân hàng gọi Webhook (POST /api/payment/webhook).
                </p>
                <button onClick={handleConfirmPayment} className="w-full py-2 rounded-lg bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-500">
                  Giả lập Webhook: xác nhận đã chuyển khoản (chỉ demo)
                </button>
              </div>
            )}

            {me?.role === 'LEADER' && requests.length > 0 && (
              <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 space-y-2">
                <p className="text-xs font-bold text-blue-300">Yêu cầu tham gia chờ duyệt ({requests.length})</p>
                {requests.map((r: any) => (
                  <div key={r.requestId} className="flex items-center justify-between text-xs">
                    <span>{r.label}</span>
                    <span className="flex gap-1">
                      <button onClick={() => handleReview(r.requestId, true)} className="px-2 py-1 rounded bg-emerald-500 text-slate-950 font-bold">Duyệt</button>
                      <button onClick={() => handleReview(r.requestId, false)} className="px-2 py-1 rounded bg-slate-700">Từ chối</button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {me && !me.isPaid && cartState?.status === 'OPEN' && (
              <button onClick={handleLeave} className="w-full py-2 rounded-xl bg-slate-800 hover:bg-red-500/30 text-red-300 font-bold text-xs">
                Rời nhóm
              </button>
            )}

            {me?.role === 'LEADER' && cartState?.status === 'OPEN' && (
              <button onClick={handleCloseCart} className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs">
                🔒 Chốt giỏ hàng (ngừng sửa món, chuyển sang thanh toán)
              </button>
            )}

            <div className="flex flex-wrap gap-2">
              {me && !me.isPaid ? (
                <>
                  <button
                    onClick={handleOpenVietQr}
                    disabled={me.subtotal === 0 || cartState?.status === 'ORDERED'}
                    className="flex-1 py-3 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white font-bold text-xs flex items-center justify-center gap-1.5"
                  >
                    <CreditCard className="w-4 h-4 text-emerald-400" /> Hiện Mã VietQR
                  </button>
                  <button
                    onClick={handleConfirmPayment}
                    disabled={me.subtotal === 0 || cartState?.status === 'ORDERED'}
                    className="flex-1 py-3 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-xs transition"
                  >
                    Thanh Toán Nhanh ({formatVND(me.finalPayable || 0)})
                  </button>
                </>
              ) : me ? (
                <button
                  onClick={handleGenerateQr}
                  disabled={cartState?.status !== 'ORDERED' || !!me.pickedUpAt}
                  className="w-full py-3 rounded-xl bg-blue-500 hover:bg-blue-400 disabled:opacity-40 text-slate-950 font-bold text-sm flex items-center justify-center gap-2"
                >
                  <QrCode className="w-4 h-4" />{' '}
                  {cartState?.status === 'ORDERED' ? 'Lấy Mã QR Nhận Hàng Ẩn Danh (HMAC-SHA256)' : 'Chờ các thành viên còn lại thanh toán / hết giờ...'}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Chat + QR */}
        <div className="lg:col-span-3 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col h-[320px]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-orange-400" /> Chat Ẩn Danh Tự Hủy
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded bg-orange-500/10 text-orange-300">RAM-Only</span>
            </div>

            <div className="flex-1 overflow-y-auto py-3 space-y-2.5 text-xs">
              {chatDestroyedNotice ? (
                <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/30 text-orange-300 text-center">
                  {chatDestroyedNotice}
                </div>
              ) : messages.length === 0 ? (
                <p className="text-slate-500 text-center mt-8">
                  Mọi tin nhắn tại đây chỉ hiển thị biệt danh ảo và tự động xóa vĩnh viễn khi đơn được chốt.
                </p>
              ) : (
                messages.map((m: any) => (
                  <div key={m.id} className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold" style={{ color: m.avatarColor }}>{m.aliasName}</span>
                      <span className="text-[10px] text-slate-500">{m.timestamp}</span>
                    </div>
                    <p className="text-slate-200">{m.text}</p>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleSendMessage} className="pt-2 flex gap-2">
              <input
                type="text"
                value={chatInput}
                maxLength={250}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Nhắn tin ẩn danh..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
              <button type="submit" className="p-2 rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400">
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <ScanLine className="w-4 h-4 text-emerald-400" /> Proxy Giao Nhận QR
            </h3>

            {myQrData && (
              <div className="p-4 bg-white rounded-xl text-slate-950 flex flex-col items-center text-center space-y-2">
                <QRCodeSVG value={myQrData.qrToken} size={150} />
                <p className="text-xs font-bold mt-2">{myQrData.aliasName}</p>
                <p className="text-[11px] text-slate-600 break-all select-all bg-slate-100 p-1.5 rounded max-h-20 overflow-auto">
                  {myQrData.qrToken}
                </p>
                <p className="text-[10px] text-emerald-700 font-semibold">
                  Đưa mã này cho Trưởng nhóm tại điểm nhận hàng. Mã dùng một lần và có hạn đến {new Date(myQrData.expiresAt).toLocaleTimeString('vi-VN')}.
                </p>
              </div>
            )}

            {me?.role === 'LEADER' && (
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <p className="text-xs text-amber-300 font-semibold">Công cụ Trưởng nhóm: Xác thực QR giao hàng</p>
                <input
                  type="text"
                  value={scanTokenInput}
                  onChange={(e) => setScanTokenInput(e.target.value)}
                  placeholder="Dán chuỗi QR Token của thành viên vào đây..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
                />
                <button onClick={handleLeaderVerifyQr} className="w-full py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs">
                  Quét &amp; Xác nhận Giao hàng
                </button>

                {verifyResult && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs space-y-1">
                    <p className="font-bold text-emerald-400">✓ Xác thực thành công cho: {verifyResult.memberPersona.aliasName}</p>
                    <p className="text-slate-300 font-semibold">Các món cần đưa:</p>
                    <ul className="list-disc pl-4 text-slate-200">
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
    </div>
  );
}
