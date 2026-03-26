# Java 开发指导

> 技术栈: Java 21 + Spring Boot 3.x + Spring MVC + MyBatis-Plus + Redis + Kafka
> 适用范围: 中后台服务 / BFF 服务
> 架构模式: 分层架构（Controller + Service + Repository）+ 模块化领域拆分

---

## 一、项目结构

```
{project}/
├── src/main/java/com/{company}/{app}/
│   ├── common/                               # 公共层
│   │   ├── app/                              # 应用入口与启动配置
│   │   │   ├── Application.java
│   │   │   ├── AppConfig.java
│   │   │   └── StartupRunner.java
│   │   │
│   │   ├── base/                             # 基础能力
│   │   │   ├── ApiResponse.java              # 统一返回体
│   │   │   ├── BaseController.java           # 控制器基类
│   │   │   ├── BaseService.java              # 服务基类（模板执行、日志）
│   │   │   └── BaseRepository.java           # 仓储基类
│   │   │
│   │   ├── web/                              # Web 层通用能力
│   │   │   ├── GlobalExceptionHandler.java   # 全局异常处理
│   │   │   ├── WebMvcConfig.java             # MVC 配置
│   │   │   └── TraceIdFilter.java            # TraceId 注入
│   │   │
│   │   ├── security/                         # 认证与鉴权
│   │   │   ├── AuthContext.java
│   │   │   ├── TokenAuthInterceptor.java
│   │   │   └── PermissionChecker.java
│   │   │
│   │   ├── db/                               # 数据访问基础设施
│   │   │   ├── MybatisPlusConfig.java
│   │   │   └── PageQuery.java
│   │   │
│   │   ├── cache/                            # 缓存能力
│   │   │   ├── CacheKey.java
│   │   │   └── RedisClient.java
│   │   │
│   │   ├── mq/                               # 消息队列能力
│   │   │   ├── KafkaProducer.java
│   │   │   └── KafkaConsumer.java
│   │   │
│   │   └── log/                              # 日志能力
│   │       └── LoggerUtil.java
│   │
│   ├── modules/                              # 业务模块（1 目录 = 1 领域）
│   │   └── {module}/
│   │       ├── controller/
│   │       │   └── {Module}Controller.java
│   │       ├── service/
│   │       │   ├── {Module}Service.java
│   │       │   └── impl/{Module}ServiceImpl.java
│   │       ├── repository/
│   │       │   └── {Module}Repository.java
│   │       ├── mapper/
│   │       │   └── {Module}Mapper.java
│   │       ├── model/
│   │       │   ├── entity/{Module}Entity.java
│   │       │   ├── dto/{Module}DTO.java
│   │       │   ├── query/{Module}Query.java
│   │       │   └── vo/{Module}VO.java
│   │       └── converter/
│   │           └── {Module}Converter.java
│   │
│   └── integrations/                         # 三方系统集成
│       ├── client/                           # OpenFeign/HTTP Client
│       └── scheduler/                        # 定时任务
│
├── src/main/resources/
│   ├── application.yml
│   ├── application-dev.yml
│   ├── application-prod.yml
│   ├── mapper/                               # MyBatis XML（如需）
│   └── logback-spring.xml
│
├── src/test/java/
└── pom.xml
```

---

## 二、核心依赖（Maven）

```xml
<dependencies>
    <!-- Web -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-validation</artifactId>
    </dependency>

    <!-- 数据访问 -->
    <dependency>
        <groupId>com.baomidou</groupId>
        <artifactId>mybatis-plus-spring-boot3-starter</artifactId>
        <version>3.5.7</version>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-jdbc</artifactId>
    </dependency>

    <!-- 缓存 -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-data-redis</artifactId>
    </dependency>

    <!-- MQ -->
    <dependency>
        <groupId>org.springframework.kafka</groupId>
        <artifactId>spring-kafka</artifactId>
    </dependency>

    <!-- 可观测性 -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-actuator</artifactId>
    </dependency>
    <dependency>
        <groupId>io.micrometer</groupId>
        <artifactId>micrometer-registry-prometheus</artifactId>
    </dependency>

    <!-- OpenAPI -->
    <dependency>
        <groupId>org.springdoc</groupId>
        <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
        <version>2.5.0</version>
    </dependency>

    <!-- 工具 -->
    <dependency>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok</artifactId>
        <optional>true</optional>
    </dependency>
    <dependency>
        <groupId>org.mapstruct</groupId>
        <artifactId>mapstruct</artifactId>
        <version>1.5.5.Final</version>
    </dependency>
</dependencies>
```

> **依赖管理原则**：优先使用 Spring 生态成熟组件；新增依赖必须评估维护活跃度、学习成本、替换成本，禁止引入“只用一处”的重型框架。

---

## 三、基础能力关键实现

### 3.1 ApiResponse（统一返回体）

```java
// common/base/ApiResponse.java
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ApiResponse<T> {
    private Integer code;
    private String message;
    private T data;

    public static <T> ApiResponse<T> success(T data) {
        return new ApiResponse<>(0, "OK", data);
    }

    public static <T> ApiResponse<T> fail(Integer code, String message) {
        return new ApiResponse<>(code, message, null);
    }
}
```

### 3.2 GlobalExceptionHandler（全局异常处理）

```java
// common/web/GlobalExceptionHandler.java
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ApiResponse<Void> handleValidation(MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
            .findFirst()
            .map(DefaultMessageSourceResolvable::getDefaultMessage)
            .orElse("参数错误");
        return ApiResponse.fail(40001, message);
    }

    @ExceptionHandler(BizException.class)
    public ApiResponse<Void> handleBiz(BizException ex) {
        return ApiResponse.fail(ex.getCode(), ex.getMessage());
    }

    @ExceptionHandler(Exception.class)
    public ApiResponse<Void> handleUnknown(Exception ex) {
        log.error("Unhandled exception", ex);
        return ApiResponse.fail(50000, "系统繁忙，请稍后重试");
    }
}
```

