//go:build !linux

package providerworker

import (
	"context"
	"fmt"
)

type Server struct {
	Socket, DataDir string
	Runner          Runner
}

func (Server) Serve(context.Context) error {
	return fmt.Errorf("unsupported_host: Exora Provider Worker requires Linux KVM/libvirt")
}
