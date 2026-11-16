'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShoppingBag } from 'lucide-react';

const inputClass =
  'w-full rounded-xl border border-[#D8D1C7] bg-[#FFF8F0] px-4 py-3 text-[#25312B] outline-none placeholder:text-[#626860] focus:border-[#2F855A] focus:ring-2 focus:ring-[#2F855A]/20';

const labelClass =
  'mb-2 block text-sm font-medium text-[#25312B]';

export default function RegisterPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    const form = event.currentTarget;
    const data = new FormData(form);

    const nickname = String(data.get('nickname') ?? '').trim();
    const password = String(data.get('password') ?? '');
    const confirmPassword = String(data.get('confirmPassword') ?? '');

    if (nickname.length < 2 || nickname.length > 30) {
      setError('Biệt danh cần từ 2 đến 30 ký tự, không tính khoảng trắng hai đầu.');
      form.querySelector<HTMLInputElement>('#nickname')?.focus();
      return;
    }

    if (password.length < 8) {
      setError('Mật khẩu cần ít nhất 8 ký tự.');
      form.querySelector<HTMLInputElement>('#password')?.focus();
      return;
    }

    if (password !== confirmPassword) {
      setError('Mật khẩu nhập lại chưa khớp. Bạn kiểm tra lại nhé.');
      form.querySelector<HTMLInputElement>('#confirmPassword')?.focus();
      return;
    }

    setMessage(
      'Thông tin hợp lệ theo quy tắc giao diện. Chưa tạo tài khoản vì chức năng đăng ký chưa được kết nối.',
    );
  }

  function clearFeedback() {
    setError('');
    setMessage('');
  }

  return (
    <main className="min-h-screen [&_button]:min-h-11 [&_button:disabled]:cursor-not-allowed [&_:focus-visible]:outline [&_:focus-visible]:outline-2 [&_:focus-visible]:outline-offset-2 [&_:focus-visible]:outline-[#2F855A] bg-[#FFF8F0] px-4 py-8 text-[#25312B] sm:px-8">
      <div className="mx-auto max-w-xl">
        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-lg text-sm text-[#626860] hover:text-[#2F855A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F855A]"
        >
          <ArrowLeft size={18} aria-hidden="true" />
          Về trang đăng nhập
        </Link>

        <section
          aria-labelledby="register-heading"
          className="mt-8 shadow-sm rounded-3xl border border-[#E8E2D9] bg-white p-6 sm:p-10"
        >
          <div className="flex items-center gap-3 text-[#2F855A]">
            <ShoppingBag size={28} aria-hidden="true" />
            <span className="text-2xl font-bold">Co-Cart</span>
          </div>

          <h1 id="register-heading" className="mt-7 text-3xl font-bold">
            Tạo tài khoản
          </h1>

          <p className="mt-3 leading-relaxed text-[#626860]">
            Bắt đầu mua chung và chia sẻ phí giao hàng cùng những người
            trong khu vực.
          </p>

          <p
            id="register-description"
            className="mt-3 text-sm text-[#626860]"
          >
            Bản xem trước giao diện — chưa kết nối đăng ký.
          </p>

          <form
            onSubmit={handleSubmit}
            onInput={clearFeedback}
            aria-describedby="register-description"
            className="mt-8 space-y-5"
          >
            <div>
              <label htmlFor="nickname" className={labelClass}>
                Biệt danh
              </label>
              <input
                id="nickname"
                name="nickname"
                type="text"
                autoComplete="nickname"
                placeholder="Ví dụ: Mèo đi mua sắm"
                required
                maxLength={30}
                aria-describedby="nickname-help"
                className={inputClass}
              />
              <p id="nickname-help" className="mt-2 text-sm text-[#626860]">
                Từ 2 đến 30 ký tự. Không dùng số điện thoại hoặc địa chỉ riêng.
              </p>
            </div>

            <div>
              <label htmlFor="email" className={labelClass}>
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="ban@example.com"
                required
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="password" className={labelClass}>
                Mật khẩu
              </label>
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Ít nhất 8 ký tự"
                required
                minLength={8}
                aria-describedby="password-help"
                className={inputClass}
              />
              <p id="password-help" className="mt-2 text-sm text-[#626860]">
                Khi thử giao diện, hãy dùng mật khẩu mẫu.
              </p>
            </div>

            <div>
              <label htmlFor="confirmPassword" className={labelClass}>
                Nhập lại mật khẩu
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Nhập lại mật khẩu phía trên"
                required
                minLength={8}
                className={inputClass}
              />
            </div>

            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-[#626860]">
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(event) => setShowPassword(event.target.checked)}
                aria-controls="password confirmPassword"
                className="h-4 w-4 accent-[#2F855A]"
              />
              Hiển thị mật khẩu
            </label>

            {error && (
              <p
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-relaxed text-red-700"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              className="w-full rounded-xl bg-[#F9734B] px-4 py-3 font-semibold text-[#25312B] transition hover:bg-[#F58260] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F855A] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            >
              Tạo tài khoản
            </button>

            <p role="status" className="text-sm leading-relaxed text-[#2F855A]">
              {message}
            </p>
          </form>

          <p className="mt-6 border-t border-[#E8E2D9] pt-6 text-center text-sm text-[#626860]">
            Đã có tài khoản?{' '}
            <Link
              href="/login"
              className="rounded font-semibold text-[#2F855A] underline underline-offset-4 hover:text-[#2F855A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F855A]"
            >
              Đăng nhập
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}