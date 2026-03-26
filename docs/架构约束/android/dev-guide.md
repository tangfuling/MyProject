# Android 开发指导

> 技术栈: Kotlin + Jetpack Compose + MVVM
> 最低支持: Android 8.0 (API 26)
> 目标 SDK: Android 14 (API 34)

---

## 一、项目结构

```
{project}/
├── app/
│   ├── src/main/
│   │   ├── java/com/{company}/{app}/
│   │   │   │
│   │   │   ├── common/                         # 公共层
│   │   │   │   ├── app/                         # 应用入口
│   │   │   │   │   ├── {App}Application.kt      # Application 入口
│   │   │   │   │   ├── AppConfig.kt             # 全局配置
│   │   │   │   │   └── AppInitializer.kt        # 初始化（网络、存储、日志等）
│   │   │   │   │
│   │   │   │   ├── base/                        # 基础能力
│   │   │   │   │   ├── PageWrapper.kt           # 页面包装 Composable（loading/error/登录态）
│   │   │   │   │   ├── BaseViewModel.kt         # ViewModel 基类
│   │   │   │   │   └── BaseApi.kt               # Api 基类
│   │   │   │   │
│   │   │   │   ├── network/                     # 网络层 (OkHttp + Retrofit)
│   │   │   │   │   ├── HttpClient.kt            # OkHttp 单例配置
│   │   │   │   │   ├── RetrofitClient.kt        # Retrofit 单例配置
│   │   │   │   │   ├── ApiConfig.kt             # baseUrl、超时等配置
│   │   │   │   │   ├── ApiService.kt            # Retrofit 接口定义
│   │   │   │   │   └── interceptors/
│   │   │   │   │       ├── AuthInterceptor.kt   # 自动带 token
│   │   │   │   │       └── LogInterceptor.kt    # 请求日志
│   │   │   │   │
│   │   │   │   ├── router/                      # 路由 (Navigation Compose)
│   │   │   │   │   ├── RouterManager.kt         # 路由管理器
│   │   │   │   │   └── RoutePath.kt             # 路由路径常量
│   │   │   │   │
│   │   │   │   ├── lifecycle/                   # 生命周期监听
│   │   │   │   │   └── TrackScreenLifecycle.kt  # 统一页面生命周期监听（入口接入一次）
│   │   │   │   │
│   │   │   │   ├── storage/                     # 本地存储 (SharedPreferences)
│   │   │   │   │   └── PreferenceManager.kt     # KV 存储
│   │   │   │   │
│   │   │   │   ├── image/                       # 图片 (Coil)
│   │   │   │   │   └── ImageLoader.kt           # 一行加载封装
│   │   │   │   │
│   │   │   │   ├── log/                         # 日志
│   │   │   │   │   └── Logger.kt                # 统一日志
│   │   │   │   │
│   │   │   │   └── ui/                          # 公共 UI 组件
│   │   │   │       ├── LoadingView.kt
│   │   │   │       ├── ErrorView.kt
│   │   │   │       ├── EmptyView.kt
│   │   │   │       └── theme/
│   │   │   │           └── AppTheme.kt
│   │   │   │
│   │   │   ├── pages/                           # 页面模块
│   │   │   │   └── {pagename}/
│   │   │   │       ├── view/
│   │   │   │       │   └── {PageName}Screen.kt
│   │   │   │       ├── viewmodel/
│   │   │   │       │   └── {PageName}ViewModel.kt
│   │   │   │       ├── model/
│   │   │   │       │   └── {PageName}Models.kt
│   │   │   │       └── api/
│   │   │   │           └── {PageName}Api.kt
│   │   │   │
│   │   │   └── features/                        # 功能模块（无界面）
│   │   │       └── auth/
│   │   │           ├── TokenManager.kt
│   │   │           └── AuthState.kt
│   │   │
│   │   └── res/                                 # 资源 (前缀: 所属模块路径)
│   │       ├── drawable/
│   │       ├── values/
│   │       │   ├── strings.xml
│   │       │   ├── colors.xml
│   │       │   └── themes.xml
│   │       └── font/
│   │
│   └── build.gradle.kts
├── build.gradle.kts
└── settings.gradle.kts
```

---

## 二、核心依赖

```kotlin
dependencies {
    // Compose
    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.navigation:navigation-compose:2.8.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.4")

    // 网络: OkHttp + Retrofit
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")

    // 图片: Coil
    implementation("io.coil-kt:coil-compose:2.7.0")

    // JSON: Gson
    implementation("com.google.code.gson:gson:2.10+")
}
```

---

## 三、基础能力关键实现

### 3.1 PageWrapper（组合方式，非继承）

```kotlin
// common/base/PageWrapper.kt
@Composable
fun PageWrapper(
    viewModel: BaseViewModel,
    content: @Composable () -> Unit
) {
    val isLoading by viewModel.isLoading.collectAsState()

    Box {
        content()
        if (isLoading) { LoadingView() }
    }

    // error 提示
    LaunchedEffect(Unit) {
        viewModel.errorMessage.collect { msg ->
            // Toast 或 Snackbar 展示错误
        }
    }
}

// 页面使用方式（函数式，不继承）：
@Composable
fun HomeScreen(viewModel: HomeViewModel = viewModel()) {
    PageWrapper(viewModel) {
        // 页面内容
    }
}
```

