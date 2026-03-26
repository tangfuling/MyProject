# 大前端统一架构指导

> 适用范围: Android / iOS / React Native 三端通用
> 版本: v2.0.0
>
> 本文档定义与技术栈无关的架构原则和目录结构。
> 各平台技术栈细节（语言、库、具体实现）参见对应的 dev-guide.md。
>
> **开发策略**：默认“首页原生 + 非首页优先 RN”。首页通常是若干顶层 Tab 主页面（如会话/通讯录/发现/我的），该部分采用各端原生开发；非首页页面优先采用 React Native（命中例外清单除外）。
> **RN 例外清单**：启动链路、首页（含首页各 Tab）、IM 主链路、Camera 类页面（扫码/拍摄/录制/实时预览）等高度依赖原生能力的页面/链路，必须原生主实现。详见 `rn-native-exception-constraints.md`。

---

## 〇、全局约束

| 约束项 | 值 | 说明 |
|--------|------|------|
| **大前端统一包名** | `{bundleId}` | Android applicationId、iOS Bundle Identifier 均使用此包名。注意：Android 源码在包名对应目录结构下，iOS 源码在 `{AppName}/` 下（无包名路径），但逻辑目录层级（common/pages/features）保持一致 |
| **混合开发策略** | `首页原生 + 非首页优先 RN` | 首页通常是若干顶层 Tab 主页面并采用各端原生开发；非首页页面优先采用 React Native，命中例外清单（启动链路/IM/Camera 等）时必须原生主实现 |
| **统一路由入口** | `RouterManager` | 页面跳转必须通过统一路由管理器，原生页面和 RN 页面之间的跳转也通过 RouterManager 统一调度，禁止页面间回调透传导航函数 |
| **统一生命周期监听** | `TrackScreenLifecycle` | 页面生命周期监听集中在应用入口接入，禁止每个页面重复挂监听 |
| **统一文案资源化** | `禁止写死文案` | 所有用户可见文案必须使用资源 key。Android: `strings.xml`；iOS: `Localizable.strings`；RN: 统一 i18n 方案（如 `i18n/zh.json`） |
| **统一图标资源策略** | `图标优先 SVG` | 图标、线性插画、简易矢量图形优先使用 SVG（Android 落地为 VectorDrawable XML；RN 使用 `react-native-svg`）；仅照片、复杂纹理使用 PNG/JPG/WebP |
| **统一顶层 Tab 导航策略** | `Top-level Destination` | 底部 Tab 切换必须复用栈顶目的地，不得重复入栈；仅"真正打开的新页面"（详情页、设置页等）允许入栈 |
| **RN Bridge 单例** | `全局唯一 ReactInstance` | Android 和 iOS 各自维护全局唯一的 React 实例（Android: `RNManager`；iOS: `RNBridgeManager`），Application/AppDelegate 启动时预热，禁止每个页面重复创建 |
| **RN Bundle 策略** | `Debug Metro / Release 离线包` | 开发阶段使用 Metro 热更新；Release 使用预构建的离线 bundle（assets 内嵌），确保无网络环境下可用 |

---

## 一、核心原则

1. **首页原生 + 非首页优先 RN**：首页通常是若干顶层 Tab 主页面并采用各端原生技术栈开发；非首页页面优先采用 React Native，命中例外清单时保持原生主实现
2. **架构一致**：三端（Android / iOS / RN）保持相同的架构模式和目录层级
3. **功能闭环**：1 个目录 = 1 个页面或功能闭环，目录内包含该功能的所有代码
4. **行业通用方案优先**：网络、图片、路由、存储等基础能力全部采用各平台行业主流库，禁止自造轮子
5. **View 函数式 + ViewModel/Api 继承**：View 层统一使用函数式组件（不继承），通过 PageWrapper 组合注入公共能力；ViewModel 和 Api 层使用类继承。RN 端 View 使用函数组件 + Hooks
6. **网络层抽象**：HTTP 请求封装在 common 层，上层业务不感知底层网络库实现。RN 端通过 common/network/ 封装，禁止页面直接使用 fetch
7. **页面内部闭环导航**：页面内部直接调用 `RouterManager` 跳转，尽量不在页面构造参数中暴露导航回调
8. **Native-RN 边界最小化**：Native Module（Bridge）仅暴露必要的原生能力（路由、存储、鉴权），业务逻辑统一在 RN 侧实现，禁止在 Bridge 中编写业务逻辑

