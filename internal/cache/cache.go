package cache

import (
	"bytes"
	"container/list"
	"strings"
	"sync"
	"time"

	"github.com/dgraph-io/badger/v4"
)

type entry struct {
	key       string
	value     []byte
	expiresAt time.Time
}

type Cache struct {
	mu       sync.RWMutex
	items    map[string]*list.Element
	evict    *list.List
	maxItems int
	db       *badger.DB
}

func New(maxItems int, dataDir string) (*Cache, error) {
	opts := badger.DefaultOptions(dataDir).WithLoggingLevel(badger.WARNING)
	db, err := badger.Open(opts)
	if err != nil {
		return nil, err
	}

	return &Cache{
		items:    make(map[string]*list.Element),
		evict:    list.New(),
		maxItems: maxItems,
		db:       db,
	}, nil
}

func (c *Cache) Get(key string) ([]byte, bool) {
	c.mu.RLock()
	if el, ok := c.items[key]; ok {
		e := el.Value.(*entry)
		if time.Now().Before(e.expiresAt) {
			c.mu.RUnlock()
			c.mu.Lock()
			c.evict.MoveToFront(el)
			c.mu.Unlock()
			return e.value, true
		}
		c.mu.RUnlock()
		c.mu.Lock()
		c.removeElement(el)
		c.mu.Unlock()
	} else {
		c.mu.RUnlock()
	}

	// Fallback to disk
	var val []byte
	err := c.db.View(func(txn *badger.Txn) error {
		item, err := txn.Get([]byte(key))
		if err != nil {
			return err
		}
		val, err = item.ValueCopy(nil)
		return err
	})
	if err != nil {
		return nil, false
	}

	// Promote to memory without shortening the persisted Badger TTL.
	c.setMemory(key, val, 5*time.Minute)
	return val, true
}

func (c *Cache) Set(key string, value []byte, ttl time.Duration) {
	c.setMemory(key, value, ttl)

	// Persist to disk
	_ = c.db.Update(func(txn *badger.Txn) error {
		return txn.SetEntry(badger.NewEntry([]byte(key), value).WithTTL(ttl))
	})
}

func (c *Cache) Delete(key string) {
	c.mu.Lock()
	if element, ok := c.items[key]; ok {
		c.removeElement(element)
	}
	c.mu.Unlock()
	_ = c.db.Update(func(txn *badger.Txn) error { return txn.Delete([]byte(key)) })
}

// DeletePrefix removes only keys with the exact byte prefix. It is intended
// for narrow, versioned migrations rather than general cache eviction.
func (c *Cache) DeletePrefix(prefix string) error {
	if c == nil || c.db == nil || prefix == "" {
		return nil
	}
	c.mu.Lock()
	for key, element := range c.items {
		if strings.HasPrefix(key, prefix) {
			c.removeElement(element)
		}
	}
	c.mu.Unlock()
	return c.db.Update(func(txn *badger.Txn) error {
		iterator := txn.NewIterator(badger.DefaultIteratorOptions)
		defer iterator.Close()
		needle := []byte(prefix)
		for iterator.Seek(needle); iterator.ValidForPrefix(needle); iterator.Next() {
			key := iterator.Item().KeyCopy(nil)
			if !bytes.HasPrefix(key, needle) {
				break
			}
			if err := txn.Delete(key); err != nil {
				return err
			}
		}
		return nil
	})
}

func (c *Cache) setMemory(key string, value []byte, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if el, ok := c.items[key]; ok {
		c.evict.MoveToFront(el)
		e := el.Value.(*entry)
		e.value = value
		e.expiresAt = time.Now().Add(ttl)
	} else {
		if c.evict.Len() >= c.maxItems {
			c.removeElement(c.evict.Back())
		}
		e := &entry{key: key, value: value, expiresAt: time.Now().Add(ttl)}
		c.items[key] = c.evict.PushFront(e)
	}
}

func (c *Cache) removeElement(el *list.Element) {
	c.evict.Remove(el)
	delete(c.items, el.Value.(*entry).key)
}

func (c *Cache) Close() error {
	return c.db.Close()
}
