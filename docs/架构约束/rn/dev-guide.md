# React Native 开发指导

> 技术栈: React Native 0.73 + React 18 + Hermes + JavaScript
> 适用范围: 非首页页面（默认）
> 首页由 Android / iOS 各自原生开发；非首页页面优先由 RN 承载
> 例外约束: 命中启动链路、首页各 Tab、IM 主链路、Camera 类页面（扫码/拍摄/录制/实时预览）等清单时，必须原生主实现。详见 `../rn-native-exception-constraints.md`

---

## 一、项目结构

> **与原生工程的关系**：`mall-rn/` 是独立的 RN 工程，通过 Metro 打包 JS Bundle，分别嵌入 `mall-android/` 和 `mall-ios/` 运行。原生端通过组件名启动对应的 RN 页面。

```
mall-rn/
├── index.js                          # 入口：组件注册
├── package.json                      # 依赖管理
├── metro.config.js                   # Metro 打包配置
├── babel.config.js                   # Babel 配置
│
├── src/
│   ├── config/                       # 配置
│   │   └── entryComponents.js        # 可从原生启动的页面注册表
│   │
│   ├── common/                       # 公共层
│   │   ├── base/                     # 基础能力
│   │   │   ├── PageWrapper.js        # 页面包装高阶组件（loading/error）
│   │   │   ├── useViewModel.js       # ViewModel Hook（统一 loading/error/异步）
│   │   │   └── BaseApi.js            # Api 基类（统一异常处理）
│   │   │
│   │   ├── network/                  # 网络层
│   │   │   ├── HttpClient.js         # HTTP 请求封装（一行代码调用）
│   │   │   ├── ApiConfig.js          # baseUrl、超时等
│   │   │   └── interceptors/
│   │   │       ├── authInterceptor.js    # 自动带 token
│   │   │       └── logInterceptor.js     # 请求日志（仅 __DEV__）
│   │   │
│   │   ├── router/                   # 路由
│   │   │   ├── RouterManager.js      # RN 内部路由 + 原生跳转
│   │   │   └── RoutePath.js          # 路由路径常量
│   │   │
│   │   ├── storage/                  # 本地存储
│   │   │   └── PreferenceManager.js  # AsyncStorage 封装
│   │   │
│   │   ├── bridge/                   # 原生桥接
│   │   │   └── NativeBridge.js       # NativeModules 统一封装
│   │   │
│   │   ├── image/                    # 图片
│   │   │   └── ImageLoader.js        # FastImage 封装
│   │   │
│   │   ├── log/                      # 日志
│   │   │   └── Logger.js             # 统一日志
│   │   │
│   │   ├── i18n/                     # 国际化
│   │   │   ├── index.js              # i18n 初始化
│   │   │   └── zh.json               # 中文文案
│   │   │
│   │   └── ui/                       # 公共 UI 组件
│   │       ├── LoadingView.js
│   │       ├── ErrorView.js
│   │       ├── EmptyView.js
│   │       └── theme/
│   │           ├── colors.js         # 全局颜色
│   │           ├── spacing.js        # 全局间距/尺寸
│   │           └── typography.js     # 全局字体
│   │
│   ├── pages/                        # 页面模块（1 目录 = 1 页面）
│   │   └── {pagename}/
│   │       ├── view/
│   │       │   └── {PageName}Screen.js
│   │       ├── viewmodel/
│   │       │   └── use{PageName}ViewModel.js
│   │       ├── model/
│   │       │   └── {PageName}Models.js
│   │       └── api/
│   │           └── {PageName}Api.js
│   │
│   ├── features/                     # 功能模块（无界面）
│   │   └── auth/
│   │       ├── TokenManager.js
│   │       └── AuthState.js
│   │
│   └── assets/                       # 静态资源（前缀: 模块路径）
│       └── images/
│
└── scripts/                          # 构建脚本
    └── build-bundle.sh               # 打包 Bundle
```

