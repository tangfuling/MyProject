import '../common/ui/theme/reset.css';
import '../common/ui/theme/tokens.css';
import { QueryProvider } from './providers/QueryProvider';
import { RouterProvider } from './providers/RouterProvider';
import { StoreProvider } from './providers/StoreProvider';
import '../common/i18n';

export default function bootstrap() {
  return (
    <StoreProvider>
      <QueryProvider>
        <RouterProvider />
      </QueryProvider>
    </StoreProvider>
  );
}
