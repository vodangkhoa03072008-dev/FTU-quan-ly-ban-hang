'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { io, Socket } from 'socket.io-client';
import {
  MapPin, Clock, Users, Sparkles, KeyRound, PlusCircle, Radar, List, Map as MapIcon, Crosshair, Search,
  ShieldCheck, Store, X, UserPlus, ShoppingBag, Package, Leaf, History, LogOut,
} from 'lucide-react';
import {
  API_URL, DEMO_USERS, SESSION_USER, Session, authedFetch, clearSession, formatVND, getDemoUser, getSession,
  maskPhone, setDemoUser, tokenFor,
} from '../lib/api';
import RadarMap from '../components/RadarMap';

const MODES = [
  { v: 'HYBRID', label: 'Kết hợp (30% đều + 70% theo giá trị)' },
  { v: 'EQUAL', label: 'Chia đều' },
  { v: 'PROPORTIONAL', label: 'Chia theo tỷ lệ giá trị đơn' },
];
const MODE_LABEL: Record<string, string> = Object.fromEntries(MODES.map((m) => [m.v, m.label]));
const RADII = [500, 1000, 2000, 5000];
const fmtRadius = (r: number) => (r >= 1000 ? `${r / 1000} km` : `${r} m`);

type Loc = { lat: number; lng: number; source: 'gps' | 'hub' | 'address'; label: string };
type GeoStatus = 'asking' | 'granted' | 'denied' | 'unsupported';

