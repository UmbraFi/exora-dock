package providerprotocol

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/market"
	"github.com/exora-dock/exora-dock/internal/task"
	"github.com/gagliardetto/solana-go"
)

const (
	QuoteRequestPurpose       = "exora.provider.quote-request.v1"
	QuoteReplyPurpose         = "exora.provider.quote-reply.v1"
	NegotiationRequestPurpose = "exora.provider.negotiation-request.v1"
	NegotiationReplyPurpose   = "exora.provider.negotiation-reply.v1"
	JobRequestPurpose         = "exora.provider.job-request.v1"
	MaxClockSkew              = 5 * time.Minute
)

type QuoteRequest struct {
	RequestID       string            `json:"requestId"`
	RequesterPubkey string            `json:"requesterPubkey"`
	AgentID         string            `json:"agentId,omitempty"`
	ProviderPubkey  string            `json:"providerPubkey"`
	ResourceID      string            `json:"resourceId"`
	Draft           market.OrderDraft `json:"draft"`
	Timestamp       string            `json:"timestamp"`
	Signature       string            `json:"signature"`
}

type QuoteReply struct {
	RequestID        string             `json:"requestId"`
	Status           string             `json:"status"`
	ProviderPubkey   string             `json:"providerPubkey"`
	ResourceID       string             `json:"resourceId,omitempty"`
	PriceAmount      float64            `json:"priceAmount,omitempty"`
	Currency         string             `json:"currency,omitempty"`
	EstimatedSeconds int                `json:"estimatedSeconds,omitempty"`
	Notes            string             `json:"notes,omitempty"`
	ExpiresAt        string             `json:"expiresAt,omitempty"`
	Runtime          string             `json:"runtime,omitempty"`
	Docker           task.DockerRunSpec `json:"docker,omitempty"`
	Error            string             `json:"error,omitempty"`
	Timestamp        string             `json:"timestamp"`
	Signature        string             `json:"signature,omitempty"`
}

type NegotiationMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type NegotiationRequest struct {
	NegotiationID     string               `json:"negotiationId"`
	RequesterPubkey   string               `json:"requesterPubkey"`
	AgentID           string               `json:"agentId,omitempty"`
	BuyerAgentCardID  string               `json:"buyerAgentCardId,omitempty"`
	SellerAgentCardID string               `json:"sellerAgentCardId,omitempty"`
	ProviderPubkey    string               `json:"providerPubkey"`
	ResourceID        string               `json:"resourceId,omitempty"`
	Intent            string               `json:"intent"`
	Draft             market.OrderDraft    `json:"draft"`
	Messages          []NegotiationMessage `json:"messages,omitempty"`
	ExpiresAt         string               `json:"expiresAt,omitempty"`
	Timestamp         string               `json:"timestamp"`
	Signature         string               `json:"signature"`
}

type NegotiationReply struct {
	NegotiationID          string             `json:"negotiationId"`
	Status                 string             `json:"status"`
	ProviderPubkey         string             `json:"providerPubkey"`
	ResourceID             string             `json:"resourceId,omitempty"`
	QuoteID                string             `json:"quoteId,omitempty"`
	PriceAmount            float64            `json:"priceAmount,omitempty"`
	Currency               string             `json:"currency,omitempty"`
	EstimatedSeconds       int                `json:"estimatedSeconds,omitempty"`
	RequiredInputs         []string           `json:"requiredInputs,omitempty"`
	RequiredPermissions    []string           `json:"requiredPermissions,omitempty"`
	ExecutionPlanSummary   string             `json:"executionPlanSummary,omitempty"`
	FailurePolicy          string             `json:"failurePolicy,omitempty"`
	DeliveryFormat         string             `json:"deliveryFormat,omitempty"`
	DataProvenance         string             `json:"dataProvenance,omitempty"`
	RetentionCommitment    string             `json:"retentionCommitment,omitempty"`
	SellerApprovalMode     string             `json:"sellerApprovalMode,omitempty"`
	ValuationDecision      string             `json:"valuationDecision,omitempty"`
	SellerAgentCardID      string             `json:"sellerAgentCardId,omitempty"`
	CapabilitySummary      string             `json:"capabilitySummary,omitempty"`
	PricingPolicyID        string             `json:"pricingPolicyId,omitempty"`
	ValuationHash          string             `json:"valuationHash,omitempty"`
	QuoteBindingHash       string             `json:"quoteBindingHash,omitempty"`
	Notes                  string             `json:"notes,omitempty"`
	Runtime                string             `json:"runtime,omitempty"`
	Docker                 task.DockerRunSpec `json:"docker,omitempty"`
	ExpiresAt              string             `json:"expiresAt,omitempty"`
	RejectReason           string             `json:"rejectReason,omitempty"`
	RejectRiskSummary      string             `json:"rejectRiskSummary,omitempty"`
	RejectMissingInputs    []string           `json:"rejectMissingInputs,omitempty"`
	NeedsNegotiationReason string             `json:"needsNegotiationReason,omitempty"`
	Error                  string             `json:"error,omitempty"`
	Timestamp              string             `json:"timestamp"`
	Signature              string             `json:"signature,omitempty"`
}

