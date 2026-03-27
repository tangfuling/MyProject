import http from '../../../common/network/HttpClient';
import type { ArticlePage, Overview } from '../model/DataModels';

const DataApi = {
  overview(range: string) {
    return http.get<Overview>('/articles/overview', { params: { range } });
  },
  page(range: string, page: number, size: number) {
    return http.get<ArticlePage>('/articles', { params: { range, page, size } });
  },
};

export default DataApi;
