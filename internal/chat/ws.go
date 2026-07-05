package chat

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin:     func(r *http.Request) bool { return true },
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// Hub manages WebSocket connections grouped by user pubkey.
// When a message arrives for a user, Hub pushes it to all their connected clients.
type Hub struct {
	mu    sync.RWMutex
	conns map[string]map[*websocket.Conn]bool // pubkey -> set of connections

	// OnConnect is called when a user successfully authenticates via WebSocket.
	// Used to deliver offline messages.
	OnConnect func(pubkey string)

	// onAck is called when a client sends an ACK for an order.
	onAck func(pubkey, orderID string)
}

func NewHub() *Hub {
	return &Hub{
		conns: make(map[string]map[*websocket.Conn]bool),
	}
}

// HandleWS upgrades an HTTP request to WebSocket.
// Auth flow: server sends a random challenge, client signs it with Ed25519, server verifies.
func (h *Hub) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[ws] upgrade error: %v", err)
		return
	}

	// Step 1: Generate and send a random challenge
	challenge := make([]byte, 32)
	if _, err := rand.Read(challenge); err != nil {
		log.Printf("[ws] challenge generation error: %v", err)
		conn.Close()
		return
	}
	challengeHex := hex.EncodeToString(challenge)

	conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if err := conn.WriteJSON(map[string]string{"challenge": challengeHex}); err != nil {
		log.Printf("[ws] challenge send error: %v", err)
		conn.Close()
		return
	}

	// Step 2: Read auth response within 10 seconds
	conn.SetReadDeadline(time.Now().Add(10 * time.Second))

	var auth struct {
		Pubkey    string `json:"pubkey"`
		Signature string `json:"signature"` // Ed25519 signature of the challenge bytes
	}
	if err := conn.ReadJSON(&auth); err != nil {
		log.Printf("[ws] auth read error: %v", err)
		conn.Close()
		return
	}

	if auth.Pubkey == "" {
		conn.WriteJSON(map[string]string{"error": "pubkey required"})
		conn.Close()
		return
	}

	// Step 3: Verify the signature against the challenge
	if err := verifyChallenge(auth.Pubkey, challengeHex, auth.Signature); err != nil {
		log.Printf("[ws] auth failed for %s: %v", auth.Pubkey[:8], err)
		conn.WriteJSON(map[string]string{"error": fmt.Sprintf("auth failed: %v", err)})
		conn.Close()
		return
	}

	conn.SetReadDeadline(time.Time{})  // clear deadline
	conn.SetWriteDeadline(time.Time{}) // clear deadline

	h.register(auth.Pubkey, conn)
	log.Printf("[ws] client connected: %s", auth.Pubkey[:8])

	conn.WriteJSON(map[string]string{"status": "connected"})

	// Deliver offline messages after successful auth
	if h.OnConnect != nil {
		go h.OnConnect(auth.Pubkey)
	}

	// Keep connection alive with ping/pong, handle ACK messages
	go h.readPump(auth.Pubkey, conn)
}

// verifyChallenge checks that the signature is a valid Ed25519 signature
// of the challenge hex string, produced by the claimed pubkey.
func verifyChallenge(pubkeyB58, challengeHex, signatureHex string) error {
	pubBytes, err := decodeBase58Pubkey(pubkeyB58)
	if err != nil {
		return fmt.Errorf("invalid pubkey: %w", err)
	}

	sigBytes, err := hex.DecodeString(signatureHex)
	if err != nil {
		return fmt.Errorf("invalid signature encoding: %w", err)
	}
	if len(sigBytes) != ed25519.SignatureSize {
		return fmt.Errorf("invalid signature length: %d", len(sigBytes))
	}

	challengeBytes, err := hex.DecodeString(challengeHex)
	if err != nil {
		return fmt.Errorf("invalid challenge encoding: %w", err)
	}

	if !ed25519.Verify(ed25519.PublicKey(pubBytes), challengeBytes, sigBytes) {
		return fmt.Errorf("signature verification failed")
	}

	return nil
}

func (h *Hub) register(pubkey string, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.conns[pubkey] == nil {
		h.conns[pubkey] = make(map[*websocket.Conn]bool)
	}
	h.conns[pubkey][conn] = true
}

func (h *Hub) unregister(pubkey string, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if cs, ok := h.conns[pubkey]; ok {
		delete(cs, conn)
		if len(cs) == 0 {
			delete(h.conns, pubkey)
		}
	}
	conn.Close()
}

// IsOnline checks if a user has any active WebSocket connections.
func (h *Hub) IsOnline(pubkey string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.conns[pubkey]) > 0
}

// Push sends an encrypted message to all connections of the recipient.
// Returns true if the user was online and received it.
func (h *Hub) Push(recipientPubkey string, msg *Message) bool {
	h.mu.RLock()
	conns := h.conns[recipientPubkey]
	h.mu.RUnlock()

	if len(conns) == 0 {
		return false
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return false
	}

	for conn := range conns {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			log.Printf("[ws] push error: %v", err)
			go h.unregister(recipientPubkey, conn)
		}
	}
	return true
}

// ackMessage is the JSON structure sent by clients to acknowledge received messages.
type ackMessage struct {
	Type    string `json:"type"`
	OrderID string `json:"order_id"`
}

// readPump keeps the connection alive, handles client ACK messages, and detects disconnection.
func (h *Hub) readPump(pubkey string, conn *websocket.Conn) {
	defer h.unregister(pubkey, conn)

	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	// Ping ticker
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	go func() {
		for range ticker.C {
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}()

	// Read loop — handle ACK messages from client
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var ack ackMessage
		if err := json.Unmarshal(data, &ack); err != nil {
			continue
		}
		if ack.Type == "ack" && ack.OrderID != "" {
			if h.onAck != nil {
				h.onAck(pubkey, ack.OrderID)
			}
		}
	}
}

// SetOnAck sets the callback for ACK messages from clients.
func (h *Hub) SetOnAck(fn func(pubkey, orderID string)) {
	h.onAck = fn
}

// OnlineCount returns the number of connected users.
func (h *Hub) OnlineCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.conns)
}
