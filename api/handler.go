package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/cloudlink"
	"github.com/exora-dock/exora-dock/internal/discovery"
	"github.com/exora-dock/exora-dock/internal/endpoint"
	"github.com/exora-dock/exora-dock/internal/localauth"
	"github.com/exora-dock/exora-dock/internal/sellerdraft"
)

type Options struct {
	Discovery           *discovery.Manifest
	CloudURL            string
	CloudTokenPath      string
	ActiveAccountID     string
	EnforceAccountScope bool
	Endpoints           *endpoint.Store
	EndpointTunnel      *endpoint.TunnelClient
	SellerDrafts        *sellerdraft.Service
	LocalAuth           *localauth.Store
}

type Handler struct {
	discovery           *discovery.Manifest
	cloudURL            string
	cloudTokenPath      string
	activeAccountID     string
	enforceAccountScope bool
	endpoints           *endpoint.Store
	endpointTunnel      *endpoint.TunnelClient
	sellerDrafts        *sellerdraft.Service
	localAuth           *localauth.Store
	startTime           time.Time
}

func NewHandler(opts Options) *Handler {
	return &Handler{discovery: opts.Discovery, cloudURL: opts.CloudURL, cloudTokenPath: opts.CloudTokenPath, activeAccountID: strings.TrimSpace(opts.ActiveAccountID), enforceAccountScope: opts.EnforceAccountScope, endpoints: opts.Endpoints, endpointTunnel: opts.EndpointTunnel, sellerDrafts: opts.SellerDrafts, localAuth: opts.LocalAuth, startTime: time.Now().UTC()}
}

func (h *Handler) Health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "exora-dock", "protocolVersion": 4, "uptimeSeconds": int64(time.Since(h.startTime).Seconds()), "applicationSources": []string{"api"}, "deliveryModes": []string{"local_dock", "cloud_direct"}})
}

func (h *Handler) DiscoveryManifest(w http.ResponseWriter, _ *http.Request) {
	if h.discovery == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "discovery manifest unavailable"})
		return
	}
	manifest := *h.discovery
	manifest.LastSeen = time.Now().UTC().Format(time.RFC3339)
	writeJSON(w, http.StatusOK, manifest)
}

func (h *Handler) cloudV2Request(r *http.Request, method, path string, body any) (int, []byte, error) {
	token, err := cloudlink.LoadToken(h.cloudTokenPath)
	if err != nil {
		return 0, nil, fmt.Errorf("Dock cloud token unavailable: %w", err)
	}
	cloudURL := firstNonEmpty(strings.TrimSpace(h.cloudURL), strings.TrimSpace(token.CloudURL))
	if cloudURL == "" {
		return 0, nil, fmt.Errorf("Exora Cloud is not configured")
	}
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return 0, nil, err
		}
		reader = bytes.NewReader(data)
	}
	ctx, cancel := contextWithTimeout(r, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(cloudURL, "/")+path, reader)
	if err != nil {
		return 0, nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token.CloudToken))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	return resp.StatusCode, payload, err
}

func (h *Handler) accountCloudRequest(r *http.Request, method, path string, body any) (int, []byte, error) {
	if h.localAuth == nil {
		return 0, nil, fmt.Errorf("Dock local authorization is unavailable")
	}
	accountID, accountKey, ok := h.localAuth.AccountKey()
	if !ok {
		return 0, nil, fmt.Errorf("Exora account API key is not configured on this Dock")
	}
	if h.enforceAccountScope && (h.activeAccountID == "" || accountID != h.activeAccountID) {
		return 0, nil, fmt.Errorf("Exora account API key does not match the active account")
	}
	token, err := cloudlink.LoadToken(h.cloudTokenPath)
	if err != nil {
		return 0, nil, fmt.Errorf("Dock Cloud link unavailable: %w", err)
	}
	cloudURL := firstNonEmpty(strings.TrimSpace(h.cloudURL), strings.TrimSpace(token.CloudURL))
	var reader io.Reader
	if body != nil {
		data, marshalErr := json.Marshal(body)
		if marshalErr != nil {
			return 0, nil, marshalErr
		}
		reader = bytes.NewReader(data)
	}
	ctx, cancel := contextWithTimeout(r, 3*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(cloudURL, "/")+path, reader)
	if err != nil {
		return 0, nil, err
	}
	for name, values := range r.Header {
		if protectedLocalForwardHeader(name) {
			continue
		}
		for _, value := range values {
			req.Header.Add(name, value)
		}
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+accountKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	return resp.StatusCode, payload, err
}

func protectedLocalForwardHeader(name string) bool {
	name = strings.ToLower(strings.TrimSpace(name))
	return name == "accept-encoding" || name == "authorization" || name == "host" || name == "cookie" || strings.HasPrefix(name, "x-exora-")
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func decodeJSONBody(r *http.Request, dst any) error {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 8<<20))
	decoder.DisallowUnknownFields()
	return decoder.Decode(dst)
}
func contextWithTimeout(r *http.Request, timeout time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), timeout)
}
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
