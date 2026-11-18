export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export const formatVND = (amount: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount || 0);

export const DEMO_USERS = ['user-sv-1', 'user-sv-2', 'user-sv-3'];
/** Định danh giả cho "tài khoản thật đang đăng nhập" trong bộ chuyển nhân vật sandbox. */
export const SESSION_USER = 'me';
const DEMO_KEY = 'cocart_demo_user';
const SESSION_KEY = 'cocart_session';

export type Profile = { id: string; fullName: string; phoneNumber: string; email: string; defaultHubId?: string };
export type Session = { token: string; profile: Profile };

export const getSession = (): Session | null => {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
};
export const clearSession = () => {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(DEMO_KEY);
};
export const maskPhone = (p = '') => (p.length > 5 ? `${p.slice(0, 2)}xx…${p.slice(-3)}` : '***');

/** Nhân vật đang dùng: tài khoản đã đăng nhập (nếu có) hoặc tài khoản mẫu sandbox. */
export const getDemoUser = () => {
  if (typeof window === 'undefined') return DEMO_USERS[0];
  const v = localStorage.getItem(DEMO_KEY);
  if (v === SESSION_USER && !getSession()) return DEMO_USERS[0];
  return v || (getSession() ? SESSION_USER : DEMO_USERS[0]);
};
export const setDemoUser = (uid: string) => localStorage.setItem(DEMO_KEY, uid);

/** JWT cho nhân vật: tài khoản thật dùng token đã lưu, tài khoản mẫu đổi qua demo-login. */
export async function tokenFor(uid: string): Promise<string> {
  if (uid === SESSION_USER) {
    const s = getSession();
    if (!s) throw new Error('Phiên đăng nhập đã hết, hãy đăng nhập lại.');
    return s.token;
  }
  return demoLogin(uid);
}

async function authRequest(path: 'login' | 'register', body: object): Promise<Session> {
  const res = await fetch(`${API_URL}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    throw new Error(msg || 'Không kết nối được máy chủ.');
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  setDemoUser(SESSION_USER);
  return data;
}

export const login = (email: string, password: string) => authRequest('login', { email, password });
export const register = (body: {
  fullName: string;
  phone: string;
  email: string;
  password: string;
  defaultHubId?: string;
}) => authRequest('register', body);

/** Đăng nhập demo (sandbox): đổi userId của dữ liệu seed lấy JWT. */
export async function demoLogin(userId: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Đăng nhập demo thất bại');
  return data.token;
}

/** Gọi REST có đính kèm Bearer token; danh tính do server lấy từ JWT, không gửi userId trong body. */
export async function authedPost<T = any>(path: string, token: string, body: object): Promise<T> {
  return authedFetch<T>('POST', path, token, body);
}

export async function authedFetch<T = any>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  token: string,
  body?: object,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    throw new Error(msg || 'Yêu cầu thất bại');
  }
  return data;
}
