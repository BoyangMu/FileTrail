package dev.filetrail;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;

final class Util {

    static String id() {
        return UUID.randomUUID().toString();
    }

    static long now() {
        return System.currentTimeMillis();
    }

    static String token() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static MessageDigest digest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static String hash(byte[] bytes) {
        return HexFormat.of().formatHex(digest().digest(bytes));
    }

    static String hash(String text) {
        return hash(text.getBytes(StandardCharsets.UTF_8));
    }

    static String required(String value, int max) {
        if (value == null || value.isBlank() || value.length() > max) throw ApiError.bad(
            "A required field is missing or exceeds the length limit."
        );
        return value.trim();
    }

    static String name(String value) {
        value = required(value, 255);
        if (
            value.equals(".") ||
            value.equals("..") ||
            value.chars().anyMatch(c -> c < 32 || c == '/' || c == '\\' || c == 127)
        ) throw ApiError.bad("File names cannot contain path separators or control characters.");
        return value;
    }

    static String sha(String value) {
        if (value == null || !value.matches("[0-9a-f]{64}")) throw ApiError.bad(
            "Provide a lowercase SHA-256 checksum."
        );
        return value;
    }

    static String str(Map<String, Object> row, String key) {
        return (String) row.get(key);
    }

    static long num(Map<String, Object> row, String key) {
        return ((Number) row.get(key)).longValue();
    }
}
