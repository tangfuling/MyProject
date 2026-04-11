package com.niuma.gzh.modules.user.service.impl;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.niuma.gzh.common.base.BaseService;
import com.niuma.gzh.common.ai.AiModelProvider;
import com.niuma.gzh.common.base.PageResult;
import com.niuma.gzh.common.security.AuthContext;
import com.niuma.gzh.common.util.PhoneUtil;
import com.niuma.gzh.common.web.BizException;
import com.niuma.gzh.common.web.ErrorCode;
import com.niuma.gzh.modules.article.model.entity.ArticleSnapshotEntity;
import com.niuma.gzh.modules.article.repository.ArticleRepository;
import com.niuma.gzh.modules.article.repository.ArticleSnapshotRepository;
import com.niuma.gzh.modules.payment.model.entity.PaymentOrderEntity;
import com.niuma.gzh.modules.payment.repository.PaymentOrderRepository;
import com.niuma.gzh.modules.user.model.entity.TokenLogEntity;
import com.niuma.gzh.modules.user.model.entity.UserEntity;
import com.niuma.gzh.modules.user.model.vo.TokenLogVO;
import com.niuma.gzh.modules.user.model.vo.UserProfileVO;
import com.niuma.gzh.modules.user.repository.TokenLogRepository;
import com.niuma.gzh.modules.user.repository.UserRepository;
import com.niuma.gzh.modules.user.service.UserService;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Slf4j
@Service
public class UserServiceImpl extends BaseService implements UserService {
    private static final long MAX_AVATAR_BYTES = 2L * 1024 * 1024;
    private static final Set<String> ALLOWED_IMAGE_EXT = com.niuma.gzh.common.util.J8.setOf(
        "jpg", "jpeg", "png", "gif", "webp", "bmp"
    );
    private static final Pattern TECHNICAL_MP_ID_PATTERN = Pattern.compile("^(gh_|wxid_)[a-z0-9_]{4,}$", Pattern.CASE_INSENSITIVE);

    private final UserRepository userRepository;
    private final TokenLogRepository tokenLogRepository;
    private final ArticleRepository articleRepository;
    private final ArticleSnapshotRepository articleSnapshotRepository;
    private final PaymentOrderRepository paymentOrderRepository;
    private final Path avatarUploadDir;
    private final String avatarUrlPrefix;

