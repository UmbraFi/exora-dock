package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/UmbraFi/Umbra_SVR/internal/agent"
	"github.com/UmbraFi/Umbra_SVR/internal/cache"
	"github.com/UmbraFi/Umbra_SVR/internal/chat"
	"github.com/UmbraFi/Umbra_SVR/internal/dht"
	"github.com/UmbraFi/Umbra_SVR/internal/ipfs"
	"github.com/UmbraFi/Umbra_SVR/internal/product"
	"github.com/go-chi/chi/v5"
)

type Handler struct {
	cache      *cache.Cache
	chatStore  *chat.Store
	relay      *chat.Relay
	hub        *chat.Hub
	ring       *dht.Ring
	ipfsClient *ipfs.Client
	pinStore    *ipfs.PinStore
	reviewAgent *agent.ReviewAgent
	products    *product.Store
	selfPubkey  string
	startTime   time.Time
}

func NewHandler(c *cache.Cache, cs *chat.Store, relay *chat.Relay, hub *chat.Hub, ring *dht.Ring, ic *ipfs.Client, ps *ipfs.PinStore, ra *agent.ReviewAgent, products *product.Store, selfPubkey string) *Handler {
	return &Handler{
		cache:       c,
		chatStore:   cs,
		relay:       relay,
		hub:         hub,
		ring:        ring,
		ipfsClient:  ic,
		pinStore:    ps,
		reviewAgent: ra,
		products:    products,
		selfPubkey:  selfPubkey,
		startTime:   time.Now(),
	}
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":       "ok",
		"uptime":       time.Since(h.startTime).String(),
		"miners":       len(h.ring.Miners()),
		"online_users": h.hub.OnlineCount(),
	})
}

// --- Cache endpoints ---

func (h *Handler) GetAccount(w http.ResponseWriter, r *http.Request) {
	addr := chi.URLParam(r, "address")
	data, ok := h.cache.Get(fmt.Sprintf("account:%s", addr))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func (h *Handler) GetProduct(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if h.products != nil {
		if p, ok := h.products.Get(id); ok {
			writeJSON(w, http.StatusOK, p)
			return
		}
	}
	data, ok := h.cache.Get(fmt.Sprintf("product:%s", id))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func (h *Handler) ListProducts(w http.ResponseWriter, r *http.Request) {
	products := []product.Product{}
	if h.products != nil {
		products = h.products.List()
	}
	writeJSON(w, http.StatusOK, map[string]any{"products": products})
}

func (h *Handler) CreateProduct(w http.ResponseWriter, r *http.Request) {
	var req product.CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if h.reviewAgent == nil || h.products == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "product service not configured"})
		return
	}

	category, title := "Marketplace", productTitle(req.Description)
	reviewReq := agent.ReviewRequest{
		ProductID:    fmt.Sprintf("draft-%d", time.Now().UnixNano()),
		Title:        title,
		Description:  req.Description,
		Category:     category,
		Price:        req.Price,
		ImageCIDs:    req.ImageCIDs,
		SellerPubkey: req.SellerPubkey,
	}

	review, err := h.reviewAgent.Review(r.Context(), reviewReq)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "review failed: " + err.Error()})
		return
	}
	review.MinerPubkey = h.selfPubkey
	if !review.Approved {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"approved": false, "review": review})
		return
	}

	p, err := product.Build(req, review)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := h.products.Save(p); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "product save failed"})
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{"product": p, "review": review})
}

func (h *Handler) GetTx(w http.ResponseWriter, r *http.Request) {
	sig := chi.URLParam(r, "signature")
	data, ok := h.cache.Get(fmt.Sprintf("tx:%s", sig))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// --- Chat endpoints ---

// SendMessage: PWA sends a signed message, miner forwards to responsible peers.
// POST /v1/chat/send
func (h *Handler) SendMessage(w http.ResponseWriter, r *http.Request) {
	var msg chat.Message
	if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}

	if err := msg.Verify(); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	if err := h.relay.Forward(&msg); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "sent", "hash": msg.Hash})
}

// ReceiveMessage: peer miner pushes a message to this miner for storage.
// POST /v1/chat/receive
func (h *Handler) ReceiveMessage(w http.ResponseWriter, r *http.Request) {
	var msg chat.Message
	if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}

	if err := h.chatStore.Append(&msg); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "stored"})
}

// GetMessages: fetch messages for an order.
// GET /v1/chat/messages/{orderID}?after=0
func (h *Handler) GetMessages(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "orderID")
	afterStr := r.URL.Query().Get("after")
	after := 0
	if afterStr != "" {
		after, _ = strconv.Atoi(afterStr)
	}

	// Try to sync from peers first if we have few messages
	local := h.chatStore.GetMessages(orderID, 0)
	if len(local) == 0 && h.relay != nil {
		h.relay.FetchFromPeers(r.Context(), orderID)
	}

	msgs := h.chatStore.GetMessages(orderID, after)
	writeJSON(w, http.StatusOK, map[string]any{"messages": msgs})
}