---

## 二、网络层架构

客户端通过 HTTP 与服务端通信，必须在 common 层做好抽象封装：

```
┌──────────────────────────────────────────────┐
│              页面 / 业务层                      │
│  (只关心"调接口"，不感知底层 HTTP 库)           │
└──────────────────┬───────────────────────────┘
                   │ 调用
┌──────────────────▼───────────────────────────┐
│              common/network/                  │
│  ┌────────────────────────────────────────┐   │
│  │  HttpClient / ApiService               │   │
│  │  (封装 HTTP 请求)                       │   │
│  └─────────────┬──────────────────────────┘   │
│                │ interceptors/                 │
│                │  ├── AuthInterceptor          │
│                │  └── LogInterceptor           │
└────────────────┼──────────────────────────────┘
                 │
                 ▼
            后端服务
```

### 封装要求

| 组件 | 职责 | 说明 |
|------|------|------|
| `HttpClient` | HTTP 请求封装 | 封装底层 HTTP 库，上层一行代码调用 |
| `ApiService` | 接口定义 | 统一的 API 接口声明 |
| `AuthInterceptor` | 鉴权拦截 | 自动携带 token |
| `LogInterceptor` | 日志拦截 | 请求/响应日志（仅 debug 模式） |

### 为什么要抽象

网络层做好抽象后，切换底层 HTTP 库时上层业务代码（pages/、features/）无需改动，只需替换 common/network/ 下的实现。

---

## 三、统一架构模式: MVVM

双端统一采用 MVVM (Model-View-ViewModel) 架构：

```
┌──────────────────────────────────────────────┐
│                   View (页面)                  │
│  函数式组件，只负责 UI 渲染和用户交互事件        │
│  使用 PageWrapper 组合公共能力                  │
└──────────────────┬───────────────────────────┘
                   │ 数据绑定 / 状态订阅
┌──────────────────▼───────────────────────────┐
│               ViewModel                       │
│  业务逻辑、状态管理、数据转换                    │
│  继承 BaseViewModel                            │
└──────────────────┬───────────────────────────┘
                   │ 调用
┌──────────────────▼───────────────────────────┐
│                Api (接口层)                     │
│  数据来源封装: HTTP 请求、本地存储               │
│  继承 BaseApi                                  │
└──────────────────────────────────────────────┘
```

> **View 层统一使用函数式组件**（Compose `@Composable`、UIKit ViewController + 编程布局），不做类继承。公共能力（loading/error/登录态）通过 `PageWrapper` 组合注入，而非继承。

---

## 四、统一目录结构

三端必须遵循以下目录层级。目录名在不同平台可能有大小写差异（如 iOS 用 PascalCase 目录名），但层级和含义必须一致。

> **目录根路径差异**：Android 源码根目录为 `app/src/main/java/{packagePath}/`，iOS 源码根目录为 `{AppName}/`，RN 源码根目录为 `src/`。三端在各自根目录下的 `common/`、`pages/`、`features/` 层级结构保持一致。

