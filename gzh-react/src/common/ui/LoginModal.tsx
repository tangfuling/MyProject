import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../state/authStore';
import { useLoginModalStore } from '../state/loginModalStore';
import LoginApi from '../../pages/login/api/LoginApi';

const PHONE_REG = /^1[3-9]\d{9}$/;

export default function LoginModal() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const open = useLoginModalStore((s) => s.open);
  const redirect = useLoginModalStore((s) => s.redirect);
  const closeModal = useLoginModalStore((s) => s.closeModal);

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      return;
    }
    setCode('');
    setError(null);
  }, [open]);

  useEffect(() => {
    if (countdown <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  const sendCode = async () => {
    if (!PHONE_REG.test(phone)) {
      setError('请输入正确的手机号。');
      return;
    }
    setError(null);
    setSending(true);
    try {
      await LoginApi.sendCode(phone);
      setCountdown(60);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : '验证码发送失败。');
    } finally {
      setSending(false);
    }
  };

  const login = async () => {
    if (!PHONE_REG.test(phone)) {
      setError('请输入正确的手机号。');
      return;
    }
    if (!code.trim()) {
      setError('请输入验证码。');
      return;
    }
    setError(null);
    setLoggingIn(true);
    try {
      const result = await LoginApi.login(phone, code.trim());
      setAuth(result.token, result.user);
      closeModal();
      navigate(redirect, { replace: true });
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : '登录失败。');
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <div
      className={`modal-overlay${open ? ' open' : ''}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          closeModal();
        }
      }}
    >
      <div className="login-modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={closeModal}>x</button>
        <div className="login-modal-title">登录 / 注册</div>
        <div className="login-modal-sub">使用手机验证码登录，新用户将自动注册。</div>

        <div className="form-field">
          <div className="form-label">手机号</div>
          <input
            className="input"
            type="text"
            placeholder="请输入手机号"
            value={phone}
            onChange={(event) => setPhone(event.target.value.trim())}
          />
        </div>

        <div className="form-field">
          <div className="form-label">验证码</div>
          <div className="code-row">
            <input
              className="input"
              type="text"
              placeholder="请输入验证码"
              value={code}
              onChange={(event) => setCode(event.target.value.trim())}
            />
            <button type="button" className="code-btn" disabled={sending || countdown > 0} onClick={() => void sendCode()}>
              {countdown > 0 ? `${countdown}s` : (sending ? '发送中...' : '获取验证码')}
            </button>
          </div>
        </div>

        {error ? <div className="error-tip">{error}</div> : null}

        <button
          className="btn btn-primary"
          type="button"
          style={{ width: '100%', padding: '13px', fontSize: '14px', marginTop: '14px' }}
          disabled={loggingIn}
          onClick={() => void login()}
        >
          {loggingIn ? '登录中...' : '登录'}
        </button>
        <div className="login-tip">新用户赠送 <b>CNY 1.00</b> 试用额度。</div>
      </div>
    </div>
  );
}

