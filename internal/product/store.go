package product

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/agent"
	"github.com/exora-dock/exora-dock/internal/cache"
)

const (
	indexKey = "products:index"
	ttl      = 365 * 24 * time.Hour
)

type ShippingRegionConfig struct {
	Type              string   `json:"type"`
	SelectedRegions   []string `json:"selectedRegions"`
	ExcludedCountries []string `json:"excludedCountries"`
}

type CreateRequest struct {
	Description          string               `json:"description"`
	Price                string               `json:"price"`
	SellType             string               `json:"sellType"`
	ShippingMethod       string               `json:"shippingMethod"`
	ShippingRegionConfig ShippingRegionConfig `json:"shippingRegionConfig"`
	ImageCIDs            []string             `json:"imageCids"`
	SellerPubkey         string               `json:"sellerPubkey"`
}

type ReviewMeta struct {
	Approved    bool   `json:"approved"`
	Reason      string `json:"reason"`
	MinerPubkey string `json:"minerPubkey"`
	Timestamp   int64  `json:"timestamp"`
}

type Product struct {
	ID                   string     `json:"id"`
	Name                 string     `json:"name"`
	Brand                string     `json:"brand"`
	Price                float64    `json:"price"`
	Image                string     `json:"image"`
	Category             string     `json:"category"`
	FeedType             string     `json:"feedType"`
	Description          string     `json:"description"`
	Seller               string     `json:"seller"`
	SellerPubkey         string     `json:"sellerPubkey"`
	ListedAt             string     `json:"listedAt"`
	Size                 string     `json:"size,omitempty"`
	Condition            string     `json:"condition"`
	SellerReputation     int        `json:"sellerReputation"`
	QualityScore         int        `json:"qualityScore"`
	ShipFromCountry      string     `json:"shipFromCountry"`
	DeliverableCountries []string   `json:"deliverableCountries"`
	SellType             string     `json:"sellType"`
	ImageCIDs            []string   `json:"imageCids"`
	Tags                 []string   `json:"tags,omitempty"`
	Review               ReviewMeta `json:"review"`
}

type Store struct {
	cache *cache.Cache
}

func NewStore(c *cache.Cache) *Store {
	return &Store{cache: c}
}

func (s *Store) Save(p Product) error {
	data, err := json.Marshal(p)
	if err != nil {
		return err
	}
	s.cache.Set(FormatProductKey(p.ID), data, ttl)

	ids := s.loadIndex()
	found := false
	for _, id := range ids {
		if id == p.ID {
			found = true
			break
		}
	}
	if !found {
		ids = append([]string{p.ID}, ids...)
	}
	indexData, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	s.cache.Set(indexKey, indexData, ttl)
	return nil
}

func (s *Store) Get(id string) (Product, bool) {
	data, ok := s.cache.Get(FormatProductKey(id))
	if !ok {
		return Product{}, false
	}
	var p Product
	if err := json.Unmarshal(data, &p); err != nil {
		return Product{}, false
	}
	return p, true
}

func (s *Store) List() []Product {
	ids := s.loadIndex()
	out := make([]Product, 0, len(ids))
	for _, id := range ids {
		if p, ok := s.Get(id); ok {
			out = append(out, p)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].ListedAt > out[j].ListedAt
	})
	return out
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

func FormatProductKey(id string) string {
	return fmt.Sprintf("product:%s", id)
}