```
项目根目录/
│
├── common/                                 # 公共层（全局基础能力）
│   │
│   ├── app/                                # 应用入口与全局配置
│   │   ├── AppEntry                        # 应用启动入口
│   │   ├── AppConfig                       # 全局配置（环境、API 地址、版本等）
│   │   └── AppInitializer                  # 初始化（各类 SDK、日志、路由等）
│   │
│   ├── base/                               # 基础能力
│   │   ├── PageWrapper                     # 页面包装组件（组合方式注入 loading/error/登录态）
│   │   ├── BaseViewModel                   # ViewModel 基类（统一状态管理，类继承）
│   │   └── BaseApi                         # Api 基类（统一异常处理，类继承）
│   │
│   ├── network/                            # 网络层
│   │   ├── HttpClient                      # HTTP 请求封装（一行代码调用）
│   │   ├── ApiConfig                       # API 基础配置（baseUrl、超时等）
│   │   ├── ApiService                      # 接口定义
│   │   └── interceptors/                   # 请求拦截器
│   │       ├── AuthInterceptor             # 鉴权（自动带 token）
│   │       └── LogInterceptor              # 日志
│   │
│   ├── storage/                            # 本地存储
│   │   └── PreferenceManager               # 轻量 KV 存储（token、设置等）
│   │
│   ├── router/                             # 路由/导航
│   │   ├── RouterManager                   # 路由管理器（一行代码跳转）
│   │   └── RoutePath                       # 路由路径常量定义
│   │
│   ├── lifecycle/                          # 生命周期监听
│   │   └── TrackScreenLifecycle            # 统一页面生命周期监听（入口接入一次）
│   │
│   ├── image/                              # 图片处理
│   │   └── ImageLoader                     # 图片加载（一行代码加载）
│   │
│   ├── log/                                # 日志
│   │   └── Logger                          # 统一日志工具
│   │
│   └── ui/                                 # 公共 UI 组件
│       ├── LoadingView                     # 加载状态
│       ├── ErrorView                       # 错误状态
│       ├── EmptyView                       # 空状态
│       └── theme/                          # 主题/样式
│           └── AppTheme                    # 全局主题定义
│
├── pages/                                  # 页面模块（有界面，1 目录 = 1 页面）
│   │
│   └── {pagename}/                         # 具体页面
│       ├── view/                           # UI
│       ├── viewmodel/                      # 逻辑
│       ├── model/                          # 数据模型
│       └── api/                            # 接口层
│
├── features/                               # 功能模块（无独立页面，1 目录 = 1 功能）
│   │
│   └── auth/                               # 鉴权
│       ├── TokenManager                    # Token 管理（存储、刷新、过期判断）
│       └── AuthState                       # 登录状态管理
│
└── resources/                              # 资源文件（前缀: 所属模块路径）
    ├── images/
    ├── fonts/
    └── strings/
```

---

## 五、基础能力设计

### 5.1 View 层：函数式组件 + 组合

View 层统一使用函数式组件，**不使用类继承**。公共能力通过 `PageWrapper` 以组合方式注入：

```
PageWrapper（组合注入，非继承）:
├── 自动展示 loading（基于 ViewModel.isLoading）
├── 自动展示 error 提示（基于 ViewModel.errorMessage）
├── 统一导航栏配置
└── 登录态检查（未登录自动跳转登录页）
```

各平台实现方式：

| 平台 | View 写法 | PageWrapper 实现方式 |
|------|-----------|---------------------|
| Android | `@Composable fun XxxScreen()` | 包装型 Composable，如 `PageWrapper { content() }` |
| iOS | `UIViewController + 编程布局` | 基类 `BasePageViewController` 绑定 ViewModel |
| RN | `function XxxScreen()` (函数组件 + Hooks) | 高阶组件 `withPageWrapper(Component)` 注入 loading/error |

### 5.2 ViewModel 层：类继承

ViewModel 保留类继承，因为状态管理逻辑有明确的公共基类需求：

```
BaseViewModel（类继承）:
├── isLoading     # 加载中状态
├── errorMessage  # 错误信息
├── execute()     # 通用异步操作：自动管理 loading，自动捕获 error
└── 生命周期感知
```

### 5.3 Api 层：类继承

Api 层保留类继承，统一异常处理和请求取消：

```
BaseApi（类继承）:
├── 统一异常处理
└── 请求取消
```

### 5.4 总结

| 层级 | 方式 | 说明 |
|------|------|------|
| **View** | 函数式组件 + 组合 | 不继承，用 PageWrapper 包装注入公共能力 |
| **ViewModel** | 类继承 BaseViewModel | 继承，统一 loading/error/异步操作 |
| **Api** | 类继承 BaseApi | 继承，统一异常处理 |

### 5.5 路由与生命周期统一约束

