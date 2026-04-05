import { useLocation, useNavigate } from 'react-router-dom';
import { RoutePath } from '../router/RoutePath';
import { useAuthStore } from '../state/authStore';
import { useLoginModalStore } from '../state/loginModalStore';

type NavItem = {
  label: string;
  path: string;
  auth: boolean;
};

const navItems: NavItem[] = [
  { label: '首页', path: RoutePath.ROOT, auth: false },
  { label: '工作台', path: RoutePath.WORKSPACE, auth: true },
  { label: '个人中心', path: RoutePath.PROFILE, auth: true },
];

type MainNavTabsProps = {
  className?: string;
};

export default function MainNavTabs({ className }: MainNavTabsProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const openModal = useLoginModalStore((s) => s.openModal);

  const isActive = (path: string) => {
    if (path === RoutePath.ROOT) {
      return location.pathname === RoutePath.ROOT;
    }
    return location.pathname.startsWith(path);
  };

  const goTo = (item: NavItem) => {
    if (item.auth && !token) {
      openModal(item.path);
      return;
    }
    navigate(item.path);
  };

  return (
    <nav className={className || 'main-nav-tabs'} aria-label="Main navigation">
      {navItems.map((item) => (
        <button
          key={item.path}
          type="button"
          className={`main-nav-tab${isActive(item.path) ? ' active' : ''}`}
          onClick={() => goTo(item)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}