---

## 二、核心依赖

```json
{
  "dependencies": {
    "react": "18.2.0",
    "react-native": "0.73.0",
    "react-native-screens": "^3.29.0",
    "react-native-safe-area-context": "^5.6.0",
    "react-native-svg": "^15.0.0",
    "react-native-fast-image": "^8.6.0",
    "@react-native-async-storage/async-storage": "^1.21.0"
  }
}
```

> **依赖管理原则**：只引入必要的社区包，优先使用 RN 内置能力。新增依赖需评估包体积、维护状态、原生链接复杂度。

---

## 三、基础能力关键实现

### 3.1 PageWrapper（高阶组件，非继承）

```javascript
// common/base/PageWrapper.js
import React from 'react';
import { View, StyleSheet } from 'react-native';
import LoadingView from '../ui/LoadingView';
import ErrorView from '../ui/ErrorView';

export function withPageWrapper(WrappedComponent) {
  return function PageWrappedComponent(props) {
    const { isLoading, errorMessage, ...restProps } = props;

    return (
      <View style={styles.container}>
        <WrappedComponent {...restProps} />
        {isLoading && <LoadingView />}
        {errorMessage && <ErrorView message={errorMessage} />}
      </View>
    );
  };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
```

### 3.2 useViewModel Hook（替代类继承）

```javascript
// common/base/useViewModel.js
import { useReducer, useCallback } from 'react';

const initialState = {
  isLoading: false,
  errorMessage: null,
};

function viewModelReducer(state, action) {
  switch (action.type) {
    case 'LOADING':
      return { ...state, isLoading: true, errorMessage: null };
    case 'SUCCESS':
      return { ...state, isLoading: false };
    case 'ERROR':
      return { ...state, isLoading: false, errorMessage: action.payload };
    default:
      return state;
  }
}

export function useViewModel() {
  const [state, dispatch] = useReducer(viewModelReducer, initialState);

  const execute = useCallback(async (asyncFn, onSuccess, onError) => {
    dispatch({ type: 'LOADING' });
    try {
      const result = await asyncFn();
      dispatch({ type: 'SUCCESS' });
      onSuccess?.(result);
    } catch (error) {
      dispatch({ type: 'ERROR', payload: error.message || '未知错误' });
      onError?.(error);
    }
  }, []);

  return { ...state, execute };
}
```

### 3.3 HttpClient（网络封装）

```javascript
// common/network/HttpClient.js
import { ApiConfig } from './ApiConfig';
import { authInterceptor } from './interceptors/authInterceptor';
import { logInterceptor } from './interceptors/logInterceptor';

class HttpClient {
  async request(method, path, options = {}) {
    const url = `${ApiConfig.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...authInterceptor.getHeaders(),
      ...options.headers,
    };

    const config = {
      method,
      headers,
      ...(options.body && { body: JSON.stringify(options.body) }),
    };

    if (__DEV__) logInterceptor.logRequest(method, url, config);

    const response = await fetch(url, config);

    if (__DEV__) logInterceptor.logResponse(url, response);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  get(path, options) { return this.request('GET', path, options); }
  post(path, options) { return this.request('POST', path, options); }
  put(path, options) { return this.request('PUT', path, options); }
  delete(path, options) { return this.request('DELETE', path, options); }
}

export default new HttpClient();
```

---

## 四、一行调用示例

### 网络请求

```javascript
// pages/productdetail/viewmodel/useProductDetailViewModel.js
import { useEffect, useState } from 'react';
import { useViewModel } from '../../../common/base/useViewModel';
import ProductDetailApi from '../api/ProductDetailApi';