```
RouterManager:
├── navigate(route, popUpTo, inclusive)   # 通用跳转入口
└── back()                                # 通用返回

TrackScreenLifecycle:
├── 在应用入口接入一次
├── 自动监听路由变化并输出页面 onResume/onPause/onDestroy
└── 页面层不再逐页挂生命周期监听器
```

约束说明：

- 页面跳转统一通过 `RouterManager`，避免在页面构造参数中透传 `onNavigate` 回调
- 生命周期监听统一通过 `TrackScreenLifecycle`，禁止在每个页面单独重复注册
- 路由与生命周期日志统一走 `common/log/Logger`，并仅在 debug 模式生效
- 底部 Tab 统一走 `RouterManager.navigateTopLevelTab(...)`（或平台等价 API），行为约束：
  - Tab 切换不累积返回栈，不允许出现"连续点 Tab 后返回逐层回退 Tab"的行为
  - 非首页顶层 Tab 点击系统返回，先回首页；首页再返回才退出应用
  - 详情页/设置页等非顶层页面保持常规返回栈语义

---

### 5.6 首页定义与 RN 例外约束

| 约束项 | 说明 |
|--------|------|
| **首页定义固定** | 首页通常定义为若干顶层 Tab 主页面（如会话/通讯录/发现/我的），首页及其 Tab 容器切换仅允许原生实现 |
| **例外清单优先** | 命中 `rn-native-exception-constraints.md` 的页面/链路（启动链路、首页 Tab、IM 主链路、Camera 类页面）必须保留原生主实现 |
| **非首页页面优先 RN** | Android 与 iOS 的非首页页面应优先在 `mall-rn` 开发（命中例外清单除外），禁止新增原生重复业务页面 |

---

## 六、pages 与 features 的区别

| 维度 | pages/ (页面模块) | features/ (功能模块) |
|------|-------------------|---------------------|
| **是否有独立页面** | 有，用户可见的完整页面 | 无独立页面，后台功能或服务 |
| **内部结构** | 固定: view/ + viewmodel/ + model/ + api/ | 按功能自由组织 |
| **举例** | 登录页、商品详情页、首页 | 鉴权、推送 |

### 归属判断

- 用户能看到、能操作的独立页面 -> `pages/`
- 没有独立界面，为其他模块提供能力 -> `features/`
- 多个模块共用的基础能力 -> `common/`

---

## 七、功能闭环原则

### 核心规则

> **1 个目录 = 1 个页面或功能闭环，该功能的所有代码都在这个目录内**

### pages/ 内部结构

每个页面目录内部按职责拆分四个子目录：

| 子目录 | 职责 |
|--------|------|
| `view/` | 函数式组件，使用 PageWrapper 组合公共能力 |
| `viewmodel/` | 业务逻辑、状态管理。继承 BaseViewModel |
| `model/` | 数据模型（请求/响应/实体） |
| `api/` | 接口层，数据来源封装（HTTP、本地数据库）。继承 BaseApi |

### 代码归属判断

- 只被当前页面使用 -> 放在当前 `pages/xxx/` 目录
- 只被当前功能使用 -> 放在当前 `features/xxx/` 目录
- 被 2 个以上模块使用 -> 提取到 `common/` 对应子目录

---

## 八、资源命名规范

资源文件以**所属模块路径**作为前缀命名，防止冲突，同时一眼可知资源归属：

| 资源类型 | 格式 | 示例 |
|----------|------|------|
| 图片 | `模块路径_描述` | `pages_home_banner.png`, `common_ui_default_avatar.png` |
| 字符串 key | `模块路径_描述` | `pages_home_title`, `pages_login_placeholder` |
| 颜色 key | `common_color_描述` | `common_color_primary`, `common_color_accent` |

**前缀规则**：以目录路径中的关键层级用下划线拼接，如 `common_storage_xxx`、`pages_home_xxx`、`features_auth_xxx`。

### 字符串 / 颜色的定义方式（分端）