### 3.2 BaseViewModel（类继承）

```kotlin
// common/base/BaseViewModel.kt
abstract class BaseViewModel : ViewModel() {
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _errorMessage = MutableSharedFlow<String>()
    val errorMessage: SharedFlow<String> = _errorMessage.asSharedFlow()

    protected fun <T> launch(
        showLoading: Boolean = true,
        block: suspend () -> T,
        onSuccess: (T) -> Unit = {},
        onError: (Throwable) -> Unit = {}
    ) {
        viewModelScope.launch {
            if (showLoading) _isLoading.value = true
            try {
                onSuccess(block())
            } catch (e: Exception) {
                _errorMessage.emit(e.message ?: "未知错误")
                onError(e)
            } finally {
                if (showLoading) _isLoading.value = false
            }
        }
    }
}
```

---

## 四、一行调用示例

### 网络请求

```kotlin
// 在 ViewModel 中
class HomeViewModel : BaseViewModel() {
    fun loadData() {
        launch(
            block = { ApiService.instance.getData() },
            onSuccess = { data -> /* 处理数据 */ }
        )
    }
}
```

### 图片加载

```kotlin
// 在 Compose 中
ImageLoader.load(
    url = imageUrl,
    placeholder = R.drawable.common_ui_default_placeholder
)
```

### 路由跳转

```kotlin
RouterManager.navigate(route = "${RoutePath.PRODUCT_DETAIL}/$id")
RouterManager.navigate(
    route = RoutePath.HOME,
    popUpToRoute = RoutePath.LOGIN,
    inclusive = true
)
RouterManager.back()
```

### 顶层 Tab 导航（必须）

> 底部 Tab 必须走顶层导航 API，禁止用普通 `navigate` 反复入栈。

```kotlin
// Tab 点击：不入栈、复用状态、单实例
RouterManager.navigateTopLevelTab(RoutePath.HOME)

// 统一返回行为：非首页 Tab 返回先回首页；首页返回才退出应用
BackHandler(enabled = RouterManager.shouldHandleBackToHome(currentRoute)) {
    RouterManager.navigateTopLevelTab(RoutePath.HOME)
}
```

### 生命周期监听（统一入口）

```kotlin
@Composable
private fun MallApp() {
    val navController = rememberNavController()
    TrackScreenLifecycle(navController) // 只在入口接入一次
    NavHost(navController = navController, startDestination = RoutePath.SPLASH) { ... }
}
```

---

## 五、列表实现规范

> 统一使用 `LazyColumn` / `LazyRow`。

### 标准写法

```kotlin
// 1. item 组件独立提取（不要内联在 LazyColumn 里）
@Composable
fun ProductItem(
    product: Product,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(16.dp)
    ) {
        ImageLoader.load(url = product.imageUrl)
        Spacer(modifier = Modifier.width(12.dp))
        Column {
            Text(text = product.name, style = MaterialTheme.typography.bodyLarge)
            Text(text = product.price, style = MaterialTheme.typography.bodySmall)
        }
    }
}

// 2. 列表页使用 LazyColumn + key + contentType
@Composable
fun ProductListScreen(viewModel: ProductListViewModel = viewModel()) {
    val products by viewModel.products.collectAsState()

    PageWrapper(viewModel) {
        LazyColumn {
            items(
                items = products,
                key = { it.id },              // 稳定 key，必须
                contentType = { "product" }   // 帮助 Compose 复用同类型 item
            ) { product ->
                ProductItem(
                    product = product,
                    onClick = { RouterManager.navigate("${RoutePath.PRODUCT_DETAIL}/${product.id}") }
                )
            }
        }
    }
}
```

### 禁止写法

```kotlin
// ❌ 禁止：Column + forEach 全量渲染
Column {
    products.forEach { ProductItem(it) {} }
}

// ❌ 禁止：用 index 做 key
items(products.size, key = { index -> index }) { ... }

// ❌ 禁止：item 内联大段 UI
LazyColumn {
    items(products, key = { it.id }) { product ->
        // ❌ 不要在这里写 50 行 UI，提取为独立 Composable
        Row { Text(product.name); Text(product.price); ... }
    }
}
```

---

## 六、文案资源化（强制）

### 6.1 核心规则

1. **禁止写死文案**：所有用户可见文本必须放在 `app/src/main/res/values/strings.xml`。
2. **统一引用方式**：Compose 页面使用 `stringResource(id = R.string.xxx)`，非 Compose 场景使用 `context.getString(R.string.xxx)`。
3. **动态文案必须格式化**：使用 `%1$s`、`%1$d` 等占位符，禁止 `"ID: " + userId` 这类硬编码拼接。

### 6.2 图片资源格式（强制）

1. 图标、线性插画、纯色矢量图形优先使用 SVG，并在 Android 落地为 `VectorDrawable`（`res/drawable/*.xml`）。
2. 仅照片、复杂渐变纹理、体积过大的矢量图等场景使用 PNG/JPG/WebP。
3. BottomNav、TopBar、功能按钮等高频 icon 禁止使用位图资源，优先使用矢量资源以保证清晰度和包体积。
