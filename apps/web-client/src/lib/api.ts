export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export const formatVND = (amount: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount || 0);

export const DEMO_USERS = ['user-sv-1', 'user-sv-2', 'user-sv-3'];
const DEMO_KEY = 'cocart_demo_user';

/** Nhân vật sandbox dùng chung giữa trang chủ và trang giỏ. */
export const getDemoUser = () =>
  (typeof window !== 'undefined' && localStorage.getItem(DEMO_KEY)) || DEMO_USERS[0];
export const setDemoUser = (uid: string) => localStorage.setItem(DEMO_KEY, uid);

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
