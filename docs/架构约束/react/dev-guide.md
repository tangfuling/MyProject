# React 开发指导

> 技术栈: React 18 + TypeScript + Vite + React Router + TanStack Query + Zustand
> 适用范围: Web 前端（中后台 / H5 管理端）
> 架构模式: 函数组件 + Hooks + 模块化目录（common/pages/features）

---

## 一、项目结构

```
web-app/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .eslintrc.cjs
├── .prettierrc
│
├── src/
│   ├── app/                                 # 应用入口
│   │   ├── bootstrap.tsx
│   │   ├── App.tsx
│   │   └── providers/
│   │       ├── RouterProvider.tsx
│   │       ├── QueryProvider.tsx
│   │       └── StoreProvider.tsx
│   │
│   ├── common/                              # 公共层
│   │   ├── base/                            # 基础能力
│   │   │   ├── PageWrapper.tsx              # 页面包装（loading/error/权限态）
│   │   │   ├── ErrorBoundary.tsx
│   │   │   └── useViewModel.ts
│   │   │
│   │   ├── network/                         # 网络层
│   │   │   ├── HttpClient.ts                # axios 封装
│   │   │   ├── ApiConfig.ts
│   │   │   ├── ApiResponse.ts               # 统一响应类型
│   │   │   └── interceptors/
│   │   │       ├── authInterceptor.ts
│   │   │       └── errorInterceptor.ts
│   │   │
│   │   ├── router/                          # 路由层
│   │   │   ├── RoutePath.ts
│   │   │   ├── RouterManager.ts
│   │   │   └── routes.tsx
│   │   │
│   │   ├── state/                           # 全局状态
│   │   │   ├── authStore.ts
│   │   │   └── appStore.ts
│   │   │
│   │   ├── i18n/                            # 国际化
│   │   │   ├── index.ts
│   │   │   ├── zh-CN.json
│   │   │   └── en-US.json
│   │   │
│   │   ├── log/
│   │   │   └── Logger.ts
│   │   │
│   │   └── ui/                              # 公共 UI 组件
│   │       ├── Loading.tsx
│   │       ├── ErrorState.tsx
│   │       ├── EmptyState.tsx
│   │       └── theme/
│   │           ├── tokens.css
│   │           └── reset.css
│   │
│   ├── pages/                               # 页面模块（1 目录 = 1 页面）
│   │   └── {pagename}/
│   │       ├── view/
│   │       │   └── {PageName}Page.tsx
│   │       ├── viewmodel/
│   │       │   └── use{PageName}ViewModel.ts
│   │       ├── model/
│   │       │   └── {PageName}Models.ts
│   │       └── api/
│   │           └── {PageName}Api.ts
│   │
│   ├── features/                            # 功能模块（无独立页面）
│   │   └── auth/
│   │       ├── AuthGuard.tsx
│   │       └── permission.ts
│   │
│   └── assets/                              # 资源
│       ├── images/
│       ├── icons/
│       └── fonts/
│
└── pnpm-lock.yaml
```

---

## 二、核心依赖

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.23.0",
    "@tanstack/react-query": "^5.51.0",
    "zustand": "^4.5.0",
    "axios": "^1.7.0",
    "i18next": "^23.12.0",
    "react-i18next": "^15.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vite": "^5.3.0",
    "eslint": "^9.0.0",
    "prettier": "^3.0.0",
    "vitest": "^2.0.0",
    "@testing-library/react": "^16.0.0"
  }
}
```

> **依赖管理原则**：状态管理只保留一套全局方案（Zustand）；服务端状态只保留一套缓存方案（TanStack Query）；禁止并行引入多套同类框架。

---

## 三、基础能力关键实现

### 3.1 PageWrapper（组合方式，非继承）

```tsx
// common/base/PageWrapper.tsx
import React from 'react';
import Loading from '../ui/Loading';
import ErrorState from '../ui/ErrorState';

type Props = {
  loading?: boolean;
  error?: string | null;
  children: React.ReactNode;
};

export default function PageWrapper({ loading, error, children }: Props) {
  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;
  return <>{children}</>;
}
```

### 3.2 HttpClient（统一网络封装）

```ts
// common/network/HttpClient.ts
import axios from 'axios';
import { getAuthToken, clearAuthToken } from '../state/authStore';

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 10000,
});

http.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (response) => {
    const payload = response.data as { code: number; message: string; data: unknown };
    if (payload.code !== 0) {
      return Promise.reject(new Error(payload.message));
    }
    return payload.data;
  },
  (error) => {
    if (error.response?.status === 401) clearAuthToken();
    return Promise.reject(error);
  }
);

export default http;
```

### 3.3 useViewModel（统一页面状态模式）

```ts
// common/base/useViewModel.ts
import { useMemo } from 'react';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';

export function useViewModel<TData>(
  options: UseQueryOptions<TData, Error, TData, readonly unknown[]>
) {
  const query = useQuery(options);

  return useMemo(
    () => ({
      data: query.data,
      loading: query.isPending,
      error: query.error?.message ?? null,
      refresh: query.refetch,
    }),
    [query.data, query.isPending, query.error, query.refetch]
  );
}
```

---

## 四、一行调用示例

### 页面 ViewModel 调接口

```ts
// pages/orderdetail/viewmodel/useOrderDetailViewModel.ts
import { useViewModel } from '../../../common/base/useViewModel';
import OrderApi from '../api/OrderApi';

