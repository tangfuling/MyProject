import http from '../../../common/network/HttpClient';
import type { WorkspaceArticlePage, WorkspaceOverview } from '../model/WorkspaceModels';

const WorkspaceApi = {
  overview(range: string) {
    return http.get<WorkspaceOverview>('/workspace/overview', { params: { range } });
  },
  articles(range: string, page: number, size: number) {
    return http.get<WorkspaceArticlePage>('/articles', { params: { range, page, size } });
  },
};

export default WorkspaceApi;
