package dht

import (
	"crypto/sha256"
	"encoding/binary"
	"sort"
	"sync"
)

const defaultReplicas = 20 // virtual nodes per miner for balance

type Miner struct {
	Pubkey   string `json:"pubkey"`
	Endpoint string `json:"endpoint"`
	Rating   int    `json:"rating"`
}

type point struct {
	hash  uint32
	miner *Miner
}

// Ring is a consistent hashing ring that maps order IDs to responsible miners.
type Ring struct {
	mu       sync.RWMutex
	points   []point
	miners   map[string]*Miner // pubkey -> Miner
	replicas int
}

func NewRing() *Ring {
	return &Ring{
		miners:   make(map[string]*Miner),
		replicas: defaultReplicas,
	}
}

func (r *Ring) AddMiner(m Miner) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.miners[m.Pubkey]; exists {
		return
	}
	mc := m
	r.miners[m.Pubkey] = &mc

	for i := 0; i < r.replicas; i++ {
		h := hashKey(m.Pubkey, i)
		r.points = append(r.points, point{hash: h, miner: &mc})
	}
	sort.Slice(r.points, func(i, j int) bool {
		return r.points[i].hash < r.points[j].hash
	})
}

func (r *Ring) RemoveMiner(pubkey string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	delete(r.miners, pubkey)
	filtered := r.points[:0]
	for _, p := range r.points {
		if p.miner.Pubkey != pubkey {
			filtered = append(filtered, p)
		}
	}
	r.points = filtered
}

// Lookup returns the K closest unique miners responsible for the given orderID.
func (r *Ring) Lookup(orderID string, k int) []Miner {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if len(r.points) == 0 {
		return nil
	}

	h := hashStr(orderID)
	idx := sort.Search(len(r.points), func(i int) bool {
		return r.points[i].hash >= h
	})

	seen := make(map[string]bool)
	var result []Miner

	for i := 0; i < len(r.points) && len(result) < k; i++ {
		p := r.points[(idx+i)%len(r.points)]
		if !seen[p.miner.Pubkey] {
			seen[p.miner.Pubkey] = true
			result = append(result, *p.miner)
		}
	}
	return result
}

// Miners returns all registered miners.
func (r *Ring) Miners() []Miner {
	r.mu.RLock()
	defer r.mu.RUnlock()

	out := make([]Miner, 0, len(r.miners))
	for _, m := range r.miners {
		out = append(out, *m)
	}
	return out
}

func hashKey(pubkey string, replica int) uint32 {
	buf := make([]byte, len(pubkey)+4)
	copy(buf, pubkey)
	binary.BigEndian.PutUint32(buf[len(pubkey):], uint32(replica))
	sum := sha256.Sum256(buf)
	return binary.BigEndian.Uint32(sum[:4])
}

func hashStr(s string) uint32 {
	sum := sha256.Sum256([]byte(s))
	return binary.BigEndian.Uint32(sum[:4])
}
