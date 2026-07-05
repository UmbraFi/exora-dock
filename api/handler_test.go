package api

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dgraph-io/badger/v4"
	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/dht"
	"github.com/go-chi/chi/v5"
)

func TestChatHandlersReturnWrappedShapes(t *testing.T) {
	c, err := cache.New(128, t.TempDir())
	if err != nil {
		t.Fatalf("cache.New() error = %v", err)
	}
	defer c.Close()

	db, err := badger.Open(badger.DefaultOptions(t.TempDir()).WithLoggingLevel(badger.ERROR))
	if err != nil {
		t.Fatalf("badger.Open() error = %v", err)
	}
	defer db.Close()

	store := chat.NewStore(db)
	fromPub, fromPriv, _ := ed25519.GenerateKey(rand.Reader)
	toPub, _, _ := ed25519.GenerateKey(rand.Reader)
	from := encodeBase58(fromPub)
	to := encodeBase58(toPub)
	hash := chat.ComputeHash("order-1", from, to, "ciphertext", 1, "")
	hashBytes, _ := hex.DecodeString(hash)
	msg := &chat.Message{
		OrderID:   "order-1",
		From:      from,
		To:        to,
		Text:      "ciphertext",
		Timestamp: 1,
		Hash:      hash,
		Signature: hex.EncodeToString(ed25519.Sign(fromPriv, hashBytes)),
	}
	if err := store.Append(msg); err != nil {
		t.Fatalf("Append() error = %v", err)
	}

	handler := NewHandler(c, store, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, nil, nil, nil, "local-dev-miner")
	router := chi.NewRouter()
	router.Get("/messages/{orderID}", handler.GetMessages)
	router.Get("/unread/{pubkey}", handler.GetUnread)

	msgReq := httptest.NewRequest(http.MethodGet, "/messages/order-1", nil)
	msgRec := httptest.NewRecorder()
	router.ServeHTTP(msgRec, msgReq)
	if msgRec.Code != http.StatusOK {
		t.Fatalf("messages status = %d", msgRec.Code)
	}
	var msgBody struct {
		Messages []chat.Message `json:"messages"`
	}
	if err := json.Unmarshal(msgRec.Body.Bytes(), &msgBody); err != nil {
		t.Fatalf("messages json error = %v", err)
	}
	if len(msgBody.Messages) != 1 {
		t.Fatalf("messages length = %d, want 1", len(msgBody.Messages))
	}

	unreadReq := httptest.NewRequest(http.MethodGet, "/unread/"+to, nil)
	unreadRec := httptest.NewRecorder()
	router.ServeHTTP(unreadRec, unreadReq)
	if unreadRec.Code != http.StatusOK {
		t.Fatalf("unread status = %d", unreadRec.Code)
	}
	var unreadBody struct {
		OrderIDs []string `json:"order_ids"`
	}
	if err := json.Unmarshal(unreadRec.Body.Bytes(), &unreadBody); err != nil {
		t.Fatalf("unread json error = %v", err)
	}
	if len(unreadBody.OrderIDs) != 1 || unreadBody.OrderIDs[0] != "order-1" {
		t.Fatalf("order_ids = %#v", unreadBody.OrderIDs)
	}
}

func encodeBase58(input []byte) string {
	const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
	if len(input) == 0 {
		return ""
	}

	digits := []byte{0}
	for _, b := range input {
		carry := int(b)
		for i := range digits {
			carry += int(digits[i]) << 8
			digits[i] = byte(carry % 58)
			carry /= 58
		}
		for carry > 0 {
			digits = append(digits, byte(carry%58))
			carry /= 58
		}
	}

	for _, b := range input {
		if b != 0 {
			break
		}
		digits = append(digits, 0)
	}

	out := make([]byte, len(digits))
	for i := range digits {
		out[i] = alphabet[digits[len(digits)-1-i]]
	}
	return string(out)
}
