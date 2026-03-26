import http from '../../../common/network/HttpClient';
import type { HomeInfo } from '../model/HomeModels';

const HomeApi = {
  detail: async (): Promise<HomeInfo> => {
    try {
      return (await http.get('/demo/home')) as HomeInfo;
    } catch {
      return {
        title: 'com.niuma.demo',
        desc: 'fallback data for local demo',
      };
    }
  },
};

export default HomeApi;
