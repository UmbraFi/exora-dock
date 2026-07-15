package main

import (
	"context"
	"flag"
	"github.com/exora-dock/exora-dock/internal/providerworker"
	"log"
	"os/signal"
	"syscall"
)

func main() {
	socket := flag.String("socket", providerworker.DefaultSocket, "Unix socket")
	data := flag.String("data-dir", "", "managed data directory (defaults to the platform-specific secure location)")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := (providerworker.Server{Socket: *socket, DataDir: *data}).Serve(ctx); err != nil {
		log.Fatal(err)
	}
}
