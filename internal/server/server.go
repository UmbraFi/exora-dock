package server

import (
	"net/http"

	"github.com/UmbraFi/Umbra_SVR/api"
	"github.com/UmbraFi/Umbra_SVR/internal/agent"
	"github.com/UmbraFi/Umbra_SVR/internal/cache"
	"github.com/UmbraFi/Umbra_SVR/internal/chat"
	"github.com/UmbraFi/Umbra_SVR/internal/dht"
	"github.com/UmbraFi/Umbra_SVR/internal/ipfs"
	"github.com/UmbraFi/Umbra_SVR/internal/product"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func New(c *cache.Cache, cs *chat.Store, relay *chat.Relay, hub *chat.Hub, ring *dht.Ring, ic *ipfs.Client, ps *ipfs.PinStore, ra *agent.ReviewAgent, products *product.Store, selfPubkey string) http.Handler {
	h := api.NewHandler(c, cs, relay, hub, ring, ic, ps, ra, products, selfPubkey)
	r := chi.NewRouter()

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/health", h.Health)
	r.Get("/ws", h.WebSocket)

	r.Route("/v1", func(r chi.Router) {
		// Cache endpoints
		r.Get("/account/{address}", h.GetAccount)
		r.Get("/products", h.ListProducts)
		r.Post("/products", h.CreateProduct)
		r.Get("/product/{id}", h.GetProduct)
		r.Get("/tx/{signature}", h.GetTx)

		// Chat endpoints
		r.Post("/chat/send", h.SendMessage)
		r.Post("/chat/receive", h.ReceiveMessage)
		r.Get("/chat/messages/{orderID}", h.GetMessages)
		r.Get("/chat/unread/{pubkey}", h.GetUnread)
		r.Get("/chat/export/{orderID}", h.ExportChat)
		r.Get("/chat/lookup/{orderID}", h.LookupMiners)

		// IPFS endpoints
		r.Post("/ipfs/upload", h.IPFSUpload)
		r.Get("/ipfs/{cid}", h.IPFSGet)
		r.Delete("/ipfs/{productID}", h.IPFSUnpin)

		// Review endpoints
		r.Post("/review/submit", h.SubmitReview)
		r.Post("/review/vote", h.Vote)
		r.Get("/review/{productID}", h.GetReview)
	})

	return r
}
