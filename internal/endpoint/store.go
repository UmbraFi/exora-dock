package endpoint

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	pathpkg "path"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/accountscope"
	"github.com/exora-dock/exora-dock/internal/cache"
)

const (
	indexKey = "v3:endpoints:index"
	ttl      = 365 * 24 * time.Hour
)

type Route struct {
	OperationID      string `json:"operationId"`
	Method           string `json:"method"`
	Path             string `json:"path"`
	Streaming        string `json:"interaction"`
	SideEffect       bool   `json:"sideEffect"`
	Idempotent       bool   `json:"idempotent"`
	MaxRequestBytes  int64  `json:"maxRequestBytes"`
	MaxResponseBytes int64  `json:"maxResponseBytes"`
	TimeoutSeconds   int    `json:"timeoutSeconds"`
}

type Config struct {
	EndpointID       string         `json:"endpointId"`
	LocalBaseURL     string         `json:"localBaseUrl"`
	HealthPath       string         `json:"healthPath"`
	ServiceManifest  map[string]any `json:"serviceManifest"`
	Routes           []Route        `json:"-"`
	ContractSHA256   string         `json:"contractSha256"`
	AuthType         string         `json:"authType"`
	CredentialRef    string         `json:"credentialRef,omitempty"`
	LastProbeHealthy bool           `json:"lastProbeHealthy"`
	LastProbeAt      time.Time      `json:"lastProbeAt,omitempty"`
	LastProbeError   string         `json:"lastProbeError,omitempty"`
	TimeoutSeconds   int            `json:"timeoutSeconds"`
	Concurrency      int            `json:"concurrency"`
	Version          int64          `json:"version"`
	UpdatedAt        time.Time      `json:"updatedAt"`
}

type ProbeInput struct {
	Config
	AuthType     string `json:"authType"`
	APIKeyHeader string `json:"apiKeyHeader"`
	Secret       string `json:"secret"`
}

type Status struct {
	EndpointID     string    `json:"endpointId"`
	Healthy        bool      `json:"healthy"`
	Status         int       `json:"status"`
	LatencyMS      int64     `json:"latencyMs"`
	ContentType    string    `json:"contentType"`
	ContractSHA256 string    `json:"contractSha256"`
	CheckedAt      time.Time `json:"checkedAt"`
	Error          string    `json:"error,omitempty"`
}

type Store struct {
	cache     *cache.Cache
	namespace string
}

func NewStore(c *cache.Cache, accountID string) *Store {
	accountID = strings.TrimSpace(accountID)
	return &Store{cache: c, namespace: accountscope.Namespace(accountID)}
}

func (s *Store) key(value string) string {
	if s.namespace == "" {
		return "inactive:" + value
	}
	return "account:" + s.namespace + ":" + value
}

func endpointKey(id string) string { return "v3:endpoints:" + id }

