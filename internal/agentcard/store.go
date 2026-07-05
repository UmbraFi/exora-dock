package agentcard

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
)

const (
	cardKeyPrefix = "agent-cards:"
	cardTTL       = 365 * 24 * time.Hour
)

type Store struct {
	cache *cache.Cache
}

func NewStore(c *cache.Cache) *Store {
	return &Store{cache: c}
}

func (s *Store) Save(card AgentCard) error {
	if s == nil || s.cache == nil {
		return fmt.Errorf("agent card store not configured")
	}
	card, err := PrepareForSave(card)
	if err != nil {
		return err
	}
	data, err := json.Marshal(card)
	if err != nil {
		return err
	}
	s.cache.Set(cardKey(card.Role), data, cardTTL)
	return nil
}

func (s *Store) SavePublished(card AgentCard) error {
	if s == nil || s.cache == nil {
		return fmt.Errorf("agent card store not configured")
	}
	data, err := json.Marshal(card)
	if err != nil {
		return err
	}
	s.cache.Set(cardKey(card.Role), data, cardTTL)
	return nil
}

func (s *Store) Get(role Role) (AgentCard, bool) {
	if s == nil || s.cache == nil {
		return AgentCard{}, false
	}
	data, ok := s.cache.Get(cardKey(role))
	if !ok {
		return AgentCard{}, false
	}
	var card AgentCard
	if err := json.Unmarshal(data, &card); err != nil {
		return AgentCard{}, false
	}
	return card, true
}

func (s *Store) List() []AgentCard {
	out := []AgentCard{}
	if card, ok := s.Get(RoleBuyer); ok {
		out = append(out, card)
	}
	if card, ok := s.Get(RoleSeller); ok {
		out = append(out, card)
	}
	return out
}

func cardKey(role Role) string {
	return cardKeyPrefix + string(role)
}
