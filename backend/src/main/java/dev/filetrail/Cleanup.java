package dev.filetrail;

import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Component
@ConditionalOnProperty(name = "filetrail.worker", havingValue = "true")
class Cleanup {

    private static final Logger log = LoggerFactory.getLogger(Cleanup.class);
    private final Workspace ws;
    private final BlobStore blobs;
    private final TransactionTemplate tx;

    Cleanup(Workspace ws, BlobStore blobs, PlatformTransactionManager manager) {
        this.ws = ws;
        this.blobs = blobs;
        tx = new TransactionTemplate(manager);
    }

    @Scheduled(
        fixedDelayString = "${CLEANUP_INTERVAL_MS:3600000}",
        initialDelayString = "${CLEANUP_INITIAL_DELAY_MS:60000}"
    )
    public void run() {
        try {
            ws.jdbc().update("DELETE FROM auth_session WHERE expires_at<?", Util.now());
            for (var row : ws
                .jdbc()
                .queryForList(
                    "SELECT DISTINCT owner_id FROM upload_session WHERE state='OPEN' AND expires_at<?",
                    Util.now()
                ))
                tx.executeWithoutResult(status -> {
                    String owner = Util.str(row, "owner_id");
                    ws.lock(owner);
                    ws.jdbc().update(
                        "UPDATE upload_session SET state='EXPIRED' WHERE owner_id=? AND state='OPEN' AND expires_at<?",
                        owner,
                        Util.now()
                    );
                });
            for (var blob : blobs.list()) {
                if (blob.modifiedAt() > Util.now() - Duration.ofDays(1).toMillis()) continue;
                tx.executeWithoutResult(status -> {
                    try {
                        String[] path = blob.key().split("/");
                        var session =
                            path.length >= 2
                                ? ws
                                      .jdbc()
                                      .queryForList(
                                          "SELECT owner_id FROM upload_session WHERE id=?",
                                          path[1]
                                      )
                                : java.util.List.<java.util.Map<String, Object>>of();
                        if (!session.isEmpty()) {
                            ws.lock(Util.str(session.get(0), "owner_id"));
                            if (
                                ws
                                    .jdbc()
                                    .queryForObject(
                                        "SELECT COUNT(*) FROM upload_session WHERE id=? AND state='OPEN' AND expires_at>?",
                                        Long.class,
                                        path[1],
                                        Util.now()
                                    ) > 0
                            ) return;
                        }
                        if (
                            ws
                                .jdbc()
                                .queryForObject(
                                    "SELECT COUNT(*) FROM content_object WHERE object_key=?",
                                    Long.class,
                                    blob.key()
                                ) > 0
                        ) return;
                        blobs.delete(blob.key());
                    } catch (Exception e) {
                        throw new IllegalStateException("Object cleanup failed", e);
                    }
                });
            }
        } catch (Exception e) {
            log.error("Cleanup will retry on the next scheduled run", e);
        }
    }
}
