package ipfs

import (
	"encoding/json"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
)

const pinTTL = 30 * 24 * time.Hour // 30 days

// PinRecord tracks which CIDs belong to a product.
type PinRecord struct {
	ProductID string    `json:"product_id"`
	CIDs      []string  `json:"cids"`
	PinnedAt  time.Time `json:"pinned_at"`
}

// PinStore persists pin records in Badger via the existing cache.
type PinStore struct {
	cache *cache.Cache
}

func NewPinStore(c *cache.Cache) *PinStore {
	return &PinStore{cache: c}
}

func pinKey(productID string) string {
	return "ipfs:pin:" + productID
}

// Save stores a pin record for the given product.
func (s *PinStore) Save(productID string, cids []string) error {
	rec := PinRecord{
		ProductID: productID,
		CIDs:      cids,
		PinnedAt:  time.Now(),
	}
	data, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	s.cache.Set(pinKey(productID), data, pinTTL)
	return nil
}

// Get retrieves the pin record for a product, if it exists.
func (s *PinStore) Get(productID string) (*PinRecord, bool) {
	data, ok := s.cache.Get(pinKey(productID))
	if !ok {
		return nil, false
	}
	var rec PinRecord
	if err := json.Unmarshal(data, &rec); err != nil {
		return nil, false
	}
	return &rec, true
}

// Delete removes the pin record for a product.
func (s *PinStore) Delete(productID string) {
	// Set with zero TTL effectively removes on next read
	s.cache.Set(pinKey(productID), nil, time.Millisecond)
}