export default function HomePage() {
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);
  const fetchedAtRef = useRef<number>(Date.now());

  const [userId, setUserId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [history, setHistory] = useState<any>(null);
  const [tab, setTab] = useState<'lobby' | 'history'>('lobby');
  const [token, setToken] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<{ hubs: any[]; merchants: any[] }>({ hubs: [], merchants: [] });

  const [geoStatus, setGeoStatus] = useState<GeoStatus>('asking');
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [loc, setLoc] = useState<Loc | null>(null);
  const [radius, setRadius] = useState(1000);
  const [merchantFilter, setMerchantFilter] = useState('');
  const [view, setView] = useState<'map' | 'list'>('list');
  const [addressQ, setAddressQ] = useState('');
  const [addressResults, setAddressResults] = useState<any[]>([]);

  const [radar, setRadar] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const [preview, setPreview] = useState<any>(null);
  const [joinStatus, setJoinStatus] = useState<string | null>(null);

  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState('');

  const [form, setForm] = useState({
    hubId: '', merchantId: '', mode: 'HYBRID', isPublic: true, requireApproval: false,
    maxMembers: 6, windowMinutes: 20, pickupLabel: '', useGps: false, rules: '',
  });
  const setF = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  // Danh tính sandbox (localStorage) → JWT → socket (nhận radar:updated).
  useEffect(() => {
    setSession(getSession());
    setUserId(getDemoUser());
    if (new URLSearchParams(window.location.search).get('tab') === 'history') setTab('history');
  }, []);
  useEffect(() => {
    if (!userId) return;
    let socket: Socket | null = null;
    let cancelled = false;
    setToken(null);
    tokenFor(userId)
      .then((jwt) => {
        if (cancelled) return;
        socket = io(`${API_URL}/co-cart`, { transports: ['websocket'], auth: { token: jwt } });
        socketRef.current = socket;
        setToken(jwt);
      })
      .catch((e) => setError(e.message || 'Không kết nối được máy chủ Co-Cart.'));
    return () => {
      cancelled = true;
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [userId]);

  useEffect(() => {
    fetch(`${API_URL}/api/geo-hub/catalog`)
      .then((r) => r.json())
      .then((c) => {
        setCatalog(c);
        // Điểm nhận mặc định của tài khoản → chọn sẵn cho Lobby và form tạo giỏ.
        const home = c.hubs?.find((h: any) => h.id === getSession()?.profile.defaultHubId);
        if (home) setLoc((l) => l ?? { lat: home.latitude, lng: home.longitude, source: 'hub', label: home.name });
        setF({ hubId: home?.id || c.hubs?.[0]?.id || '', merchantId: c.merchants?.[0]?.id || '' });
      })
      .catch(() => setError('Không kết nối được máy chủ Co-Cart.'));
  }, []);

  // Xin quyền GPS. Từ chối → chọn khu vực thủ công, ứng dụng vẫn chạy.
  const askGps = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return setGeoStatus('unsupported');
    setGeoStatus('asking');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const g = { lat: p.coords.latitude, lng: p.coords.longitude };
        setGps(g);
        setGeoStatus('granted');
        setLoc({ ...g, source: 'gps', label: 'Vị trí hiện tại (GPS)' });
      },
      () => setGeoStatus('denied'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }, []);
  useEffect(() => {
    askGps();
  }, [askGps]);

  const loadRadar = useCallback(async () => {
    if (!token || !loc) return;
    setLoading(true);
    try {
      const q = new URLSearchParams({ lat: String(loc.lat), lng: String(loc.lng), radius: String(radius) });
      if (merchantFilter) q.set('merchantId', merchantFilter);
      const data = await authedFetch('GET', `/api/geo-hub/discover?${q}`, token);
      fetchedAtRef.current = Date.now();
      setRadar(data);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, loc, radius, merchantFilter]);

  useEffect(() => {
    loadRadar();
    const t = setInterval(loadRadar, 30000);
    return () => clearInterval(t);
  }, [loadRadar]);

  // Real-time: cập nhật số người/chỗ trống; nhóm mới hoặc đóng → tải lại Radar.
  useEffect(() => {
    const s = socketRef.current;
    if (!s) return;
    let timer: any;
    const refetchSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(loadRadar, 800);
    };
    const onUpdate = (u: any) => {
      setRadar((r: any) => {
        if (!r) return r;
        const exists = r.groups.some((g: any) => g.cartId === u.cartId);
        if (!exists) {
          refetchSoon();
          return r;
        }
        if (u.status !== 'OPEN' || u.seatsLeft === 0) {
          refetchSoon(); // cập nhật lại thống kê
          return { ...r, groups: r.groups.filter((g: any) => g.cartId !== u.cartId) };
        }
        return {
          ...r,
          groups: r.groups.map((g: any) =>
            g.cartId === u.cartId ? { ...g, membersCount: u.membersCount, seatsLeft: u.seatsLeft } : g,
          ),
        };
      });
    };
    s.on('radar:updated', onUpdate);
    return () => {
      s.off('radar:updated', onUpdate);
      clearTimeout(timer);
    };
  }, [token, loadRadar]);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const remaining = (g: any) =>
    Math.max(0, g.remainingSeconds - Math.floor((Date.now() - fetchedAtRef.current) / 1000));
  const groups = (radar?.groups || []).filter((g: any) => remaining(g) > 0);

  // Lịch sử đơn ghép COMPLETED & Hồ sơ Tiết kiệm Xanh (của chính người dùng hiện tại).
  useEffect(() => {
    if (!token || tab !== 'history') return;
    authedFetch('GET', '/api/co-cart/history', token).then(setHistory).catch((e) => setError(e.message));
  }, [token, tab]);

  const logout = () => {
    clearSession();
    setSession(null);
    setUserId(DEMO_USERS[0]);
  };

  const searchAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addressQ.trim()) return;
    try {
      // Dịch vụ ngoài (OpenStreetMap Nominatim) — chỉ gửi chuỗi địa chỉ người dùng tự nhập.
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=vn&q=${encodeURIComponent(addressQ)}`,
      );
      setAddressResults(await r.json());
    } catch {
      setError('Không tìm được địa chỉ. Hãy chọn điểm nhận hàng có sẵn.');
    }
  };

  const toggleIntent = async () => {
    if (!token || !loc) return;
    try {
      const active = radar?.myIntent?.active;
      await authedFetch(
        active ? 'DELETE' : 'POST',
        '/api/geo-hub/intent',
        token,
        active
          ? undefined
          : { lat: loc.lat, lng: loc.lng, minutes: 30, ...(merchantFilter ? { merchantId: merchantFilter } : {}) },
      );
      await loadRadar();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const openPreview = async (cartId: string) => {
    if (!token) return;
    setJoinStatus(null);
    try {
      setPreview(await authedFetch('GET', `/api/co-cart/public/${cartId}`, token));
    } catch (e: any) {
      setError(e.message);
    }
  };

  // consent=true chỉ được gửi khi người dùng bấm "Đồng ý và tham gia".
  const confirmJoin = () => {
    const s = socketRef.current;
    if (!s || !preview) return;
    setJoinStatus('Đang tham gia...');
    s.emit('cart:join_public', { cartId: preview.cartId, consent: true }, (res: any) => {
      if (res?.error) return setJoinStatus(res.error);
      if (res.pending) {
        setJoinStatus('Đã gửi yêu cầu. Đang chờ Trưởng nhóm duyệt...');
        const onReviewed = (r: any) => {
          if (r.cartId !== preview.cartId) return;
          s.off('cart:join_reviewed', onReviewed);
          if (r.approved && r.joinCode) router.push(`/cart/${r.joinCode}`);
          else setJoinStatus('Trưởng nhóm đã từ chối yêu cầu.');
        };
        s.on('cart:join_reviewed', onReviewed);
        return;
      }
      router.push(`/cart/${res.joinCode}`);
    });
  };

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.hubId || !form.merchantId) return;
    const q = new URLSearchParams({
      hub: form.hubId,
      merchant: form.merchantId,
      mode: form.mode,
      public: form.isPublic ? '1' : '0',
      approval: form.requireApproval ? '1' : '0',
      max: String(form.maxMembers),
      window: String(form.windowMinutes),
    });
    if (form.pickupLabel.trim()) q.set('label', form.pickupLabel.trim());
    if (form.rules.trim()) q.set('rules', form.rules.trim());
    if (form.useGps && gps) {
      q.set('lat', String(gps.lat));
      q.set('lng', String(gps.lng));
    }
    router.push(`/cart/new?${q}`);
  };

  const joinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c) router.push(`/cart/${encodeURIComponent(c)}`);
  };

  const switchUser = (uid: string) => {
    setDemoUser(uid);
    setRadar(null);
    setUserId(uid);
  };

  const input =
    'w-full min-w-0 bg-white border border-[#E8E2D9] rounded-lg px-3 py-2.5 text-sm text-[#25312B] focus:outline-none focus:border-[#2F855A]';
  const stats = radar?.stats;

  return (
    <div className="cocart-home min-h-screen bg-[#FFF8F0] text-[#25312B] px-4 py-6 md:px-8 md:py-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-[#2F855A] font-extrabold text-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.jpg" alt="" className="w-12 h-12 rounded-xl" /> Co-Cart
          </div>
          {session ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#CDE2D3] bg-white px-4 py-2 text-xs">
              <div>
                <p className="text-[#626860]">🔒 Hồ sơ thật (Đã ẩn với nhóm):</p>
                <p className="font-bold text-[#25312B]">
                  {session.profile.fullName} · {maskPhone(session.profile.phoneNumber)}
                </p>
              </div>
              <button onClick={logout} className="inline-flex items-center gap-1 rounded-lg bg-[#F3EEE8] px-3 py-2 font-semibold">
                <LogOut className="w-3.5 h-3.5" /> Đăng xuất
              </button>
            </div>
          ) : (
          <nav
            aria-label="Tài khoản"
            className="flex flex-wrap items-center gap-3"
          >
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#D8D1C7] px-4 py-2 text-sm font-semibold text-[#25312B] transition hover:border-[#2F855A] hover:text-[#2F855A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F855A]"
            >
              Đăng nhập
            </Link>
            <Link
              href="/register"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#F9734B] px-4 py-2 text-sm font-semibold text-[#25312B] transition hover:bg-[#F58260] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F855A] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            >
              Đăng ký
            </Link>
          </nav>
          )}
        </div>

        <div className="flex flex-wrap gap-2" role="tablist">
          {(
            [
              ['lobby', '🏠 Trang chính (Lobby giỏ khu vực)'],
              ['history', '📜 Lịch sử & Tác động Xanh của tôi'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === k ? 'bg-[#2F855A] text-white' : 'bg-white border border-[#E8E2D9]'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'history' && (
          <section className="rounded-3xl bg-white border border-[#E8E2D9] p-5 md:p-8 space-y-5 shadow-sm">
            <h2 className="font-bold text-lg flex items-center gap-2">
              <History className="w-5 h-5 text-[#2F855A]" /> Lịch sử đơn ghép & Hồ sơ Tiết kiệm Xanh
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
              <div className="rounded-2xl bg-[#EAF4ED] p-4">
                <p className="text-2xl font-extrabold text-[#2F855A]">{history?.totalOrders ?? 0}</p>
                <p className="text-xs text-[#626860]">đơn ghép thành công</p>
              </div>
              <div className="rounded-2xl bg-[#FFF0E5] p-4">
                <p className="text-2xl font-extrabold text-[#B83D20]">{formatVND(history?.totalSaved ?? 0)}</p>
                <p className="text-xs text-[#626860]">tổng tiết kiệm (S = C<sub>riêng lẻ</sub> − C<sub>ghép</sub>)</p>
              </div>
              <div className="rounded-2xl bg-[#EAF4ED] p-4">
                <p className="text-2xl font-extrabold text-[#2F855A]">-{history?.totalCo2SavedGrams ?? 0} g</p>
                <p className="text-xs text-[#626860]">CO₂ ước tính tránh được</p>
              </div>
            </div>
            {history?.orders?.length ? (
              <ul className="space-y-2">
                {history.orders.map((o: any) => (
                  <li key={o.cartId} className="rounded-xl border border-[#E8E2D9] p-3 text-sm flex flex-wrap justify-between gap-2">
                    <span>
                      <b>{o.merchantName}</b> · {o.hubName} · {o.membersCount} người · bạn là <i>{o.aliasName}</i>
                      <br />
                      <span className="text-xs text-[#626860]">
                        {new Date(o.completedAt).toLocaleString('vi-VN')} · mã {o.joinCode} · giảm {o.savedTripsCount} chuyến
                      </span>
                    </span>
                    <span className="text-right">
                      Thực trả <b>{formatVND(o.finalPayable)}</b>
                      <br />
                      <span className="text-[#2F855A] font-bold">Tiết kiệm {formatVND(o.savedAmount)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[#626860]">Chưa có đơn ghép nào hoàn tất. Tạo hoặc tham gia một giỏ ở Trang chính nhé!</p>
            )}
          </section>
        )}

        {/* ===== KHU VỰC CHÍNH: KHÁM PHÁ ĐƠN GHÉP QUANH BẠN ===== */}
        <section hidden={tab !== 'lobby'} className="rounded-3xl bg-white border border-[#E8E2D9] p-5 md:p-8 space-y-6 shadow-sm">
          <div className="rounded-2xl bg-[#FFF0E5] p-6 md:p-8 grid gap-6 md:grid-cols-[1fr_auto] items-center">
            <div className="space-y-4">
              <p className="text-xs font-bold uppercase tracking-widest text-[#B83D20]">Cùng khu vực · Cùng chia phí giao</p>
              <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-tight text-[#25312B]">
                Mua chung gần bạn,<br /><span className="text-[#B83D20]">chia nhẹ phí giao.</span>
              </h1>
              <p className="text-sm md:text-base leading-relaxed text-[#626860] max-w-xl">
                Đồ uống, snack và những món cần mỗi ngày. Tìm nhóm gần bạn,
                đặt cùng một cửa hàng và nhận tại điểm chung bằng biệt danh.
              </p>
              <div className="flex flex-wrap gap-3 pt-1">
                <a href="#discover-groups" className="inline-flex min-h-11 items-center rounded-xl bg-[#F9734B] px-5 py-3 text-sm font-bold text-[#25312B] hover:bg-[#F58260]">Tìm nhóm gần bạn</a>
                <a href="#create-group" className="inline-flex min-h-11 items-center rounded-xl border border-[#D8D1C7] bg-white px-5 py-3 text-sm font-semibold">Tạo nhóm mới</a>
                <a href="#join-code" className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-[#B83D20] underline underline-offset-4">Tôi có mã nhóm</a>
              </div>
            </div>
            <div aria-hidden="true" className="hidden md:flex h-40 w-40 flex-col items-center justify-center gap-3 rounded-full bg-[#FFDFCA] border-8 border-[#FFF8F0] text-[#B83D20]">
              <ShoppingBag className="h-16 w-16" strokeWidth={1.5} />
              <div className="flex gap-3"><Package className="h-6 w-6" /><Leaf className="h-6 w-6 text-[#2F855A]" /></div>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-[#2F855A] font-medium">
            <span className="inline-flex items-center gap-2"><Users className="h-4 w-4" /> Chia sẻ phí giao hàng</span>
            <span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4" /> Nhận tại điểm chung</span>
            <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Tham gia bằng biệt danh</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Vị trí + bán kính */}
            <div className="lg:col-span-2 p-4 rounded-2xl bg-white border border-[#E8E2D9] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-[#2F855A]" />
                  {loc ? (
                    <span className="text-[#25312B] font-semibold">{loc.label}</span>
                  ) : (
                    <span className="text-[#626860]">Chưa chọn khu vực</span>
                  )}
                </p>
                <button onClick={askGps} className="text-xs px-3 py-1.5 rounded-lg bg-[#F3EEE8] hover:bg-[#E8E2D9] flex items-center gap-1.5">
                  <Crosshair className="w-3.5 h-3.5" /> Dùng GPS
                </button>
              </div>
              {geoStatus === 'asking' && !loc && <p className="text-xs text-[#626860]">Đang xin quyền truy cập vị trí...</p>}
              {(geoStatus === 'denied' || geoStatus === 'unsupported') && (
                <p className="text-xs text-[#8A4B10]">
                  {geoStatus === 'denied' ? 'Bạn đã từ chối chia sẻ vị trí.' : 'Trình duyệt không hỗ trợ GPS.'} Hãy chọn khu
                  vực thủ công bên dưới.
                </p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <select
                  aria-label="Điểm nhận hàng tìm kiếm"
                  className={input}
                  value={loc?.source === 'hub' ? loc.label : ''}
                  onChange={(e) => {
                    const h = catalog.hubs.find((x) => x.name === e.target.value);
                    if (h) setLoc({ lat: h.latitude, lng: h.longitude, source: 'hub', label: h.name });
                  }}
                >
                  <option value="">— Chọn điểm nhận hàng / khu vực —</option>
                  {catalog.hubs.map((h) => (
                    <option key={h.id} value={h.name}>{h.name}</option>
                  ))}
                </select>
                <form onSubmit={searchAddress} className="flex gap-2">
                  <input aria-label="Tìm theo địa chỉ" value={addressQ} onChange={(e) => setAddressQ(e.target.value)} placeholder="Tìm theo địa chỉ..." className={input} />
                  <button className="px-3 rounded-lg bg-[#F3EEE8] hover:bg-[#E8E2D9]" aria-label="Tìm địa chỉ">
                    <Search className="w-4 h-4" />
                  </button>
                </form>
              </div>
              {addressResults.length > 0 && (
                <div className="text-xs space-y-1 max-h-32 overflow-auto">
                  {addressResults.map((a) => (
                    <button
                      key={a.place_id}
                      onClick={() => {
                        setLoc({
                          lat: Number(a.lat),
                          lng: Number(a.lon),
                          source: 'address',
                          label: a.display_name.split(',').slice(0, 3).join(','),
                        });
                        setAddressResults([]);
                      }}
                      className="block w-full text-left px-2 py-1.5 rounded hover:bg-[#F3EEE8] text-[#626860]"
                    >
                      {a.display_name}
                    </button>
                  ))}
                  <p className="text-xs text-[#626860]">Kết quả địa chỉ từ OpenStreetMap Nominatim.</p>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-[#626860]">Bán kính:</span>
                {RADII.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRadius(r)}
                    className={`px-3 py-1.5 rounded-lg font-bold ${radius === r ? 'bg-[#EAF4ED] text-[#2F855A] ring-1 ring-[#2F855A]' : 'bg-[#F3EEE8] text-[#626860]'}`}
                  >
                    {fmtRadius(r)}
                  </button>
                ))}
                <select
                  value={merchantFilter}
                  onChange={(e) => setMerchantFilter(e.target.value)}
                  aria-label="Lọc theo cửa hàng" className="max-w-full ml-auto bg-white border border-[#E8E2D9] rounded-lg px-2 py-1.5"
                >
                  <option value="">Ưu tiên: mọi cửa hàng</option>
                  {catalog.merchants.map((m) => (
                    <option key={m.id} value={m.id}>Ưu tiên: {m.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Thống kê */}
            <div className="p-4 rounded-2xl bg-white border border-[#E8E2D9] space-y-3">
              <p className="text-sm text-[#626860]">
                Trong khu vực của bạn hiện có <strong className="text-2xl text-[#2F855A]">{stats?.uniquePeople ?? 0}</strong>{' '}
                người đang muốn ghép đơn.
              </p>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="p-2 rounded-lg bg-white">
                  <p className="text-lg font-bold text-[#25312B]">{stats?.joinedPeople ?? 0}</p>đã vào nhóm
                </div>
                <div className="p-2 rounded-lg bg-white">
                  <p className="text-lg font-bold text-[#25312B]">{stats?.seekingPeople ?? 0}</p>đang tìm nhóm
                </div>
                <div className="p-2 rounded-lg bg-white">
                  <p className="text-lg font-bold text-[#25312B]">{stats?.openGroups ?? 0}</p>nhóm đang mở
                </div>
              </div>
              <p className="text-xs text-[#626860]">
                Chỉ đếm người đã tham gia nhóm công khai hoặc tự bật chế độ tìm ghép đơn. Mỗi người chỉ tính một lần.
              </p>
              <button
                onClick={toggleIntent}
                disabled={!loc || !token}
                className={`w-full py-2 rounded-lg text-xs font-bold disabled:opacity-40 ${radar?.myIntent?.active ? 'bg-amber-500 text-[#25312B]' : 'bg-[#F3EEE8] text-[#2F855A] hover:bg-[#E8E2D9]'}`}
              >
                {radar?.myIntent?.active
                  ? 'Bạn đang được tính là người tìm ghép đơn · Tắt'
                  : 'Tôi cũng muốn ghép đơn ở đây (bật 30 phút)'}
              </button>
              {radar?.topMerchants?.length > 0 && (
                <div className="text-xs space-y-1 pt-2 border-t border-[#E8E2D9]">
                  <p className="text-[#626860] flex items-center gap-1">
                    <Store className="w-3.5 h-3.5" /> Cửa hàng nhiều người đặt:
                  </p>
                  {radar.topMerchants.map((m: any) => (
                    <p key={m.merchantId} className="text-[#25312B]">
                      {m.merchantName} — {m.people} người · {m.groups} nhóm
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Bản đồ / danh sách */}
          <div id="discover-groups" className="scroll-mt-6 flex flex-wrap gap-3 items-center justify-between">
            <h2 className="font-bold text-[#25312B]">
              Nhóm đặt hàng đang mở {loading && <span className="text-xs text-[#626860]">· đang tìm nhóm...</span>}
            </h2>
            <div className="flex gap-1 text-xs">
              <button onClick={() => setView('map')} className={`px-3 py-1.5 rounded-lg flex items-center gap-1 ${view === 'map' ? 'bg-[#F9734B] text-[#25312B]' : 'bg-[#F3EEE8]'}`}>
                <MapIcon className="w-3.5 h-3.5" /> Bản đồ
              </button>
              <button onClick={() => setView('list')} className={`px-3 py-1.5 rounded-lg flex items-center gap-1 ${view === 'list' ? 'bg-[#F9734B] text-[#25312B]' : 'bg-[#F3EEE8]'}`}>
                <List className="w-3.5 h-3.5" /> Danh sách
              </button>
            </div>
          </div>

          {error && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-700">{error}</div>}

          {!loc ? (
            <div className="p-8 rounded-2xl bg-white border border-[#E8E2D9] text-center text-sm text-[#626860]">
              Chọn điểm nhận hàng ở phía trên để tìm nhóm gần bạn.
            </div>
          ) : (
            <div className={`grid grid-cols-1 ${view === 'map' ? 'lg:grid-cols-2' : ''} gap-4`}>
              {view === 'map' && radar && (
                <div className="p-4 rounded-2xl bg-white border border-[#E8E2D9]">
                  <RadarMap center={radar.center} radius={radius} groups={groups} selected={selected} onSelect={setSelected} />
                  <p className="text-xs text-[#626860] text-center mt-2">
                    Vị trí điểm nhận làm tròn ~110 m, khoảng cách làm tròn 50 m. Chấm xanh lá: nhóm của bạn. Cam: nhóm còn chỗ. Xám: nhóm hết chỗ.
                  </p>
                </div>
              )}
              <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                {groups.length === 0 ? (
                  <div className="p-6 rounded-2xl bg-white border border-[#E8E2D9] text-sm text-[#626860] space-y-2">
                    <p>Chưa có nhóm công khai nào trong bán kính {fmtRadius(radius)}.</p>
                    <p>Hãy tăng bán kính, bật &quot;Tôi cũng muốn ghép đơn&quot; hoặc tự tạo nhóm công khai bên dưới.</p>
                  </div>
                ) : (
                  groups.map((g: any, i: number) => (
                    <div
                      key={g.cartId}
                      onMouseEnter={() => setSelected(g.cartId)}
                      className={`p-4 rounded-2xl bg-white border space-y-3 shadow-sm ${selected === g.cartId ? 'border-[#2F855A]' : 'border-[#E8E2D9]'}`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <p className="text-xs text-[#626860]">
                            Nhóm {i + 1}
                            {g.isMine ? ' · bạn đang ở nhóm này' : ''}
                          </p>
                          <p className="font-bold text-[#25312B]">{g.merchantName}</p>
                          <p className="text-xs text-[#626860] flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {g.pickupLabel} · ~{g.distanceMeters} m
                          </p>
                        </div>
                        <span className="inline-flex items-center gap-1 text-xs text-[#8A4B10] font-semibold whitespace-nowrap">
                          <Clock className="w-3.5 h-3.5" /> Còn {Math.ceil(remaining(g) / 60)} phút
                        </span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-[#626860]">
                        <span>
                          <Users className="inline w-3.5 h-3.5 text-[#2F855A]" /> {g.membersCount} người đang đặt
                        </span>
                        <span className="rounded-full bg-[#EAF4ED] px-2 py-1 text-[#2F855A] font-semibold">Còn {g.seatsLeft}/{g.maxMembers} chỗ</span>
                        <span>
                          Ship dự kiến: <b className="text-[#2F855A]">{formatVND(g.estimatedShipPerPerson)}</b>/người
                        </span>
                        <span>
                          Tiết kiệm ~<b className="text-[#2F855A]">{formatVND(g.estimatedSaving)}</b>
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-3 items-center justify-between pt-3 border-t border-[#E8E2D9]">
                        <span className="text-xs text-[#2F855A]">
                          Đang tìm người ghép đơn{g.requireApproval ? ' · cần Trưởng nhóm duyệt' : ''}
                        </span>
                        <button
                          onClick={() => openPreview(g.cartId)}
                          className="px-4 py-2 rounded-lg bg-[#F9734B] hover:bg-[#F58260] text-[#25312B] font-bold text-xs"
                        >
                          Xem nhóm và tham gia
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </section>

        {/* ===== TẠO NHÓM ===== */}
        <form hidden={tab !== 'lobby'} id="create-group" onSubmit={create} className="p-5 md:p-6 rounded-2xl bg-white border border-[#E8E2D9] space-y-3">
          <h2 className="font-bold text-[#25312B] flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-[#2F855A]" /> Rủ thêm người, chia nhẹ phí giao
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-xs text-[#626860] space-y-1">
              Cửa hàng
              <select value={form.merchantId} onChange={(e) => setF({ merchantId: e.target.value })} className={input}>
                {catalog.merchants.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} — ship {formatVND(m.baseShippingFee)}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[#626860] space-y-1">
              Khu vực / điểm nhận chuẩn
              <select value={form.hubId} onChange={(e) => setF({ hubId: e.target.value })} className={input}>
                {catalog.hubs.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[#626860] space-y-1">
              Tên điểm nhận chung (tùy chọn)
              <input value={form.pickupLabel} maxLength={80} onChange={(e) => setF({ pickupLabel: e.target.value })} placeholder="VD: Sảnh KTX khu A" className={input} />
            </label>
            <label className="text-xs text-[#626860] space-y-1">
              Số thành viên tối đa
              <input type="number" min={2} max={10} value={form.maxMembers} onChange={(e) => setF({ maxMembers: Number(e.target.value) })} className={input} />
            </label>
            <label className="text-xs text-[#626860] space-y-1">
              Thời gian chờ ghép (phút)
              <input type="number" min={10} max={120} value={form.windowMinutes} onChange={(e) => setF({ windowMinutes: Number(e.target.value) })} className={input} />
            </label>
            <label className="text-xs text-[#626860] space-y-1">
              Cách chia phí ship
              <select value={form.mode} onChange={(e) => setF({ mode: e.target.value })} className={input}>
                {MODES.map((m) => (
                  <option key={m.v} value={m.v}>{m.label}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="text-xs text-[#626860] block space-y-1">
            Quy định nhóm (tùy chọn)
            <input value={form.rules} maxLength={300} onChange={(e) => setF({ rules: e.target.value })} placeholder="VD: Có mặt nhận hàng trong 10 phút sau khi shipper tới" className={input} />
          </label>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-[#626860]">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.isPublic} onChange={(e) => setF({ isPublic: e.target.checked })} />
              Công khai: cho phép người lạ trong khu vực tìm thấy và tham gia (tắt = riêng tư, chỉ vào bằng mã)
            </label>
            {form.isPublic && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.requireApproval} onChange={(e) => setF({ requireApproval: e.target.checked })} />
                Phải được tôi duyệt (tắt = tự động chấp nhận người đủ điều kiện)
              </label>
            )}
            <label className={`flex items-center gap-2 ${gps ? '' : 'opacity-40'}`}>
              <input type="checkbox" disabled={!gps} checked={form.useGps} onChange={(e) => setF({ useGps: e.target.checked })} />
              Đặt điểm nhận tại vị trí GPS hiện tại (chỉ khi bạn đang ở nơi công cộng)
            </label>
          </div>
          <p className="text-xs text-[#8A4B10]">
            Chỉ chọn nơi công cộng (sảnh, cổng trường...). Không ghi số phòng hay địa chỉ nhà riêng.
          </p>
          <button
            disabled={!form.hubId || !form.merchantId}
            className="w-full md:w-auto px-6 py-2.5 rounded-xl bg-[#F9734B] hover:bg-[#F58260] disabled:opacity-40 text-[#25312B] font-bold text-sm"
          >
            Tạo nhóm
          </button>
        </form>

        {/* ===== PHỤ: MÃ MỜI ===== */}
        <div hidden={tab !== 'lobby'} id="join-code" className="p-5 rounded-2xl bg-[#FFF0E5] border border-[#E8E2D9] flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[#626860] flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[#2F855A]" /> Bạn có mã mời từ bạn bè?
          </p>
          {showCode ? (
            <form onSubmit={joinByCode} className="flex gap-2">
              <input aria-label="Mã tham gia nhóm" value={code} onChange={(e) => setCode(e.target.value)} placeholder="VD: K7P3QA" maxLength={16} autoFocus className={`${input} uppercase tracking-widest w-40`} />
              <button className="px-4 rounded-lg bg-[#F9734B] hover:bg-[#F58260] text-[#25312B] font-bold text-sm">Vào</button>
            </form>
          ) : (
            <button onClick={() => setShowCode(true)} className="px-4 py-2 rounded-lg bg-[#F3EEE8] hover:bg-[#E8E2D9] text-sm font-bold">
              Nhập mã tham gia
            </button>
          )}
        </div>
        <details className="rounded-2xl border border-[#E8E2D9] bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-[#626860]">Thử nghiệm với tài khoản mẫu</summary>
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
            <span className="text-[#626860]">Chế độ demo:</span>
            {session && (
              <button
                onClick={() => switchUser(SESSION_USER)}
                className={`px-3 py-1.5 rounded-lg font-bold ${userId === SESSION_USER ? 'bg-[#EAF4ED] text-[#2F855A] ring-1 ring-[#2F855A]' : 'bg-[#F3EEE8] text-[#626860]'}`}
              >
                Tài khoản của tôi
              </button>
            )}
            {DEMO_USERS.map((uid, i) => (
              <button
                key={uid}
                onClick={() => switchUser(uid)}
                className={`px-3 py-1.5 rounded-lg font-bold ${userId === uid ? 'bg-[#EAF4ED] text-[#2F855A] ring-1 ring-[#2F855A]' : 'bg-[#F3EEE8] text-[#626860]'}`}
              >
                Sinh viên #{i + 1}
              </button>
            ))}
        </div>

        </details>
      </div>

      {/* ===== MODAL ĐỒNG Ý GHÉP ĐƠN VỚI NGƯỜI LẠ ===== */}
      {preview && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-white border border-[#CDE2D3] p-6 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-bold text-[#25312B] flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#2F855A] shrink-0" /> Bạn đang tham gia đặt hàng chung với những người
                chưa quen biết.
              </h3>
              <button onClick={() => setPreview(null)} aria-label="Đóng">
                <X className="w-5 h-5 text-[#626860]" />
              </button>
            </div>
            <ul className="text-sm text-[#626860] space-y-1.5">
              <li>Cửa hàng: <b className="text-[#25312B]">{preview.merchantName}</b></li>
              <li>Điểm nhận hàng: <b className="text-[#25312B]">{preview.pickupLabel}</b></li>
              <li>Thành viên hiện có: <b className="text-[#25312B]">{preview.membersCount}/{preview.maxMembers}</b></li>
              <li>
                Chia phí ship: <b className="text-[#25312B]">{MODE_LABEL[preview.shippingMode] || preview.shippingMode}</b> (ship gốc{' '}
                {formatVND(preview.baseShippingFee)}, dự kiến ~{formatVND(preview.estimatedShipPerPerson)}/người)
              </li>
              <li>
                Dự kiến chốt đơn:{' '}
                <b className="text-[#25312B]">
                  {new Date(preview.expiresAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                </b>
              </li>
              <li>Quy định nhóm: <span className="text-[#25312B]">{preview.rules || 'Không có quy định riêng.'}</span></li>
              <li className="text-xs text-[#626860]">
                Bạn chỉ hiện bằng biệt danh. Có thể rời nhóm trước khi chốt đơn và trước khi thanh toán.
                {preview.requireApproval && ' Nhóm này cần Trưởng nhóm duyệt.'}
              </li>
            </ul>
            {!preview.alreadyMember && !preview.joinable && (
              <p className="text-xs text-red-700">Nhóm đã đầy, đã chốt hoặc hết hạn.</p>
            )}
            {joinStatus && <p className="text-xs text-[#8A4B10]">{joinStatus}</p>}
            <div className="flex gap-2">
              <button onClick={() => setPreview(null)} className="flex-1 py-2.5 rounded-xl bg-[#F3EEE8] hover:bg-[#E8E2D9] font-bold text-sm">
                Hủy
              </button>
              <button
                onClick={confirmJoin}
                disabled={!preview.alreadyMember && !preview.joinable}
                className="flex-1 py-2.5 rounded-xl bg-[#F9734B] hover:bg-[#F58260] disabled:opacity-40 text-[#25312B] font-bold text-sm flex items-center justify-center gap-1.5"
              >
                <UserPlus className="w-4 h-4" /> {preview.alreadyMember ? 'Vào nhóm' : 'Đồng ý và tham gia'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
