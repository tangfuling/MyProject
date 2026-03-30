import http from '../../../common/network/HttpClient';
import type { ArticlePage, Overview, UserProfileBrief } from '../model/DataModels';

const DataApi = {
  profile() {
    return http.get<UserProfileBrief>('/user/profile');
  },
  overview(range: string) {
    return http.get<Overview>('/articles/overview', { params: { range } });
  },
  page(range: string, page: number, size: number) {
    return http.get<ArticlePage>('/articles', { params: { range, page, size } });
  },
};

export default DataApi;
