package payment

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/approval"
	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/gagliardetto/solana-go"
)

const (
	indexKey = "payments:index"
	ttl      = 365 * 24 * time.Hour
)

type Status string

const (
	StatusRequiresConfirmation Status = "requires_confirmation"
	StatusConfirmedSimulated   Status = "confirmed_simulated"
	StatusChainIntentCreated   Status = "chain_intent_created"
	StatusChainConfirming      Status = "chain_confirming"
	StatusChainConfirmed       Status = "chain_confirmed"
	StatusEvidenceMismatch     Status = "evidence_mismatch"
)

type EvidenceStatus string

const (
	EvidencePendingChainConfirmation EvidenceStatus = "pending_chain_confirmation"
	EvidenceFoundFinalized           EvidenceStatus = "found_finalized"
	EvidenceNotFound                 EvidenceStatus = "not_found"
	EvidenceMismatch                 EvidenceStatus = "mismatch"
	EvidenceReleased                 EvidenceStatus = "released"
	EvidenceRefunded                 EvidenceStatus = "refunded"
)

type ChainIntentRequest struct {
	BuyerPubkey    string `json:"buyerPubkey,omitempty"`
	SellerPubkey   string `json:"sellerPubkey,omitempty"`
	AmountLamports uint64 `json:"amountLamports,omitempty"`
	AmountAtomic   uint64 `json:"amountAtomic,omitempty"`
	Currency       string `json:"currency,omitempty"`
	Mint           string `json:"mint,omitempty"`
	Decimals       uint8  `json:"decimals,omitempty"`
	NativeSOL      bool   `json:"nativeSol,omitempty"`
	Network        string `json:"network,omitempty"`
	ProgramID      string `json:"programId,omitempty"`
	OrderPlanID    string `json:"orderPlanId,omitempty"`
	TaskID         string `json:"taskId,omitempty"`
}

type PaymentIntent struct {
	PaymentID           string `json:"paymentId"`
	OrderPlanID         string `json:"orderPlanId,omitempty"`
	TaskID              string `json:"taskId,omitempty"`
	BuyerPubkey         string `json:"buyerPubkey,omitempty"`
	SellerPubkey        string `json:"sellerPubkey,omitempty"`
	AmountLamports      uint64 `json:"amountLamports,omitempty"`
	AmountAtomic        uint64 `json:"amountAtomic,omitempty"`
	Currency            string `json:"currency,omitempty"`
	Mint                string `json:"mint,omitempty"`
	Decimals            uint8  `json:"decimals,omitempty"`
	NativeSOL           bool   `json:"nativeSol,omitempty"`
	Chain               string `json:"chain"`
	Network             string `json:"network,omitempty"`
	ProgramID           string `json:"programId,omitempty"`
	EscrowPDA           string `json:"escrowPda,omitempty"`
	CanonicalIntentHash string `json:"canonicalIntentHash"`
}

type PaymentEvidence struct {
	EvidenceID     string         `json:"evidenceId,omitempty"`
	PaymentID      string         `json:"paymentId"`
	Status         EvidenceStatus `json:"status"`
	Chain          string         `json:"chain,omitempty"`
	Network        string         `json:"network,omitempty"`
	ProgramID      string         `json:"programId,omitempty"`
	EscrowPDA      string         `json:"escrowPda,omitempty"`
	TxSignature    string         `json:"txSignature,omitempty"`
	Slot           uint64         `json:"slot,omitempty"`
	Finality       string         `json:"finality,omitempty"`
	BuyerPubkey    string         `json:"buyerPubkey,omitempty"`
	SellerPubkey   string         `json:"sellerPubkey,omitempty"`
	AmountLamports uint64         `json:"amountLamports,omitempty"`
	AmountAtomic   uint64         `json:"amountAtomic,omitempty"`
	Currency       string         `json:"currency,omitempty"`
	Mint           string         `json:"mint,omitempty"`
	Decimals       uint8          `json:"decimals,omitempty"`
	NativeSOL      bool           `json:"nativeSol,omitempty"`
	ContentHash    string         `json:"contentHash,omitempty"`
	Source         string         `json:"source,omitempty"`
	FoundAt        string         `json:"foundAt,omitempty"`
	UpdatedAt      string         `json:"updatedAt,omitempty"`
}

