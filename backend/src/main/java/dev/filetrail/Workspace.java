package dev.filetrail;

import static dev.filetrail.Util.*;

import java.time.Duration;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class Workspace {

    private final JdbcTemplate db;

    Workspace(JdbcTemplate db) {
        this.db = db;
    }

    public JdbcTemplate jdbc() {
        return db;
    }

    void lock(String owner) {
        db.queryForObject("SELECT id FROM app_user WHERE id=? FOR UPDATE", String.class, owner);
    }

    Map<String, Object> entry(String owner, String id) {
        var rows = db.queryForList(
            "SELECT f.*,COALESCE(c.size,0) AS size,v.version_no,c.sha256 FROM file_entry f LEFT JOIN file_version v ON f.current_version=v.id LEFT JOIN content_object c ON c.id=v.content_id WHERE f.id=? AND f.owner_id=?",
            id,
            owner
        );
        if (rows.isEmpty()) throw ApiError.missing();
        return rows.get(0);
    }

    void parent(String owner, String id) {
        if (id == null) return;
        var f = entry(owner, id);
        if (!"FOLDER".equals(f.get("kind")) || f.get("trashed_at") != null) throw ApiError.bad(
            "The destination folder is unavailable."
        );
    }

    String availableParent(String owner, String id) {
        if (id == null) return null;
        try {
            parent(owner, id);
            return id;
        } catch (ApiError e) {
            return null;
        }
    }

    void active(Map<String, Object> row) {
        if (row.get("trashed_at") != null) throw ApiError.conflict("This item is in the trash.");
    }

    void event(
        String owner,
        String action,
        String file,
        String version,
        String name,
        String detail
    ) {
        db.update(
            "INSERT INTO activity_event VALUES (?,?,?,?,?,?,?,?)",
            id(),
            owner,
            action,
            file,
            version,
            name,
            detail,
            now()
        );
        db.update(
            "INSERT INTO change_event(owner_id,file_id,version_id,action,created_at) VALUES (?,?,?,?,?)",
            owner,
            file,
            version,
            action,
            now()
        );
    }

    String insertEntry(String owner, String parent, String name, String kind, String conflict) {
        String id = id();
        long time = now();
        db.update(
            "INSERT INTO file_entry(id,owner_id,parent_id,parent_key,name,name_key,kind,conflict_of,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            id,
            owner,
            parent,
            parent == null ? "root" : parent,
            name,
            name.toLowerCase(Locale.ROOT),
            kind,
            conflict,
            time,
            time
        );
        return id;
    }

    String insertVersion(String file, String content, String source, String restored) {
        Integer number = db.queryForObject(
            "SELECT COALESCE(MAX(version_no),0)+1 FROM file_version WHERE file_id=?",
            Integer.class,
            file
        );
        String id = id();
        db.update(
            "INSERT INTO file_version VALUES (?,?,?,?,?,?,?)",
            id,
            file,
            content,
            number,
            source,
            restored,
            now()
        );
        db.update(
            "UPDATE file_entry SET current_version=?,updated_at=? WHERE id=?",
            id,
            now(),
            file
        );
        return id;
    }

    public List<Map<String, Object>> files(String owner, String parent, String view) {
        if (!Set.of("files", "recent", "trash", "conflicts").contains(view)) throw ApiError.bad(
            "Unknown view."
        );
        String sql =
            "SELECT f.*,COALESCE(c.size,0) AS size,v.version_no,c.sha256 FROM file_entry f LEFT JOIN file_version v ON v.id=f.current_version LEFT JOIN content_object c ON c.id=v.content_id WHERE f.owner_id=?";
        List<Object> args = new ArrayList<>();
        args.add(owner);
        if (view.equals("trash")) sql += " AND f.trashed_at IS NOT NULL";
        else {
            sql += " AND f.trashed_at IS NULL";
            if (view.equals("files")) {
                if (parent == null) sql += " AND f.parent_id IS NULL";
                else {
                    parent(owner, parent);
                    sql += " AND f.parent_id=?";
                    args.add(parent);
                }
            }
            if (view.equals("conflicts")) sql += " AND f.conflict_of IS NOT NULL";
            if (view.equals("recent")) sql += " AND f.kind='FILE'";
        }
        return db.queryForList(sql + " ORDER BY f.updated_at DESC", args.toArray());
    }

    public List<Map<String, Object>> folders(String owner) {
        return db.queryForList(
            "SELECT id,name,parent_id FROM file_entry WHERE owner_id=? AND kind='FOLDER' AND trashed_at IS NULL ORDER BY name",
            owner
        );
    }

    public Map<String, Object> stats(String owner) {
        var result = new HashMap<String, Object>();
        result.put(
            "files",
            db.queryForObject(
                "SELECT COUNT(*) FROM file_entry WHERE owner_id=? AND kind='FILE' AND trashed_at IS NULL",
                Long.class,
                owner
            )
        );
        result.put(
            "bytes",
            db.queryForObject(
                "SELECT COALESCE(SUM(c.size),0) FROM file_entry f JOIN file_version v ON v.id=f.current_version JOIN content_object c ON c.id=v.content_id WHERE f.owner_id=? AND f.trashed_at IS NULL",
                Long.class,
                owner
            )
        );
        result.put(
            "versions",
            db.queryForObject(
                "SELECT COUNT(*) FROM file_version v JOIN file_entry f ON f.id=v.file_id WHERE f.owner_id=?",
                Long.class,
                owner
            )
        );
        result.put(
            "conflicts",
            db.queryForObject(
                "SELECT COUNT(*) FROM file_entry WHERE owner_id=? AND conflict_of IS NOT NULL AND trashed_at IS NULL",
                Long.class,
                owner
            )
        );
        return result;
    }

    @Transactional
    public Map<String, Object> mkdir(String owner, String parent, String name) {
        lock(owner);
        parent(owner, parent);
        name = name(name);
        String file = insertEntry(owner, parent, name, "FOLDER", null);
        event(owner, "FOLDER_CREATED", file, null, name, "Created folder.");
        return entry(owner, file);
    }

    @Transactional
    public Map<String, Object> move(String owner, String id, String name, String parent) {
        lock(owner);
        var file = entry(owner, id);
        active(file);
        name = name(name);
        parent(owner, parent);
        String cursor = parent;
        while (cursor != null) {
            if (cursor.equals(id)) throw ApiError.bad(
                "A folder cannot be moved into itself or one of its subfolders."
            );
            cursor = str(entry(owner, cursor), "parent_id");
        }
        db.update(
            "UPDATE file_entry SET name=?,name_key=?,parent_id=?,parent_key=?,updated_at=? WHERE id=?",
            name,
            name.toLowerCase(Locale.ROOT),
            parent,
            parent == null ? "root" : parent,
            now(),
            id
        );
        event(
            owner,
            "MOVED",
            id,
            str(file, "current_version"),
            name,
            "Renamed or moved. File identity and version history are preserved."
        );
        return entry(owner, id);
    }

    @Transactional
    public void trash(String owner, String id) {
        lock(owner);
        var file = entry(owner, id);
        if (file.get("trashed_at") != null) return;
        if (
            db.queryForObject(
                "SELECT COUNT(*) FROM file_entry WHERE parent_id=? AND trashed_at IS NULL",
                Long.class,
                id
            ) > 0
        ) throw ApiError.conflict("Move or delete the contents of this folder first.");
        db.update(
            "UPDATE file_entry SET trashed_at=?,name_key=NULL,updated_at=? WHERE id=?",
            now(),
            now(),
            id
        );
        event(
            owner,
            "TRASHED",
            id,
            str(file, "current_version"),
            str(file, "name"),
            "Moved to trash. File contents and history are retained."
        );
    }

    @Transactional
    public Map<String, Object> untrash(String owner, String id) {
        lock(owner);
        var file = entry(owner, id);
        if (file.get("trashed_at") == null) return file;
        String parent = availableParent(owner, str(file, "parent_id"));
        db.update(
            "UPDATE file_entry SET trashed_at=NULL,name_key=?,parent_id=?,parent_key=?,updated_at=? WHERE id=?",
            str(file, "name").toLowerCase(Locale.ROOT),
            parent,
            parent == null ? "root" : parent,
            now(),
            id
        );
        event(
            owner,
            "UNTRASHED",
            id,
            str(file, "current_version"),
            str(file, "name"),
            "Restored from trash."
        );
        return entry(owner, id);
    }

    public List<Map<String, Object>> versions(String owner, String file) {
        entry(owner, file);
        return db.queryForList(
            "SELECT v.*,c.size,c.sha256 FROM file_version v JOIN content_object c ON c.id=v.content_id WHERE v.file_id=? ORDER BY v.version_no DESC",
            file
        );
    }

    public Map<String, Object> version(String owner, String file, String version) {
        entry(owner, file);
        var rows = db.queryForList(
            "SELECT v.*,c.object_key,c.sha256,c.size FROM file_version v JOIN content_object c ON c.id=v.content_id WHERE v.file_id=? AND v.id=?",
            file,
            version
        );
        if (rows.isEmpty()) throw ApiError.missing();
        return rows.get(0);
    }

    @Transactional
    public Map<String, Object> restore(
        String owner,
        String file,
        String version,
        String base,
        String key
    ) {
        lock(owner);
        key = required(key, 100);
        String hash = hash(file + "|" + version + "|" + base);
        var prior = db.queryForList(
            "SELECT * FROM operation_result WHERE owner_id=? AND request_key=?",
            owner,
            key
        );
        if (!prior.isEmpty()) {
            if (!hash.equals(prior.get(0).get("request_hash"))) throw ApiError.conflict(
                "This request key was used for a different operation."
            );
            return version(owner, file, str(prior.get(0), "version_id"));
        }
        var f = entry(owner, file);
        active(f);
        if (!Objects.equals(base, f.get("current_version"))) throw ApiError.conflict(
            "The current version has changed. Refresh before restoring."
        );
        var old = version(owner, file, version);
        String next = insertVersion(file, str(old, "content_id"), "Web · Restore", version);
        db.update("INSERT INTO operation_result VALUES (?,?,?,?)", owner, key, hash, next);
        event(
            owner,
            "RESTORED",
            file,
            next,
            str(f, "name"),
            "Created a new version from a historical version."
        );
        return version(owner, file, next);
    }

    @Transactional
    public void resolve(String owner, String id) {
        lock(owner);
        var f = entry(owner, id);
        active(f);
        if (f.get("conflict_of") == null) return;
        db.update("UPDATE file_entry SET conflict_of=NULL,updated_at=? WHERE id=?", now(), id);
        event(
            owner,
            "CONFLICT_RESOLVED",
            id,
            str(f, "current_version"),
            str(f, "name"),
            "Kept both files and marked the conflict as resolved."
        );
    }

    @Transactional
    public Map<String, Object> share(String owner, String file, String version, int days) {
        lock(owner);
        var f = entry(owner, file);
        active(f);
        version(owner, file, version);
        if (days < 1 || days > 30) throw ApiError.bad(
            "Choose an expiration between 1 and 30 days."
        );
        String token = token(),
            id = id();
        db.update(
            "INSERT INTO share_link(id,owner_id,version_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?)",
            id,
            owner,
            version,
            hash(token),
            now() + Duration.ofDays(days).toMillis(),
            now()
        );
        event(
            owner,
            "SHARED",
            file,
            version,
            str(f, "name"),
            "Created a read-only version link. Expires in " + days + " days."
        );
        return Map.of("id", id, "token", token, "path", "/s/" + token);
    }

    public List<Map<String, Object>> shares(String owner) {
        return db.queryForList(
            "SELECT s.id,s.version_id,s.expires_at,s.revoked_at,s.created_at,f.id AS file_id,f.name,v.version_no FROM share_link s JOIN file_version v ON v.id=s.version_id JOIN file_entry f ON f.id=v.file_id WHERE s.owner_id=? ORDER BY s.created_at DESC",
            owner
        );
    }

    @Transactional
    public void revoke(String owner, String id) {
        lock(owner);
        var rows = db.queryForList(
            "SELECT s.*,f.name,f.id AS file_id FROM share_link s JOIN file_version v ON v.id=s.version_id JOIN file_entry f ON f.id=v.file_id WHERE s.id=? AND s.owner_id=?",
            id,
            owner
        );
        if (rows.isEmpty()) throw ApiError.missing();
        var s = rows.get(0);
        if (s.get("revoked_at") != null) return;
        db.update("UPDATE share_link SET revoked_at=? WHERE id=?", now(), id);
        event(
            owner,
            "SHARE_REVOKED",
            str(s, "file_id"),
            str(s, "version_id"),
            str(s, "name"),
            "New access is blocked. Downloads already in progress cannot be recalled."
        );
    }

    public Map<String, Object> publicShare(String token) {
        if (token == null || token.length() != 43) throw ApiError.missing();
        var rows = db.queryForList(
            "SELECT f.name,v.version_no,c.size,c.sha256,c.object_key,s.expires_at FROM share_link s JOIN file_version v ON v.id=s.version_id JOIN file_entry f ON f.id=v.file_id JOIN content_object c ON c.id=v.content_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?",
            hash(token),
            now()
        );
        if (rows.isEmpty()) throw new ApiError(
            410,
            "SHARE_UNAVAILABLE",
            "This link has expired, was revoked, or does not exist."
        );
        return rows.get(0);
    }

    public List<Map<String, Object>> activity(String owner) {
        return db.queryForList(
            "SELECT * FROM activity_event WHERE owner_id=? ORDER BY created_at DESC LIMIT 200",
            owner
        );
    }
}
