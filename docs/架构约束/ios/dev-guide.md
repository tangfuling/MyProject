# iOS 开发指导

> 技术栈: Swift + UIKit (编程布局) + MVVM
> 最低支持: iOS 16.0
> 开发工具: Xcode 15+

---

## 一、项目结构

> **与 Android 的目录差异**：Android 源码根目录为 `app/src/main/java/{packagePath}/`（Java/Kotlin 包名规范），iOS 源码根目录为 `{AppName}/`（无包名路径前缀）。两端在各自根目录下的 `common/`、`pages/`、`features/` 层级结构保持一致。

```
{project}/
├── {AppName}/
│   ├── App/                                   # 应用入口
│   │   ├── AppDelegate.swift                  # @main 入口
│   │   ├── AppRootViewController.swift        # 根控制器（路由栈驱动）
│   │   └── MainTabBarController.swift         # 底部 Tab 控制器
│   │
│   ├── Base/                                  # 基础 ViewController
│   │   ├── BaseViewController.swift           # VC 基类（setupUI/setupData）
│   │   └── BasePageViewController.swift       # 页面 VC 基类（loading/error 绑定）
│   │
│   ├── common/                                # 公共层
│   │   ├── app/                               # 全局配置
│   │   │   ├── AppConfig.swift
│   │   │   ├── AppEnv.swift
│   │   │   └── AppInitializer.swift
│   │   │
│   │   ├── base/                              # 基础能力
│   │   │   ├── BaseViewModel.swift            # ViewModel 基类 (ObservableObject)
│   │   │   └── BaseApi.swift                  # Api 基类
│   │   │
│   │   ├── network/                           # 网络层 (URLSession)
│   │   │   ├── HttpClient.swift               # HTTP 请求封装
│   │   │   ├── ApiConfig.swift                # baseUrl、超时等
│   │   │   ├── ApiService.swift               # 接口定义
│   │   │   └── interceptors/
│   │   │       ├── AuthInterceptor.swift      # 自动带 token
│   │   │       └── LogInterceptor.swift       # 请求日志
│   │   │
│   │   ├── router/                            # 路由
│   │   │   ├── RouterManager.swift            # 路由管理器
│   │   │   └── RoutePath.swift                # 路由路径枚举
│   │   │
│   │   ├── lifecycle/                         # 生命周期监听
│   │   │   └── TrackScreenLifecycle.swift
│   │   │
│   │   ├── storage/                           # 本地存储 (UserDefaults)
│   │   │   └── PreferenceManager.swift
│   │   │
│   │   ├── image/                             # 图片
│   │   │   └── ImageLoader.swift
│   │   │
│   │   ├── log/                               # 日志 (OSLog)
│   │   │   └── Logger.swift
│   │   │
│   │   ├── localization/                      # 国际化
│   │   │   └── L10n.swift
│   │   │
│   │   └── ui/                                # 公共 UI 组件
│   │       ├── LoadingView.swift
│   │       ├── ErrorView.swift
│   │       ├── EmptyView.swift
│   │       └── theme/
│   │           └── AppTheme.swift
│   │
│   ├── pages/                                 # 页面模块（ViewModel 层）
│   │   └── {pagename}/
│   │       ├── viewmodel/
│   │       │   └── {PageName}ViewModel.swift
│   │       ├── model/
│   │       │   └── {PageName}Models.swift
│   │       └── api/
│   │           └── {PageName}Api.swift
│   │
│   ├── features/                              # 功能模块（无界面）
│   │   └── auth/
│   │       ├── TokenManager.swift
│   │       └── AuthState.swift
│   │
│   ├── Modules/                               # ViewController 层
│   │   └── {PageName}/
│   │       └── {PageName}ViewController.swift
│   │
│   └── Resources/                             # 资源
│       ├── Info.plist
│       ├── Assets.xcassets/
│       └── Localizable.strings
│
├── project.yml                                # XcodeGen 项目定义
└── Podfile                                    # CocoaPods 依赖
```

---

## 二、核心依赖 (CocoaPods)

```ruby
pod 'SnapKit'    # 声明式 AutoLayout
```

内置框架：
- `UIKit` - UI 组件
- `Combine` - 响应式编程
- `Foundation` - 基础功能

---

## 三、基础能力关键实现

### 3.1 BasePageViewController（页面 VC 基类）

```swift
// Base/BasePageViewController.swift
class BasePageViewController: BaseViewController {
    private let loadingView = UIActivityIndicatorView(style: .large)

    override func setupUI() {
        super.setupUI()
        loadingView.hidesWhenStopped = true
        view.addSubview(loadingView)
        loadingView.snp.makeConstraints { make in
            make.center.equalToSuperview()
        }
    }

    func bindBaseViewModel(_ viewModel: BaseViewModel) {
        viewModel.$isLoading
            .receive(on: RunLoop.main)
            .sink { [weak self] isLoading in
                if isLoading { self?.loadingView.startAnimating() }
                else { self?.loadingView.stopAnimating() }
            }
            .store(in: &cancellables)

        viewModel.$errorMessage
            .compactMap { $0 }
            .receive(on: RunLoop.main)
            .sink { [weak self, weak viewModel] message in
                let alert = UIAlertController(title: "错误", message: message, preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in
                    viewModel?.errorMessage = nil
                })
                self?.present(alert, animated: true)
            }
            .store(in: &cancellables)
    }
}
```

### 3.2 BaseViewModel（类继承）

```swift
// common/base/BaseViewModel.swift
class BaseViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var errorMessage: String?

    func execute<T>(
        showLoading: Bool = true,
        action: @escaping () async throws -> T,
        onSuccess: @escaping (T) -> Void = { _ in },
        onError: @escaping (Error) -> Void = { _ in }
    ) {
        Task {
            if showLoading { await MainActor.run { self.isLoading = true } }
            do {
                let result = try await action()
                await MainActor.run { onSuccess(result) }
            } catch {
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                    onError(error)
                }
            }
            if showLoading { await MainActor.run { self.isLoading = false } }
        }
    }
}
```

---

## 四、一行调用示例

### 网络请求

```swift
class HomeViewModel: BaseViewModel {
    func loadData() {
        execute(
            action: { try await ApiService.shared.getData() },
            onSuccess: { data in /* 处理数据 */ }
        )
    }
}
```

### 路由跳转

```swift
RouterManager.shared.navigate(.productDetail(productId: id))
RouterManager.shared.navigate(.home, popUpTo: .login, inclusive: true)
RouterManager.shared.back()
```

### 顶层 Tab 导航（必须）

```swift
RouterManager.shared.navigateTopLevelTab(.home)
```

### 生命周期监听（统一入口）

```swift
// RouterManager 内部自动触发
TrackScreenLifecycle.shared.onDestinationChanged(route: currentRoute)
```

---

## 五、文案资源化（强制）

### 5.1 核心规则

1. **禁止写死文案**：所有用户可见文本必须放在 `Resources/Localizable.strings`。
2. **统一引用方式**：使用 `L10n.tr("key")` 或 `NSLocalizedString("key", comment: "")`。
3. **动态文案必须格式化**：使用 `%@`、`%d` 等占位符。

### 5.2 图片资源格式（强制）

1. 图标、线性插画优先使用 SF Symbols 或 SVG。
2. 仅照片、复杂纹理使用 PNG/JPG/WebP，放入 Assets.xcassets。
3. TabBar、导航栏等高频 icon 优先使用 SF Symbols。
