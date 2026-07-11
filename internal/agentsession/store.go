package agentsession

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
)

var ErrNotFound = errors.New("local agent session not found")

const (
	sessionIndexKey = "interactive-agent-sessions:v1:index"
	sessionKey      = "interactive-agent-session:v1:"
	sessionTTL      = 365 * 24 * time.Hour
	maxEvents       = 1000
)

type Store struct {
	mu       sync.RWMutex
	cache    *cache.Cache
	sessions map[string]Session
	index    []string
}

func NewStore(c *cache.Cache) *Store {
	return &Store{cache: c, sessions: map[string]Session{}}
}

func (s *Store) Create(req StartRequest) (Session, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, id := range s.loadIndexLocked() {
		candidate, ok := s.loadLocked(id)
		if !ok || candidate.ConversationID != req.ConversationID || candidate.Role != req.Role {
			continue
		}
		if candidate.Idempotency == nil {
			candidate.Idempotency = map[string]string{}
		}
		if candidate.Idempotency[req.IdempotencyKey] == "start" {
			return clone(candidate), true, nil
		}
		if candidate.Status == StatusStopped && (candidate.Driver != req.Binding.Driver || candidate.Binding.BindingID != req.Binding.BindingID) {
			// Switching a stopped conversation to another bound Agent creates a
			// fresh vendor session. The old mapping remains locally auditable.
			continue
		}
		if candidate.Status != StatusStopped && candidate.Driver != req.Binding.Driver {
			return Session{}, false, fmt.Errorf("conversation is already connected to %s", candidate.Driver)
		}
		candidate.Idempotency[req.IdempotencyKey] = "start"
		s.sessions[id] = candidate
		s.persistLocked(candidate)
		return clone(candidate), true, nil
	}
	now := nowString()
	id := newID("agent-session")
	record := Session{
		ID: id, ConversationID: req.ConversationID, Role: req.Role, Purpose: req.Purpose,
		Driver: req.Binding.Driver, Binding: req.Binding, Status: StatusStarting,
		Workspace: req.Workspace, PermissionMode: req.PermissionMode,
		PermissionProfile: req.PermissionProfile, WorkUID: req.WorkUID,
		TransactionID: req.TransactionID, RunID: req.RunID,
		CreatedAt: now, UpdatedAt: now, Idempotency: map[string]string{req.IdempotencyKey: "start"},
	}
	s.sessions[id] = record
	s.index = append([]string{id}, s.index...)
	s.persistLocked(record)
	s.persistIndexLocked()
	return clone(record), false, nil
}

func (s *Store) Get(id string) (Session, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.loadLocked(strings.TrimSpace(id))
	return clone(record), ok
}

func (s *Store) Find(conversationID, role string) (Session, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, id := range s.loadIndexLocked() {
		record, ok := s.loadLocked(id)
		if ok && record.ConversationID == conversationID && record.Role == role {
			return clone(record), true
		}
	}
	return Session{}, false
}

func (s *Store) Update(id string, fn func(*Session) error) (Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.loadLocked(strings.TrimSpace(id))
	if !ok {
		return Session{}, ErrNotFound
	}
	if err := fn(&record); err != nil {
		return Session{}, err
	}
	record.UpdatedAt = nowString()
	s.sessions[record.ID] = record
	s.persistLocked(record)
	return clone(record), nil
}

func (s *Store) AddEvent(id string, event Event) (Session, error) {
	return s.Update(id, func(record *Session) error {
		record.EventCursor++
		event.Seq = record.EventCursor
		if event.CreatedAt == "" {
			event.CreatedAt = nowString()
		}
		record.Events = append(record.Events, event)
		if len(record.Events) > maxEvents {
			record.Events = append([]Event(nil), record.Events[len(record.Events)-maxEvents:]...)
		}
		return nil
	})
}

func (s *Store) Events(id string, after int64) ([]Event, error) {
	record, ok := s.Get(id)
	if !ok {
		return nil, ErrNotFound
	}
	out := make([]Event, 0)
	for _, event := range record.Events {
		if event.Seq > after {
			out = append(out, event)
		}
	}
	return out, nil
}

func (s *Store) loadIndexLocked() []string {
	if len(s.index) > 0 || s.cache == nil {
		return s.index
	}
	if data, ok := s.cache.Get(sessionIndexKey); ok {
		_ = json.Unmarshal(data, &s.index)
	}
	return s.index
}

func (s *Store) loadLocked(id string) (Session, bool) {
	if id == "" {
		return Session{}, false
	}
	if record, ok := s.sessions[id]; ok {
		return record, true
	}
	if s.cache == nil {
		return Session{}, false
	}
	data, ok := s.cache.Get(sessionKey + id)
	if !ok {
		return Session{}, false
	}
	var record Session
	if json.Unmarshal(data, &record) != nil || record.ID != id {
		return Session{}, false
	}
	if record.Idempotency == nil {
		record.Idempotency = map[string]string{}
	}
	s.sessions[id] = record
	return record, true
}

func (s *Store) persistLocked(record Session) {
	if s.cache == nil {
		return
	}
	data, _ := json.Marshal(record)
	s.cache.Set(sessionKey+record.ID, data, sessionTTL)
}

func (s *Store) persistIndexLocked() {
	if s.cache == nil {
		return
	}
	data, _ := json.Marshal(s.index)
	s.cache.Set(sessionIndexKey, data, sessionTTL)
}

func clone(in Session) Session {
	data, _ := json.Marshal(in)
	var out Session
	_ = json.Unmarshal(data, &out)
	out.Binding.Executable = in.Binding.Executable
	out.Queue = append([]QueuedMessage(nil), in.Queue...)
	out.Idempotency = map[string]string{}
	for key, value := range in.Idempotency {
		out.Idempotency[key] = value
	}
	return out
}