export function useOrderDetailViewModel(orderId: string) {
  return useViewModel({
    queryKey: ['order-detail', orderId],
    queryFn: () => OrderApi.detail(orderId),
    staleTime: 60_000,
  });
}
```

### 页面组件（函数组件 + PageWrapper）

```tsx
// pages/orderdetail/view/OrderDetailPage.tsx
import PageWrapper from '../../../common/base/PageWrapper';
import { useOrderDetailViewModel } from '../viewmodel/useOrderDetailViewModel';

export default function OrderDetailPage() {
  const vm = useOrderDetailViewModel('10001');

  return (
    <PageWrapper loading={vm.loading} error={vm.error}>
      <div>{vm.data?.orderNo}</div>
    </PageWrapper>
  );
}
```

### 路由跳转与全局状态

```ts
RouterManager.navigate(RoutePath.ORDER_DETAIL, { orderId: '10001' });
useAppStore.getState().setPageTitle('订单详情');
```

---

## 五、列表实现规范

> 统一使用“分页 + 虚拟列表”方案。数据量超过 100 条时，必须启用虚拟滚动。

### 标准写法

```tsx
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import { memo, useCallback } from 'react';

const Row = memo(({ index, style, data }: ListChildComponentProps) => {
  const item = data[index];
  return (
    <div style={style} key={item.id}>
      {item.name}
    </div>
  );
});

export default function ProductList({ list }: { list: Array<{ id: string; name: string }> }) {
  const itemData = list;
  const renderRow = useCallback(Row, []);

  return (
    <FixedSizeList
      height={600}
      width="100%"
      itemCount={list.length}
      itemSize={52}
      itemData={itemData}
    >
      {renderRow}
    </FixedSizeList>
  );
}
```

### 禁止写法

```tsx
// ❌ 禁止：大列表直接 map 全量渲染
<div>{list.map((item) => <Row key={item.id} item={item} />)}</div>

// ❌ 禁止：使用 index 作为 key
{list.map((item, index) => <Row key={index} item={item} />)}

// ❌ 禁止：列表项内发起网络请求
function Row({ item }) {
  useEffect(() => { fetch('/api/detail'); }, []);
}
```

---

## 六、状态管理与路由约束

| 约束项 | 说明 |
|--------|------|
| **服务端状态统一用 React Query** | 列表/详情/搜索等接口数据全部走 Query 缓存与失效机制 |
| **客户端状态统一用 Zustand** | 登录态、主题态、全局筛选条件放入 Store，禁止散落全局变量 |
| **路由定义集中管理** | 所有路由必须在 `common/router/routes.tsx` 统一声明 |
| **导航入口统一** | 页面跳转统一走 `RouterManager`，禁止组件间透传 `navigate` 回调 |
| **权限守卫前置** | 受控页面必须通过 `AuthGuard` 包装，禁止在页面内部零散鉴权 |

---

## 七、工程化与发布约束

| 约束项 | 说明 | 级别 |
|--------|------|------|
| **TypeScript 严格模式** | `strict: true` 必须开启 | 强制 |
| **ESLint + Prettier** | 代码风格自动校验与修复 | 强制 |
| **提交门禁** | PR 必须通过 lint/test/build 三项校验 | 强制 |
| **按路由分包** | 页面级组件使用 `React.lazy` 做代码分割 | 强制 |
| **环境变量白名单** | 仅允许读取 `VITE_*` 变量 | 强制 |
| **SourceMap 管控** | 生产 SourceMap 仅在内部可访问 | 推荐 |
| **错误监控** | 前端运行时错误统一上报（Sentry/自建平台） | 推荐 |

---

## 八、文案资源化（强制）

### 8.1 核心规则

1. **禁止写死文案**：所有用户可见文案必须放在 `src/common/i18n/*.json`。
2. **统一引用方式**：页面内统一使用 `t('key')` 引用文案。
3. **动态文案必须模板化**：使用 `t('order_count', { count })`，禁止字符串拼接。

### 8.2 图标与图片规范

1. 图标、线性插画优先使用 SVG（SVGR 或 icon 组件方式引入）。
2. 仅照片、复杂纹理使用 PNG/JPG/WebP。
3. 图片资源命名必须带模块前缀（如 `pages_orderdetail_banner.png`）。

---

## 九、禁止事项

1. **禁止**页面直接使用 `axios/fetch`，必须通过 `common/network/HttpClient` 封装。
2. **禁止**在组件中同时维护“接口缓存状态”和“本地重复状态”两份数据。
3. **禁止**在 JSX 中大面积内联函数与内联对象样式导致高频重渲染。
4. **禁止**在 `pages/` 目录外散落页面私有代码。
5. **禁止**将接口返回对象直接透传到 UI，不做模型转换与字段收敛。
6. **禁止**绕开 `AuthGuard` 在页面内手写重复权限判断。
7. **禁止**在生产环境启用调试日志与开发开关。
8. **禁止**使用 `any` 逃避类型约束（确需使用需附带注释说明原因）。
9. **禁止**使用含义模糊的 `utils/` 万能目录承载业务逻辑。
10. **禁止**无测试覆盖的核心流程（登录、支付、提交）直接发布。
