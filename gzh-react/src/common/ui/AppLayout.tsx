import type { PropsWithChildren } from 'react';
import { NavLink } from 'react-router-dom';
import { RoutePath } from '../router/RoutePath';
import { useAuthStore } from '../state/authStore';

const links = [
  { to: RoutePath.DATA, label: '数据' },
  { to: RoutePath.ANALYSIS, label: '分析' },
  { to: RoutePath.CHAT, label: '对话' },
  { to: RoutePath.SETTINGS, label: '我的' },
];

export default function AppLayout({ children }: PropsWithChildren) {
  const profile = useAuthStore((s) => s.profile);
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
      <section className="app-content">{children}</section>
    </div>
  );
}
