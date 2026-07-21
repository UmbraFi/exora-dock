package localauth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Scope int

const (
	ScopeNone Scope = iota
	ScopeAgent
	ScopeIntegrationAgent
	ScopeOwner
)

type Tokens struct {
	OwnerToken              string   `json:"ownerToken"`
	DefaultSessionScopes    []string `json:"defaultSessionScopes,omitempty"`
	SessionPolicyConfigured bool     `json:"sessionPolicyConfigured,omitempty"`
	CreatedAt               string   `json:"createdAt"`
	UpdatedAt               string   `json:"updatedAt"`
}

type Store struct {
	path          string
	tokens        Tokens
	mu            sync.Mutex
	sessions      map[string]Session
	accountKey    string
	accountID     string
	now           func() time.Time
	defaultScopes []string
}

const (
	DefaultSessionIdle = 30 * time.Minute
	DefaultSessionTTL  = 24 * time.Hour
)

var DefaultAgentScopes = []string{"market.read", "api.invoke", "account.read", "provider.integrate"}

var allowedAgentScopes = map[string]bool{
	"market.read":        true,
	"api.invoke":         true,
	"account.read":       true,
	"provider.integrate": true,
}

type Session struct {
	SessionID     string    `json:"sessionId"`
	ClientName    string    `json:"clientName"`
	Scopes        []string  `json:"scopes"`
	CreatedAt     time.Time `json:"createdAt"`
	LastUsedAt    time.Time `json:"lastUsedAt"`
	IdleExpiresAt time.Time `json:"idleExpiresAt"`
	ExpiresAt     time.Time `json:"expiresAt"`
	IdleSeconds   int64     `json:"idleSeconds"`
	TokenHash     [32]byte  `json:"-"`
}

func LoadOrCreate(path string) (*Store, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, fmt.Errorf("auth token path required")
	}
	if data, err := os.ReadFile(path); err == nil {
		var tokens Tokens
		if err := json.Unmarshal(data, &tokens); err != nil {
			return nil, err
		}
		changed := false
		if strings.TrimSpace(tokens.OwnerToken) == "" {
			token, err := randomToken("exora_owner_")
			if err != nil {
				return nil, err
			}
			tokens.OwnerToken = token
			changed = true
		}
		if strings.TrimSpace(tokens.CreatedAt) == "" {
			tokens.CreatedAt = time.Now().UTC().Format(time.RFC3339)
			changed = true
		}
		if changed {
			tokens.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
			if err := writeTokens(path, tokens); err != nil {
				return nil, err
			}
		}
		return newStore(path, tokens), nil
	} else if !os.IsNotExist(err) {
		return nil, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	owner, err := randomToken("exora_owner_")
	if err != nil {
		return nil, err
	}
	tokens := Tokens{
		OwnerToken: owner,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if err := writeTokens(path, tokens); err != nil {
		return nil, err
	}
	return newStore(path, tokens), nil
}

func newStore(path string, tokens Tokens) *Store {
	scopes := append([]string(nil), DefaultAgentScopes...)
	if tokens.SessionPolicyConfigured {
		scopes = make([]string, 0, len(tokens.DefaultSessionScopes))
		for _, scope := range tokens.DefaultSessionScopes {
			if allowedAgentScopes[scope] {
				scopes = append(scopes, scope)
			}
		}
	}
	return &Store{path: path, tokens: tokens, sessions: map[string]Session{}, now: time.Now, defaultScopes: scopes}
}

func (s *Store) Path() string {
	if s == nil {
		return ""
	}
	return s.path
}

func (s *Store) Tokens() Tokens {
	if s == nil {
		return Tokens{}
	}
	return s.tokens
}

func (s *Store) OwnerToken() string {
	return s.Tokens().OwnerToken
}

func (s *Store) ScopeForToken(token string) Scope {
	if s == nil {
		return ScopeNone
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return ScopeNone
	}
	if constantTimeEqual(token, s.tokens.OwnerToken) {
		return ScopeOwner
	}
	if _, ok := s.SessionForToken(token); ok {
		return ScopeAgent
	}
	return ScopeNone
}

func (s *Store) CreateSession(clientName string, scopes []string) (Session, string, error) {
	if s == nil {
		return Session{}, "", fmt.Errorf("local auth unavailable")
	}
	if len(scopes) == 0 {
		s.mu.Lock()
		scopes = append([]string(nil), s.defaultScopes...)
		s.mu.Unlock()
	}
	seen := map[string]bool{}
	normalized := make([]string, 0, len(scopes))
	for _, scope := range scopes {
		scope = strings.TrimSpace(scope)
		if !allowedAgentScopes[scope] {
			return Session{}, "", fmt.Errorf("unsupported Agent scope %q", scope)
		}
		if !seen[scope] {
			seen[scope] = true
			normalized = append(normalized, scope)
		}
	}
	raw, err := randomToken("sk-exora-session-")
	if err != nil {
		return Session{}, "", err
	}
	now := s.now().UTC()
	suffix := strings.TrimPrefix(raw, "sk-exora-session-")
	if len(suffix) > 16 {
		suffix = suffix[:16]
	}
	session := Session{SessionID: "ases_" + suffix, ClientName: strings.TrimSpace(clientName), Scopes: normalized, CreatedAt: now, LastUsedAt: now, IdleExpiresAt: now.Add(DefaultSessionIdle), ExpiresAt: now.Add(DefaultSessionTTL), IdleSeconds: int64(DefaultSessionIdle / time.Second), TokenHash: sha256.Sum256([]byte(raw))}
	if session.ClientName == "" {
		session.ClientName = "Local Agent"
	}
	s.mu.Lock()
	s.sessions[session.SessionID] = session
	s.mu.Unlock()
	return session, raw, nil
}

func (s *Store) SessionPolicy() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.defaultScopes...)
}