// GetUnread: check which orders have unread messages for a user.
// GET /v1/chat/unread/{pubkey}
func (h *Handler) GetUnread(w http.ResponseWriter, r *http.Request) {
	pubkey := chi.URLParam(r, "pubkey")
	orders := h.chatStore.GetUnreadOrders(pubkey)
	writeJSON(w, http.StatusOK, map[string]any{
		"order_ids": orders,
	})
}

// ExportChat: export full chat chain for dispute evidence.
// GET /v1/chat/export/{orderID}
func (h *Handler) ExportChat(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "orderID")

	// Sync from peers to get complete chain
	h.relay.FetchFromPeers(r.Context(), orderID)

	data, err := h.chatStore.ExportChain(orderID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// WebSocket: real-time message push to connected PWA clients.
// GET /ws
func (h *Handler) WebSocket(w http.ResponseWriter, r *http.Request) {
	h.hub.HandleWS(w, r)
}

// LookupMiners: PWA can query which miners are responsible for an order.
// GET /v1/chat/lookup/{orderID}
func (h *Handler) LookupMiners(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "orderID")
	miners := h.ring.Lookup(orderID, chat.ReplicaCount)
	writeJSON(w, http.StatusOK, miners)
}

// --- IPFS endpoints ---

const maxUploadSize = 10 << 20 // 10 MB

// IPFSUpload handles POST /v1/ipfs/upload
// Accepts multipart form with 1-3 files under field "files" and a "product_id" field.
func (h *Handler) IPFSUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "body too large or invalid multipart"})
		return
	}

	productID := r.FormValue("product_id")
	if productID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "product_id required"})
		return
	}

	files := r.MultipartForm.File["files"]
	if len(files) == 0 || len(files) > 3 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "upload 1-3 files"})
		return
	}

	var cids []string
	for _, fh := range files {
		f, err := fh.Open()
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cannot open file"})
			return
		}
		cid, err := h.ipfsClient.Add(fh.Filename, f)
		f.Close()
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "ipfs add failed: " + err.Error()})
			return
		}
		cids = append(cids, cid)
	}

	if err := h.pinStore.Save(productID, cids); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "pin record save failed"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"cids": cids})
}

// IPFSGet handles GET /v1/ipfs/{cid}
// Proxies IPFS cat and streams raw bytes back.
func (h *Handler) IPFSGet(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "cid")
	rc, err := h.ipfsClient.Cat(cid)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "ipfs cat failed"})
		return
	}
	defer rc.Close()

	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("Content-Type", "application/octet-stream")
	io.Copy(w, rc)
}

// IPFSUnpin handles DELETE /v1/ipfs/{productID}
// Unpins all CIDs associated with a product.
func (h *Handler) IPFSUnpin(w http.ResponseWriter, r *http.Request) {
	productID := chi.URLParam(r, "productID")
	rec, ok := h.pinStore.Get(productID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no pins for product"})
		return
	}

	for _, cid := range rec.CIDs {
		_ = h.ipfsClient.Unpin(cid) // best-effort
	}
	h.pinStore.Delete(productID)

	writeJSON(w, http.StatusOK, map[string]string{"status": "unpinned"})
}

// --- Review endpoints ---

// SubmitReview handles POST /v1/review/submit
// PWA submits a product for review; this node votes locally and collects peer votes.
func (h *Handler) SubmitReview(w http.ResponseWriter, r *http.Request) {
	if h.reviewAgent == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "review agent not configured"})
		return
	}

	var req agent.ReviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if req.ProductID == "" || req.Title == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "product_id and title required"})
		return
	}

	// Local vote
	selfResult, err := h.reviewAgent.Review(r.Context(), req)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "local review failed: " + err.Error()})
		return
	}
	selfResult.MinerPubkey = h.selfPubkey

	// Collect peer votes
	consensus := agent.CollectVotes(r.Context(), h.ring, req, selfResult)

	// Persist result
	data, _ := json.Marshal(consensus)
	h.cache.Set(agent.FormatResultKey(req.ProductID), data, 30*24*time.Hour)

	writeJSON(w, http.StatusOK, consensus)
}

// Vote handles POST /v1/review/vote
// Called by peer nodes to get this node's review vote.
func (h *Handler) Vote(w http.ResponseWriter, r *http.Request) {
	if h.reviewAgent == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "review agent not configured"})
		return
	}

	var req agent.ReviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}

	result, err := h.reviewAgent.Review(r.Context(), req)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "review failed: " + err.Error()})
		return
	}
	result.MinerPubkey = h.selfPubkey

	writeJSON(w, http.StatusOK, result)
}

// GetReview handles GET /v1/review/{productID}
// Returns a previously stored review result.
func (h *Handler) GetReview(w http.ResponseWriter, r *http.Request) {
	productID := chi.URLParam(r, "productID")
	data, ok := h.cache.Get(agent.FormatResultKey(productID))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "review not found"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func productTitle(desc string) string {
	desc = strings.TrimSpace(desc)
	if desc == "" {
		return "Draft listing"
	}
	for _, sep := range []string{".", ","} {
		if idx := strings.Index(desc, sep); idx > 0 {
			desc = desc[:idx]
			break
		}
	}
	if len(desc) > 56 {
		desc = desc[:56]
	}
	return strings.TrimSpace(desc)
}
