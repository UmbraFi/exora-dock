package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/UmbraFi/Umbra_SVR/internal/dht"
)

const (
	ReplicaCount = 3 // store each message on K miners
	RelayTimeout = 5 * time.Second
	SyncInterval = 30 * time.Second
)

// Relay handles forwarding messages to responsible miners,
// real-time WebSocket push, and offline message queuing.
type Relay struct {
	ring   *dht.Ring
	store  *Store
	hub    *Hub
	self   string // this miner's pubkey
	client *http.Client
}

func NewRelay(ring *dht.Ring, store *Store, hub *Hub, selfPubkey string) *Relay {
	return &Relay{
		ring:   ring,
		store:  store,
		hub:    hub,
		self:   selfPubkey,
		client: &http.Client{Timeout: RelayTimeout},
	}
}

// Forward sends a message to the K responsible miners for its order.
// If the recipient is connected via WebSocket, push in real-time.
func (r *Relay) Forward(msg *Message) error {
	miners := r.ring.Lookup(msg.OrderID, ReplicaCount)

	var lastErr error
	sent := 0
	for _, m := range miners {
		if m.Pubkey == r.self {
			if err := r.store.Append(msg); err != nil {
				log.Printf("[relay] local store error: %v", err)
			} else {
				sent++
			}
			continue
		}

		if err := r.sendToMiner(m, msg); err != nil {
			log.Printf("[relay] forward to %s failed: %v", m.Pubkey[:8], err)
			lastErr = err
		} else {
			sent++
		}
	}

	if sent == 0 {
		return fmt.Errorf("failed to store on any miner: %v", lastErr)
	}

	// Real-time push to recipient if connected to this miner
	r.hub.Push(msg.To, msg)

	log.Printf("[relay] message %s stored on %d/%d miners", msg.Hash[:8], sent, len(miners))
	return nil
}

// DeliverOffline pushes all queued messages to a user who just came online.
func (r *Relay) DeliverOffline(pubkey string) {
	orders := r.store.GetUnreadOrders(pubkey)
	for _, orderID := range orders {
		msgs := r.store.GetMessages(orderID, 0)
		for _, msg := range msgs {
			if msg.To == pubkey {
				r.hub.Push(pubkey, msg)
			}
		}
	}
}

func (r *Relay) sendToMiner(miner dht.Miner, msg *Message) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/v1/chat/receive", miner.Endpoint)
	resp, err := r.client.Post(url, "application/json", bytes.NewReader(data))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("miner %s returned %d", miner.Pubkey[:8], resp.StatusCode)
	}
	return nil
}

// FetchFromPeers pulls messages for an order from responsible peer miners.
func (r *Relay) FetchFromPeers(ctx context.Context, orderID string) ([]*Message, error) {
	miners := r.ring.Lookup(orderID, ReplicaCount)
	localCount := len(r.store.GetMessages(orderID, 0))

	for _, m := range miners {
		if m.Pubkey == r.self {
			continue
		}

		url := fmt.Sprintf("%s/v1/chat/messages/%s?after=%d", m.Endpoint, orderID, localCount)
		req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
		resp, err := r.client.Do(req)
		if err != nil {
			log.Printf("[relay] fetch from %s failed: %v", m.Pubkey[:8], err)
			continue
		}

		var msgs []*Message
		json.NewDecoder(resp.Body).Decode(&msgs)
		resp.Body.Close()

		for _, msg := range msgs {
			_ = r.store.Append(msg)
		}
	}

	return r.store.GetMessages(orderID, 0), nil
}

// RunSync periodically syncs messages with peer miners.
func (r *Relay) RunSync(ctx context.Context) {
	ticker := time.NewTicker(SyncInterval)
	defer ticker.Stop()

	log.Println("[relay] sync started")
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.syncAll(ctx)
		}
	}
}

func (r *Relay) syncAll(ctx context.Context) {
	for _, orderID := range r.store.OrderIDs() {
		r.FetchFromPeers(ctx, orderID)
	}
}