export function useProductDetailViewModel(productId) {
  const { isLoading, errorMessage, execute } = useViewModel();
  const [product, setProduct] = useState(null);

  useEffect(() => {
    execute(
      () => ProductDetailApi.getDetail(productId),
      (data) => setProduct(data)
    );
  }, [productId, execute]);

  return { isLoading, errorMessage, product };
}
```

### 页面组件

```javascript
// pages/productdetail/view/ProductDetailScreen.js
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { withPageWrapper } from '../../../common/base/PageWrapper';
import { useProductDetailViewModel } from '../viewmodel/useProductDetailViewModel';

function ProductDetailScreen({ route }) {
  const { productId } = route.params;
  const { isLoading, errorMessage, product } = useProductDetailViewModel(productId);

  return (
    <View style={styles.container}>
      {product && (
        <>
          <Text style={styles.title}>{product.name}</Text>
          <Text style={styles.price}>{product.price}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 18, fontWeight: 'bold' },
  price: { fontSize: 16, color: '#E53935', marginTop: 8 },
});

export default withPageWrapper(ProductDetailScreen);
```

### 路由跳转

```javascript
// RN 内部跳转
RouterManager.navigate(RoutePath.PRODUCT_DETAIL, { productId: id });
RouterManager.back();

// 跳转到原生页面（通过 Bridge）
NativeBridge.navigateNative('home');
```

---

## 五、组件注册（entryComponents）

```javascript
// config/entryComponents.js
import ProductDetailScreen from '../pages/productdetail/view/ProductDetailScreen';
import CategoryScreen from '../pages/category/view/CategoryScreen';

const ENTRY_COMPONENTS = [
  { name: 'ProductDetailScreen', component: ProductDetailScreen },
  { name: 'CategoryScreen', component: CategoryScreen },
];

export default ENTRY_COMPONENTS;
```

```javascript
// index.js
import { AppRegistry } from 'react-native';
import ENTRY_COMPONENTS from './src/config/entryComponents';

ENTRY_COMPONENTS.forEach(({ name, component }) => {
  AppRegistry.registerComponent(name, () => component);
});
```

> **原生端启动 RN 页面**：
> - Android: `ReactNativeActivity` 通过 Intent Extra 传入组件名
> - iOS: `RNViewController` 通过初始化参数传入组件名

---

## 六、列表实现规范

> 统一使用 `FlatList` / `SectionList`。

### 标准写法

```javascript
// 1. item 组件独立提取 + React.memo
const ProductItem = React.memo(function ProductItem({ item, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.item}>
      <FastImage source={{ uri: item.imageUrl }} style={styles.image} />
      <View style={styles.info}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.price}>{item.price}</Text>
      </View>
    </TouchableOpacity>
  );
});

// 2. 列表页使用 FlatList + keyExtractor + useCallback
function ProductListScreen() {
  const { products, isLoading } = useProductListViewModel();

  const renderItem = useCallback(({ item }) => (
    <ProductItem
      item={item}
      onPress={() => RouterManager.navigate(RoutePath.PRODUCT_DETAIL, { productId: item.id })}
    />
  ), []);

  const keyExtractor = useCallback((item) => item.id, []);

  return (
    <FlatList
      data={products}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      getItemLayout={(data, index) => ({
        length: ITEM_HEIGHT,
        offset: ITEM_HEIGHT * index,
        index,
      })}
    />
  );
}
```

### 禁止写法

```javascript
// ❌ 禁止：ScrollView + map 全量渲染
<ScrollView>
  {products.map(item => <ProductItem key={item.id} item={item} />)}
</ScrollView>

// ❌ 禁止：用 index 做 key
keyExtractor={(item, index) => index.toString()}

// ❌ 禁止：renderItem 中创建匿名函数（导致 re-render）
renderItem={({ item }) => (
  <ProductItem item={item} onPress={() => navigate(item.id)} />
)}
// 应使用 useCallback 包装

// ❌ 禁止：内联 style 对象
<View style={{ flex: 1, padding: 16 }}>
// 应使用 StyleSheet.create()