func (s *Store) Save(ctx context.Context, cfg Config) (Config, error) {
	if s == nil || s.cache == nil {
		return Config{}, errors.New("endpoint store is unavailable")
	}
	cfg.EndpointID = strings.TrimSpace(cfg.EndpointID)
	if !strings.HasPrefix(cfg.EndpointID, "epd_") || len(cfg.EndpointID) > 132 {
		return Config{}, errors.New("endpointId is invalid")
	}
	if _, err := ValidateLocalBaseURL(ctx, cfg.LocalBaseURL); err != nil {
		return Config{}, err
	}
	if !safeEndpointPath(cfg.HealthPath) {
		return Config{}, errors.New("healthPath must start with /")
	}
	manifest, operations, contractSHA, err := ValidateServiceManifest(cfg.ServiceManifest)
	if err != nil {
		return Config{}, err
	}
	cfg.ServiceManifest, cfg.Routes, cfg.ContractSHA256 = manifest, operations, contractSHA
	seen := map[string]bool{}
	for index := range cfg.Routes {
		route := &cfg.Routes[index]
		route.Method = strings.ToUpper(strings.TrimSpace(route.Method))
		route.Path = strings.TrimSpace(route.Path)
		route.OperationID = strings.TrimSpace(route.OperationID)
		if route.OperationID == "" {
			return Config{}, errors.New("every endpoint operation requires operationId")
		}
		if route.Method == "" || !safeEndpointPath(route.Path) || !validPathTemplate(route.Path) {
			return Config{}, errors.New("every HTTP operation requires method and a valid absolute path template")
		}
		key := route.Method + " " + route.Path
		if seen[key] {
			return Config{}, errors.New("duplicate endpoint route")
		}
		seen[key] = true
	}
	if err := validateRouteConflicts(cfg.Routes); err != nil {
		return Config{}, err
	}
	cfg.TimeoutSeconds = clamp(cfg.TimeoutSeconds, 1, 300, 120)
	cfg.Concurrency = clamp(cfg.Concurrency, 1, 64, 1)
	cfg.CredentialRef = strings.TrimSpace(cfg.CredentialRef)
	if cfg.AuthType != "" && cfg.AuthType != "none" && cfg.CredentialRef == "" {
		return Config{}, errors.New("credentialRef is required for an authenticated endpoint")
	}
	if previous, found := s.Get(cfg.EndpointID); found {
		cfg.Version = previous.Version + 1
	} else {
		cfg.Version = 1
	}
	cfg.UpdatedAt = time.Now().UTC()
	raw, _ := json.Marshal(cfg)
	s.cache.Set(s.key(endpointKey(cfg.EndpointID)), raw, ttl)
	ids := s.loadIndex()
	found := false
	for _, id := range ids {
		found = found || id == cfg.EndpointID
	}
	if !found {
		ids = append([]string{cfg.EndpointID}, ids...)
		indexRaw, _ := json.Marshal(ids)
		s.cache.Set(s.key(indexKey), indexRaw, ttl)
	}
	return cfg, nil
}

func validPathTemplate(value string) bool {
	seen := map[string]bool{}
	for _, segment := range strings.Split(strings.Trim(value, "/"), "/") {
		if !strings.ContainsAny(segment, "{}") {
			continue
		}
		if len(segment) < 3 || segment[0] != '{' || segment[len(segment)-1] != '}' {
			return false
		}
		name := segment[1 : len(segment)-1]
		if seen[name] || name == "" {
			return false
		}
		for i, r := range name {
			if !(r == '_' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || i > 0 && r >= '0' && r <= '9') {
				return false
			}
		}
		seen[name] = true
	}
	return true
}

func routeShape(value string) string {
	parts := strings.Split(strings.Trim(value, "/"), "/")
	for index, part := range parts {
		if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
			parts[index] = "{}"
		}
	}
	return strings.Join(parts, "/")
}

func validateRouteConflicts(routes []Route) error {
	seen := map[string]string{}
	for _, route := range routes {
		key := strings.ToUpper(route.Method) + " " + routeShape(route.Path)
		if prior := seen[key]; prior != "" && prior != route.Path {
			return fmt.Errorf("ambiguous endpoint path templates: %s and %s", prior, route.Path)
		}
		seen[key] = route.Path
	}
	return nil
}

func safeEndpointPath(value string) bool {
	if !strings.HasPrefix(value, "/") || strings.ContainsAny(value, "?#") || strings.Contains(value, "\\") {
		return false
	}
	decoded, err := url.PathUnescape(value)
	return err == nil && strings.HasPrefix(decoded, "/") && pathpkg.Clean(decoded) == decoded && !strings.Contains(decoded, "\\")
}

func (s *Store) Get(id string) (Config, bool) {
	if s == nil || s.cache == nil {
		return Config{}, false
	}
	raw, ok := s.cache.Get(s.key(endpointKey(strings.TrimSpace(id))))
	if !ok {
		return Config{}, false
	}
	var cfg Config
	if json.Unmarshal(raw, &cfg) != nil {
		return Config{}, false
	}
	manifest, operations, contractSHA, err := ValidateServiceManifest(cfg.ServiceManifest)
	if err != nil {
		return Config{}, false
	}
	cfg.ServiceManifest, cfg.Routes, cfg.ContractSHA256 = manifest, operations, contractSHA
	return cfg, true
}

func (s *Store) List() []Config {
	out := []Config{}
	for _, id := range s.loadIndex() {
		if cfg, found := s.Get(id); found {
			out = append(out, cfg)
		}
	}
	return out
}