func (s *Store) SetSessionPolicy(scopes []string) error {
	seen := map[string]bool{}
	normalized := []string{}
	for _, scope := range scopes {
		scope = strings.TrimSpace(scope)
		if !allowedAgentScopes[scope] {
			return fmt.Errorf("unsupported Agent scope %q", scope)
		}
		if !seen[scope] {
			seen[scope] = true
			normalized = append(normalized, scope)
		}
	}
	s.mu.Lock()
	updated := s.tokens
	updated.DefaultSessionScopes = append([]string(nil), normalized...)
	updated.SessionPolicyConfigured = true
	updated.UpdatedAt = s.now().UTC().Format(time.RFC3339)
	s.mu.Unlock()
	if err := writeTokens(s.path, updated); err != nil {
		return err
	}
	s.mu.Lock()
	s.tokens = updated
	s.defaultScopes = append([]string(nil), normalized...)
	s.mu.Unlock()
	return nil
}

func (s *Store) SessionForToken(token string) (Session, bool) {
	if s == nil || !strings.HasPrefix(strings.TrimSpace(token), "sk-exora-session-") {
		return Session{}, false
	}
	hash := sha256.Sum256([]byte(strings.TrimSpace(token)))
	now := s.now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, session := range s.sessions {
		if now.After(session.ExpiresAt) || now.Sub(session.LastUsedAt) > time.Duration(session.IdleSeconds)*time.Second {
			delete(s.sessions, id)
			continue
		}
		if subtle.ConstantTimeCompare(hash[:], session.TokenHash[:]) == 1 {
			session.LastUsedAt = now
			session.IdleExpiresAt = now.Add(time.Duration(session.IdleSeconds) * time.Second)
			s.sessions[id] = session
			return session, true
		}
	}
	return Session{}, false
}

func (s *Store) SessionPermits(token, scope string) bool {
	session, ok := s.SessionForToken(token)
	if !ok {
		return false
	}
	for _, value := range session.Scopes {
		if value == scope {
			return true
		}
	}
	return false
}

func (s *Store) ListSessions() []Session {
	if s == nil {
		return nil
	}
	now := s.now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Session, 0, len(s.sessions))
	for id, session := range s.sessions {
		if now.After(session.ExpiresAt) || now.Sub(session.LastUsedAt) > time.Duration(session.IdleSeconds)*time.Second {
			delete(s.sessions, id)
			continue
		}
		out = append(out, session)
	}
	return out
}

func (s *Store) RevokeSession(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, found := s.sessions[strings.TrimSpace(id)]
	delete(s.sessions, strings.TrimSpace(id))
	return found
}

func (s *Store) RevokeAllSessions() {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.sessions = map[string]Session{}
	s.mu.Unlock()
}

func (s *Store) SetAccountKey(accountID, key string) error {
	key = strings.TrimSpace(key)
	if !strings.HasPrefix(key, "sk-exora-") || strings.HasPrefix(key, "sk-exora-session-") {
		return fmt.Errorf("valid Exora account API key required")
	}
	s.mu.Lock()
	s.accountID, s.accountKey = strings.TrimSpace(accountID), key
	s.mu.Unlock()
	return nil
}

func (s *Store) AccountKey() (accountID, key string, ok bool) {
	if s == nil {
		return "", "", false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.accountID, s.accountKey, s.accountKey != ""
}

func (s *Store) LockAccount() {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.accountID, s.accountKey, s.sessions = "", "", map[string]Session{}
	s.mu.Unlock()
}

func writeTokens(path string, tokens Tokens) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(tokens, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0600)
}

func randomToken(prefix string) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return prefix + base64.RawURLEncoding.EncodeToString(raw), nil
}

func constantTimeEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