// ❌ 禁止：Image 不指定尺寸
<Image source={{ uri: url }} />
// 必须指定 width/height
```

---

## 七、性能约束清单

| 约束项 | 说明 | 级别 |
|--------|------|------|
| **FlatList 替代 ScrollView+map** | 列表超过一屏必须用 FlatList | 强制 |
| **React.memo 包装 item** | 列表 item 必须用 React.memo 避免不必要 re-render | 强制 |
| **useCallback 包装回调** | 传给子组件的回调必须用 useCallback | 强制 |
| **StyleSheet.create** | 所有样式必须预定义，禁止内联 style 对象 | 强制 |
| **Image 显式尺寸** | 图片必须指定 width/height | 强制 |
| **getItemLayout** | item 高度固定时必须提供 | 推荐 |
| **useMemo 缓存计算** | 复杂数据转换使用 useMemo 缓存 | 推荐 |
| **避免频繁 setState** | 批量更新状态，避免连续多次 setState | 推荐 |
| **减少 Bridge 调用** | 批量操作优先，禁止在滚动/动画中高频调 Bridge | 强制 |
| **InteractionManager** | 耗时操作放在动画/转场完成后执行 | 推荐 |

---

## 八、原生集成约束

### 8.1 Android 集成

```
mall-android 中的 RN 集成层：
├── common/rn/
│   ├── RNManager.kt              # 全局 ReactInstanceManager 单例
│   ├── ReactNativeActivity.kt    # RN 容器 Activity
│   └── bridge/
│       ├── MallBridgePackage.kt  # Native Module 注册
│       └── modules/
│           ├── RNRouterModule.kt     # 路由跳转
│           └── RNStorageModule.kt    # 本地存储
```

- Application.onCreate() 中调用 `RNManager.warmUp()` 预热
- 通过 Intent Extra 传入组件名启动 RN 页面
- Debug 模式连接 Metro（IP/localhost），Release 使用 assets 离线 Bundle

### 8.2 iOS 集成

```
mall-ios 中的 RN 集成层：
├── common/rn/
│   ├── RNBridgeManager.swift         # 全局 RCTBridge 单例
│   ├── RNViewController.swift        # RN 容器 ViewController
│   └── bridge/
│       ├── MallBridgeModule.swift     # Native Module 注册
│       └── modules/
│           ├── RNRouterModule.swift       # 路由跳转
│           └── RNStorageModule.swift      # 本地存储
```

- AppDelegate 中调用 `RNBridgeManager.shared.preload()` 预热
- 通过初始化参数传入组件名启动 RN 页面
- Podfile 引用 `../mall-rn/node_modules/react-native`

### 8.3 Bundle 构建

```bash
# Debug（开发阶段，连接 Metro）
npx react-native start --host 0.0.0.0 --port 8081

# Release（打包离线 Bundle）
# Android
npx react-native bundle --platform android --dev false \
  --entry-file index.js \
  --bundle-output ../mall-android/app/src/main/assets/index.android.bundle \
  --assets-dest ../mall-android/app/src/main/res/

# iOS
npx react-native bundle --platform ios --dev false \
  --entry-file index.js \
  --bundle-output ../mall-ios/MallApp/main.jsbundle \
  --assets-dest ../mall-ios/MallApp/
```

---

## 九、文案资源化（强制）

### 9.1 核心规则

1. **禁止写死文案**：所有用户可见文本必须放在 `src/common/i18n/zh.json`。
2. **统一引用方式**：使用 `i18n.t('pages_productdetail_title')` 引用。
3. **动态文案必须格式化**：使用 `i18n.t('key', { count: 5 })` 模板，禁止字符串拼接。

### 9.2 图片资源格式（强制）

1. 图标、线性插画优先使用 SVG（通过 `react-native-svg` 渲染）。
2. 仅照片、复杂纹理使用 PNG/JPG/WebP，放入 `src/assets/images/`。
3. 图片必须指定宽高，禁止无尺寸的 Image 组件。
