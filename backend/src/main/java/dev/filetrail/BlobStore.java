package dev.filetrail;

import java.io.*;
import java.net.URI;
import java.nio.file.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.*;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;

@Component
class BlobStore {

    private final Path root;
    private final S3Client s3;
    private final String bucket;

    BlobStore(
        @Value("${filetrail.storage}") String mode,
        @Value("${filetrail.data-dir}") String dir,
        @Value("${filetrail.s3.endpoint}") String endpoint,
        @Value("${filetrail.s3.region}") String region,
        @Value("${filetrail.s3.bucket}") String bucket,
        @Value("${filetrail.s3.access-key}") String key,
        @Value("${filetrail.s3.secret-key}") String secret
    ) throws IOException {
        root = Path.of(dir).toAbsolutePath().normalize();
        Files.createDirectories(root);
        this.bucket = bucket;
        s3 = mode.equals("s3")
            ? S3Client.builder()
                  .endpointOverride(URI.create(endpoint))
                  .region(Region.of(region))
                  .forcePathStyle(true)
                  .credentialsProvider(
                      StaticCredentialsProvider.create(AwsBasicCredentials.create(key, secret))
                  )
                  .build()
            : null;
        if (!Set.of("local", "s3").contains(mode)) throw new IllegalArgumentException(
            "Unsupported storage mode"
        );
    }

    void put(String key, Path source) throws IOException {
        if (s3 != null) {
            s3.putObject(
                PutObjectRequest.builder().bucket(bucket).key(key).build(),
                RequestBody.fromFile(source)
            );
            return;
        }
        Path target = path(key);
        Files.createDirectories(target.getParent());
        Path tmp = Files.createTempFile(target.getParent(), ".writing-", ".tmp");
        try {
            Files.copy(source, tmp, StandardCopyOption.REPLACE_EXISTING);
            try (var channel = java.nio.channels.FileChannel.open(tmp, StandardOpenOption.WRITE)) {
                channel.force(true);
            }
            Files.move(
                tmp,
                target,
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING
            );
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    InputStream open(String key) throws IOException {
        return s3 != null
            ? s3.getObject(GetObjectRequest.builder().bucket(bucket).key(key).build())
            : Files.newInputStream(path(key));
    }

    void delete(String key) throws IOException {
        if (s3 != null) s3.deleteObject(
            DeleteObjectRequest.builder().bucket(bucket).key(key).build()
        );
        else Files.deleteIfExists(path(key));
    }

    record Blob(String key, long modifiedAt) {}

    List<Blob> list() throws IOException {
        List<Blob> result = new ArrayList<>();
        if (s3 != null) {
            for (var page : s3.listObjectsV2Paginator(
                ListObjectsV2Request.builder().bucket(bucket).build()
            ))
                for (var obj : page.contents())
                    result.add(new Blob(obj.key(), obj.lastModified().toEpochMilli()));
        } else try (var paths = Files.walk(root)) {
            for (Path p : paths.filter(Files::isRegularFile).toList())
                result.add(
                    new Blob(root.relativize(p).toString(), Files.getLastModifiedTime(p).toMillis())
                );
        }
        return result;
    }

    private Path path(String key) {
        Path path = root.resolve(key).normalize();
        if (!path.startsWith(root)) throw new IllegalArgumentException("Invalid object key");
        return path;
    }
}
