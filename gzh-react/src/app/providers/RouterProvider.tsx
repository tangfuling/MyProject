import { BrowserRouter } from 'react-router-dom';
import AppRoutes from '../../common/router/routes';
import LoginModal from '../../common/ui/LoginModal';

export function RouterProvider() {
  return (
    <BrowserRouter>
      <AppRoutes />
      <LoginModal />
    </BrowserRouter>
  );
}
