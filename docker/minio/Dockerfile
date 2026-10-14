# Local S3 compatibility services, built from official, pinned source commits.
# Upstream MinIO / mc images are no longer anonymously pullable.
# Both projects are AGPL-3.0: source and license links are recorded below.
FROM golang:1.25-bookworm AS server-build
# minio/minio RELEASE.2025-09-07T16-13-09Z
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go install github.com/minio/minio@01ce918d8279a20e4706b96a64396146894adee4

FROM golang:1.25-bookworm AS client-build
# minio/mc RELEASE.2025-04-16T18-13-26Z
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go install github.com/minio/mc@1e78af443bf0443eb177f26421fe081f08d83dc5

FROM alpine:3.22 AS runtime
RUN apk add --no-cache ca-certificates curl

FROM runtime AS server
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
    org.opencontainers.image.revision="01ce918d8279a20e4706b96a64396146894adee4" \
    org.opencontainers.image.licenses="AGPL-3.0"
COPY --from=server-build /go/bin/minio /usr/bin/minio
EXPOSE 9000 9001
ENTRYPOINT ["minio"]

FROM runtime AS client
LABEL org.opencontainers.image.source="https://github.com/minio/mc" \
    org.opencontainers.image.revision="1e78af443bf0443eb177f26421fe081f08d83dc5" \
    org.opencontainers.image.licenses="AGPL-3.0"
COPY --from=client-build /go/bin/mc /usr/bin/mc
ENTRYPOINT ["mc"]
