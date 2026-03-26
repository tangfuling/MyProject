import { BrowserRouter } from 'react-router-dom';
import AppRoutes from '../../common/router/routes';

export function RouterProvider() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