### 3.3 BaseService（统一执行模板）

```java
// common/base/BaseService.java
@Slf4j
public abstract class BaseService {

    protected <T> T execute(String action, Supplier<T> supplier) {
        long start = System.currentTimeMillis();
        try {
            return supplier.get();
        } finally {
            long cost = System.currentTimeMillis() - start;
            log.info("action={}, costMs={}", action, cost);
        }
    }
}
```

---

## 四、一行调用示例

### Controller 调用 Service（标准）

```java
@RestController
@RequestMapping("/orders")
public class OrderController {

    @Resource
    private OrderService orderService;

    @GetMapping("/{id}")
    public ApiResponse<OrderVO> detail(@PathVariable Long id) {
        return ApiResponse.success(orderService.detail(id));
    }
}
```

### Service 事务管理（标准）

```java
@Service
public class OrderServiceImpl extends BaseService implements OrderService {

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void pay(PayOrderDTO dto) {
        execute("order.pay", () -> {
            // 校验 + 扣减 + 状态变更 + 发消息
            return null;
        });
    }
}
```

### Repository/Mapper 分页查询（标准）

```java
public Page<OrderEntity> pageByUserId(Long userId, long current, long size) {
    LambdaQueryWrapper<OrderEntity> wrapper = Wrappers.lambdaQuery(OrderEntity.class)
        .eq(OrderEntity::getUserId, userId)
        .orderByDesc(OrderEntity::getId);
    return orderMapper.selectPage(Page.of(current, size), wrapper);
}
```

### 缓存与消息（标准）

```java
redisClient.set(CacheKey.orderDetail(orderId), orderVO, Duration.ofMinutes(10));
kafkaProducer.send("order-paid-topic", event);
```

---

## 五、数据层与事务约束

| 约束项 | 说明 |
|--------|------|
| **Controller 禁止写业务逻辑** | Controller 仅做参数接收、鉴权校验入口、调用 Service、返回结果 |
| **Service 是唯一事务边界** | `@Transactional` 只能放在 Service 层，禁止 Controller/Mapper 直接开事务 |
| **Mapper 仅做数据访问** | 禁止在 Mapper 中写业务规则、鉴权逻辑、流程编排 |
| **对象分层强制隔离** | `DTO` 仅入参，`Entity` 仅持久化，`VO` 仅出参，禁止混用 |
| **分页查询必须显式分页** | 列表接口必须有分页参数，禁止全量查询后内存分页 |
| **写操作必须幂等** | 创建/支付/取消等接口必须具备业务幂等键，避免重复请求造成脏数据 |

### 禁止写法

```java
// ❌ 禁止：Controller 直接操作 Mapper
@GetMapping("/list")
public List<OrderEntity> list() {
    return orderMapper.selectList(null);
}

// ❌ 禁止：Entity 直接返回给前端
public ApiResponse<OrderEntity> detail(Long id) { ... }
```

---

## 六、接口与安全约束

| 约束项 | 说明 |
|--------|------|
| **参数校验强制开启** | 所有入参必须使用 `@Valid` + `jakarta.validation` 注解 |
| **统一鉴权上下文** | 用户身份统一从 `AuthContext` 获取，禁止在业务代码重复解析 token |
| **权限检查统一入口** | 使用 `@PreAuthorize` 或 `PermissionChecker`，禁止散落 if/else 权限判断 |
| **敏感信息脱敏** | 日志中手机号、证件号、token 必须脱敏，禁止明文落日志 |
| **接口语义 REST 化** | 查询用 GET，新增用 POST，更新用 PUT/PATCH，删除用 DELETE |
| **错误码统一治理** | 错误码由 `common` 统一管理，禁止模块私定义冲突错误码 |

---

## 七、可观测性与稳定性

| 约束项 | 说明 | 级别 |
|--------|------|------|
| **TraceId 全链路透传** | 每个请求必须具备 `traceId`，日志按 traceId 可串联 | 强制 |
| **超时与重试显式配置** | HTTP/DB/MQ 调用必须设置超时，重试次数可控 | 强制 |
| **健康检查标准化** | 开启 `/actuator/health` 并拆分 readiness/liveness | 强制 |
| **关键指标上报** | QPS、P99、错误率、线程池队列长度必须可观测 | 强制 |
| **慢 SQL 监控** | 慢 SQL 阈值与告警规则必须配置 | 推荐 |
| **削峰能力** | 下游不稳场景使用 MQ/队列进行削峰 | 推荐 |

---

## 八、禁止事项

1. **禁止**在 Controller 层进行事务控制、数据库写入、流程编排。
2. **禁止**跨模块直接调用对方 Mapper，模块间只能通过 Service 或 Facade 交互。
3. **禁止**在业务代码中硬编码环境配置（URL、Topic、开关），必须走配置中心或 `application-*.yml`。
4. **禁止**接口返回堆栈、SQL 错误等内部细节给前端。
5. **禁止**绕开统一异常处理直接 `printStackTrace`。
6. **禁止**无分页参数的大列表查询接口上线。
7. **禁止**在日志中打印明文 token、身份证号、银行卡号、手机号全量值。
8. **禁止**在定时任务中直接执行超长事务，必须拆批并具备失败补偿。
9. **禁止**使用含义模糊的 `CommonUtil`、`Helper` 作为万能目录。
10. **禁止**未经评审引入新框架或中间件。