    public UserServiceImpl(UserRepository userRepository,
                           TokenLogRepository tokenLogRepository,
                           ArticleRepository articleRepository,
                           ArticleSnapshotRepository articleSnapshotRepository,
                           PaymentOrderRepository paymentOrderRepository,
                           @Value("${app.upload.avatar-dir:./storage/avatars}") String avatarDir,
                           @Value("${app.upload.avatar-url-prefix:/uploads/avatars}") String avatarUrlPrefix) {
        this.userRepository = userRepository;
        this.tokenLogRepository = tokenLogRepository;
        this.articleRepository = articleRepository;
        this.articleSnapshotRepository = articleSnapshotRepository;
        this.paymentOrderRepository = paymentOrderRepository;
        this.avatarUploadDir = Paths.get(avatarDir).toAbsolutePath().normalize();
        this.avatarUrlPrefix = normalizeAvatarUrlPrefix(avatarUrlPrefix);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public UserEntity findOrCreateByPhone(String phone) {
        UserEntity existed = userRepository.findByPhone(phone);
        if (existed != null) {
            return existed;
        }
        UserEntity created = new UserEntity();
        created.setPhone(phone);
        created.setDisplayName(defaultDisplayNameByPhone(phone));
        created.setAiModel(AiModelProvider.QWEN_3_5.getCode());
        created.setBalanceCent(0);
        created.setFreeQuotaCent(100);
        userRepository.save(created);
        createFreeQuotaGrantRecord(created);
        return created;
    }

    @Override
    public UserEntity getById(Long userId) {
        UserEntity entity = userRepository.findById(userId);
        if (entity == null) {
            throw new BizException(ErrorCode.NOT_FOUND.getCode(), "用户不存在");
        }
        return entity;
    }

    @Override
    public UserProfileVO profile() {
        Long userId = AuthContext.requiredUserId();
        UserEntity user = getById(userId);
        UserProfileVO vo = new UserProfileVO();
        vo.setId(user.getId());
        vo.setPhone(PhoneUtil.mask(user.getPhone()));
        vo.setDisplayName(resolveDisplayName(user));
        vo.setMpAccountName(resolveMpAccountName(user));
        vo.setAvatarUrl(user.getAvatarUrl());
        vo.setAiModel(normalizeToQwenModelCode(user.getAiModel()));
        vo.setBalanceCent(user.getBalanceCent());
        vo.setFreeQuotaCent(user.getFreeQuotaCent());
        vo.setArticleCount(articleRepository.countByUser(userId));
        vo.setCreatedAt(user.getCreatedAt());
        ArticleSnapshotEntity latestSnapshot = articleSnapshotRepository.latestByUser(userId);
        vo.setLastSyncAt(latestSnapshot == null ? null : latestSnapshot.getSnapshotTime());
        return vo;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void updateProfile(String displayName, String avatarUrl) {
        Long userId = AuthContext.requiredUserId();
        UserEntity user = getById(userId);

        if (displayName != null) {
            String normalized = displayName.trim();
            if (normalized.isEmpty()) {
                throw new BizException(ErrorCode.INVALID_PARAM.getCode(), "displayName cannot be blank");
            }
            user.setDisplayName(normalized);
        }

        if (avatarUrl != null) {
            String normalized = avatarUrl.trim();
            user.setAvatarUrl(normalized.isEmpty() ? null : normalized);
        }

        userRepository.save(user);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public String uploadAvatar(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new BizException(ErrorCode.INVALID_PARAM.getCode(), "avatar file is empty");
        }
        if (file.getSize() > MAX_AVATAR_BYTES) {
            throw new BizException(ErrorCode.INVALID_PARAM.getCode(), "avatar file size exceeds 2MB");
        }
        String ext = resolveAvatarExt(file);
        if (ext.isEmpty()) {
            throw new BizException(ErrorCode.INVALID_PARAM.getCode(), "avatar image format is not supported");
        }

        Long userId = AuthContext.requiredUserId();
        UserEntity user = getById(userId);
        String fileName = buildAvatarFileName(userId, ext);
        Path target = avatarUploadDir.resolve(fileName).normalize();

        try {
            Files.createDirectories(avatarUploadDir);
            try (InputStream input = file.getInputStream()) {
                Files.copy(input, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException ex) {
            throw new BizException(ErrorCode.SYSTEM_BUSY.getCode(), "avatar upload failed");
        }

        String avatarUrl = avatarUrlPrefix + "/" + fileName;
        user.setAvatarUrl(avatarUrl);
        userRepository.save(user);
        return avatarUrl;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void updateAiModel(String model) {
        Long userId = AuthContext.requiredUserId();
        UserEntity user = getById(userId);
        user.setAiModel(resolveSelectableModelCode(model));
        userRepository.save(user);
    }

    @Override
    public PageResult<TokenLogVO> tokenLogs(long page, long size) {
        Long userId = AuthContext.requiredUserId();
        Page<TokenLogEntity> result = tokenLogRepository.pageByUser(userId, page, size);
        List<TokenLogVO> items = result.getRecords().stream().map(record -> {
            TokenLogVO vo = new TokenLogVO();
            vo.setId(record.getId());
            vo.setBizType(record.getBizType());
            vo.setBizId(record.getBizId());
            vo.setAiModel(record.getAiModel());
            vo.setInputTokens(record.getInputTokens());
            vo.setOutputTokens(record.getOutputTokens());
            vo.setCostCent(record.getCostCent());
            vo.setCreatedAt(record.getCreatedAt());
            return vo;
        }).collect(java.util.stream.Collectors.toList());
        return new PageResult<>(page, size, result.getTotal(), items);
    }

    @Override
    public void logTokenCost(Long userId, String bizType, String bizId, String aiModel, int inputTokens, int outputTokens, int costCent) {
        TokenLogEntity log = new TokenLogEntity();
        log.setUserId(userId);
        log.setBizType(bizType);
        log.setBizId(bizId);
        log.setAiModel(aiModel);
        log.setInputTokens(inputTokens);
        log.setOutputTokens(outputTokens);
        log.setCostCent(costCent);
        tokenLogRepository.save(log);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deductCost(Long userId, int costCent) {
        if (costCent <= 0) {
            return;
        }
        UserEntity user = getById(userId);
        int freeQuota = user.getFreeQuotaCent() == null ? 0 : user.getFreeQuotaCent();
        int balance = user.getBalanceCent() == null ? 0 : user.getBalanceCent();
        int available = freeQuota + balance;
        if (available < costCent) {
            throw new BizException(ErrorCode.BALANCE_NOT_ENOUGH);
        }

        int usedFree = Math.min(freeQuota, costCent);
        int usedBalance = costCent - usedFree;
        user.setFreeQuotaCent(freeQuota - usedFree);
        user.setBalanceCent(balance - usedBalance);
        userRepository.save(user);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void recharge(Long userId, int amountCent) {
        UserEntity user = getById(userId);
        user.setBalanceCent((user.getBalanceCent() == null ? 0 : user.getBalanceCent()) + amountCent);
        userRepository.save(user);
    }

    private void createFreeQuotaGrantRecord(UserEntity user) {
        if (user.getId() == null) {
            return;
        }
        String orderNo = "FREE-GRANT-" + user.getId();
        if (paymentOrderRepository.findByOrderNo(orderNo) != null) {
            return;
        }
        int amountCent = user.getFreeQuotaCent() == null ? 100 : user.getFreeQuotaCent();
        PaymentOrderEntity grantRecord = new PaymentOrderEntity();
        grantRecord.setUserId(user.getId());
        grantRecord.setOrderNo(orderNo);
        grantRecord.setAmountCent(amountCent);
        grantRecord.setChannel("free_quota");
        grantRecord.setStatus("PAID");
        grantRecord.setSubject("新用户免费额度");
        grantRecord.setAlipayTradeNo("FREE-" + user.getId());
        grantRecord.setCreatedAt(LocalDateTime.now());
        grantRecord.setUpdatedAt(LocalDateTime.now());
        paymentOrderRepository.save(grantRecord);
    }

    private String resolveDisplayName(UserEntity user) {
        if (user != null && user.getDisplayName() != null && !user.getDisplayName().trim().isEmpty()) {
            return user.getDisplayName().trim();
        }
        return defaultDisplayNameByPhone(user == null ? null : user.getPhone());
    }

    private String resolveMpAccountName(UserEntity user) {
        if (user != null && user.getMpAccountName() != null && !user.getMpAccountName().trim().isEmpty()) {
            String normalized = user.getMpAccountName().trim();
            if (!isTechnicalMpId(normalized)) {
                return normalized;
            }
        }
        return "";
    }

    private String defaultDisplayNameByPhone(String phone) {
        if (phone == null || phone.trim().isEmpty()) {
            return "\u516c\u4f17\u53f7\u8d26\u53f7";
        }
        String normalized = phone.trim();
        String suffix = normalized.length() <= 4 ? normalized : normalized.substring(normalized.length() - 4);
        return "\u516c\u4f17\u53f7" + suffix;
    }

    private String resolveAvatarExt(MultipartFile file) {
        String original = file.getOriginalFilename();
        if (original != null) {
            int dot = original.lastIndexOf('.');
            if (dot >= 0 && dot < original.length() - 1) {
                String ext = original.substring(dot + 1).trim().toLowerCase(Locale.ROOT);
                if (ALLOWED_IMAGE_EXT.contains(ext)) {
                    return ext;
                }
            }
        }
        String contentType = String.valueOf(file.getContentType()).toLowerCase(Locale.ROOT);
        if (contentType.contains("jpeg")) {
            return "jpg";
        }
        if (contentType.contains("png")) {
            return "png";
        }
        if (contentType.contains("gif")) {
            return "gif";
        }
        if (contentType.contains("webp")) {
            return "webp";
        }
        if (contentType.contains("bmp")) {
            return "bmp";
        }
        return "";
    }

    private String buildAvatarFileName(Long userId, String ext) {
        String random = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        return "u" + userId + "_" + System.currentTimeMillis() + "_" + random + "." + ext;
    }

    private String normalizeAvatarUrlPrefix(String rawPrefix) {
        String prefix = rawPrefix == null ? "" : rawPrefix.trim();
        if (prefix.isEmpty()) {
            prefix = "/uploads/avatars";
        }
        if (!prefix.startsWith("/")) {
            prefix = "/" + prefix;
        }
        while (prefix.endsWith("/")) {
            prefix = prefix.substring(0, prefix.length() - 1);
        }
        return prefix;
    }

    private String resolveSelectableModelCode(String model) {
        AiModelProvider provider = AiModelProvider.fromCode(model);
        if (provider == AiModelProvider.QWEN_3_5 || provider == AiModelProvider.QWEN_3_6) {
            return provider.getCode();
        }
        log.warn("[tfling][user.aiModel] unsupported selectable model input={}", model);
        throw new BizException(ErrorCode.INVALID_PARAM.getCode(), "当前仅支持千问3.5-Flash和千问3.6-Plus");
    }

    private String normalizeToQwenModelCode(String modelCode) {
        AiModelProvider provider = AiModelProvider.fromCode(modelCode);
        if (provider == AiModelProvider.QWEN_3_5 || provider == AiModelProvider.QWEN_3_6) {
            return provider.getCode();
        }
        log.error("[tfling][user.aiModel] invalid stored modelCode={}", modelCode);
        throw new BizException(ErrorCode.INVALID_PARAM.getCode(), "用户模型配置非法，仅支持千问3.5-Flash和千问3.6-Plus");
    }

    private boolean isTechnicalMpId(String value) {
        if (value == null || value.trim().isEmpty()) {
            return false;
        }
        return TECHNICAL_MP_ID_PATTERN.matcher(value.trim()).matches();
    }
}