type Record struct {
	ID             string         `json:"paymentId"`
	ApprovalID     string         `json:"approvalId"`
	TaskID         string         `json:"taskId"`
	ProviderPubkey string         `json:"providerPubkey,omitempty"`
	BuyerPubkey    string         `json:"buyerPubkey,omitempty"`
	Amount         float64        `json:"amount,omitempty"`
	Currency       string         `json:"currency,omitempty"`
	AmountLamports uint64         `json:"amountLamports,omitempty"`
	AmountAtomic   uint64         `json:"amountAtomic,omitempty"`
	Mint           string         `json:"mint,omitempty"`
	Decimals       uint8          `json:"decimals,omitempty"`
	NativeSOL      bool           `json:"nativeSol,omitempty"`
	Mode           string         `json:"mode"`
	Status         Status         `json:"status"`
	ProofRef       string         `json:"proofRef,omitempty"`
	Chain          string         `json:"chain,omitempty"`
	Network        string         `json:"network,omitempty"`
	ProgramID      string         `json:"programId,omitempty"`
	EscrowPDA      string         `json:"escrowPda,omitempty"`
	TxSignature    string         `json:"txSignature,omitempty"`
	Slot           uint64         `json:"slot,omitempty"`
	Finality       string         `json:"finality,omitempty"`
	IntentHash     string         `json:"intentHash,omitempty"`
	EvidenceID     string         `json:"evidenceId,omitempty"`
	EvidenceStatus EvidenceStatus `json:"evidenceStatus,omitempty"`
	CreatedAt      string         `json:"createdAt"`
	UpdatedAt      string         `json:"updatedAt"`
	ConfirmedAt    string         `json:"confirmedAt,omitempty"`
}

type ListFilter struct {
	ApprovalID string
	TaskID     string
}

type Store struct {
	cache *cache.Cache
}

func NewStore(c *cache.Cache) *Store {
	return &Store{cache: c}
}

func (s *Store) EnsureIntent(a approval.Approval) (Record, error) {
	if !a.PaymentRequired {
		return Record{}, fmt.Errorf("payment is not required")
	}
	if existing, ok := s.GetByApproval(a.ID); ok {
		return existing, nil
	}
	now := time.Now().UTC()
	record := Record{
		ID:             fmt.Sprintf("pay-%d-%s", now.UnixNano(), shortHash(a.ID+a.TaskID)),
		ApprovalID:     a.ID,
		TaskID:         a.TaskID,
		ProviderPubkey: firstNonEmpty(a.ProviderPubkey, a.Quote.ProviderPubkey),
		BuyerPubkey:    firstNonEmpty(a.UserPubkey),
		Amount:         firstPositive(a.Amount.Value, a.Quote.PriceAmount),
		Currency:       strings.TrimSpace(a.Amount.Currency),
		Mode:           "simulated",
		Status:         StatusRequiresConfirmation,
		CreatedAt:      now.Format(time.RFC3339),
		UpdatedAt:      now.Format(time.RFC3339),
	}
	if record.Currency == "" {
		record.Currency = strings.TrimSpace(a.Quote.Currency)
	}
	return record, s.Save(record)
}

func (s *Store) EnsureChainIntent(a approval.Approval, req ChainIntentRequest) (Record, PaymentIntent, error) {
	record, err := s.EnsureIntent(a)
	if err != nil {
		return Record{}, PaymentIntent{}, err
	}
	if strings.TrimSpace(req.TaskID) == "" {
		req.TaskID = record.TaskID
	}
	return s.AttachChainIntent(record.ID, req)
}

