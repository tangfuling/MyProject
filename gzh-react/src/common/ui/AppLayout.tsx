import type { PropsWithChildren } from 'react';
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { RoutePath } from '../router/RoutePath';
import { useAuthStore } from '../state/authStore';
import SettingsApi from '../../pages/settings/api/SettingsApi';

const links = [
  { to: RoutePath.DATA, label: '数据' },
  { to: RoutePath.ANALYSIS, label: '分析' },
  { to: RoutePath.CHAT, label: '对话' },
  { to: RoutePath.SETTINGS, label: '我的' },
];

const models = ['qwen', 'doubao', 'gpt', 'claude'];

export default function AppLayout({ children }: PropsWithChildren) {
  const profile = useAuthStore((s) => s.profile);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  const onModelChange = async (nextModel: string) => {
    if (!profile || nextModel === profile.aiModel) {
      return;
    }
    setSwitchingModel(true);
    setModelError(null);
    try {
      await SettingsApi.updateModel(nextModel);
      updateProfile({ aiModel: nextModel });
    } catch (error) {
      setModelError(error instanceof Error ? error.message : '模型切换失败');
    } finally {
      setSwitchingModel(false);
    }
  };

  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <div className="brand">公众号运营助手</div>
        <div className="brand-sub">AI 驱动复盘</div>
        <nav className="sidebar-nav">
          {links.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-user">{profile?.phone ?? '未登录'}</div>
      </aside>
      <section className="app-content">
        <header className="app-topbar">
          <div className="topbar-title">工作台</div>
          <label className="model-switch" htmlFor="modelSwitcher">
            <span>AI 模型</span>
            <select
              id="modelSwitcher"
              value={profile?.aiModel ?? 'qwen'}
              disabled={switchingModel}
              onChange={(event) => {
                void onModelChange(event.target.value);
              }}
            >
              {models.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          </label>
        </header>
        {modelError ? <div className="error-tip">{modelError}</div> : null}
        {children}
      </section>
    </div>
  );
}