func Build(req CreateRequest, review agent.ReviewResult) (Product, error) {
	desc := strings.TrimSpace(req.Description)
	if desc == "" {
		return Product{}, fmt.Errorf("description required")
	}
	if req.SellerPubkey == "" {
		return Product{}, fmt.Errorf("seller_pubkey required")
	}
	if len(req.ImageCIDs) == 0 {
		return Product{}, fmt.Errorf("at least one image is required")
	}

	price, err := strconv.ParseFloat(strings.TrimSpace(req.Price), 64)
	if err != nil || price <= 0 {
		return Product{}, fmt.Errorf("valid price required")
	}

	name := deriveTitle(desc)
	category, feedType, tags := classify(desc)
	now := time.Now().UTC()
	id := fmt.Sprintf("local-%d-%s", now.UnixNano(), shortHash(req.SellerPubkey+desc))
	sellType := req.SellType
	if sellType == "" {
		sellType = "regular"
	}

	scoreSeed := int(hash32(req.SellerPubkey + desc))
	reputation := 78 + scoreSeed%18
	quality := 80 + (scoreSeed/7)%17

	return Product{
		ID:                   id,
		Name:                 name,
		Brand:                "EXORA LOCAL",
		Price:                price,
		Image:                "/v1/ipfs/" + req.ImageCIDs[0],
		Category:             category,
		FeedType:             feedType,
		Description:          desc,
		Seller:               req.SellerPubkey,
		SellerPubkey:         req.SellerPubkey,
		ListedAt:             now.Format(time.RFC3339),
		Condition:            "New",
		SellerReputation:     reputation,
		QualityScore:         quality,
		ShipFromCountry:      "Local",
		DeliverableCountries: deriveDelivery(req.ShippingRegionConfig),
		SellType:             sellType,
		ImageCIDs:            req.ImageCIDs,
		Tags:                 tags,
		Review: ReviewMeta{
			Approved:    review.Approved,
			Reason:      review.Reason,
			MinerPubkey: review.MinerPubkey,
			Timestamp:   review.Timestamp,
		},
	}, nil
}

func deriveTitle(desc string) string {
	cleaned := strings.Join(strings.Fields(desc), " ")
	for _, sep := range []string{".", ",", "\n"} {
		if idx := strings.Index(cleaned, sep); idx > 0 {
			cleaned = cleaned[:idx]
			break
		}
	}
	if len(cleaned) > 56 {
		cleaned = strings.TrimSpace(cleaned[:56])
	}
	if cleaned == "" {
		return "Local Listing"
	}
	return cleaned
}

func classify(desc string) (string, string, []string) {
	lower := strings.ToLower(desc)
	rules := []struct {
		terms    []string
		category string
		feedType string
	}{
		{[]string{"phone", "iphone", "laptop", "camera", "keyboard", "monitor", "ssd", "headphone", "earbud"}, "Electronics", "electronics"},
		{[]string{"dress", "shirt", "hoodie", "jacket", "shoe", "bag", "watch"}, "Fashion", "mensFashion"},
		{[]string{"coffee", "tea", "wine", "whisky", "beer"}, "Beverages", "beverages"},
		{[]string{"serum", "skin", "fragrance", "makeup"}, "Beauty", "beauty"},
		{[]string{"bike", "fitness", "yoga", "running"}, "Sports", "sports"},
		{[]string{"game", "controller", "console"}, "Gaming", "gaming"},
		{[]string{"chair", "desk", "lamp", "kitchen", "bedding"}, "Home Living", "homeLiving"},
	}
	for _, rule := range rules {
		for _, term := range rule.terms {
			if strings.Contains(lower, term) {
				return rule.category, rule.feedType, []string{rule.feedType, "local"}
			}
		}
	}
	return "Collectibles", "collectibles", []string{"collectibles", "local"}
}

func deriveDelivery(cfg ShippingRegionConfig) []string {
	if cfg.Type == "regions" && len(cfg.SelectedRegions) > 0 {
		out := make([]string, 0, len(cfg.SelectedRegions))
		for _, region := range cfg.SelectedRegions {
			out = append(out, titleWords(strings.ReplaceAll(region, "-", " ")))
		}
		return out
	}
	return []string{"Local"}
}

func shortHash(value string) string {
	sum := hash32(value)
	return fmt.Sprintf("%08x", sum)
}

func hash32(value string) uint32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(value))
	return h.Sum32()
}

func titleWords(value string) string {
	words := strings.Fields(value)
	for i, word := range words {
		if word == "" {
			continue
		}
		words[i] = strings.ToUpper(word[:1]) + strings.ToLower(word[1:])
	}
	return strings.Join(words, " ")
}
