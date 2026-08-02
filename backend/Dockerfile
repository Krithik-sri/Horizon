# Build context is backend/, not the repo root — this server is a self-contained module
# and has no reason to see mobile/ or docs/.

FROM golang:1.26-alpine AS build
WORKDIR /src

# Dependency layer first, so editing Go source doesn't re-download the module cache.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO_ENABLED=0 produces a fully static binary, which is what lets the final stage be
# distroless/static — nothing to link against at runtime. Note this also means the
# race detector is unavailable in this image; race testing happens in CI/dev, not here.
# -trimpath keeps build-machine paths out of the binary.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /server .

# distroless/static: no shell, no package manager, no libc — a smaller attack surface
# than alpine for a static binary that needs none of it. `nonroot` runs as uid 65532.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /server /server

# Documentation only; Koyeb injects PORT and the server reads it (defaulting to 8080).
EXPOSE 8080

USER nonroot:nonroot
ENTRYPOINT ["/server"]
