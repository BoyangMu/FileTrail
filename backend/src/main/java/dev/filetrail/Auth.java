package dev.filetrail;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
class AuthFilter extends OncePerRequestFilter {

    private final JdbcTemplate db;
    private final ObjectMapper json;

    AuthFilter(JdbcTemplate db, ObjectMapper json) {
        this.db = db;
        this.json = json;
    }

    @Override
    protected void doFilterInternal(
        HttpServletRequest req,
        HttpServletResponse res,
        FilterChain chain
    ) throws ServletException, IOException {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Cache-Control", "no-store");
        String path = req.getRequestURI();
        if (!path.startsWith("/api/")) {
            chain.doFilter(req, res);
            return;
        }
        if (
            !Set.of("GET", "HEAD", "OPTIONS").contains(req.getMethod()) &&
            (!"1".equals(req.getHeader("X-FileTrail")) ||
                "cross-site".equals(req.getHeader("Sec-Fetch-Site")))
        ) {
            reject(res, 403, "CSRF_REJECTED", "Invalid request origin.");
            return;
        }
        if (
            path.equals("/api/health") ||
            path.equals("/api/auth/login") ||
            path.equals("/api/auth/register") ||
            path.startsWith("/api/public/")
        ) {
            chain.doFilter(req, res);
            return;
        }
        String token = readToken(req);
        var users = db.queryForList(
            "SELECT user_id FROM auth_session WHERE token_hash=? AND expires_at>?",
            Util.hash(token),
            Util.now()
        );
        if (users.isEmpty()) {
            reject(res, 401, "UNAUTHENTICATED", "Please sign in to continue.");
            return;
        }
        req.setAttribute("userId", users.get(0).get("user_id"));
        chain.doFilter(req, res);
    }

    static String readToken(HttpServletRequest req) {
        if (req.getCookies() != null) for (Cookie c : req.getCookies())
            if (c.getName().equals("ft_session")) return c.getValue();
        return "";
    }

    void reject(HttpServletResponse res, int status, String code, String message)
        throws IOException {
        res.setStatus(status);
        res.setContentType("application/json;charset=UTF-8");
        json.writeValue(res.getOutputStream(), Map.of("code", code, "message", message));
    }
}

@RestController
@RequestMapping("/api")
class AuthController {

    private final JdbcTemplate db;
    private final BCryptPasswordEncoder passwords = new BCryptPasswordEncoder(12);
    private final String dummy = passwords.encode("filetrail-dummy-password");
    private final boolean secure;
    private final ConcurrentHashMap<String, long[]> attempts = new ConcurrentHashMap<>();

    AuthController(JdbcTemplate db, @Value("${filetrail.secure-cookie}") boolean secure) {
        this.db = db;
        this.secure = secure;
    }

    record Credentials(String email, String password, String displayName) {}

    @GetMapping("/health")
    Map<String, Object> health() {
        db.queryForObject("SELECT 1", Integer.class);
        return Map.of("status", "ok", "phase", "web-v1");
    }

    @PostMapping("/auth/register")
    Map<String, Object> register(
        @RequestBody Credentials body,
        HttpServletRequest req,
        HttpServletResponse res
    ) {
        throttle(req);
        String email = email(body.email());
        String name = Util.required(body.displayName(), 100);
        String password = password(body.password());
        String id = Util.id();
        db.update(
            "INSERT INTO app_user(id,email,display_name,password_hash,created_at) VALUES (?,?,?,?,?)",
            id,
            email,
            name,
            passwords.encode(password),
            Util.now()
        );
        loginCookie(id, res);
        return user(id);
    }

    @PostMapping("/auth/login")
    Map<String, Object> login(
        @RequestBody Credentials body,
        HttpServletRequest req,
        HttpServletResponse res
    ) {
        throttle(req);
        String email = email(body.email());
        String password = password(body.password());
        var rows = db.queryForList("SELECT * FROM app_user WHERE email=?", email);
        boolean valid = passwords.matches(
            password,
            rows.isEmpty() ? dummy : (String) rows.get(0).get("password_hash")
        );
        if (rows.isEmpty() || !valid) throw new ApiError(
            401,
            "INVALID_CREDENTIALS",
            "Incorrect email or password."
        );
        String id = (String) rows.get(0).get("id");
        loginCookie(id, res);
        return user(id);
    }

    @GetMapping("/auth/me")
    Map<String, Object> me(HttpServletRequest req) {
        return user((String) req.getAttribute("userId"));
    }

    @PostMapping("/auth/logout")
    void logout(HttpServletRequest req, HttpServletResponse res) {
        db.update(
            "DELETE FROM auth_session WHERE token_hash=?",
            Util.hash(AuthFilter.readToken(req))
        );
        res.addHeader(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO).toString());
    }

    private Map<String, Object> user(String id) {
        return db.queryForMap("SELECT id,email,display_name FROM app_user WHERE id=?", id);
    }

    private String email(String text) {
        String email = Util.required(text, 254).toLowerCase(Locale.ROOT);
        if (!email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) throw ApiError.bad(
            "Enter a valid email address."
        );
        return email;
    }

    private String password(String password) {
        if (
            password == null ||
            password.length() < 10 ||
            password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 72
        ) throw ApiError.bad(
            "Use at least 10 characters and no more than 72 UTF-8 bytes for your password."
        );
        return password;
    }

    private void loginCookie(String id, HttpServletResponse res) {
        String token = Util.token();
        db.update(
            "INSERT INTO auth_session VALUES (?,?,?)",
            Util.hash(token),
            id,
            Util.now() + Duration.ofDays(7).toMillis()
        );
        res.addHeader(HttpHeaders.SET_COOKIE, cookie(token, Duration.ofDays(7)).toString());
    }

    private ResponseCookie cookie(String token, Duration age) {
        return ResponseCookie.from("ft_session", token)
            .httpOnly(true)
            .secure(secure)
            .sameSite("Strict")
            .path("/")
            .maxAge(age)
            .build();
    }

    private synchronized void throttle(HttpServletRequest req) {
        long now = Util.now();
        attempts.entrySet().removeIf(e -> now - e.getValue()[0] > 60_000);
        if (attempts.size() > 10_000) throw new ApiError(
            429,
            "RATE_LIMITED",
            "Too many requests. Please try again later."
        );
        long[] counter = attempts.computeIfAbsent(req.getRemoteAddr(), k -> new long[] { now, 0 });
        if (++counter[1] > 20) throw new ApiError(
            429,
            "RATE_LIMITED",
            "Too many sign-in attempts. Please wait a minute."
        );
    }
}
