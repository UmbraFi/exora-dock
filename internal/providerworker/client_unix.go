//go:build !windows

package providerworker

import (
	"context"
	"net"
)

const defaultWorkerEndpoint = "/run/exora/worker.sock"

func dialWorker(ctx context.Context, endpoint string) (net.Conn, error) {
	d := net.Dialer{}
	return d.DialContext(ctx, "unix", endpoint)
}
