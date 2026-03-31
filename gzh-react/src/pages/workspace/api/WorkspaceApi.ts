import http from '../../../common/network/HttpClient';
import type { WorkspaceOverview } from '../model/WorkspaceModels';

const WorkspaceApi = {
  overview(range: string) {
    return http.get<WorkspaceOverview>('/workspace/overview', { params: { range } });
  },
};

export default WorkspaceApi;
