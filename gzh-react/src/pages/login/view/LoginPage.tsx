import { RoutePath } from '../../../common/router/RoutePath';
import { useAuthStore } from '../../../common/state/authStore';
import { useLoginViewModel } from '../viewmodel/useLoginViewModel';
import { Navigate } from 'react-router-dom';

export default function LoginPage() {
  const token = useAuthStore((s) => s.token);
  const vm = useLoginViewModel();

  if (token) {
    return <Navigate to={RoutePath.DATA} replace />;
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <h1 className="login-title">公众号数据运营助手</h1>
        <p className="login-sub">手机号验证码登录，新用户自动注册并赠送免费额度</p>

        <label className="field-label" htmlFor="phone">手机号</label>
        <input
          id="phone"
          className="field-input"
          placeholder="13800001234"
          value={vm.phone}
          onChange={(event) => vm.setPhone(event.target.value.trim())}
        />

        <label className="field-label" htmlFor="code">验证码</label>
        <div className="code-row">
          <input
            id="code"
            className="field-input"
            placeholder="6位验证码"
            value={vm.code}
            onChange={(event) => vm.setCode(event.target.value.trim())}
          />
          <button type="button" className="ghost-btn" disabled={vm.sending || vm.countdown > 0} onClick={vm.sendCode}>
            {vm.countdown > 0 ? `${vm.countdown}s` : '获取验证码'}
          </button>
        </div>

        {vm.error ? <div className="error-tip">{vm.error}</div> : null}

        <button type="button" className="primary-btn" disabled={vm.logining} onClick={vm.login}>
          {vm.logining ? '登录中...' : '登录'}
        </button>
      </section>
    </main>
  );
}
