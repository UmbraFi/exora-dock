package localauth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Scope int

const (
	ScopeNone Scope = iota
	ScopeAgent
	ScopeProviderAgent
	ScopeOwner
)

type Tokens struct {
	OwnerToken         string `json:"ownerToken"`
	AgentToken         string `json:"agentToken"`
	ProviderAgentToken string `json:"providerAgentToken"`
	CreatedAt          string `json:"createdAt"`
	UpdatedAt          string `json:"updatedAt"`
}

type Store struct {
	path   string
	tokens Tokens
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
		if strings.TrimSpace(tokens.AgentToken) == "" {
			token, err := randomToken("exora_agent_")
			if err != nil {
				return nil, err
			}
			tokens.AgentToken = token
			changed = true
		}
		if strings.TrimSpace(tokens.ProviderAgentToken) == "" {
			token, err := randomToken("exora_provider_agent_")
			if err != nil {
				return nil, err
			}
			tokens.ProviderAgentToken = token
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
		return &Store{path: path, tokens: tokens}, nil
	} else if !os.IsNotExist(err) {
		return nil, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	owner, err := randomToken("exora_owner_")
	if err != nil {
		return nil, err
	}
	agent, err := randomToken("exora_agent_")
	if err != nil {
		return nil, err
	}
	providerAgent, err := randomToken("exora_provider_agent_")
	if err != nil {
		return nil, err
	}
	tokens := Tokens{
		OwnerToken:         owner,
		AgentToken:         agent,
		ProviderAgentToken: providerAgent,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	if err := writeTokens(path, tokens); err != nil {
		return nil, err
	}
	return &Store{path: path, tokens: tokens}, nil
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

func (s *Store) AgentToken() string {
	return s.Tokens().AgentToken
}

func (s *Store) OwnerToken() string {
	return s.Tokens().OwnerToken
}

func (s *Store) ProviderAgentToken() string {
	return s.Tokens().ProviderAgentToken
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
	if constantTimeEqual(token, s.tokens.ProviderAgentToken) {
		return ScopeProviderAgent
	}
	if constantTimeEqual(token, s.tokens.AgentToken) {
		return ScopeAgent
	}
	return ScopeNone
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