| 资源 | Android | iOS | RN |
|------|---------|-----|-----|
| **字符串** | `res/values/strings.xml` 中用 `<string name="pages_home_title">` 定义 | `Resources/Localizable.strings` 中用 `"pages_home_title" = "xxx";` 定义 | `src/common/i18n/zh.json` 中用 `"pages_home_title": "xxx"` 定义 |
| **颜色** | `res/values/colors.xml` 中用 `<color name="common_color_primary">` 定义 | 代码中定义常量，如 `static let commonColorPrimary = UIColor(...)` | `src/common/ui/theme/colors.js` 中定义 `colors.primary` |
| **尺寸** | `res/values/dimens.xml` 中用 `<dimen name="common_dimen_avatar_size">` 定义 | 代码中定义常量，如 `static let commonDimenAvatarSize: CGFloat = 40` | `src/common/ui/theme/spacing.js` 中定义 `spacing.avatarSize` |

**要点**：
- Android 全部走 XML 资源文件，系统原生支持按 name 引用
- iOS 的字符串走 `Localizable.strings`（支持多语言），颜色和尺寸在代码中定义
- 双端的 **key 命名保持一致**（如都叫 `pages_home_title`），只是定义位置不同
- **禁止在业务代码中写死用户可见文案**：必须通过资源 key 引用；动态文案使用格式化占位符（如 `%1$s`、`%1$d`），禁止字符串拼接硬编码前后缀
- **图标尽可能使用 SVG**：Android 使用 VectorDrawable XML（可由 SVG 转换）；仅当资源为照片或复杂位图效果时，才使用 PNG/JPG/WebP

---

## 九、列表实现约束

列表是最常见的 UI 模式，也是性能问题的高发区。核心约束双端一致。

### 核心规则

| 约束项 | 说明 |
|--------|------|
| **必须使用平台原生懒加载列表** | 禁止在 ScrollView 中手动排列全量 item。Android 用 `LazyColumn/LazyRow`，iOS 用 `UITableView` 或 `UICollectionView` |
| **item 必须提供稳定唯一 key** | 每个 item 必须绑定业务 ID 作为 key，禁止使用 index 作为 key。稳定 key 是高效 diff 和动画的前提 |
| **item 组件必须独立提取** | 列表 item 必须抽为独立的函数式组件（文件或函数级别），禁止在列表循环体内写大段内联 UI |
| **item 组件必须可复用** | 同一数据类型的 item 在不同页面应复用同一组件，放在 `common/ui/` 或页面内 `view/` 下 |
| **item 组件必须做等值跳过优化** | 当 item 数据未变化时，框架应跳过该 item 的重组/重绘 |
| **禁止嵌套同方向滚动列表** | 禁止在垂直滚动列表中嵌套另一个垂直滚动列表，会导致滚动冲突和性能问题 |
| **大数据量必须分页** | 列表数据超过一屏时，必须实现分页加载（上拉加载更多），禁止一次性加载全量数据 |

### 各平台对应方案

| 能力 | Android (Compose) | iOS (UIKit) | RN |
|------|-------------------|-------------|-----|
| 懒加载列表 | `LazyColumn` / `LazyRow` | `UITableView` / `UICollectionView` | `FlatList` / `SectionList` |
| 稳定 key | `items(key = { it.id })` | `cellForRowAt` + 业务 ID | `keyExtractor={(item) => item.id}` |
| 等值跳过 | data class 自带 equals + Compose 智能跳过 | 数据比较 + `reloadRows` | `React.memo` + `useCallback` |

### 禁止事项

- 禁止在 Compose 中使用 `Column` + `forEach` 替代 `LazyColumn`（全量渲染，无回收）
- 禁止在列表 item 内发起网络请求或执行重计算，数据应由 ViewModel 预处理好

---

## 十、React Native 架构约束

### 10.1 混合开发边界

