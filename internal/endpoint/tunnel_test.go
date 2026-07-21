package endpoint

import (
	"context"
	"encoding/base64"
	"fmt"
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
		if got := r.Header.Get("Authorization"); got != "Bearer vault-token" {
			t.Errorf("local request did not receive vault credential: %q", got)
			http.Error(w, "missing local credential", http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/health":
			w.WriteHeader(http.StatusNoContent)
		case "/echo":
			if got := r.Header.Get("X-Exora-Invocation-Id"); got != "inv-tunnel-test" {
				t.Errorf("local request did not receive Cloud invocation identity: %q", got)
			}
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
	store := NewStore(c, "test-account")
	endpointID := "epd_stream_test_1234"
	manifest := endpointTestManifest()
	manifestInterface := manifest["interface"].(map[string]any)
	paths := manifestInterface["paths"].(map[string]any)
	paths["/echo"] = paths["/run"]
	delete(paths, "/run")
	paths["/echo"].(map[string]any)["post"].(map[string]any)["operationId"] = "echo"
	limits := map[string]any{"timeoutSeconds": 5, "maxRequestBytes": 1048576, "maxResponseBytes": 1048576, "maxConcurrency": 2}
	manifest["operationPolicies"] = []any{
		map[string]any{"operationId": "echo", "interaction": "request_response", "sideEffect": false, "idempotent": true, "limits": limits, "meteringCapabilities": []any{"request"}},
		map[string]any{"operationId": "events", "interaction": "server_stream", "sideEffect": false, "idempotent": true, "limits": limits, "meteringCapabilities": []any{"request"}},
	}
	_, err = store.Save(context.Background(), Config{EndpointID: endpointID, LocalBaseURL: local.URL, HealthPath: "/health", ServiceManifest: manifest, TimeoutSeconds: 5, Concurrency: 2, AuthType: "bearer", CredentialRef: "cred-local-test"})
	if err != nil {
		t.Fatal(err)
	}

	result := make(chan error, 1)
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v4/provider/tunnels/connect" || r.Header.Get("Authorization") != "Bearer dock-token" {
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
		if writeErr := conn.WriteJSON(Frame{Version: frameVersion, Type: "request_start", RequestID: "req-echo", EndpointID: endpointID, Method: "POST", Path: "/echo", Headers: map[string][]string{"X-Exora-Invocation-Id": {"inv-tunnel-test"}}, TimeoutSec: 5}); writeErr != nil {
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
	client.CredentialResolver = func(ref string) (string, string, string, error) {
		if ref != "cred-local-test" {
			return "", "", "", &tunnelTestError{"unexpected credential ref: " + ref}
		}
		return "bearer", "", "vault-token", nil
	}
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

func TestTunnelClientStaysOnlineWhenCloudSendsOnlyPingFrames(t *testing.T) {
	const pingPayload = "cloud-heartbeat"
	pongs := make(chan string, 16)
	serverErrors := make(chan error, 1)
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			serverErrors <- err
			return
		}
		defer conn.Close()
		var register Frame
		if err := conn.ReadJSON(&register); err != nil || register.Type != "register" {
			serverErrors <- fmt.Errorf("initial register failed: type=%q err=%w", register.Type, err)
			return
		}
		conn.SetPongHandler(func(data string) error {
			pongs <- data
			return nil
		})
		stop := make(chan struct{})
		defer close(stop)
		go func() {
			ticker := time.NewTicker(20 * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					if err := conn.WriteControl(websocket.PingMessage, []byte(pingPayload), time.Now().Add(time.Second)); err != nil {
						return
					}
				case <-stop:
					return
				}
			}
		}()
		for {
			var frame Frame
			if err := conn.ReadJSON(&frame); err != nil {
				return
			}
		}
	}))
	defer cloud.Close()

	storage, err := cache.New(8, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer storage.Close()
	tokenPath := filepath.Join(t.TempDir(), "cloud-token.json")
	if err := cloudlink.SaveToken(tokenPath, cloudlink.TokenFile{DockID: "dock", CloudURL: cloud.URL, CloudToken: "dock-token"}); err != nil {
		t.Fatal(err)
	}
	client := NewTunnelClient(cloud.URL, tokenPath, NewStore(storage, "test-account"))
	client.readTimeout = 55 * time.Millisecond
	client.healthInterval = time.Hour
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() { result <- client.runConnection(ctx) }()

	deadline := time.After(220 * time.Millisecond)
	pongCount := 0
	for pongCount < 6 {
		select {
		case payload := <-pongs:
			if payload != pingPayload {
				t.Fatalf("pong payload=%q want=%q", payload, pingPayload)
			}
			pongCount++
		case err := <-result:
			t.Fatalf("tunnel disconnected while Cloud pings were active: %v", err)
		case err := <-serverErrors:
			t.Fatal(err)
		case <-deadline:
			t.Fatalf("received %d Pong frames before deadline", pongCount)
		}
	}
	cancel()
	select {
	case <-result:
	case <-time.After(time.Second):
		t.Fatal("tunnel did not stop after context cancellation")
	}
}

func TestTunnelChunkLimit(t *testing.T) {
	max := base64.StdEncoding.EncodeToString(make([]byte, 64<<10))
	if _, err := decodeChunk(max); err != nil {
		t.Fatalf("64 KiB stream frame rejected: %v", err)
	}
	over := base64.StdEncoding.EncodeToString(make([]byte, (64<<10)+1))
	if _, err := decodeChunk(over); err == nil {
		t.Fatal("oversized stream frame was accepted")
	}
}
