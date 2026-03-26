import { useViewModel } from '../../../common/base/useViewModel';
import HomeApi from '../api/HomeApi';

export function useHomeViewModel() {
  return useViewModel({
    queryKey: ['home-detail'],
    queryFn: () => HomeApi.detail(),
  });
}
