package order

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"sort"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/product"
)

const (
	indexKey = "orders:index"
	ttl      = 365 * 24 * time.Hour
)

type Status string

const (
	StatusPendingPayment  Status = "pending_payment"
	StatusPaidSimulated   Status = "paid_simulated"
	StatusSellerConfirmed Status = "seller_confirmed"
	StatusShipped         Status = "shipped"
	StatusCompleted       Status = "completed"
	StatusCancelled       Status = "cancelled"
)

type Order struct {
	ID           string  `json:"id"`
	ProductID    string  `json:"productId"`
	ProductName  string  `json:"productName"`
	ProductImage string  `json:"productImage"`
	BuyerPubkey  string  `json:"buyerPubkey"`
	SellerPubkey string  `json:"sellerPubkey"`
	Quantity     int     `json:"quantity"`
	UnitPrice    float64 `json:"unitPrice"`
	TotalPrice   float64 `json:"totalPrice"`
	Status       Status  `json:"status"`
	CreatedAt    string  `json:"createdAt"`
	UpdatedAt    string  `json:"updatedAt"`
	PaymentMode  string  `json:"paymentMode"`
	PaymentRef   string  `json:"paymentRef"`
	ChatOrderID  string  `json:"chatOrderId"`
}

type CreateItem struct {
	ProductID string `json:"productId"`
	Quantity  int    `json:"quantity"`
}

type CreateRequest struct {
	BuyerPubkey string       `json:"buyerPubkey"`
	Items       []CreateItem `json:"items"`
}

type StatusRequest struct {
	Status Status `json:"status"`
}

type Store struct {
	cache *cache.Cache
}

func NewStore(c *cache.Cache) *Store {
	return &Store{cache: c}
}

func (s *Store) Create(req CreateRequest, products *product.Store) ([]Order, error) {
	buyer := strings.TrimSpace(req.BuyerPubkey)
	if buyer == "" {
		return nil, fmt.Errorf("buyer_pubkey required")
	}
	if len(req.Items) == 0 {
		return nil, fmt.Errorf("at least one order item is required")
	}
	if products == nil {
		return nil, fmt.Errorf("product store not configured")
	}

	orders := make([]Order, 0, len(req.Items))
	now := time.Now().UTC()
	nowString := now.Format(time.RFC3339)

	for _, item := range req.Items {
		productID := strings.TrimSpace(item.ProductID)
		if productID == "" {
			return nil, fmt.Errorf("product_id required")
		}
		if item.Quantity <= 0 {
			return nil, fmt.Errorf("quantity must be greater than 0")
		}

		p, ok := products.Get(productID)
		if !ok {
			return nil, fmt.Errorf("product not found: %s", productID)
		}
		seller := strings.TrimSpace(p.SellerPubkey)
		if seller == "" {
			seller = strings.TrimSpace(p.Seller)
		}
		if seller == "" {
			return nil, fmt.Errorf("product seller missing: %s", productID)
		}
		if seller == buyer {
			return nil, fmt.Errorf("buyer cannot buy their own listing")
		}

		id := fmt.Sprintf("ord-%d-%s", now.UnixNano()+int64(len(orders)), shortHash(buyer+seller+productID))
		total := p.Price * float64(item.Quantity)
		orders = append(orders, Order{
			ID:           id,
			ProductID:    p.ID,
			ProductName:  p.Name,
			ProductImage: p.Image,
			BuyerPubkey:  buyer,
			SellerPubkey: seller,
			Quantity:     item.Quantity,
			UnitPrice:    p.Price,
			TotalPrice:   total,
			Status:       StatusPendingPayment,
			CreatedAt:    nowString,
			UpdatedAt:    nowString,
			PaymentMode:  "simulated",
			ChatOrderID:  id,
		})
	}

	for _, order := range orders {
		if err := s.Save(order); err != nil {
			return nil, err
		}
	}
	return orders, nil
}

func (s *Store) Save(o Order) error {
	data, err := json.Marshal(o)
	if err != nil {
		return err
	}
	s.cache.Set(FormatOrderKey(o.ID), data, ttl)

	ids := s.loadIndex()
	found := false
	for _, id := range ids {
		if id == o.ID {
			found = true
			break
		}
	}
	if !found {
		ids = append([]string{o.ID}, ids...)
	}
	indexData, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	s.cache.Set(indexKey, indexData, ttl)
	return nil
}

func (s *Store) Get(id string) (Order, bool) {
	data, ok := s.cache.Get(FormatOrderKey(id))
	if !ok {
		return Order{}, false
	}
	var o Order
	if err := json.Unmarshal(data, &o); err != nil {
		return Order{}, false
	}
	return o, true
}

func (s *Store) ListByParty(party string, role string) []Order {
	party = strings.TrimSpace(party)
	role = strings.TrimSpace(role)

	ids := s.loadIndex()
	out := make([]Order, 0, len(ids))
	for _, id := range ids {
		o, ok := s.Get(id)
		if !ok {
			continue
		}
		if party != "" {
			switch role {
			case "buyer":
				if o.BuyerPubkey != party {
					continue
				}
			case "seller":
				if o.SellerPubkey != party {
					continue
				}
			default:
				if o.BuyerPubkey != party && o.SellerPubkey != party {
					continue
				}
			}
		}
		out = append(out, o)
	}

	sort.SliceStable(out, func(i, j int) bool {
		return out[i].CreatedAt > out[j].CreatedAt
	})
	return out
}

func (s *Store) SimulatePayment(id string) (Order, error) {
	o, ok := s.Get(id)
	if !ok {
		return Order{}, fmt.Errorf("order not found")
	}
	if o.Status != StatusPendingPayment {
		return Order{}, fmt.Errorf("cannot simulate payment from status %s", o.Status)
	}
	o.Status = StatusPaidSimulated
	o.PaymentRef = "sim-" + shortHash(o.ID+time.Now().UTC().Format(time.RFC3339Nano))
	o.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return o, s.Save(o)
}

func (s *Store) UpdateStatus(id string, next Status) (Order, error) {
	o, ok := s.Get(id)
	if !ok {
		return Order{}, fmt.Errorf("order not found")
	}
	if !isKnownStatus(next) {
		return Order{}, fmt.Errorf("unknown status: %s", next)
	}
	if !canTransition(o.Status, next) {
		return Order{}, fmt.Errorf("invalid status transition: %s -> %s", o.Status, next)
	}
	o.Status = next
	o.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return o, s.Save(o)
}

func (s *Store) loadIndex() []string {
	data, ok := s.cache.Get(indexKey)
	if !ok {
		return nil
	}
	var ids []string
	if err := json.Unmarshal(data, &ids); err != nil {
		return nil
	}
	return ids
}

func FormatOrderKey(id string) string {
	return fmt.Sprintf("order:%s", id)
}

func isKnownStatus(status Status) bool {
	switch status {
	case StatusPendingPayment, StatusPaidSimulated, StatusSellerConfirmed, StatusShipped, StatusCompleted, StatusCancelled:
		return true
	default:
		return false
	}
}

func canTransition(current Status, next Status) bool {
	if current == next {
		return true
	}
	switch current {
	case StatusPendingPayment:
		return next == StatusPaidSimulated || next == StatusCancelled
	case StatusPaidSimulated:
		return next == StatusSellerConfirmed || next == StatusCancelled
	case StatusSellerConfirmed:
		return next == StatusShipped || next == StatusCancelled
	case StatusShipped:
		return next == StatusCompleted
	default:
		return false
	}
}

func shortHash(value string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(value))
	return fmt.Sprintf("%08x", h.Sum32())
}
