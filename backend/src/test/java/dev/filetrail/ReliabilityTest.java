package dev.filetrail;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(
    properties = {
        "spring.datasource.url=jdbc:h2:mem:test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "filetrail.data-dir=./target/test-objects",
        "filetrail.worker=false",
    }
)
@AutoConfigureMockMvc
class ReliabilityTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper json;

    @Autowired
    Uploads uploads;

    @Autowired
    Workspace ws;

    @Autowired
    PlatformTransactionManager manager;

    @MockitoSpyBean
    BlobStore blobs;

    Cookie cookie;
    String owner;

    @BeforeEach
    void account() throws Exception {
        String email = UUID.randomUUID() + "@example.com";
        var result = mvc
            .perform(
                post("/api/auth/register")
                    .header("X-FileTrail", "1")
                    .contentType("application/json")
                    .content(
                        json.writeValueAsBytes(
                            Map.of(
                                "email",
                                email,
                                "password",
                                "correct-password-123",
                                "displayName",
                                "Test"
                            )
                        )
                    )
            )
            .andExpect(status().isOk())
            .andReturn();
        owner = (String) json
            .readValue(result.getResponse().getContentAsString(), Map.class)
            .get("id");
        String value = result
            .getResponse()
            .getHeader("Set-Cookie")
            .split(";", 2)[0]
            .split("=", 2)[1];
        cookie = new Cookie("ft_session", value);
    }

    Map<String, Object> call(MockHttpServletRequestBuilder r, int status) throws Exception {
        var res = mvc
            .perform(r.cookie(cookie).header("X-FileTrail", "1"))
            .andExpect(status().is(status))
            .andReturn()
            .getResponse()
            .getContentAsString();
        return res.isBlank() ? Map.of() : json.readValue(res, Map.class);
    }

    MockHttpServletRequestBuilder body(MockHttpServletRequestBuilder r, Object b) throws Exception {
        return r.contentType("application/json").content(json.writeValueAsBytes(b));
    }

    Uploads.Start start(String name, byte[] data, String target, String base) {
        return new Uploads.Start(
            Util.id(),
            target,
            null,
            name,
            base,
            data.length,
            Util.hash(data),
            64 * 1024,
            "test-device"
        );
    }

    Map<String, Object> upload(String name, byte[] data, String target, String base)
        throws Exception {
        var s = uploads.begin(owner, start(name, data, target, base));
        String id = Util.str(s, "id");
        for (int i = 0; i < (data.length + 65535) / 65536; i++) {
            byte[] part = Arrays.copyOfRange(
                data,
                i * 65536,
                Math.min(data.length, (i + 1) * 65536)
            );
            uploads.part(owner, id, i, Util.hash(part), new ByteArrayInputStream(part));
        }
        return uploads.complete(owner, id);
    }

    @Test
    void incompleteAndCorruptPartsNeverPublishAndResumeOnlyMissing() throws Exception {
        byte[] data = new byte[100_000];
        new Random(42).nextBytes(data);
        var s = uploads.begin(owner, start("large.bin", data, null, null));
        String id = Util.str(s, "id");
        byte[] first = Arrays.copyOfRange(data, 0, 65536),
            second = Arrays.copyOfRange(data, 65536, data.length);
        call(
            put("/api/uploads/" + id + "/parts/0")
                .contentType("application/octet-stream")
                .header("X-Content-SHA256", Util.hash("wrong"))
                .content(first),
            422
        );
        assertThat(ws.stats(owner).get("versions")).isEqualTo(0L);
        uploads.part(owner, id, 0, Util.hash(first), new ByteArrayInputStream(first));
        uploads.part(owner, id, 0, Util.hash(first), new ByteArrayInputStream(first));
        assertThat((List<?>) uploads.status(owner, id).get("parts")).hasSize(1);
        call(post("/api/uploads/" + id + "/complete"), 409);
        assertThat(ws.files(owner, null, "files")).isEmpty();
        uploads.part(owner, id, 1, Util.hash(second), new ByteArrayInputStream(second));
        var result = uploads.complete(owner, id);
        assertThat(result.get("state")).isEqualTo("PUBLISHED");
        var bytes = mvc
            .perform(
                get(
                    "/api/files/" +
                        result.get("result_file") +
                        "/versions/" +
                        result.get("result_version") +
                        "/download"
                ).cookie(cookie)
            )
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsByteArray();
        assertThat(bytes).isEqualTo(data);
    }

    @Test
    void idempotencyRejectsChangedPayloadAndCompleteReturnsSameVersion() throws Exception {
        byte[] data = "unchanged".getBytes();
        var request = start("test.txt", data, null, null);
        var s = uploads.begin(owner, request);
        assertThat(uploads.begin(owner, request).get("id")).isEqualTo(s.get("id"));
        var changed = new Uploads.Start(
            request.requestKey(),
            null,
            null,
            "different.txt",
            null,
            data.length,
            Util.hash(data),
            65536,
            "test-device"
        );
        assertThatThrownBy(() -> uploads.begin(owner, changed)).isInstanceOf(ApiError.class);
        String id = Util.str(s, "id");
        uploads.part(owner, id, 0, Util.hash(data), new ByteArrayInputStream(data));
        var a = uploads.complete(owner, id);
        var b = uploads.complete(owner, id);
        assertThat(a.get("result_version")).isEqualTo(b.get("result_version"));
        assertThat(ws.stats(owner).get("versions")).isEqualTo(1L);
    }

    @Test
    void competingUpdatesPreserveBothContents() throws Exception {
        var original = upload("report.txt", "v1".getBytes(), null, null);
        String file = Util.str(original, "result_file"),
            base = Util.str(original, "result_version");
        var a = uploads.begin(owner, start("report.txt", "from A".getBytes(), file, base));
        var b = uploads.begin(owner, start("report.txt", "from B".getBytes(), file, base));
        uploads.part(
            owner,
            Util.str(a, "id"),
            0,
            Util.hash("from A"),
            new ByteArrayInputStream("from A".getBytes())
        );
        uploads.part(
            owner,
            Util.str(b, "id"),
            0,
            Util.hash("from B"),
            new ByteArrayInputStream("from B".getBytes())
        );
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch gate = new CountDownLatch(1);
        try {
            var f1 = pool.submit(() -> {
                gate.await();
                return uploads.complete(owner, Util.str(a, "id"));
            });
            var f2 = pool.submit(() -> {
                gate.await();
                return uploads.complete(owner, Util.str(b, "id"));
            });
            gate.countDown();
            assertThat(
                List.of(
                    f1.get(10, TimeUnit.SECONDS).get("state"),
                    f2.get(10, TimeUnit.SECONDS).get("state")
                )
            ).containsExactlyInAnyOrder("PUBLISHED", "CONFLICT");
        } finally {
            pool.shutdownNow();
        }
        assertThat(ws.files(owner, null, "files")).hasSize(2);
        assertThat(ws.versions(owner, file)).hasSize(2);
        assertThat(ws.files(owner, null, "conflicts")).hasSize(1);
        Set<String> checksums = new HashSet<>();
        for (var f : ws.files(owner, null, "files")) checksums.add(Util.str(f, "sha256"));
        assertThat(checksums).containsExactlyInAnyOrder(Util.hash("from A"), Util.hash("from B"));
    }

    @Test
    void restoringCreatesVersionAndReplayingDoesNotCreateAnother() throws Exception {
        var a = upload("report.txt", "yesterday".getBytes(), null, null);
        String file = Util.str(a, "result_file"),
            v1 = Util.str(a, "result_version");
        var b = upload("report.txt", "today".getBytes(), file, v1);
        String key = Util.id();
        var restored = ws.restore(owner, file, v1, Util.str(b, "result_version"), key);
        assertThat(restored.get("sha256")).isEqualTo(Util.hash("yesterday"));
        assertThat(
            ws.restore(owner, file, v1, Util.str(b, "result_version"), key).get("id")
        ).isEqualTo(restored.get("id"));
        assertThat(ws.versions(owner, file)).hasSize(3);
        assertThatThrownBy(() -> ws.restore(owner, file, v1, v1, Util.id())).isInstanceOf(
            ApiError.class
        );
    }

    @Test
    void ownershipAndCsrfAreEnforcedAcrossEndpoints() throws Exception {
        var a = upload("private.txt", "secret".getBytes(), null, null);
        String file = Util.str(a, "result_file"),
            version = Util.str(a, "result_version"),
            session = Util.str(a, "id");
        account();
        call(get("/api/files/" + file), 404);
        call(get("/api/files/" + file + "/versions"), 404);
        call(get("/api/files/" + file + "/versions/" + version + "/download"), 404);
        call(delete("/api/files/" + file), 404);
        call(get("/api/uploads/" + session), 404);
        mvc.perform(
            post("/api/folders")
                .cookie(cookie)
                .contentType("application/json")
                .content("{\"name\":\"bad\"}")
        ).andExpect(status().isForbidden());
        mvc.perform(get("/api/files")).andExpect(status().isUnauthorized());
    }

    @Test
    void sharesRemainPinnedAndRevocationAndExpiryDenyNewDownloads() throws Exception {
        var a = upload("report.txt", "shared v1".getBytes(), null, null);
        String file = Util.str(a, "result_file"),
            version = Util.str(a, "result_version");
        var share = ws.share(owner, file, version, 1);
        String token = Util.str(share, "token");
        upload("report.txt", "private v2".getBytes(), file, version);
        assertThat(ws.publicShare(token).get("sha256")).isEqualTo(Util.hash("shared v1"));
        mvc.perform(get("/api/public/shares/" + token + "/download"))
            .andExpect(status().isOk())
            .andExpect(content().bytes("shared v1".getBytes()));
        ws.revoke(owner, Util.str(share, "id"));
        mvc.perform(get("/api/public/shares/" + token + "/download")).andExpect(status().isGone());
        var expired = ws.share(owner, file, version, 1);
        ws.jdbc().update("UPDATE share_link SET expires_at=0 WHERE id=?", expired.get("id"));
        mvc.perform(get("/api/public/shares/" + expired.get("token"))).andExpect(status().isGone());
    }

    @Test
    void deleteRacePreservesOfflineEditAndMovesRetainIdentity() throws Exception {
        var a = upload("report.txt", "v1".getBytes(), null, null);
        String file = Util.str(a, "result_file"),
            base = Util.str(a, "result_version");
        var pending = uploads.begin(owner, start("report.txt", "offline".getBytes(), file, base));
        uploads.part(
            owner,
            Util.str(pending, "id"),
            0,
            Util.hash("offline"),
            new ByteArrayInputStream("offline".getBytes())
        );
        var folder = ws.mkdir(owner, null, "Reports");
        ws.move(owner, file, "renamed.txt", Util.str(folder, "id"));
        assertThat(ws.entry(owner, file).get("current_version")).isEqualTo(base);
        ws.trash(owner, file);
        var result = uploads.complete(owner, Util.str(pending, "id"));
        assertThat(result.get("state")).isEqualTo("CONFLICT");
        assertThat(ws.files(owner, null, "trash")).hasSize(1);
        ws.untrash(owner, file);
        assertThat(ws.versions(owner, file)).hasSize(1);
    }

    @Test
    void namespaceRejectsCyclesAndNonemptyFolderDeletion() {
        String parent = Util.str(ws.mkdir(owner, null, "parent"), "id");
        String child = Util.str(ws.mkdir(owner, parent, "child"), "id");
        assertThatThrownBy(() -> ws.move(owner, parent, "parent", child)).isInstanceOf(
            ApiError.class
        );
        assertThatThrownBy(() -> ws.trash(owner, parent)).isInstanceOf(ApiError.class);
        assertThatThrownBy(() -> ws.mkdir(owner, null, "PARENT")).isInstanceOf(
            org.springframework.dao.DataIntegrityViolationException.class
        );
    }

    @Test
    void fullChecksumAndStoredCorruptionFailClosedAndPartCanBeRepaired() throws Exception {
        byte[] data = "bytes".getBytes();
        var s = uploads.begin(owner, start("test.bin", data, null, null));
        String id = Util.str(s, "id");
        uploads.part(owner, id, 0, Util.hash(data), new ByteArrayInputStream(data));
        Files.writeString(
            Path.of("target/test-objects/parts/" + id + "/0-" + Util.hash(data)),
            "broken"
        );
        call(post("/api/uploads/" + id + "/complete"), 422);
        assertThat(ws.files(owner, null, "files")).isEmpty();
        uploads.part(owner, id, 0, Util.hash(data), new ByteArrayInputStream(data));
        assertThat(uploads.complete(owner, id).get("state")).isEqualTo("PUBLISHED");
        var wrong = new Uploads.Start(
            Util.id(),
            null,
            null,
            "wrong.txt",
            null,
            data.length,
            Util.hash("other"),
            65536,
            "Web"
        );
        var invalid = uploads.begin(owner, wrong);
        uploads.part(
            owner,
            Util.str(invalid, "id"),
            0,
            Util.hash(data),
            new ByteArrayInputStream(data)
        );
        call(post("/api/uploads/" + invalid.get("id") + "/complete"), 422);
        assertThat(ws.files(owner, null, "files")).hasSize(1);
    }

    @Test
    void commitRollbackLeavesNoVisibleVersionAndRetryCanPublish() throws Exception {
        byte[] data = "rollback".getBytes();
        String id = Util.str(uploads.begin(owner, start("rollback.txt", data, null, null)), "id");
        uploads.part(owner, id, 0, Util.hash(data), new ByteArrayInputStream(data));
        new TransactionTemplate(manager).executeWithoutResult(tx -> {
            try {
                uploads.complete(owner, id);
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
            tx.setRollbackOnly();
        });
        assertThat(ws.files(owner, null, "files")).isEmpty();
        assertThat(uploads.status(owner, id).get("state")).isEqualTo("OPEN");
        assertThat(Files.exists(Path.of("target/test-objects/contents/" + id))).isTrue();
        assertThat(uploads.complete(owner, id).get("state")).isEqualTo("PUBLISHED");
        assertThat(ws.stats(owner).get("versions")).isEqualTo(1L);
    }

    @Test
    void storageWriteFailureDoesNotPublishAndCanRetry() throws Exception {
        byte[] data = "retry".getBytes();
        String id = Util.str(uploads.begin(owner, start("retry.txt", data, null, null)), "id");
        uploads.part(owner, id, 0, Util.hash(data), new ByteArrayInputStream(data));
        doThrow(new IOException("injected storage failure"))
            .when(blobs)
            .put(eq("contents/" + id), any(Path.class));
        assertThatThrownBy(() -> uploads.complete(owner, id)).isInstanceOf(IOException.class);
        assertThat(ws.files(owner, null, "files")).isEmpty();
        doCallRealMethod()
            .when(blobs)
            .put(eq("contents/" + id), any(Path.class));
        assertThat(uploads.complete(owner, id).get("state")).isEqualTo("PUBLISHED");
    }

    @Test
    void emptyFilesAndCancelledOrExpiredSessionsBehaveExplicitly() throws Exception {
        assertThat(upload("empty.txt", new byte[0], null, null).get("state")).isEqualTo(
            "PUBLISHED"
        );
        String id = Util.str(
            uploads.begin(owner, start("cancel.txt", "x".getBytes(), null, null)),
            "id"
        );
        uploads.cancel(owner, id);
        call(post("/api/uploads/" + id + "/complete"), 409);
        String expired = Util.str(
            uploads.begin(owner, start("expired.txt", "x".getBytes(), null, null)),
            "id"
        );
        ws.jdbc().update("UPDATE upload_session SET expires_at=0 WHERE id=?", expired);
        call(post("/api/uploads/" + expired + "/complete"), 410);
    }

    @Test
    void cleanupKeepsReferencesAndActiveUploadsButReclaimsAbandonedObjects() throws Exception {
        byte[] data = "cleanup".getBytes();
        var published = upload("kept.txt", data, null, null);
        String open = Util.str(uploads.begin(owner, start("open.txt", data, null, null)), "id");
        String cancelled = Util.str(
            uploads.begin(owner, start("cancelled.txt", data, null, null)),
            "id"
        );
        uploads.part(owner, open, 0, Util.hash(data), new ByteArrayInputStream(data));
        uploads.part(owner, cancelled, 0, Util.hash(data), new ByteArrayInputStream(data));
        uploads.cancel(owner, cancelled);
        Path root = Path.of("target/test-objects");
        Path kept = root.resolve("contents/" + published.get("id"));
        Path live = root.resolve("parts/" + open + "/0-" + Util.hash(data));
        Path abandoned = root.resolve("parts/" + cancelled + "/0-" + Util.hash(data));
        Path orphan = root.resolve("contents/" + Util.id());
        Files.write(orphan, data);
        var old = java.nio.file.attribute.FileTime.fromMillis(Util.now() - 48L * 3600 * 1000);
        for (Path path : List.of(kept, live, abandoned, orphan))
            Files.setLastModifiedTime(path, old);
        var cleaner = new Cleanup(ws, blobs, manager);
        cleaner.run();
        assertThat(kept).exists();
        assertThat(live).exists();
        assertThat(abandoned).doesNotExist();
        assertThat(orphan).doesNotExist();
        ws.jdbc().update("UPDATE upload_session SET expires_at=0 WHERE id=?", open);
        cleaner.run();
        assertThat(live).doesNotExist();
        assertThat(uploads.status(owner, open).get("state")).isEqualTo("EXPIRED");
    }
}