type JobRequest struct {
	RequestID       string            `json:"requestId"`
	RequesterPubkey string            `json:"requesterPubkey"`
	AgentID         string            `json:"agentId,omitempty"`
	ProviderPubkey  string            `json:"providerPubkey"`
	ResourceID      string            `json:"resourceId"`
	Draft           market.OrderDraft `json:"draft"`
	QuoteID         string            `json:"quoteId,omitempty"`
	ApprovalID      string            `json:"approvalId,omitempty"`
	PaymentID       string            `json:"paymentId,omitempty"`
	PaymentEvidence *PaymentEvidence  `json:"paymentEvidence,omitempty"`
	Timestamp       string            `json:"timestamp"`
	Signature       string            `json:"signature"`
}

type PaymentEvidence struct {
	EvidenceID     string `json:"evidenceId,omitempty"`
	PaymentID      string `json:"paymentId,omitempty"`
	Status         string `json:"status,omitempty"`
	Chain          string `json:"chain,omitempty"`
	Network        string `json:"network,omitempty"`
	ProgramID      string `json:"programId,omitempty"`
	EscrowPDA      string `json:"escrowPda,omitempty"`
	TxSignature    string `json:"txSignature,omitempty"`
	Slot           uint64 `json:"slot,omitempty"`
	Finality       string `json:"finality,omitempty"`
	BuyerPubkey    string `json:"buyerPubkey,omitempty"`
	SellerPubkey   string `json:"sellerPubkey,omitempty"`
	AmountLamports uint64 `json:"amountLamports,omitempty"`
	AmountAtomic   uint64 `json:"amountAtomic,omitempty"`
	Currency       string `json:"currency,omitempty"`
	Mint           string `json:"mint,omitempty"`
	Decimals       uint8  `json:"decimals,omitempty"`
	NativeSOL      bool   `json:"nativeSol,omitempty"`
	ContentHash    string `json:"contentHash,omitempty"`
	Source         string `json:"source,omitempty"`
}

type JobReply struct {
	JobID          string `json:"jobId"`
	TaskID         string `json:"taskId"`
	Status         string `json:"status"`
	ProviderPubkey string `json:"providerPubkey,omitempty"`
	NextAction     string `json:"nextAction,omitempty"`
}

func QuoteRequestPayload(req QuoteRequest) ([]byte, error) {
	req.Signature = ""
	return canonical(QuoteRequestPurpose, req)
}

func QuoteReplyPayload(reply QuoteReply) ([]byte, error) {
	reply.Signature = ""
	return canonical(QuoteReplyPurpose, reply)
}

func NegotiationRequestPayload(req NegotiationRequest) ([]byte, error) {
	req.Signature = ""
	return canonical(NegotiationRequestPurpose, req)
}

func NegotiationReplyPayload(reply NegotiationReply) ([]byte, error) {
	reply.Signature = ""
	return canonical(NegotiationReplyPurpose, reply)
}

func JobRequestPayload(req JobRequest) ([]byte, error) {
	req.Signature = ""
	return canonical(JobRequestPurpose, req)
}

func Verify(pubkey string, signature string, payload []byte) error {
	pubkey = strings.TrimSpace(pubkey)
	signature = strings.TrimSpace(signature)
	if pubkey == "" {
		return fmt.Errorf("pubkey required")
	}
	if signature == "" {
		return fmt.Errorf("signature required")
	}
	publicKey, err := solana.PublicKeyFromBase58(pubkey)
	if err != nil {
		return fmt.Errorf("invalid pubkey: %w", err)
	}
	sig, err := solana.SignatureFromBase58(signature)
	if err != nil {
		return fmt.Errorf("invalid signature: %w", err)
	}
	if !sig.Verify(publicKey, payload) {
		return fmt.Errorf("signature verification failed")
	}
	return nil
}

func ValidateTimestamp(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return fmt.Errorf("timestamp required")
	}
	ts, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return fmt.Errorf("timestamp must be RFC3339")
	}
	now := time.Now().UTC()
	if ts.Before(now.Add(-MaxClockSkew)) || ts.After(now.Add(MaxClockSkew)) {
		return fmt.Errorf("timestamp outside allowed clock skew")
	}
	return nil
}

func canonical(purpose string, value any) ([]byte, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	out := append([]byte(purpose), '\n')
	out = append(out, data...)
	return out, nil
}
