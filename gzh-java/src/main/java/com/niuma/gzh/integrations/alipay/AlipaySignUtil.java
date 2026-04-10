package com.niuma.gzh.integrations.alipay;

import com.niuma.gzh.common.web.BizException;
import com.niuma.gzh.common.web.ErrorCode;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

public final class AlipaySignUtil {
    private AlipaySignUtil() {
    }

    public static String sign(Map<String, String> params, String privateKeyPem) {
        try {
            String content = buildSignContentForRequest(params);
            PrivateKey privateKey = loadPrivateKey(privateKeyPem);
            Signature signature = Signature.getInstance("SHA256withRSA");
            signature.initSign(privateKey);
            signature.update(content.getBytes(StandardCharsets.UTF_8));
            byte[] signed = signature.sign();
            return Base64.getEncoder().encodeToString(signed);
        } catch (Exception e) {
            throw new BizException(ErrorCode.SYSTEM_BUSY.getCode(), "支付宝签名失败: " + e.getMessage());
        }
    }

    public static boolean verify(Map<String, String> params, String alipayPublicKeyPem, String sign) {
        try {
            PublicKey publicKey = loadPublicKey(alipayPublicKeyPem);
            String normalizedSign = sign == null ? "" : sign.trim();
            if (verifyWithContent(buildSignContentForCallback(params), publicKey, normalizedSign)) {
                return true;
            }
            // Some gateways include sign_type in sign content. Keep fallback for compatibility.
            if (verifyWithContent(buildSignContentForRequest(params), publicKey, normalizedSign)) {
                return true;
            }
            // Defensive fallback for unexpected '+'->' ' conversion on callback transport.
            if (normalizedSign.contains(" ")) {
                String repairedSign = normalizedSign.replace(' ', '+');
                if (verifyWithContent(buildSignContentForCallback(params), publicKey, repairedSign)) {
                    return true;
                }
                return verifyWithContent(buildSignContentForRequest(params), publicKey, repairedSign);
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    public static String buildSignContentForRequest(Map<String, String> params) {
        return buildSignContent(params, true);
    }

    public static String buildSignContentForCallback(Map<String, String> params) {
        return buildSignContent(params, false);
    }

    private static String buildSignContent(Map<String, String> params, boolean includeSignType) {
        List<Map.Entry<String, String>> entries = new ArrayList<>(params.entrySet());
        entries.sort(Comparator.comparing(Map.Entry::getKey));
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> entry : entries) {
            String key = entry.getKey();
            String value = entry.getValue();
            if (value == null || value.isBlank() || "sign".equals(key)) {
                continue;
            }
            if (!includeSignType && "sign_type".equals(key)) {
                continue;
            }
            if (sb.length() > 0) {
                sb.append('&');
            }
            sb.append(key).append('=').append(value);
        }
        return sb.toString();
    }

    private static boolean verifyWithContent(String content, PublicKey publicKey, String sign) throws Exception {
        Signature signature = Signature.getInstance("SHA256withRSA");
        signature.initVerify(publicKey);
        signature.update(content.getBytes(StandardCharsets.UTF_8));
        return signature.verify(Base64.getDecoder().decode(sign));
    }

    public static String toQueryString(Map<String, String> params) {
        List<Map.Entry<String, String>> entries = new ArrayList<>(params.entrySet());
        entries.sort(Comparator.comparing(Map.Entry::getKey));
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> entry : entries) {
            if (entry.getValue() == null) {
                continue;
            }
            if (sb.length() > 0) {
                sb.append('&');
            }
            sb.append(entry.getKey()).append('=')
                .append(URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8));
        }
        return sb.toString();
    }

    private static PrivateKey loadPrivateKey(String privateKeyPem) throws Exception {
        String normalized = normalizeKey(privateKeyPem);
        byte[] keyBytes = Base64.getDecoder().decode(normalized);
        PKCS8EncodedKeySpec spec = new PKCS8EncodedKeySpec(keyBytes);
        return KeyFactory.getInstance("RSA").generatePrivate(spec);
    }

    private static PublicKey loadPublicKey(String publicKeyPem) throws Exception {
        String normalized = normalizeKey(publicKeyPem);
        byte[] keyBytes = Base64.getDecoder().decode(normalized);
        X509EncodedKeySpec spec = new X509EncodedKeySpec(keyBytes);
        return KeyFactory.getInstance("RSA").generatePublic(spec);
    }

    private static String normalizeKey(String key) {
        if (key == null) {
            return "";
        }
        return key
            .replace("-----BEGIN PRIVATE KEY-----", "")
            .replace("-----END PRIVATE KEY-----", "")
            .replace("-----BEGIN PUBLIC KEY-----", "")
            .replace("-----END PUBLIC KEY-----", "")
            .replaceAll("\\s", "");
    }
}
