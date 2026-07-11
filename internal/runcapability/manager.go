package runcapability

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const tokenPrefix = "exora_run_v1."

func IsToken(value string) bool {
	return strings.HasPrefix(strings.TrimSpace(value), tokenPrefix)
}

var (
	ErrInvalidToken = errors.New("invalid run capability")
	ErrExpired      = errors.New("run capability expired")
	ErrRevoked      = errors.New("run capability revoked")
	ErrForbidden    = errors.New("run capability does not authorize this request")
)

// Claims are deliberately narrow. A token is useful only for one automation
// run, transaction role, action set and (optionally) one workspace.
type Claims struct {
	ID            string   `json:"jti"`
	RunID         string   `json:"runId"`
	TransactionID string   `json:"transactionId"`
	Role          string   `json:"role"`
	Actions       []string `json:"actions"`
	Workspace     string   `json:"workspace,omitempty"`
	LeaseEpoch    int64    `json:"leaseEpoch,omitempty"`
	IssuedAt      int64    `json:"iat"`
	ExpiresAt     int64    `json:"exp"`
}

type Requirement struct {
	RunID         string
	TransactionID string
	Role          string
	Action        string
	Workspace     string
	LeaseEpoch    int64
}

type persistedState struct {
	Secret  string           `json:"secret"`
	Revoked map[string]int64 `json:"revoked,omitempty"`
}

type Manager struct {
	mu      sync.RWMutex
	path    string
	secret  []byte
	revoked map[string]int64
	now     func() time.Time
}

// LoadOrCreate keeps the signing secret local. The file never contains issued
// tokens, owner credentials, wallet material or prompts.
func LoadOrCreate(path string) (*Manager, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, fmt.Errorf("run capability path required")
	}
	state := persistedState{}
	if data, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(data, &state); err != nil {
			return nil, fmt.Errorf("decode run capability state: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	secret, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(state.Secret))
	if err != nil || len(secret) < 32 {
		secret = make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			return nil, err
		}
		state.Secret = base64.RawURLEncoding.EncodeToString(secret)
	}
	if state.Revoked == nil {
		state.Revoked = map[string]int64{}
	}
	m := &Manager{path: path, secret: secret, revoked: state.Revoked, now: time.Now}
	m.pruneLocked(m.now().UTC().Unix())
	if err := m.persistLocked(); err != nil {
		return nil, err
	}
	return m, nil
}

func NewEphemeral(secret []byte) *Manager {
	copySecret := append([]byte(nil), secret...)
	if len(copySecret) < 32 {
		sum := sha256.Sum256(copySecret)
		copySecret = sum[:]
	}
	return &Manager{secret: copySecret, revoked: map[string]int64{}, now: time.Now}
}

func (m *Manager) Issue(claims Claims, ttl time.Duration) (string, Claims, error) {
	if m == nil || len(m.secret) == 0 {
		return "", Claims{}, fmt.Errorf("run capability manager unavailable")
	}
	claims.RunID = strings.TrimSpace(claims.RunID)
	claims.TransactionID = strings.TrimSpace(claims.TransactionID)
	claims.Role = strings.ToLower(strings.TrimSpace(claims.Role))
	claims.Workspace = cleanWorkspace(claims.Workspace)
	claims.Actions = compactActions(claims.Actions)
	if claims.RunID == "" || claims.TransactionID == "" || claims.Role == "" || len(claims.Actions) == 0 {
		return "", Claims{}, fmt.Errorf("runId, transactionId, role and actions are required")
	}
	if ttl <= 0 || ttl > 24*time.Hour {
		ttl = 15 * time.Minute
	}
	now := m.now().UTC()
	claims.ID = randomID()
	claims.IssuedAt = now.Unix()
	claims.ExpiresAt = now.Add(ttl).Unix()
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", Claims{}, err
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	sig := m.sign(encoded)
	return tokenPrefix + encoded + "." + base64.RawURLEncoding.EncodeToString(sig), claims, nil
}

