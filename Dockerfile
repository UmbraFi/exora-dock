FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /exora-dock ./cmd/exora-dock/

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=build /exora-dock /usr/local/bin/exora-dock
COPY config.example.yaml /etc/exora-dock/config.yaml
ENV EXORA_MODE=hybrid \
    EXORA_LISTEN_ADDR=:8080 \
    EXORA_DATA_DIR=/var/lib/exora-dock
EXPOSE 8080
VOLUME ["/var/lib/exora-dock"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
ENTRYPOINT ["exora-dock", "/etc/exora-dock/config.yaml"]
