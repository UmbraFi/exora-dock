FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /umbra-svr ./cmd/umbra-svr/

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=build /umbra-svr /usr/local/bin/umbra-svr
COPY config.example.yaml /etc/umbra-svr/config.yaml
EXPOSE 8080
ENTRYPOINT ["umbra-svr", "/etc/umbra-svr/config.yaml"]