```
┌─────────────────────────────────────────────────┐
│                   原生壳 (Android / iOS)           │
│  ┌─────────────┐  ┌──────────────────────────┐  │
│  │  首页 (原生)  │  │  ReactNativeActivity/VC  │  │
│  │  Tab 主页面集 │  │  ┌──────────────────┐    │  │
│  │  (Compose/   │  │  │   RN Bundle       │    │  │
│  │   UIKit)     │  │  │  (默认非首页页面，    │    │  │
│  │             │  │  │   命中例外除外)      │    │  │
│  │             │  │  └──────────────────┘    │  │
│  └─────────────┘  └──────────────────────────┘  │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │  Native Modules (Bridge)                  │    │
│  │  RouterModule / StorageModule / AuthModule │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### 10.2 Native Module（Bridge）约束

| 约束项 | 说明 |
|--------|------|
| **Bridge 仅暴露原生能力** | Bridge 只提供路由跳转、本地存储、鉴权 token、设备信息等原生能力，禁止在 Bridge 中编写业务逻辑 |
| **Bridge 模块统一注册** | 所有 Native Module 在一个 Package/Registry 中集中注册，禁止分散注册 |
| **Bridge 方法必须异步** | Native → RN 通信使用 Promise/Callback，禁止同步阻塞 UI 线程 |
| **Bridge 数据序列化** | 传递数据必须使用 JSON 兼容类型（string/number/boolean/array/object），禁止传递原生对象引用 |

### 10.3 RN 性能约束

| 约束项 | 说明 |
|--------|------|
| **全局唯一 React 实例** | Application/AppDelegate 启动时创建并预热，所有 RN 页面共享同一实例，禁止每个页面重新创建 |
| **启用 Hermes 引擎** | Android 端必须启用 Hermes 以优化启动速度和内存占用；iOS 端按实际情况启用 |
| **列表必须使用 FlatList** | 禁止在 ScrollView 中用 map 渲染列表；必须使用 FlatList/SectionList + keyExtractor + React.memo |
| **避免匿名函数 re-render** | 列表 item 的回调函数必须使用 `useCallback`，禁止在 renderItem 中创建匿名箭头函数 |
| **图片必须指定尺寸** | RN 中 Image 组件必须显式指定 width/height，禁止依赖自动计算尺寸（会触发多次布局） |
| **禁止 Inline Style 对象** | 样式必须使用 `StyleSheet.create()` 预定义，禁止在 JSX 中写 `style={{ ... }}` 内联对象 |
| **大列表必须 getItemLayout** | 列表 item 高度固定时，必须提供 `getItemLayout` 以跳过动态测量，提升滚动性能 |
| **减少 Bridge 调用频率** | 批量操作优先于频繁单次调用；禁止在滚动事件、动画帧中高频调用 Bridge |
| **Release 使用离线 Bundle** | 生产环境必须使用预构建的 JS Bundle（从 assets 加载），禁止依赖 Metro 开发服务器 |

### 10.4 RN 组件开发约束

| 约束项 | 说明 |
|--------|------|
| **函数组件 + Hooks** | 所有组件必须使用函数组件，禁止使用 Class 组件 |
| **状态管理统一** | 使用 useReducer + Context 或统一的状态管理方案，禁止随意使用全局变量 |
| **组件注册集中管理** | 所有可从 Native 启动的页面在 `config/entryComponents.js` 中统一注册，禁止分散注册 |
| **目录结构与原生对齐** | RN 的 src/ 目录下 common/pages/features 结构与 Android/iOS 保持一致 |
| **网络请求统一封装** | 所有 HTTP 请求通过 `common/network/HttpClient.js` 封装，页面禁止直接使用 fetch/axios |

---

## 十一、开发流程

1. **首页需求（Tab 主页面）** -> 在原生工程对应 Tab 页面目录下开发（Android Compose / iOS UIKit）
2. **非首页页面需求** -> 在 `mall-rn/src/pages/` 下创建 RN 页面（命中例外清单除外），按 `view/viewmodel/model/api/` 拆分
3. **新增无界面功能** -> 在对应工程的 `features/` 下创建目录
4. RN 页面注册 -> 在 `config/entryComponents.js` 中注册组件名，原生端通过组件名启动
5. View 层使用函数式组件 + PageWrapper/withPageWrapper 组合，ViewModel 继承 BaseViewModel
6. 网络/图片/路由使用 `common/` 封装好的统一接口，业务层一行代码调用
7. 资源命名以所属模块路径为前缀（如 `pages_home_banner.png`）
8. 公共代码提取到 `common/` 对应模块
9. 每次改动完成后立即提交到远程仓库
10. 提交信息格式：`feat: add home page` / `fix: network request timeout`
