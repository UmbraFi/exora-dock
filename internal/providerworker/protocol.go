package providerworker

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"time"
)

const DefaultSocket = "/run/exora/worker.sock"

type Request struct {
	ID      string         `json:"id"`
	Command string         `json:"command"`
	Input   map[string]any `json:"input,omitempty"`
}
type Response struct {
	ID     string         `json:"id"`
	OK     bool           `json:"ok"`
	Result map[string]any `json:"result,omitempty"`
	Error  string         `json:"error,omitempty"`
}

type Client struct{ Socket string }

func (c Client) Call(ctx context.Context, command string, input map[string]any) (map[string]any, error) {
	socket := c.Socket
	if socket == "" {
		socket = DefaultSocket
	}
	d := net.Dialer{}
	conn, err := d.DialContext(ctx, "unix", socket)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(2 * time.Minute))
	id := fmt.Sprintf("cmd-%d", time.Now().UnixNano())
	if err := json.NewEncoder(conn).Encode(Request{ID: id, Command: command, Input: input}); err != nil {
		return nil, err
	}
	var out Response
	if err := json.NewDecoder(bufio.NewReader(conn)).Decode(&out); err != nil {
		return nil, err
	}
	if !out.OK {
		return nil, fmt.Errorf("%s", out.Error)
	}
	return out.Result, nil
}

type Runner interface {
	Run(context.Context, string, ...string) (string, error)
}

var AllowedCommands = map[string]bool{
	"probe_host": true, "list_domains": true, "import_template": true, "validate_template": true,
	"reserve_disk": true, "capacity_check": true, "create_test_clone": true, "reset_test_clone": true, "delete_template": true,
}
