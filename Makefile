.PHONY: build run clean docker deb

build:
	go build -o exora-dock ./cmd/exora-dock/

run: build
	./exora-dock config.example.yaml

clean:
	rm -f exora-dock
	rm -rf data/

docker:
	docker build -t exora-dock .

deb:
	mkdir -p dist
	VERSION=$${VERSION:-0.1.0} GOARCH=$${GOARCH:-amd64} nfpm package --config packaging/deb/nfpm.yaml --packager deb --target dist/
