package dev.filetrail;

import static dev.filetrail.Util.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class Uploads {

    private final Workspace ws;
    private final BlobStore blobs;
    private final ObjectMapper json;

    Uploads(Workspace ws, BlobStore blobs, ObjectMapper json) {
        this.ws = ws;
        this.blobs = blobs;
        this.json = json;
    }

    public record Start(
        String requestKey,
        String targetId,
        String parentId,
        String name,
        String baseVersion,
        long size,
        String sha256,
        int partSize,
        String source
    ) {}

    @Transactional
    public Map<String, Object> begin(String owner, Start r) throws IOException {
        ws.lock(owner);
        String name = name(r.name());
        required(r.requestKey(), 100);
        sha(r.sha256());
        required(r.source(), 100);
        if (
            r.size() < 0 ||
            r.size() > 4L * 1024 * 1024 * 1024 ||
            r.partSize() < 64 * 1024 ||
            r.partSize() > 4 * 1024 * 1024
        ) throw ApiError.bad(
            "Files must be no larger than 4 GiB. Part size must be between 64 KiB and 4 MiB."
        );
        long count = (r.size() + r.partSize() - 1) / r.partSize();
        if (count > 10000) throw ApiError.bad("An upload cannot exceed 10,000 parts.");
        String fingerprint = hash(json.writeValueAsBytes(r));
        var prior = ws
            .jdbc()
            .queryForList(
                "SELECT * FROM upload_session WHERE owner_id=? AND request_key=?",
                owner,
                r.requestKey()
            );
        if (!prior.isEmpty()) {
            if (!fingerprint.equals(prior.get(0).get("request_hash"))) throw ApiError.conflict(
                "This request key was used for a different upload."
            );
            return status(owner, str(prior.get(0), "id"));
        }
        ws.parent(owner, r.parentId());
        if (r.targetId() != null) {
            var f = ws.entry(owner, r.targetId());
            ws.active(f);
            if (!"FILE".equals(f.get("kind"))) throw ApiError.bad(
                "Only regular files support versions."
            );
            if (r.baseVersion() == null) throw ApiError.bad(
                "A base version is required when updating a file."
            );
            ws.version(owner, r.targetId(), r.baseVersion());
        } else if (r.baseVersion() != null) throw ApiError.bad(
            "New files cannot specify a base version."
        );
        String id = id();
        ws.jdbc().update(
            "INSERT INTO upload_session(id,owner_id,request_key,request_hash,target_id,parent_id,name,base_version,size,sha256,part_size,part_count,source,state,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'OPEN',?,?)",
            id,
            owner,
            r.requestKey(),
            fingerprint,
            r.targetId(),
            r.parentId(),
            name,
            r.baseVersion(),
            r.size(),
            r.sha256(),
            r.partSize(),
            count,
            r.source(),
            now() + Duration.ofDays(7).toMillis(),
            now()
        );
        return status(owner, id);
    }

    Map<String, Object> session(String owner, String id) {
        var rows = ws
            .jdbc()
            .queryForList("SELECT * FROM upload_session WHERE owner_id=? AND id=?", owner, id);
        if (rows.isEmpty()) throw ApiError.missing();
        return rows.get(0);
    }

    public Map<String, Object> status(String owner, String id) {
        var s = session(owner, id);
        s.remove("request_hash");
        s.put(
            "parts",
            ws
                .jdbc()
                .queryForList(
                    "SELECT part_no,size,sha256 FROM upload_part WHERE session_id=? ORDER BY part_no",
                    id
                )
        );
        return s;
    }

    public List<Map<String, Object>> list(String owner) {
        return ws
            .jdbc()
            .queryForList(
                "SELECT id,name,size,state,created_at,expires_at,result_file,result_version FROM upload_session WHERE owner_id=? ORDER BY created_at DESC LIMIT 100",
                owner
            );
    }

    void open(Map<String, Object> s) {
        if (!s.get("state").equals("OPEN")) throw ApiError.conflict(
            "This upload session is closed."
        );
        if (num(s, "expires_at") <= now()) throw new ApiError(
            410,
            "UPLOAD_EXPIRED",
            "This upload has expired. Start a new upload."
        );
    }

    @Transactional(rollbackFor = Exception.class)
    public Map<String, Object> part(
        String owner,
        String id,
        int index,
        String checksum,
        InputStream input
    ) throws IOException {
        ws.lock(owner);
        var s = session(owner, id);
        open(s);
        sha(checksum);
        if (index < 0 || index >= num(s, "part_count")) throw ApiError.bad("Invalid part number.");
        long expected = Math.min(
            num(s, "part_size"),
            num(s, "size") - (long) index * num(s, "part_size")
        );
        // Bounded body read: at most 4 MiB + 1 byte, regardless of Content-Length.
        byte[] bytes = input.readNBytes((int) expected + 1);
        if (bytes.length != expected) throw ApiError.bad(
            "Incorrect part size. Upload this part again."
        );
        if (!hash(bytes).equals(checksum)) throw new ApiError(
            422,
            "PART_CHECKSUM_MISMATCH",
            "Part checksum mismatch. Upload this part again: " + index
        );
        var existing = ws
            .jdbc()
            .queryForList("SELECT * FROM upload_part WHERE session_id=? AND part_no=?", id, index);
        if (
            !existing.isEmpty() && !checksum.equals(existing.get(0).get("sha256"))
        ) throw ApiError.conflict(
            "This part already contains different content. Cancel and start a new upload."
        );
        String key = "parts/" + id + "/" + index + "-" + checksum;
        Path tmp = Files.createTempFile("ft-part-", ".tmp");
        try {
            Files.write(tmp, bytes);
            blobs.put(key, tmp);
        } finally {
            Files.deleteIfExists(tmp);
        }
        if (existing.isEmpty()) ws.jdbc().update(
            "INSERT INTO upload_part VALUES (?,?,?,?,?)",
            id,
            index,
            bytes.length,
            checksum,
            key
        );
        return Map.of("part_no", index, "size", bytes.length, "sha256", checksum);
    }

    @Transactional(rollbackFor = Exception.class)
    public Map<String, Object> complete(String owner, String id) throws IOException {
        ws.lock(owner);
        var s = session(owner, id);
        if (Set.of("PUBLISHED", "CONFLICT").contains(str(s, "state"))) return status(owner, id);
        open(s);
        var parts = ws
            .jdbc()
            .queryForList("SELECT * FROM upload_part WHERE session_id=? ORDER BY part_no", id);
        if (parts.size() != num(s, "part_count")) throw ApiError.conflict(
            "Some parts are missing. Check progress and upload the missing parts."
        );
        Path tmp = Files.createTempFile("ft-assembled-", ".tmp");
        MessageDigest full = digest();
        long total = 0;
        try {
            try (OutputStream output = Files.newOutputStream(tmp)) {
                byte[] buffer = new byte[64 * 1024];
                for (var part : parts) {
                    MessageDigest check = digest();
                    long bytes = 0;
                    try (InputStream input = blobs.open(str(part, "object_key"))) {
                        int n;
                        while ((n = input.read(buffer)) != -1) {
                            output.write(buffer, 0, n);
                            full.update(buffer, 0, n);
                            check.update(buffer, 0, n);
                            bytes += n;
                            total += n;
                        }
                    }
                    if (
                        bytes != num(part, "size") ||
                        !HexFormat.of().formatHex(check.digest()).equals(part.get("sha256"))
                    ) throw ApiError.corruptPart((int) num(part, "part_no"));
                }
            }
            if (
                total != num(s, "size") ||
                !HexFormat.of().formatHex(full.digest()).equals(s.get("sha256"))
            ) throw new ApiError(
                422,
                "FILE_CHECKSUM_MISMATCH",
                "File checksum mismatch. No version was published. Cancel and start a new upload."
            );
            String content = id(),
                objectKey = "contents/" + id;
            blobs.put(objectKey, tmp); // Durable bytes before the database can publish a reference.
            ws.jdbc().update(
                "INSERT INTO content_object VALUES (?,?,?,?,?)",
                content,
                objectKey,
                total,
                s.get("sha256"),
                now()
            );
            String target = str(s, "target_id"),
                parent = ws.availableParent(owner, str(s, "parent_id")),
                name = str(s, "name"),
                conflict = null;
            if (target != null) {
                var file = ws.entry(owner, target);
                if (
                    file.get("trashed_at") != null ||
                    !Objects.equals(s.get("base_version"), file.get("current_version"))
                ) {
                    conflict = target;
                    parent = ws.availableParent(owner, str(file, "parent_id"));
                    target = null;
                } else name = str(file, "name");
            } else {
                var same = ws
                    .jdbc()
                    .queryForList(
                        "SELECT id FROM file_entry WHERE owner_id=? AND parent_key=? AND name_key=?",
                        owner,
                        parent == null ? "root" : parent,
                        name.toLowerCase(Locale.ROOT)
                    );
                if (!same.isEmpty()) conflict = str(same.get(0), "id");
            }
            if (target == null) {
                if (conflict != null) name =
                    name.substring(0, Math.min(name.length(), 200)) +
                    " (conflict " +
                    id.substring(0, 8) +
                    ")";
                target = ws.insertEntry(owner, parent, name, "FILE", conflict);
            }
            String version = ws.insertVersion(target, content, str(s, "source"), null);
            String state = conflict == null ? "PUBLISHED" : "CONFLICT";
            ws.jdbc().update(
                "UPDATE upload_session SET state=?,result_file=?,result_version=? WHERE id=?",
                state,
                target,
                version,
                id
            );
            ws.event(
                owner,
                conflict == null ? "UPLOADED" : "CONFLICT",
                target,
                version,
                name,
                conflict == null
                    ? "Content verified. Version published."
                    : "The base version changed or the name is in use. A separate conflict copy was saved."
            );
            return status(owner, id);
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @Transactional
    public void cancel(String owner, String id) {
        ws.lock(owner);
        var s = session(owner, id);
        if (Set.of("CANCELLED", "EXPIRED").contains(str(s, "state"))) return;
        if (!"OPEN".equals(s.get("state"))) throw ApiError.conflict(
            "This version is already published. Move the file to trash instead."
        );
        ws.jdbc().update("UPDATE upload_session SET state='CANCELLED' WHERE id=?", id);
    }
}
