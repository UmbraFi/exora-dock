package chat

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

// Message is a single chat message within an order conversation.
// The Text field contains AES-256-GCM encrypted ciphertext (hex-encoded).
// Only the sender and recipient can decrypt it using their shared X25519 secret.
// Miners store and relay messages but cannot read the plaintext.
type Message struct {
	OrderID   string `json:"order_id"`
	From      string `json:"from"`       // sender pubkey (base58)
	To        string `json:"to"`         // receiver pubkey (base58)
	Text      string `json:"text"`       // encrypted ciphertext (hex), only sender/receiver can decrypt
	Timestamp int64  `json:"ts"`
	PrevHash  string `json:"prev_hash"`  // hash of previous message, "" if first
	Hash      string `json:"hash"`       // SHA256(order_id + from + to + text + ts + prev_hash)
	Signature string `json:"signature"`  // ed25519 signature of Hash by sender
}

// ComputeHash calculates the message hash from its fields.
func ComputeHash(orderID, from, to, text string, ts int64, prevHash string) string {
	payload := fmt.Sprintf("%s:%s:%s:%s:%d:%s", orderID, from, to, text, ts, prevHash)
	sum := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(sum[:])
}

// Verify checks that the message hash is correct and the signature is valid.
func (m *Message) Verify() error {
	expected := ComputeHash(m.OrderID, m.From, m.To, m.Text, m.Timestamp, m.PrevHash)
	if m.Hash != expected {
		return fmt.Errorf("hash mismatch: got %s, want %s", m.Hash, expected)
	}

	sigBytes, err := hex.DecodeString(m.Signature)
	if err != nil {
		return fmt.Errorf("invalid signature encoding: %w", err)
	}

	pubBytes, err := decodeBase58Pubkey(m.From)
	if err != nil {
		return fmt.Errorf("invalid sender pubkey: %w", err)
	}

	hashBytes, _ := hex.DecodeString(m.Hash)
	if !ed25519.Verify(ed25519.PublicKey(pubBytes), hashBytes, sigBytes) {
		return fmt.Errorf("signature verification failed")
	}

	return nil
}

// NewMessage creates a properly hashed message. Signature must be added by the PWA.
func NewMessage(orderID, from, to, text, prevHash string) *Message {
	ts := time.Now().Unix()
	hash := ComputeHash(orderID, from, to, text, ts, prevHash)
	return &Message{
		OrderID:   orderID,
		From:      from,
		To:        to,
		Text:      text,
		Timestamp: ts,
		PrevHash:  prevHash,
		Hash:      hash,
	}
}

func (m *Message) Marshal() ([]byte, error) {
	return json.Marshal(m)
}

func UnmarshalMessage(data []byte) (*Message, error) {
	var m Message
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// base58 decode (simplified Solana pubkey decode)
func decodeBase58Pubkey(s string) ([]byte, error) {
	alphabet := "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
	result := make([]byte, 0, 32)

	for _, c := range s {
		carry := 0
		for i := 0; i < len(alphabet); i++ {
			if rune(alphabet[i]) == c {
				carry = i
				break
			}
		}
		for j := len(result) - 1; j >= 0; j-- {
			carry += int(result[j]) * 58
			result[j] = byte(carry & 0xff)
			carry >>= 8
		}
		for carry > 0 {
			result = append([]byte{byte(carry & 0xff)}, result...)
			carry >>= 8
		}
	}

	// leading zeros
	for _, c := range s {
		if c != '1' {
			break
		}
		result = append([]byte{0}, result...)
	}

	if len(result) != 32 {
		return nil, fmt.Errorf("invalid pubkey length: %d", len(result))
	}
	return result, nil
}
