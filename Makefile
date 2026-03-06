.PHONY: build run clean

build:
	go build -o umbra-svr ./cmd/umbra-svr/

run: build
	./umbra-svr config.example.yaml

clean:
	rm -f umbra-svr
	rm -rf data/

docker:
	docker build -t umbra-svr .