func (m *Manager) Verify(token string, requirement Requirement) (Claims, error) {
	claims, err := m.parse(token)
	if err != nil {
		return Claims{}, err
	}
	m.mu.RLock()
	_, revoked := m.revoked[claims.ID]
	m.mu.RUnlock()
	if revoked {
		return Claims{}, ErrRevoked
	}
	if m.now().UTC().Unix() >= claims.ExpiresAt {
		return Claims{}, ErrExpired
	}
	if want := strings.TrimSpace(requirement.RunID); want != "" && !same(want, claims.RunID) {
		return Claims{}, ErrForbidden
	}
	if want := strings.TrimSpace(requirement.TransactionID); want != "" && !same(want, claims.TransactionID) {
		return Claims{}, ErrForbidden
	}
	if want := strings.ToLower(strings.TrimSpace(requirement.Role)); want != "" && !same(want, claims.Role) {
		return Claims{}, ErrForbidden
	}
	if action := strings.ToLower(strings.TrimSpace(requirement.Action)); action != "" && !contains(claims.Actions, action) {
		return Claims{}, ErrForbidden
	}
	if requirement.LeaseEpoch > 0 && claims.LeaseEpoch != requirement.LeaseEpoch {
		return Claims{}, ErrForbidden
	}
	if workspace := cleanWorkspace(requirement.Workspace); workspace != "" {
		if claims.Workspace == "" || !workspaceWithin(workspace, claims.Workspace) {
			return Claims{}, ErrForbidden
		}
	}
	return claims, nil
}

func (m *Manager) Revoke(token string) error {
	claims, err := m.parse(token)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pruneLocked(m.now().UTC().Unix())
	m.revoked[claims.ID] = claims.ExpiresAt
	return m.persistLocked()
}

func (m *Manager) parse(token string) (Claims, error) {
	if m == nil {
		return Claims{}, ErrInvalidToken
	}
	token = strings.TrimSpace(token)
	if !strings.HasPrefix(token, tokenPrefix) {
		return Claims{}, ErrInvalidToken
	}
	parts := strings.Split(strings.TrimPrefix(token, tokenPrefix), ".")
	if len(parts) != 2 {
		return Claims{}, ErrInvalidToken
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || subtle.ConstantTimeCompare(signature, m.sign(parts[0])) != 1 {
		return Claims{}, ErrInvalidToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return Claims{}, ErrInvalidToken
	}
	var claims Claims
	if err := json.Unmarshal(payload, &claims); err != nil || claims.ID == "" || claims.ExpiresAt == 0 {
		return Claims{}, ErrInvalidToken
	}
	return claims, nil
}

func (m *Manager) sign(payload string) []byte {
	mac := hmac.New(sha256.New, m.secret)
	_, _ = mac.Write([]byte(payload))
	return mac.Sum(nil)
}

func (m *Manager) pruneLocked(now int64) {
	for id, expires := range m.revoked {
		if expires <= now {
			delete(m.revoked, id)
		}
	}
}

func (m *Manager) persistLocked() error {
	if m.path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(m.path), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(persistedState{
		Secret:  base64.RawURLEncoding.EncodeToString(m.secret),
		Revoked: m.revoked,
	}, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0600); err != nil {
		return err
	}
	return os.Rename(tmp, m.path)
}

func randomID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UTC().UnixNano())
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

func compactActions(actions []string) []string {
	out := make([]string, 0, len(actions))
	seen := map[string]struct{}{}
	for _, action := range actions {
		action = strings.ToLower(strings.TrimSpace(action))
		if action == "" {
			continue
		}
		if _, ok := seen[action]; ok {
			continue
		}
		seen[action] = struct{}{}
		out = append(out, action)
	}
	return out
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == "*" || same(value, target) {
			return true
		}
	}
	return false
}

func same(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func cleanWorkspace(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	cleaned, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return ""
	}
	return strings.TrimRight(cleaned, string(os.PathSeparator))
}

func workspaceWithin(candidate, root string) bool {
	rel, err := filepath.Rel(root, candidate)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)))
}
