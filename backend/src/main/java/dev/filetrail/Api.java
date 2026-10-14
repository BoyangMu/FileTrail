package dev.filetrail;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.http.ContentDisposition;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
class Api {

    private final Workspace ws;
    private final Uploads uploads;
    private final BlobStore blobs;

    Api(Workspace ws, Uploads uploads, BlobStore blobs) {
        this.ws = ws;
        this.uploads = uploads;
        this.blobs = blobs;
    }

    String owner(HttpServletRequest req) {
        return (String) req.getAttribute("userId");
    }

    record Folder(String name, String parentId) {}

    record Move(String name, String parentId) {}

    record Restore(String versionId, String baseVersion, String requestKey) {}

    record Share(String versionId, int days) {}

    @GetMapping("/stats")
    Object stats(HttpServletRequest r) {
        return ws.stats(owner(r));
    }

    @GetMapping("/files")
    Object files(
        HttpServletRequest r,
        @RequestParam(required = false) String parent,
        @RequestParam(defaultValue = "files") String view
    ) {
        return ws.files(owner(r), parent, view);
    }

    @GetMapping("/folders")
    Object folders(HttpServletRequest r) {
        return ws.folders(owner(r));
    }

    @PostMapping("/folders")
    Object folder(HttpServletRequest r, @RequestBody Folder b) {
        return ws.mkdir(owner(r), b.parentId(), b.name());
    }

    @GetMapping("/files/{id}")
    Object file(HttpServletRequest r, @PathVariable String id) {
        return ws.entry(owner(r), id);
    }

    @PatchMapping("/files/{id}")
    Object move(HttpServletRequest r, @PathVariable String id, @RequestBody Move b) {
        return ws.move(owner(r), id, b.name(), b.parentId());
    }

    @DeleteMapping("/files/{id}")
    void trash(HttpServletRequest r, @PathVariable String id) {
        ws.trash(owner(r), id);
    }

    @PostMapping("/files/{id}/untrash")
    Object untrash(HttpServletRequest r, @PathVariable String id) {
        return ws.untrash(owner(r), id);
    }

    @GetMapping("/files/{id}/versions")
    Object versions(HttpServletRequest r, @PathVariable String id) {
        return ws.versions(owner(r), id);
    }

    @PostMapping("/files/{id}/restore")
    Object restore(HttpServletRequest r, @PathVariable String id, @RequestBody Restore b) {
        return ws.restore(owner(r), id, b.versionId(), b.baseVersion(), b.requestKey());
    }

    @PostMapping("/files/{id}/resolve")
    void resolve(HttpServletRequest r, @PathVariable String id) {
        ws.resolve(owner(r), id);
    }

    @GetMapping("/files/{id}/versions/{version}/download")
    void download(
        HttpServletRequest r,
        HttpServletResponse response,
        @PathVariable String id,
        @PathVariable String version
    ) throws IOException {
        var file = ws.entry(owner(r), id);
        var v = ws.version(owner(r), id, version);
        stream(response, v, Util.str(file, "name"));
    }

    @PostMapping("/uploads")
    Object begin(HttpServletRequest r, @RequestBody Uploads.Start b) throws IOException {
        return uploads.begin(owner(r), b);
    }

    @GetMapping("/uploads")
    Object uploads(HttpServletRequest r) {
        return uploads.list(owner(r));
    }

    @GetMapping("/uploads/{id}")
    Object upload(HttpServletRequest r, @PathVariable String id) {
        return uploads.status(owner(r), id);
    }

    @PutMapping(value = "/uploads/{id}/parts/{part}", consumes = "application/octet-stream")
    Object part(
        HttpServletRequest r,
        @PathVariable String id,
        @PathVariable int part,
        @RequestHeader("X-Content-SHA256") String sha
    ) throws IOException {
        return uploads.part(owner(r), id, part, sha, r.getInputStream());
    }

    @PostMapping("/uploads/{id}/complete")
    Object complete(HttpServletRequest r, @PathVariable String id) throws IOException {
        return uploads.complete(owner(r), id);
    }

    @DeleteMapping("/uploads/{id}")
    void cancel(HttpServletRequest r, @PathVariable String id) {
        uploads.cancel(owner(r), id);
    }

    @PostMapping("/files/{id}/shares")
    Object share(HttpServletRequest r, @PathVariable String id, @RequestBody Share b) {
        return ws.share(owner(r), id, b.versionId(), b.days());
    }

    @GetMapping("/shares")
    Object shares(HttpServletRequest r) {
        return ws.shares(owner(r));
    }

    @DeleteMapping("/shares/{id}")
    void revoke(HttpServletRequest r, @PathVariable String id) {
        ws.revoke(owner(r), id);
    }

    @GetMapping("/activity")
    Object activity(HttpServletRequest r) {
        return ws.activity(owner(r));
    }

    @GetMapping("/public/shares/{token}")
    Object shared(@PathVariable String token) {
        var share = ws.publicShare(token);
        share.remove("object_key");
        return share;
    }

    @GetMapping("/public/shares/{token}/download")
    void sharedDownload(HttpServletResponse r, @PathVariable String token) throws IOException {
        var share = ws.publicShare(token);
        stream(r, share, Util.str(share, "name"));
    }

    private void stream(HttpServletResponse response, Map<String, Object> content, String name)
        throws IOException {
        // No redirects/presigned URLs: every new request revalidates authorization.
        try (InputStream input = blobs.open(Util.str(content, "object_key"))) {
            response.setContentType("application/octet-stream");
            response.setContentLengthLong(Util.num(content, "size"));
            response.setHeader(
                "Content-Disposition",
                ContentDisposition.attachment()
                    .filename(name, StandardCharsets.UTF_8)
                    .build()
                    .toString()
            );
            response.setHeader("X-Content-SHA256", Util.str(content, "sha256"));
            input.transferTo(response.getOutputStream());
        }
    }
}
