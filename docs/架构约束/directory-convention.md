# 大前端目录结构规范

> 本文档定义三端（Android / iOS / RN）统一的目录和命名规则，与技术栈无关。
> 各平台的文件命名细节参见对应的 dev-guide.md。
> 首页通常是若干顶层 Tab 主页面（原生实现）；非首页页面默认落在 RN 工程（命中 `rn-native-exception-constraints.md` 例外清单除外）。

---

## 一、顶层目录定义

| 目录 | 含义 | 放什么 |
|------|------|--------|
| `common/` | 公共层 | 全局基础能力：app 入口、base 类、网络、存储、路由、生命周期监听、图片、UI 组件、日志 |
| `pages/` | 页面模块 | 有独立界面的功能，1 目录 = 1 页面 |
| `features/` | 功能模块 | 无独立界面的业务功能，1 目录 = 1 功能 |
| `resources/` | 资源文件 | 图片、字体、多语言文案 |
| `config/` | 配置（RN 专用） | 组件注册表（entryComponents.js）、全局配置 |

> **三端工程目录对应关系**：
>
> | 工程 | 源码根目录 | 职责 |
> |------|-----------|------|
> | `mall-android/` | `app/src/main/java/{packagePath}/` | Android 原生壳 + 首页（Tab 主页面）+ RN 集成层 |
> | `mall-ios/` | `{AppName}/` | iOS 原生壳 + 首页（Tab 主页面）+ RN 集成层 |
> | `mall-rn/` | `src/` | 所有非首页页面的 RN 共享代码 |

---

## 二、目录命名规则

| 规则 | 示例 | 说明 |
|------|------|------|
| 全小写无分隔符 | `productdetail/` | 目录名统一小写，不用连字符或下划线（iOS 的 Xcode Group 可用 PascalCase，但逻辑层级一致） |
| 功能语义命名 | `home/`, `login/`, `productdetail/` | 用功能名称，不用技术名称 |
| pages/ 子目录固定 | `view/`, `viewmodel/`, `model/`, `api/` | 页面内部四层结构不可变 |

---

## 三、资源命名规则

资源以**所属模块路径**作为前缀命名，一眼可知资源归属：

| 资源类型 | 格式 | 示例 |
|----------|------|------|
| 图片 | `模块路径_描述.后缀` | `pages_home_banner.png`, `common_ui_default_avatar.png` |
| 字符串 key | `模块路径_描述` | `pages_home_title` |
| 颜色 key | `common_color_描述` | `common_color_primary` |

前缀规则：以目录路径中的关键层级用下划线拼接，如 `common_storage_xxx`、`pages_home_xxx`。
图标资源规则：图标、线性插画优先使用 SVG（Android 为 VectorDrawable XML）；照片或复杂纹理再使用 PNG/JPG/WebP。

---

## 四、新增页面 Checklist

### 4.1 原生首页（Tab 主页面，Android / iOS）

```
1. 在原生工程对应 Tab 页面目录下开发
   └── pages/{tabpage}/view/  viewmodel/  model/  api/

2. 使用各端原生技术栈（Compose / UIKit）

3. 首页跳转到 RN 页面时，通过 RouterManager 调起 ReactNativeActivity/RNViewController
4. 原生层承载首页（Tab 主页面）与 RN 容器；命中例外清单（启动链路、IM、Camera 等）的页面必须原生主实现
```

### 4.2 非首页页面（React Native）

```
1. 在 mall-rn/src/pages/ 下创建页面目录
   └── src/pages/newpage/

2. 创建标准子目录
   └── src/pages/newpage/
       ├── view/           # 函数组件 + Hooks，使用 withPageWrapper 组合
       ├── viewmodel/      # 业务逻辑（useReducer / 自定义 Hook）
       ├── model/          # 数据模型（TypeScript 类型定义）
       └── api/            # 接口层（通过 common/network/HttpClient 封装）

3. 在 config/entryComponents.js 中注册组件名

4. 确保该页面的所有代码都在此目录内

5. 页面跳转使用 common/router/RouterManager，不在页面 props 透传导航回调

6. 如果某段代码会被其他页面复用 -> 提取到 common/ 对应模块
```

## 五、新增功能 Checklist

```
1. 在 features/ 下创建功能目录
   └── features/newfeature/

2. 按功能需要自由组织文件（无固定子目录要求）

3. 确保该功能没有独立页面（有页面的放 pages/）
```

---

## 六、禁止事项

1. **禁止**将页面代码分散到多个不相关的目录
2. **禁止**在 `common/` 下放置只被一个模块使用的代码
3. **禁止**创建 `utils/`、`helpers/` 等含义模糊的万能目录
4. **禁止**三端使用不同的目录层级结构
5. **禁止**页面不使用 PageWrapper 包装 / ViewModel 不继承 BaseViewModel
6. **禁止**资源文件不加模块路径前缀
7. **禁止**业务层直接使用底层 SDK 的原始 API，必须通过 `common/` 封装层调用
8. **禁止**在 pages/ 或 features/ 中直接引用底层第三方 SDK 或 HTTP 库，必须通过 `common/network/` 的抽象接口
9. **禁止**在页面构造参数中透传导航回调（如 `onNavigate`、`onBack`），统一走 `RouterManager`
10. **禁止**在每个页面单独挂生命周期监听，统一走 `TrackScreenLifecycle`
11. **禁止**在业务代码中写死用户可见文案，必须统一放入资源文件（Android `strings.xml` / iOS `Localizable.strings`）
12. **禁止**图标类资源优先上传位图（PNG/JPG）；在可矢量化场景下必须优先使用 SVG/VectorDrawable
13. **禁止**RN 页面在 `config/entryComponents.js` 以外的位置注册组件
14. **禁止**RN 页面直接使用 `fetch` / `axios`，必须通过 `common/network/HttpClient` 封装
15. **禁止**在 RN 的 JSX 中使用内联 `style={{ }}` 对象，必须使用 `StyleSheet.create()`
16. **禁止**在非例外场景新增 Android / iOS 原生业务页面；非首页页面必须优先在 RN 开发（命中 `rn-native-exception-constraints.md` 的页面除外）
