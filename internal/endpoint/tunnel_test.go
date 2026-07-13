package endpoint

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/cloudlink"
	"github.com/gorilla/websocket"
)

func TestTunnelClientForwardsBodyAndStreamsSSE(t *testing.T) {
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/health":
			w.WriteHeader(http.StatusNoContent)
		case "/echo":
			raw, _ := io.ReadAll(r.Body)
			w.Header().Set("X-Upstream", "echo")
			_, _ = w.Write(append([]byte("echo:"), raw...))
		case "/events":
			w.Header().Set("Content-Type", "text/event-stream")
			flusher, _ := w.(http.Flusher)
			_, _ = w.Write([]byte("data: one\n\n"))
			flusher.Flush()
			time.Sleep(30 * time.Millisecond)
			_, _ = w.Write([]byte("data: two\n\n"))
			flusher.Flush()
		default:
			http.NotFound(w, r)
		}
	}))
	defer local.Close()

	c, err := cache.New(32, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	store := NewStore(c)
	endpointID := "epd_stream_test_1234"
	_, err = store.Save(context.Background(), Config{EndpointID: endpointID, LocalBaseURL: local.URL, HealthPath: "/health", Routes: []Route{{OperationID: "echo", Method: "POST", Path: "/echo"}, {OperationID: "events", Method: "GET", Path: "/events"}}, TimeoutSeconds: 5, Concurrency: 2})
	if err != nil {
		t.Fatal(err)
	}

	result := make(chan error, 1)
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v3/provider/tunnels/connect" || r.Header.Get("Authorization") != "Bearer dock-token" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		conn, upgradeErr := upgrader.Upgrade(w, r, nil)
		if upgradeErr != nil {
			result <- upgradeErr
			return
		}
		defer conn.Close()
		var register Frame
		if readErr := conn.ReadJSON(&register); readErr != nil || register.Type != "register" || len(register.Endpoints) != 1 {
			result <- readErr
			return
		}
		if writeErr := conn.WriteJSON(Frame{Version: frameVersion, Type: "request_start", RequestID: "req-echo", EndpointID: endpointID, Method: "POST", Path: "/echo", TimeoutSec: 5}); writeErr != nil {
			result <- writeErr
			return
		}
		_ = conn.WriteJSON(Frame{Version: frameVersion, Type: "request_chunk", RequestID: "req-echo", EndpointID: endpointID, DataBase64: base64.StdEncoding.EncodeToString([]byte("hello"))})
		_ = conn.WriteJSON(Frame{Version: frameVersion, Type: "request_end", RequestID: "req-echo", EndpointID: endpointID})
		echo := strings.Builder{}
		for {
			var frame Frame
			if readErr := conn.ReadJSON(&frame); readErr != nil {
				result <- readErr
				return
			}
			if frame.Type == "response_chunk" && frame.RequestID == "req-echo" {
				raw, _ := base64.StdEncoding.DecodeString(frame.DataBase64)
				echo.Write(raw)
			}
			if frame.Type == "response_end" && frame.RequestID == "req-echo" {
				break
			}
		}
		if echo.String() != "echo:hello" {
			result <- &tunnelTestError{"unexpected echo response: " + echo.String()}
			return
		}

		_ = conn.WriteJSON(Frame{Version: frameVersion, Type: "request_start", RequestID: "req-sse", EndpointID: endpointID, Method: "GET", Path: "/events", TimeoutSec: 5})
		_ = conn.WriteJSON(Frame{Version: frameVersion, Type: "request_end", RequestID: "req-sse", EndpointID: endpointID})
		chunks := 0
		stream := strings.Builder{}
		for {
			var frame Frame
			if readErr := conn.ReadJSON(&frame); readErr != nil {
				result <- readErr
				return
			}
			if frame.Type == "response_chunk" && frame.RequestID == "req-sse" {
				chunks++
				raw, _ := base64.StdEncoding.DecodeString(frame.DataBase64)
				stream.Write(raw)
			}
			if frame.Type == "response_end" && frame.RequestID == "req-sse" {
				break
			}
		}
		if chunks < 2 || stream.String() != "data: one\n\ndata: two\n\n" {
			result <- &tunnelTestError{"SSE response was not streamed in chunks: " + stream.String()}
			return
		}
		result <- nil
	}))
	defer cloud.Close()

	tokenPath := filepath.Join(t.TempDir(), "cloud-token.json")
	if err := cloudlink.SaveToken(tokenPath, cloudlink.TokenFile{DockID: "dock", CloudURL: cloud.URL, CloudToken: "dock-token"}); err != nil {
		t.Fatal(err)
	}
	client := NewTunnelClient(cloud.URL, tokenPath, store)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	go func() { _ = client.runConnection(ctx) }()
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("tunnel forwarding test timed out")
	}
}

type tunnelTestError struct{ message string }

func (e *tunnelTestError) Error() string { return e.message }
