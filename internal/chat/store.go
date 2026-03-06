package chat

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"

	"github.com/dgraph-io/badger/v4"
)

// Store holds chat messages per order, with chain integrity validation.
// Messages are persisted to Badger and restored on startup.
type Store struct {
	mu sync.RWMutex
	// orderID -> ordered messages
	orders map[string][]*Message
	// pubkey -> list of orderIDs with unread messages
	unread map[string]map[string]bool
	db     *badger.DB
}

func NewStore(db *badger.DB) *Store {
	s := &Store{
		orders: make(map[string][]*Message),
		unread: make(map[string]map[string]bool),
		db:     db,
	}
	s.loadFromDisk()
	return s
}

// loadFromDisk restores all chat messages from Badger on startup.
func (s *Store) loadFromDisk() {
	count := 0
	err := s.db.View(func(txn *badger.Txn) error {
		opts := badger.DefaultIteratorOptions
		opts.Prefix = []byte("chat:")
		it := txn.NewIterator(opts)
		defer it.Close()

		for it.Rewind(); it.Valid(); it.Next() {
			item := it.Item()
			val, err := item.ValueCopy(nil)
			if err != nil {
				log.Printf("[store] skip bad value: %v", err)
				continue
			}

			var msg Message
			if err := json.Unmarshal(val, &msg); err != nil {
				log.Printf("[store] skip bad json: %v", err)
				continue
			}

			s.orders[msg.OrderID] = append(s.orders[msg.OrderID], &msg)
			count++
		}
		return nil
	})
	if err != nil {
		log.Printf("[store] loadFromDisk error: %v", err)
	}

	// Rebuild unread from restored messages: any message whose recipient
	// hasn't been marked read is considered unread.
	// We also load the persisted unread set.
	s.loadUnreadFromDisk()

	log.Printf("[store] restored %d messages from disk", count)
}

// loadUnreadFromDisk restores the unread set from Badger.
func (s *Store) loadUnreadFromDisk() {
	err := s.db.View(func(txn *badger.Txn) error {
		opts := badger.DefaultIteratorOptions
		opts.Prefix = []byte("unread:")
		it := txn.NewIterator(opts)
		defer it.Close()

		for it.Rewind(); it.Valid(); it.Next() {
			// key = unread:{pubkey}:{orderID}
			key := string(it.Item().Key())
			parts := strings.SplitN(key, ":", 3)
			if len(parts) != 3 {
				continue
			}
			pubkey, orderID := parts[1], parts[2]
			if s.unread[pubkey] == nil {
				s.unread[pubkey] = make(map[string]bool)
			}
			s.unread[pubkey][orderID] = true
		}
		return nil
	})
	if err != nil {
		log.Printf("[store] loadUnreadFromDisk error: %v", err)
	}
}

// Append validates and stores a message. Returns error if chain is broken or signature invalid.
func (s *Store) Append(msg *Message) error {
	if err := msg.Verify(); err != nil {
		return fmt.Errorf("verification failed: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	chain := s.orders[msg.OrderID]

	// Validate prev_hash linkage
	if len(chain) == 0 {
		if msg.PrevHash != "" {
			return fmt.Errorf("first message must have empty prev_hash")
		}
	} else {
		lastHash := chain[len(chain)-1].Hash
		if msg.PrevHash != lastHash {
			return fmt.Errorf("prev_hash mismatch: got %s, want %s", msg.PrevHash, lastHash)
		}
	}

	// Duplicate check
	if len(chain) > 0 && chain[len(chain)-1].Hash == msg.Hash {
		return nil // idempotent
	}

	s.orders[msg.OrderID] = append(chain, msg)

	// Persist message to Badger
	idx := len(s.orders[msg.OrderID]) - 1
	s.persistMessage(msg, idx)

	// Track unread for recipient
	if s.unread[msg.To] == nil {
		s.unread[msg.To] = make(map[string]bool)
	}
	s.unread[msg.To][msg.OrderID] = true
	s.persistUnread(msg.To, msg.OrderID)

	return nil
}

// persistMessage writes a single message to Badger.
func (s *Store) persistMessage(msg *Message, index int) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[store] marshal error: %v", err)
		return
	}

	key := fmt.Sprintf("chat:%s:%06d", msg.OrderID, index)
	err = s.db.Update(func(txn *badger.Txn) error {
		return txn.Set([]byte(key), data)
	})
	if err != nil {
		log.Printf("[store] persist error: %v", err)
	}
}

// persistUnread writes an unread marker to Badger.
func (s *Store) persistUnread(pubkey, orderID string) {
	key := fmt.Sprintf("unread:%s:%s", pubkey, orderID)
	_ = s.db.Update(func(txn *badger.Txn) error {
		return txn.Set([]byte(key), []byte("1"))
	})
}

// deleteUnread removes an unread marker from Badger.
func (s *Store) deleteUnread(pubkey, orderID string) {
	key := fmt.Sprintf("unread:%s:%s", pubkey, orderID)
	_ = s.db.Update(func(txn *badger.Txn) error {
		return txn.Delete([]byte(key))
	})
}

// MarkRead clears the unread flag for a specific order. Called when client sends ACK.
func (s *Store) MarkRead(pubkey, orderID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if orders, ok := s.unread[pubkey]; ok {
		delete(orders, orderID)
		if len(orders) == 0 {
			delete(s.unread, pubkey)
		}
	}
	s.deleteUnread(pubkey, orderID)
}

// GetMessages returns all messages for an order, optionally after a given index.
func (s *Store) GetMessages(orderID string, afterIndex int) []*Message {
	s.mu.RLock()
	defer s.mu.RUnlock()

	chain := s.orders[orderID]
	if afterIndex >= len(chain) {
		return nil
	}
	if afterIndex < 0 {
		afterIndex = 0
	}
	return chain[afterIndex:]
}

// GetUnreadOrders returns order IDs that have unread messages for a given pubkey.
// Does NOT clear unread — use MarkRead after client ACK.
func (s *Store) GetUnreadOrders(pubkey string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	orders, ok := s.unread[pubkey]
	if !ok {
		return nil
	}

	result := make([]string, 0, len(orders))
	for oid := range orders {
		result = append(result, oid)
	}
	return result
}

// LatestHash returns the hash of the last message in an order chain.
func (s *Store) LatestHash(orderID string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	chain := s.orders[orderID]
	if len(chain) == 0 {
		return ""
	}
	return chain[len(chain)-1].Hash
}

// OrderIDs returns all order IDs stored in this node.
func (s *Store) OrderIDs() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ids := make([]string, 0, len(s.orders))
	for id := range s.orders {
		ids = append(ids, id)
	}
	return ids
}

// ExportChain returns the full message chain as JSON for dispute evidence.
func (s *Store) ExportChain(orderID string) ([]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	chain := s.orders[orderID]
	if chain == nil {
		return nil, fmt.Errorf("order %s not found", orderID)
	}
	return json.Marshal(chain)
}