func (s *Store) AttachChainIntent(paymentID string, req ChainIntentRequest) (Record, PaymentIntent, error) {
	record, ok := s.Get(paymentID)
	if !ok {
		return Record{}, PaymentIntent{}, fmt.Errorf("payment not found")
	}
	intent, err := BuildPaymentIntent(record, req)
	if err != nil {
		return Record{}, PaymentIntent{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	record.Mode = "chain_escrow"
	record.Status = StatusChainIntentCreated
	record.Chain = intent.Chain
	record.Network = intent.Network
	record.ProgramID = intent.ProgramID
	record.EscrowPDA = intent.EscrowPDA
	record.IntentHash = intent.CanonicalIntentHash
	record.AmountLamports = intent.AmountLamports
	record.AmountAtomic = intent.AmountAtomic
	record.Currency = firstNonEmpty(intent.Currency, record.Currency)
	record.Mint = intent.Mint
	record.Decimals = intent.Decimals
	record.NativeSOL = intent.NativeSOL
	record.BuyerPubkey = firstNonEmpty(intent.BuyerPubkey, record.BuyerPubkey)
	record.ProviderPubkey = firstNonEmpty(intent.SellerPubkey, record.ProviderPubkey)
	record.EvidenceStatus = EvidencePendingChainConfirmation
	record.UpdatedAt = now
	return record, intent, s.Save(record)
}

func BuildPaymentIntent(record Record, req ChainIntentRequest) (PaymentIntent, error) {
	paymentID := strings.TrimSpace(record.ID)
	if paymentID == "" {
		return PaymentIntent{}, fmt.Errorf("paymentId required")
	}
	programID := strings.TrimSpace(req.ProgramID)
	escrowPDA := ""
	if programID != "" {
		pda, err := DeriveEscrowPDA(paymentID, programID)
		if err != nil {
			return PaymentIntent{}, err
		}
		escrowPDA = pda
	}
	currency := firstNonEmpty(req.Currency, record.Currency)
	amountLamports := firstPositiveUint64(req.AmountLamports, record.AmountLamports, LamportsFromAmount(record.Amount, currency))
	amountAtomic := firstPositiveUint64(req.AmountAtomic, record.AmountAtomic, amountLamports)
	nativeSOL := req.NativeSOL || record.NativeSOL || strings.EqualFold(strings.TrimSpace(currency), "sol") || strings.EqualFold(strings.TrimSpace(currency), "lamport") || strings.EqualFold(strings.TrimSpace(currency), "lamports")
	mint := firstNonEmpty(req.Mint, record.Mint)
	decimals := req.Decimals
	if decimals == 0 {
		decimals = record.Decimals
	}
	if nativeSOL {
		mint = ""
		decimals = 9
		amountAtomic = firstPositiveUint64(req.AmountAtomic, record.AmountAtomic, amountLamports)
	} else if amountAtomic == amountLamports && amountLamports > 0 && strings.EqualFold(currency, "usdc") {
		amountLamports = 0
	}
	intent := PaymentIntent{
		PaymentID:      paymentID,
		OrderPlanID:    strings.TrimSpace(req.OrderPlanID),
		TaskID:         firstNonEmpty(req.TaskID, record.TaskID),
		BuyerPubkey:    firstNonEmpty(req.BuyerPubkey, record.BuyerPubkey),
		SellerPubkey:   firstNonEmpty(req.SellerPubkey, record.ProviderPubkey),
		AmountLamports: amountLamports,
		AmountAtomic:   amountAtomic,
		Currency:       currency,
		Mint:           mint,
		Decimals:       decimals,
		NativeSOL:      nativeSOL,
		Chain:          "solana",
		Network:        firstNonEmpty(req.Network, record.Network, "devnet"),
		ProgramID:      programID,
		EscrowPDA:      escrowPDA,
	}
	intent.CanonicalIntentHash = CanonicalIntentHash(intent)
	return intent, nil
}

func (s *Store) ConfirmSimulated(a approval.Approval) (Record, error) {
	record, err := s.EnsureIntent(a)
	if err != nil {
		return Record{}, err
	}
	now := time.Now().UTC()
	record.Status = StatusConfirmedSimulated
	record.ProofRef = "simulated:" + shortHash(record.ID+now.Format(time.RFC3339Nano))
	record.UpdatedAt = now.Format(time.RFC3339)
	record.ConfirmedAt = now.Format(time.RFC3339)
	return record, s.Save(record)
}

func (s *Store) MarkChainConfirming(paymentID, txSignature string, slot uint64) (Record, error) {
	record, ok := s.Get(paymentID)
	if !ok {
		return Record{}, fmt.Errorf("payment not found")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	record.Mode = "chain_escrow"
	record.Status = StatusChainConfirming
	record.TxSignature = strings.TrimSpace(txSignature)
	record.Slot = slot
	record.EvidenceStatus = EvidencePendingChainConfirmation
	record.UpdatedAt = now
	return record, s.Save(record)
}

func (s *Store) ApplyEvidence(evidence PaymentEvidence) (Record, error) {
	paymentID := strings.TrimSpace(evidence.PaymentID)
	if paymentID == "" {
		return Record{}, fmt.Errorf("paymentId required")
	}
	record, ok := s.Get(paymentID)
	if !ok {
		return Record{}, fmt.Errorf("payment not found")
	}
	if err := VerifyEvidenceMatches(record, evidence); err != nil {
		record.Status = StatusEvidenceMismatch
		record.EvidenceStatus = EvidenceMismatch
		record.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		_ = s.Save(record)
		return record, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	record.Mode = "chain_escrow"
	record.Chain = firstNonEmpty(evidence.Chain, record.Chain, "solana")
	record.Network = firstNonEmpty(evidence.Network, record.Network)
	record.ProgramID = firstNonEmpty(evidence.ProgramID, record.ProgramID)
	record.EscrowPDA = firstNonEmpty(evidence.EscrowPDA, record.EscrowPDA)
	record.TxSignature = firstNonEmpty(evidence.TxSignature, record.TxSignature)
	record.Slot = firstPositiveUint64(evidence.Slot, record.Slot)
	record.Finality = firstNonEmpty(evidence.Finality, record.Finality)
	record.BuyerPubkey = firstNonEmpty(evidence.BuyerPubkey, record.BuyerPubkey)
	record.ProviderPubkey = firstNonEmpty(evidence.SellerPubkey, record.ProviderPubkey)
	record.AmountLamports = firstPositiveUint64(evidence.AmountLamports, record.AmountLamports)
	record.AmountAtomic = firstPositiveUint64(evidence.AmountAtomic, record.AmountAtomic, record.AmountLamports)
	record.Currency = firstNonEmpty(evidence.Currency, record.Currency)
	record.Mint = firstNonEmpty(evidence.Mint, record.Mint)
	if evidence.Decimals != 0 {
		record.Decimals = evidence.Decimals
	}
	if evidence.NativeSOL {
		record.NativeSOL = true
	}
	record.EvidenceID = firstNonEmpty(evidence.EvidenceID, record.EvidenceID)
	record.EvidenceStatus = evidence.Status
	record.UpdatedAt = now
	switch evidence.Status {
	case EvidenceFoundFinalized, EvidenceReleased, EvidenceRefunded:
		record.Status = StatusChainConfirmed
		record.ConfirmedAt = firstNonEmpty(evidence.FoundAt, now)
	case EvidenceMismatch:
		record.Status = StatusEvidenceMismatch
	default:
		record.Status = StatusChainConfirming
	}
	return record, s.Save(record)
}

func (s *Store) Save(record Record) error {
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	s.cache.Set(FormatPaymentKey(record.ID), data, ttl)
	ids := s.loadIndex()
	found := false
	for _, id := range ids {
		if id == record.ID {
			found = true
			break
		}
	}
	if !found {
		ids = append([]string{record.ID}, ids...)
	}
	indexData, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	s.cache.Set(indexKey, indexData, ttl)
	return nil
}

func (s *Store) Get(id string) (Record, bool) {
	data, ok := s.cache.Get(FormatPaymentKey(id))
	if !ok {
		return Record{}, false
	}
	var record Record
	if err := json.Unmarshal(data, &record); err != nil {
		return Record{}, false
	}
	return record, true
}

func (s *Store) GetByApproval(approvalID string) (Record, bool) {
	for _, record := range s.List(ListFilter{ApprovalID: approvalID}) {
		return record, true
	}
	return Record{}, false
}

func (s *Store) List(filter ListFilter) []Record {
	ids := s.loadIndex()
	out := make([]Record, 0, len(ids))
	for _, id := range ids {
		record, ok := s.Get(id)
		if !ok {
			continue
		}
		if filter.ApprovalID != "" && record.ApprovalID != filter.ApprovalID {
			continue
		}
		if filter.TaskID != "" && record.TaskID != filter.TaskID {
			continue
		}
		out = append(out, record)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].CreatedAt > out[j].CreatedAt
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

func FormatPaymentKey(id string) string {
	return fmt.Sprintf("payment:%s", id)
}

func PaymentIDHash(paymentID string) []byte {
	sum := sha256.Sum256([]byte(strings.TrimSpace(paymentID)))
	return sum[:]
}

func PaymentIDHashHex(paymentID string) string {
	return hex.EncodeToString(PaymentIDHash(paymentID))
}

func DeriveEscrowPDA(paymentID, programID string) (string, error) {
	programID = strings.TrimSpace(programID)
	if programID == "" {
		return "", fmt.Errorf("programId required")
	}
	program, err := solana.PublicKeyFromBase58(programID)
	if err != nil {
		return "", fmt.Errorf("invalid programId: %w", err)
	}
	pda, _, err := solana.FindProgramAddress([][]byte{[]byte("exora_escrow"), PaymentIDHash(paymentID)}, program)
	if err != nil {
		return "", err
	}
	return pda.String(), nil
}

func CanonicalIntentHash(intent PaymentIntent) string {
	canonical := struct {
		PaymentID      string `json:"paymentId"`
		OrderPlanID    string `json:"orderPlanId,omitempty"`
		TaskID         string `json:"taskId,omitempty"`
		BuyerPubkey    string `json:"buyerPubkey,omitempty"`
		SellerPubkey   string `json:"sellerPubkey,omitempty"`
		AmountLamports uint64 `json:"amountLamports,omitempty"`
		AmountAtomic   uint64 `json:"amountAtomic,omitempty"`
		Currency       string `json:"currency,omitempty"`
		Mint           string `json:"mint,omitempty"`
		Decimals       uint8  `json:"decimals,omitempty"`
		NativeSOL      bool   `json:"nativeSol,omitempty"`
		Chain          string `json:"chain"`
		Network        string `json:"network,omitempty"`
		ProgramID      string `json:"programId,omitempty"`
		EscrowPDA      string `json:"escrowPda,omitempty"`
	}{
		PaymentID:      strings.TrimSpace(intent.PaymentID),
		OrderPlanID:    strings.TrimSpace(intent.OrderPlanID),
		TaskID:         strings.TrimSpace(intent.TaskID),
		BuyerPubkey:    strings.TrimSpace(intent.BuyerPubkey),
		SellerPubkey:   strings.TrimSpace(intent.SellerPubkey),
		AmountLamports: intent.AmountLamports,
		AmountAtomic:   intent.AmountAtomic,
		Currency:       strings.TrimSpace(intent.Currency),
		Mint:           strings.TrimSpace(intent.Mint),
		Decimals:       intent.Decimals,
		NativeSOL:      intent.NativeSOL,
		Chain:          firstNonEmpty(intent.Chain, "solana"),
		Network:        strings.TrimSpace(intent.Network),
		ProgramID:      strings.TrimSpace(intent.ProgramID),
		EscrowPDA:      strings.TrimSpace(intent.EscrowPDA),
	}
	data, _ := json.Marshal(canonical)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func LamportsFromAmount(amount float64, currency string) uint64 {
	if amount <= 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		return 0
	}
	switch strings.ToLower(strings.TrimSpace(currency)) {
	case "sol":
		return uint64(math.Round(amount * 1_000_000_000))
	case "lamport", "lamports":
		return uint64(math.Round(amount))
	default:
		return 0
	}
}

func AtomicAmountFromAmount(amount float64, currency string, usdcMint string, usdcDecimals uint8) (amountAtomic uint64, mint string, decimals uint8, nativeSOL bool) {
	if amount <= 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		return 0, "", 0, false
	}
	switch strings.ToLower(strings.TrimSpace(currency)) {
	case "sol":
		return uint64(math.Round(amount * 1_000_000_000)), "", 9, true
	case "lamport", "lamports":
		return uint64(math.Round(amount)), "", 9, true
	case "usdc", "usd":
		mint = strings.TrimSpace(usdcMint)
		if mint == "" {
			return 0, "", 0, false
		}
		decimals = usdcDecimals
		if decimals == 0 {
			decimals = 6
		}
		scale := math.Pow10(int(decimals))
		return uint64(math.Round(amount * scale)), mint, decimals, false
	default:
		return 0, "", 0, false
	}
}

func VerifyEvidenceMatches(record Record, evidence PaymentEvidence) error {
	if strings.TrimSpace(record.ID) != strings.TrimSpace(evidence.PaymentID) {
		return fmt.Errorf("payment evidence paymentId mismatch")
	}
	if record.EscrowPDA != "" && evidence.EscrowPDA != "" && record.EscrowPDA != evidence.EscrowPDA {
		return fmt.Errorf("payment evidence escrowPda mismatch")
	}
	if record.ProgramID != "" && evidence.ProgramID != "" && record.ProgramID != evidence.ProgramID {
		return fmt.Errorf("payment evidence programId mismatch")
	}
	if record.BuyerPubkey != "" && evidence.BuyerPubkey != "" && record.BuyerPubkey != evidence.BuyerPubkey {
		return fmt.Errorf("payment evidence buyer mismatch")
	}
	if record.ProviderPubkey != "" && evidence.SellerPubkey != "" && record.ProviderPubkey != evidence.SellerPubkey {
		return fmt.Errorf("payment evidence seller mismatch")
	}
	if record.AmountLamports > 0 && evidence.AmountLamports > 0 && record.AmountLamports != evidence.AmountLamports {
		return fmt.Errorf("payment evidence amount mismatch")
	}
	if record.AmountAtomic > 0 && evidence.AmountAtomic > 0 && record.AmountAtomic != evidence.AmountAtomic {
		return fmt.Errorf("payment evidence amount mismatch")
	}
	if record.Mint != "" && evidence.Mint != "" && record.Mint != evidence.Mint {
		return fmt.Errorf("payment evidence mint mismatch")
	}
	if record.NativeSOL && evidence.Mint != "" {
		return fmt.Errorf("payment evidence currency mismatch")
	}
	return nil
}

func shortHash(value string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(value))
	return fmt.Sprintf("%08x", h.Sum32())
}

func firstPositive(values ...float64) float64 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func firstPositiveUint64(values ...uint64) uint64 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
