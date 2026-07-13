//go:build windows

package providerworker

import (
	"context"
	"net"

	"github.com/Microsoft/go-winio"
)

const defaultWorkerEndpoint = `\\.\pipe\exora-wsl-broker`

func dialWorker(ctx context.Context, endpoint string) (net.Conn, error) {
	return winio.DialPipeContext(ctx, endpoint)
}