func (s *Store) Delete(id string) {
	if s == nil || s.cache == nil {
		return
	}
	id = strings.TrimSpace(id)
	s.cache.Delete(s.key(endpointKey(id)))
	ids := s.loadIndex()
	next := ids[:0]
	for _, candidate := range ids {
		if candidate != id {
			next = append(next, candidate)
		}
	}
	raw, _ := json.Marshal(next)
	s.cache.Set(s.key(indexKey), raw, ttl)
}

func (s *Store) loadIndex() []string {
	if s == nil || s.cache == nil {
		return nil
	}
	raw, ok := s.cache.Get(s.key(indexKey))
	if !ok {
		return nil
	}
	var ids []string
	_ = json.Unmarshal(raw, &ids)
	return ids
}

func ValidateLocalBaseURL(ctx context.Context, raw string) (*url.URL, error) {
	target, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") || target.Hostname() == "" || target.User != nil {
		return nil, errors.New("localBaseUrl must be an HTTP or HTTPS URL without embedded credentials")
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, target.Hostname())
	if err != nil || len(addresses) == 0 {
		return nil, errors.New("localBaseUrl hostname could not be resolved")
	}
	for _, address := range addresses {
		ip := address.IP
		if ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || (!ip.IsLoopback() && !ip.IsPrivate()) {
			return nil, errors.New("localBaseUrl must resolve only to loopback or private network addresses")
		}
	}
	return target, nil
}

func Probe(ctx context.Context, input ProbeInput) Status {
	started := time.Now()
	_, operations, contractSHA, contractErr := ValidateServiceManifest(input.ServiceManifest)
	status := Status{EndpointID: input.EndpointID, ContractSHA256: contractSHA, CheckedAt: time.Now().UTC()}
	if contractErr != nil {
		status.Error = contractErr.Error()
		return status
	}
	input.Routes = operations
	base, err := ValidateLocalBaseURL(ctx, input.LocalBaseURL)
	if err != nil {
		status.Error = err.Error()
		return status
	}
	target := *base
	target.Path = strings.TrimRight(base.Path, "/") + "/" + strings.TrimPrefix(input.HealthPath, "/")
	target.RawPath = ""
	target.RawQuery = ""
	target.Fragment = ""
	request, _ := http.NewRequestWithContext(ctx, http.MethodHead, target.String(), nil)
	request.Header.Set("Accept", "application/json, text/event-stream;q=0.9, */*;q=0.5")
	transport, authErr := applyRequestCredential(ctx, request, input.AuthType, input.APIKeyHeader, input.Secret)
	if authErr != nil {
		status.Error = authErr.Error()
		return status
	}
	client := &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	if transport != nil {
		client.Transport = transport
	}
	response, err := client.Do(request)
	// A number of otherwise valid local runtimes only implement GET for their
	// health route and answer HEAD with a generic 404. Confirm every unsuccessful
	// HEAD probe with GET before declaring the endpoint unhealthy.
	if err == nil && (response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusBadRequest) {
		_ = response.Body.Close()
		request, _ = http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
		request.Header.Set("Accept", "application/json, text/event-stream;q=0.9, */*;q=0.5")
		transport, authErr = applyRequestCredential(ctx, request, input.AuthType, input.APIKeyHeader, input.Secret)
		if authErr != nil {
			status.Error = authErr.Error()
			return status
		}
		if transport != nil {
			client.Transport = transport
		}
		response, err = client.Do(request)
	}
	status.LatencyMS = time.Since(started).Milliseconds()
	if err != nil {
		status.Error = err.Error()
		return status
	}
	defer response.Body.Close()
	status.Status = response.StatusCode
	status.ContentType = response.Header.Get("Content-Type")
	status.Healthy = response.StatusCode >= 200 && response.StatusCode < 400
	if !status.Healthy {
		status.Error = fmt.Sprintf("local provider returned HTTP %d", response.StatusCode)
	}
	return status
}

func applyCredential(headers http.Header, authType, apiKeyHeader, secret string) {
	switch strings.ToLower(strings.TrimSpace(authType)) {
	case "bearer":
		headers.Set("Authorization", "Bearer "+secret)
	case "basic":
		headers.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(secret)))
	case "api_key":
		header := strings.TrimSpace(apiKeyHeader)
		if header == "" {
			header = "X-API-Key"
		}
		headers.Set(header, secret)
	}
}

func clamp(value, minimum, maximum, fallback int) int {
	if value == 0 {
		return fallback
	}
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}
