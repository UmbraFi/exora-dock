package api

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/buyerflow"
	"github.com/go-chi/chi/v5"
)

func decodeJSONBody(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body, 2<<20))
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}
func writeBuyerFlowError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeBuyerFlowError(w, status, message)
}

func (h *Handler) CreateBuyerFlow(w http.ResponseWriter, r *http.Request) {
	var req buyerflow.CreateRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeBuyerFlowError(w, http.StatusBadRequest, err.Error())
		return
	}
	f, err := h.buyerFlows.Create(req)
	if err != nil {
		writeBuyerFlowError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, f)
}
func (h *Handler) ListBuyerFlows(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.buyerFlows.List())
}
func (h *Handler) GetBuyerFlow(w http.ResponseWriter, r *http.Request) {
	f, ok := h.buyerFlows.Get(chi.URLParam(r, "id"))
	if !ok {
		writeBuyerFlowError(w, http.StatusNotFound, "buyer flow not found")
		return
	}
	writeJSON(w, http.StatusOK, f)
}

func (h *Handler) ApproveBuyerPlans(w http.ResponseWriter, r *http.Request) {
	h.updateBuyerFlow(w, r, func(f *buyerflow.Flow) error {
		if f.Phase != buyerflow.PhasePlanning || f.State != "plan_review" {
			return fmt.Errorf("plans can only be approved during plan review")
		}
		f.Phase = buyerflow.PhasePreparing
		f.State = "preparing"
		f.NextAction = "prepare_materials"
		f.AddEvent("plans.approved", "Buyer approved both linked plans")
		return nil
	})
}

func (h *Handler) PrepareBuyerBundle(w http.ResponseWriter, r *http.Request) {
	h.updateBuyerFlow(w, r, func(f *buyerflow.Flow) error {
		if f.Phase != buyerflow.PhasePreparing || f.State != "preparing" {
			return fmt.Errorf("materials can only be prepared after plan approval")
		}
		root, err := lockedWorkspace(f.WorkspacePath)
		if err != nil {
			return err
		}
		dir := filepath.Join(root, ".exora", "buyer-flows", f.FlowID)
		if err = os.MkdirAll(dir, 0700); err != nil {
			return err
		}
		remote, _ := json.MarshalIndent(f.Plans.RemoteExecutionPlan, "", "  ")
		if err = os.WriteFile(filepath.Join(dir, "remote_execution_plan.json"), remote, 0600); err != nil {
			return err
		}
		files := []buyerflow.PreparedFile{{LogicalName: "remote_execution_plan", RelativePath: filepath.ToSlash(filepath.Join(".exora", "buyer-flows", f.FlowID, "remote_execution_plan.json")), SHA256: buyerflow.Hash(remote), SizeBytes: int64(len(remote)), Purpose: "Instructions for the selected remote seller", Approved: false}}
		materialsDir := filepath.Join(dir, "materials")
		if err = os.MkdirAll(materialsDir, 0700); err != nil {
			return err
		}
		for _, spec := range f.Plans.LocalPreparationPlan.FilesToPrepare {
			name := safeName(spec.LogicalName)
			content := []byte(fmt.Sprintf("Material: %s\nPurpose: %s\nStatus: prepared placeholder; source was unavailable or intentionally not disclosed.\n", spec.LogicalName, spec.Purpose))
			if source, ok := workspaceSource(root, spec.SourceHint); ok {
				if raw, readErr := os.ReadFile(source); readErr == nil {
					content = raw
					if ext := filepath.Ext(source); ext != "" && filepath.Ext(name) == "" {
						name += ext
					}
				}
			}
			target := filepath.Join(materialsDir, name)
			if err = os.WriteFile(target, content, 0600); err != nil {
				return err
			}
			files = append(files, buyerflow.PreparedFile{LogicalName: spec.LogicalName, RelativePath: filepath.ToSlash(filepath.Join(".exora", "buyer-flows", f.FlowID, "materials", name)), SHA256: buyerflow.Hash(content), SizeBytes: int64(len(content)), Purpose: spec.Purpose, Approved: false})
		}
		b := buyerflow.PreparedBundleManifest{BundleID: "bundle-" + strings.TrimPrefix(f.FlowID, "bf-"), PlanHash: f.Plans.PlanHash, Files: files, Redactions: []string{"absolute workspace paths", "local preparation plan", "credentials and secrets"}}
		b.BundleHash = buyerflow.Hash(b.PlanHash, b.Files, b.Redactions)
		f.Bundle = &b
		f.State = "waiting_bundle_review"
		f.NextAction = "review_remote_bundle"
		f.AddEvent("bundle.prepared", "Local Agent prepared a disclosure-safe remote bundle for review")
		return nil
	})
}

func (h *Handler) ApproveBuyerBundle(w http.ResponseWriter, r *http.Request) {
	h.updateBuyerFlow(w, r, func(f *buyerflow.Flow) error {
		if f.Phase != buyerflow.PhasePreparing || f.State != "waiting_bundle_review" || f.Bundle == nil {
			return fmt.Errorf("no prepared bundle is awaiting review")
		}
		now := time.Now().UTC()
		f.Bundle.ApprovedAt = now.Format(time.RFC3339)
		for i := range f.Bundle.Files {
			f.Bundle.Files[i].Approved = true
		}
		f.Phase = buyerflow.PhaseMatching
		f.State = "dispatching"
		f.NextAction = "start_matching"
		f.AddEvent("bundle.approved", "Buyer approved the exact materials that may be disclosed")
		return nil
	})
}

func (h *Handler) StartBuyerMatching(w http.ResponseWriter, r *http.Request) {
	h.updateBuyerFlow(w, r, func(f *buyerflow.Flow) error {
		if f.Phase != buyerflow.PhaseMatching || f.State != "dispatching" || f.Bundle == nil || f.Bundle.ApprovedAt == "" {
			return fmt.Errorf("matching requires an approved remote bundle")
		}
		now := time.Now().UTC()
		deadline := now.Add(10 * time.Minute)
		if strings.EqualFold(r.URL.Query().Get("simulation"), "false") {
			f.QuoteDeadline = deadline.Format(time.RFC3339)
			f.Quotes = []buyerflow.Quote{}
			f.Sellers = []buyerflow.SellerParticipant{}
			f.State = "quote_review"
			f.NextAction = "wait_for_remote_seller_quotes"
			f.AddEvent("matching.remote_opened", "Remote matching opened for real seller quote submissions")
			return nil
		}
		settings := h.safeSellerSettings().(SellerAgentSettings)
		publishMode := quotePublishMode(settings.QuotePublishMode, settings.AutoQuote)
		f.QuoteDeadline = deadline.Format(time.RFC3339)
		f.Quotes = make([]buyerflow.Quote, 0, 3)
		f.Sellers = make([]buyerflow.SellerParticipant, 0, 3)
		for i := 1; i <= 3; i++ {
			amount := float64(8 + i*4)
			sellerID := fmt.Sprintf("local-seller-%d", i)
			sellerName := fmt.Sprintf("Local Seller %d", i)
			quoteID := fmt.Sprintf("quote-%s-%d", shortID(f.FlowID), i)
			status := "published"
			sellerState := "waiting_selection"
			publishedAt := now.Format(time.RFC3339)
			if publishMode == "manual_review" {
				status = "draft"
				sellerState = "draft"
				publishedAt = ""
			}
			version := buyerflow.QuoteVersion{Version: 1, Amount: amount, Currency: "USDC", ETAHours: 2 * i, RevisionCount: i - 1, Deliverables: append([]string(nil), f.Plans.RemoteExecutionPlan.Deliverables...), Terms: []string{"Work follows the approved remote plan", "Execution questions pause the task until answered"}, ChangedAt: now.Format(time.RFC3339)}
			f.Quotes = append(f.Quotes, buyerflow.Quote{QuoteID: quoteID, SellerID: sellerID, SellerName: sellerName, Amount: amount, Currency: "USDC", ETAHours: 2 * i, RevisionCount: i - 1, Deliverables: version.Deliverables, Terms: version.Terms, PlanHash: f.Plans.PlanHash, BundleHash: f.Bundle.BundleHash, Status: status, PublishMode: publishMode, Version: 1, Versions: []buyerflow.QuoteVersion{version}, CreatedAt: now.Format(time.RFC3339), UpdatedAt: now.Format(time.RFC3339), PublishedAt: publishedAt, ExpiresAt: deadline.Format(time.RFC3339)})
			f.Sellers = append(f.Sellers, buyerflow.SellerParticipant{SellerID: sellerID, SellerName: sellerName, QuoteID: quoteID, Stage: "review_quote", State: sellerState, RevisionLimit: i - 1, UpdatedAt: now.Format(time.RFC3339)})
		}
		f.State = "quote_review"
		if publishMode == "manual_review" {
			f.NextAction = "wait_for_seller_quote_publication"
		} else {
			f.NextAction = "select_quote"
		}
		f.AddEvent("matching.quotes_created", fmt.Sprintf("Three seller quote %s were created", map[bool]string{true: "drafts", false: "offers"}[publishMode == "manual_review"]))
		return nil
	})
}

func (h *Handler) SubmitSellerQuote(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SellerID      string   `json:"sellerId"`
		SellerName    string   `json:"sellerName"`
		PublishMode   string   `json:"publishMode"`
		Amount        float64  `json:"amount"`
		Currency      string   `json:"currency"`
		ETAHours      int      `json:"etaHours"`
		RevisionCount int      `json:"revisionCount"`
		Deliverables  []string `json:"deliverables"`
		Terms         []string `json:"terms"`
	}
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.updateBuyerFlow(w, r, func(f *buyerflow.Flow) error {
		if f.Phase != buyerflow.PhaseMatching || f.State != "quote_review" || f.SelectedQuoteID != "" {
			return fmt.Errorf("flow is not accepting seller quotes")
		}
		if strings.TrimSpace(req.SellerID) == "" || req.Amount < 0 || req.ETAHours <= 0 || req.RevisionCount < 0 || len(req.Deliverables) == 0 {
			return fmt.Errorf("sellerId, positive ETA, nonnegative amount/revisions, and deliverables are required")
		}
		if _, exists := f.Seller(req.SellerID); exists {
			return fmt.Errorf("seller already submitted a quote")
		}
		mode := req.PublishMode
		if mode != "manual_review" {
			mode = "auto"
		}
		status := "published"
		sellerState := "waiting_selection"
		now := time.Now().UTC()
		published := now.Format(time.RFC3339)
		if mode == "manual_review" {
			status = "draft"
			sellerState = "draft"
			published = ""
		}
		currency := firstNonEmpty(strings.TrimSpace(req.Currency), "USDC")
		name := firstNonEmpty(strings.TrimSpace(req.SellerName), req.SellerID)
		quoteID := fmt.Sprintf("quote-%s-%s", shortID(f.FlowID), safeName(req.SellerID))
		version := buyerflow.QuoteVersion{Version: 1, Amount: req.Amount, Currency: currency, ETAHours: req.ETAHours, RevisionCount: req.RevisionCount, Deliverables: req.Deliverables, Terms: req.Terms, ChangedAt: now.Format(time.RFC3339)}
		expires := now.Add(10 * time.Minute).Format(time.RFC3339)
		f.Quotes = append(f.Quotes, buyerflow.Quote{QuoteID: quoteID, SellerID: req.SellerID, SellerName: name, Amount: req.Amount, Currency: currency, ETAHours: req.ETAHours, RevisionCount: req.RevisionCount, Deliverables: req.Deliverables, Terms: req.Terms, PlanHash: f.Plans.PlanHash, BundleHash: f.Bundle.BundleHash, Status: status, PublishMode: mode, Version: 1, Versions: []buyerflow.QuoteVersion{version}, CreatedAt: now.Format(time.RFC3339), UpdatedAt: now.Format(time.RFC3339), PublishedAt: published, ExpiresAt: expires})
		f.Sellers = append(f.Sellers, buyerflow.SellerParticipant{SellerID: req.SellerID, SellerName: name, QuoteID: quoteID, Stage: "review_quote", State: sellerState, RevisionLimit: req.RevisionCount, UpdatedAt: now.Format(time.RFC3339)})
		if status == "published" {
			f.NextAction = "select_quote"
		}
		f.AddEvent("quote.submitted", name+" submitted a real remote quote")
		return nil
	})
}

func (h *Handler) SelectBuyerQuote(w http.ResponseWriter, r *http.Request) {
	quoteID := chi.URLParam(r, "quoteId")
	h.updateBuyerFlow(w, r, func(f *buyerflow.Flow) error {
		if f.Phase != buyerflow.PhaseMatching || f.State != "quote_review" {
			return fmt.Errorf("quotes can only be selected during quote review")
		}
		found := false
		now := time.Now().UTC().Format(time.RFC3339)
		for i := range f.Quotes {
			if f.Quotes[i].QuoteID == quoteID {
				if quoteExpired(f.Quotes[i]) {
					f.Quotes[i].Status = "expired"
					return fmt.Errorf("quote expired")
				}
				if f.Quotes[i].Status != "published" {
					return fmt.Errorf("only a published quote can be selected")
				}
				found = true
				f.Quotes[i].Status = "locked"
				f.Quotes[i].LockedAt = now
			} else if f.Quotes[i].Status != "withdrawn" {
				f.Quotes[i].Status = "not_selected"
			}
		}
		if !found {
			return fmt.Errorf("quote not found")
		}
		f.SelectedQuoteID = quoteID
		for i := range f.Sellers {
			f.Sellers[i].Selected = f.Sellers[i].QuoteID == quoteID
			if f.Sellers[i].Selected {
				f.Sellers[i].Stage = "execute"
				f.Sellers[i].State = "waiting_payment"
			} else {
				f.Sellers[i].State = "not_selected"
			}
			f.Sellers[i].UpdatedAt = now
		}
		f.Phase = buyerflow.PhaseSelectionPayment
		f.State = "payment_pending"
		f.NextAction = "confirm_payment"
		f.AddEvent("quote.selected", "Buyer locked a seller quote; terms are now frozen")
		return nil
	})
}

type sellerQuoteMutation struct {
	Amount        float64  `json:"amount"`
	Currency      string   `json:"currency"`
	ETAHours      int      `json:"etaHours"`
	RevisionCount int      `json:"revisionCount"`
	Deliverables  []string `json:"deliverables"`
	Terms         []string `json:"terms"`
}

func (h *Handler) PublishSellerQuote(w http.ResponseWriter, r *http.Request) {
	h.updateSellerQuote(w, r, func(f *buyerflow.Flow, q *buyerflow.Quote, s *buyerflow.SellerParticipant, now string) error {
		if q.Status != "draft" {
			return fmt.Errorf("only a draft quote can be published")
		}
		q.Status = "published"
		q.PublishedAt = now
		q.UpdatedAt = now
		s.State = "waiting_selection"
		s.UpdatedAt = now
		f.NextAction = "select_quote"
		f.AddEvent("quote.published", q.SellerName+" published quote version "+fmt.Sprint(q.Version))
		return nil
	})
}
func (h *Handler) WithdrawSellerQuote(w http.ResponseWriter, r *http.Request) {
	h.updateSellerQuote(w, r, func(f *buyerflow.Flow, q *buyerflow.Quote, s *buyerflow.SellerParticipant, now string) error {
		if q.Status != "draft" && q.Status != "published" {
			return fmt.Errorf("only an unlocked draft or published quote can be withdrawn")
		}
		q.Status = "withdrawn"
		q.WithdrawnAt = now
		q.UpdatedAt = now
		s.State = "rejected"
		s.UpdatedAt = now
		f.AddEvent("quote.withdrawn", q.SellerName+" withdrew its quote")
		return nil
	})
}
func (h *Handler) UpdateSellerQuote(w http.ResponseWriter, r *http.Request) {
	var req sellerQuoteMutation
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.updateSellerQuote(w, r, func(f *buyerflow.Flow, q *buyerflow.Quote, s *buyerflow.SellerParticipant, now string) error {
		if q.Status != "draft" && q.Status != "published" {
			return fmt.Errorf("locked, withdrawn, and terminal quotes cannot be changed")
		}
		if req.Amount < 0 || req.ETAHours <= 0 || req.RevisionCount < 0 {
			return fmt.Errorf("amount and revisions must be nonnegative and ETA must be positive")
		}
		if strings.TrimSpace(req.Currency) == "" || len(req.Deliverables) == 0 {
			return fmt.Errorf("currency and deliverables are required")
		}
		q.Amount = req.Amount
		q.Currency = strings.TrimSpace(req.Currency)
		q.ETAHours = req.ETAHours
		q.RevisionCount = req.RevisionCount
		q.Deliverables = req.Deliverables
		q.Terms = req.Terms
		q.Version++
		q.UpdatedAt = now
		q.Versions = append(q.Versions, buyerflow.QuoteVersion{Version: q.Version, Amount: q.Amount, Currency: q.Currency, ETAHours: q.ETAHours, RevisionCount: q.RevisionCount, Deliverables: q.Deliverables, Terms: q.Terms, ChangedAt: now})
		s.RevisionLimit = q.RevisionCount
		s.UpdatedAt = now
		f.AddEvent("quote.updated", fmt.Sprintf("%s updated quote to version %d", q.SellerName, q.Version))
		return nil
	})
}
func (h *Handler) updateSellerQuote(w http.ResponseWriter, r *http.Request, fn func(*buyerflow.Flow, *buyerflow.Quote, *buyerflow.SellerParticipant, string) error) {
	quoteID := chi.URLParam(r, "quoteId")
	h.updateBuyerFlow(w, r, func(f *buyerflow.Flow) error {
		if f.Phase != buyerflow.PhaseMatching || f.SelectedQuoteID != "" {
			return fmt.Errorf("quote changes are closed after buyer selection")
		}
		q, ok := f.Quote(quoteID)
		if !ok {
			return fmt.Errorf("quote not found")
		}
		if quoteExpired(*q) {
			q.Status = "expired"
			return fmt.Errorf("quote expired")
		}
		s, ok := f.Seller(q.SellerID)
		if !ok {
			return fmt.Errorf("seller participant not found")
		}
		return fn(f, q, s, time.Now().UTC().Format(time.RFC3339))
	})
}

func quoteExpired(q buyerflow.Quote) bool {
	expires, err := time.Parse(time.RFC3339, q.ExpiresAt)
	return err == nil && time.Now().UTC().After(expires)
}

func (h *Handler) AskBuyerReviewQuestion(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SellerID string                     `json:"sellerId"`
		Prompt   string                     `json:"prompt"`
		Options  []buyerflow.QuestionOption `json:"options"`
	}
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.updateBuyerFlow(w, r, func(f *buyerflow.Flow) error {
		if f.Phase != buyerflow.PhaseMatching || f.SelectedQuoteID != "" {
			return fmt.Errorf("review questions are only allowed before quote selection")
		}
		if strings.TrimSpace(req.Prompt) == "" || len(req.Options) < 2 || len(req.Options) > 3 {
			return fmt.Errorf("question requires a prompt and 2-3 options")
		}
		s, ok := f.Seller(req.SellerID)
		if !ok {
			return fmt.Errorf("seller participant not found")
		}
		now := time.Now().UTC()
		f.Questions = append(f.Questions, buyerflow.ExecutionQuestion{QuestionID: fmt.Sprintf("question-%d", len(f.Questions)+1), SellerID: req.SellerID, Scope: "review_quote", Prompt: req.Prompt, Options: req.Options, AllowCustom: true, Status: "waiting_buyer", AskedAt: now.Format(time.RFC3339), ExpiresAt: now.Add(24 * time.Hour).Format(time.RFC3339)})
		s.State = "waiting_buyer"
		s.UpdatedAt = now.Format(time.RFC3339)
		f.NextAction = "answer_seller_review_question"
		f.AddEvent("quote.question_asked", s.SellerName+" requested quote clarification")
		return nil
	})
}

func (h *Handler) FundBuyerEscrow(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PaymentPin string `json:"paymentPin"`
	}
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if h.paymentPIN != nil {
		if err := h.paymentPIN.Verify(req.PaymentPin); err != nil {
			writeError(w, http.StatusUnauthorized, "payment PIN verification failed")
			return
		}
	}
	h.updateBuyerFlow(w, r, func(f *buyerflow.Flow) error {
		if f.Phase != buyerflow.PhaseSelectionPayment || f.State != "payment_pending" {
			return fmt.Errorf("payment is not pending")
		}
		q, ok := f.SelectedQuote()
		if !ok {
			return fmt.Errorf("selected quote is missing")
		}
		now := time.Now().UTC()
		f.Escrow = buyerflow.Escrow{Status: "funded", Amount: q.Amount, Currency: q.Currency, FundedAt: now.Format(time.RFC3339)}
		f.TaskID = "task-" + shortID(f.FlowID)
		f.Phase = buyerflow.PhaseExecuting
		f.State = "running"
		f.NextAction = "wait_for_seller_delivery"
		if s, ok := f.Seller(q.SellerID); ok {
			s.Stage = "execute"
			s.State = "running"
			s.UpdatedAt = now.Format(time.RFC3339)
		}
		f.AddEvent("escrow.funded", "Payment entered local escrow; selected seller was notified to start")
		return nil
	})
}

func (h *Handler) AskBuyerExecutionQuestion(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SellerID string                     `json:"sellerId"`
		Prompt   string                     `json:"prompt"`
		Options  []buyerflow.QuestionOption `json:"options"`
	}
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.updateBuyerFlow(w, r, func(f *buyerflow.Flow) error {
		if f.Phase != buyerflow.PhaseExecuting || (f.State != "running" && f.State != "revising") {
			return fmt.Errorf("seller can only ask while execution is running")
		}
		if strings.TrimSpace(req.Prompt) == "" || len(req.Options) < 2 || len(req.Options) > 3 {
			return fmt.Errorf("question requires a prompt and 2-3 options")
		}
		now := time.Now().UTC()
		sellerID := req.SellerID
		if sellerID == "" {
			if selected, ok := f.SelectedQuote(); ok {
				sellerID = selected.SellerID
			}
		}
		q := buyerflow.ExecutionQuestion{QuestionID: fmt.Sprintf("question-%d", len(f.Questions)+1), SellerID: sellerID, Scope: "execute", Prompt: req.Prompt, Options: req.Options, AllowCustom: true, Status: "waiting_buyer", AskedAt: now.Format(time.RFC3339), ExpiresAt: now.Add(24 * time.Hour).Format(time.RFC3339)}
		f.Questions = append(f.Questions, q)
		f.State = "waiting_buyer"
		if s, ok := f.Seller(sellerID); ok {
			s.State = "waiting_buyer"
			s.UpdatedAt = now.Format(time.RFC3339)
		}
		f.NextAction = "answer_execution_question"
		f.AddEvent("execution.question_asked", "Seller needs buyer clarification; execution is paused")
		return nil
	})
}
func (h *Handler) AnswerBuyerExecutionQuestion(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Answer string `json:"answer"`
	}
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	qid := chi.URLParam(r, "questionId")
	h.updateBuyerFlow(w, r, func(f *buyerflow.Flow) error {
		if strings.TrimSpace(req.Answer) == "" {
			return fmt.Errorf("a non-empty answer is required")
		}
		found := false
		var scope, sellerID string
		for i := range f.Questions {
			if f.Questions[i].QuestionID == qid && f.Questions[i].Status == "waiting_buyer" {
				found = true
				scope = f.Questions[i].Scope
				sellerID = f.Questions[i].SellerID
				f.Questions[i].Answer = strings.TrimSpace(req.Answer)
				f.Questions[i].Status = "answered"
				f.Questions[i].AnsweredAt = time.Now().UTC().Format(time.RFC3339)
			}
		}
		if !found {
			return fmt.Errorf("active question not found")
		}
		if scope == "review_quote" {
			if f.Phase != buyerflow.PhaseMatching {
				return fmt.Errorf("review question is no longer active")
			}
			if s, ok := f.Seller(sellerID); ok {
				q, _ := f.Quote(s.QuoteID)
				if q != nil && q.Status == "draft" {
					s.State = "draft"
				} else {
					s.State = "waiting_selection"
				}
				s.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
			}
			f.NextAction = "review_or_publish_quote"
			f.AddEvent("quote.question_answered", "Buyer answered seller quote clarification")
		} else {
			if f.Phase != buyerflow.PhaseExecuting || f.State != "waiting_buyer" {
				return fmt.Errorf("execution question is no longer active")
			}
			f.State = "running"
			f.NextAction = "wait_for_seller_delivery"
			if s, ok := f.Seller(sellerID); ok {
				s.State = "running"
				s.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
			}
			f.AddEvent("execution.question_answered", "Buyer answered and execution resumed")
		}
		return nil
	})
}

func (h *Handler) DeliverBuyerTask(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Artifacts []string                      `json:"artifacts"`
		Files     []buyerflow.DeliveredArtifact `json:"files"`
		Summary   string                        `json:"summary"`
	}
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.updateBuyerFlow(w, r, func(f *buyerflow.Flow) error {
		if f.Phase != buyerflow.PhaseExecuting || (f.State != "running" && f.State != "revising") {
			return fmt.Errorf("delivery requires running execution")
		}
		if len(req.Artifacts) == 0 && len(req.Files) == 0 {
			return fmt.Errorf("delivery requires at least one artifact reference")
		}
		for i := range req.Files {
			file := &req.Files[i]
			if strings.TrimSpace(file.Name) == "" {
				return fmt.Errorf("delivered file name is required")
			}
			raw, err := base64.StdEncoding.DecodeString(file.ContentBase64)
			if err != nil {
				return fmt.Errorf("delivered file content must be base64")
			}
			if len(raw) > 2<<20 {
				return fmt.Errorf("delivered file exceeds 2 MiB")
			}
			sum := sha256.Sum256(raw)
			actual := hex.EncodeToString(sum[:])
			if file.SHA256 != "" && !strings.EqualFold(file.SHA256, actual) {
				return fmt.Errorf("delivered file hash mismatch")
			}
			file.SHA256 = actual
			file.SizeBytes = int64(len(raw))
			if file.MediaType == "" {
				file.MediaType = "application/octet-stream"
			}
			req.Artifacts = append(req.Artifacts, file.Name)
		}
		now := time.Now().UTC()
		criteria := make([]buyerflow.CriterionResult, 0, len(f.Plans.RemoteExecutionPlan.AcceptanceCriteria))
		for _, c := range f.Plans.RemoteExecutionPlan.AcceptanceCriteria {
			criteria = append(criteria, buyerflow.CriterionResult{Criterion: c, Passed: true, Evidence: "Seller delivery supplied for buyer verification"})
		}
		f.DeliveryArtifacts = req.Artifacts
		f.DeliveryFiles = req.Files
		f.Acceptance = &buyerflow.AcceptanceReport{ReportID: "acceptance-" + shortID(f.FlowID), Summary: firstNonEmpty(req.Summary, "Buyer Agent precheck completed; human acceptance is still required"), Criteria: criteria, ArtifactRefs: req.Artifacts, Verdict: "precheck_passed", CreatedAt: now.Format(time.RFC3339)}
		f.Phase = buyerflow.PhaseAcceptance
		f.State = "waiting_acceptance"
		if q, ok := f.SelectedQuote(); ok {
			if s, found := f.Seller(q.SellerID); found {
				s.Stage = "return_wait"
				s.State = "waiting_acceptance"
				s.UpdatedAt = now.Format(time.RFC3339)
			}
		}
		f.NextAction = "accept_request_revision_or_dispute"
		f.AcceptanceDeadline = now.Add(72 * time.Hour).Format(time.RFC3339)
		f.AddEvent("delivery.received", "Buyer Agent prechecked the delivery against the approved acceptance criteria")
		return nil
	})
}

func (h *Handler) DecideBuyerAcceptance(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Decision string `json:"decision"`
		Note     string `json:"note"`
	}
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.updateBuyerFlow(w, r, func(f *buyerflow.Flow) error {
		if f.Phase != buyerflow.PhaseAcceptance || f.State != "waiting_acceptance" {
			return fmt.Errorf("delivery is not awaiting acceptance")
		}
		q, ok := f.SelectedQuote()
		if !ok {
			return fmt.Errorf("selected quote missing")
		}
		switch req.Decision {
		case "accept":
			f.State = "completed"
			f.NextAction = "rate_seller_optional"
			f.Escrow.Status = "released"
			f.Escrow.ReleasedAt = time.Now().UTC().Format(time.RFC3339)
			f.AddEvent("delivery.accepted", "Buyer accepted delivery; escrow released")
			if s, found := f.Seller(q.SellerID); found {
				s.Stage = "return_wait"
				s.State = "accepted"
				s.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
			}
		case "request_revision":
			if f.RevisionsUsed >= q.RevisionCount {
				return fmt.Errorf("no included revisions remain; accept or dispute")
			}
			f.RevisionsUsed++
			f.Phase = buyerflow.PhaseExecuting
			f.State = "revising"
			f.NextAction = "wait_for_revised_delivery"
			f.AddEvent("delivery.revision_requested", req.Note)
			if s, found := f.Seller(q.SellerID); found {
				s.Stage = "execute"
				s.State = "revising"
				s.RevisionsUsed = f.RevisionsUsed
				s.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
			}
		case "dispute":
			f.State = "disputed"
			f.NextAction = "resolve_dispute"
			f.Escrow.Status = "held_dispute"
			f.AddEvent("delivery.disputed", req.Note)
			if s, found := f.Seller(q.SellerID); found {
				s.Stage = "return_wait"
				s.State = "disputed"
				s.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
			}
		default:
			return fmt.Errorf("decision must be accept, request_revision, or dispute")
		}
		return nil
	})
}

func (h *Handler) ResolveBuyerDispute(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Resolution string `json:"resolution"`
	}
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.updateBuyerFlow(w, r, func(f *buyerflow.Flow) error {
		if f.Phase != buyerflow.PhaseAcceptance || f.State != "disputed" {
			return fmt.Errorf("flow is not disputed")
		}
		now := time.Now().UTC().Format(time.RFC3339)
		switch req.Resolution {
		case "release":
			f.Escrow.Status = "released"
			f.Escrow.ReleasedAt = now
			f.State = "completed"
			f.NextAction = "rate_seller_optional"
		case "refund":
			f.Escrow.Status = "refunded"
			f.Escrow.RefundedAt = now
			f.State = "refunded"
			f.NextAction = "closed"
		default:
			return fmt.Errorf("resolution must be release or refund")
		}
		f.DisputeResolution = req.Resolution
		if q, ok := f.SelectedQuote(); ok {
			if s, found := f.Seller(q.SellerID); found {
				s.Stage = "return_wait"
				if req.Resolution == "refund" {
					s.State = "refunded"
				} else {
					s.State = "accepted"
				}
				s.UpdatedAt = now
			}
		}
		f.AddEvent("dispute.resolved", req.Resolution)
		return nil
	})
}

func (h *Handler) RateBuyerSeller(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Stars   int    `json:"stars"`
		Comment string `json:"comment"`
	}
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.updateBuyerFlow(w, r, func(f *buyerflow.Flow) error {
		if f.State != "completed" {
			return fmt.Errorf("rating is available only after completion")
		}
		if f.Rating != nil {
			return fmt.Errorf("this order is already rated")
		}
		if req.Stars < 1 || req.Stars > 5 {
			return fmt.Errorf("stars must be between 1 and 5")
		}
		f.Rating = &buyerflow.BuyerRating{Stars: req.Stars, Comment: strings.TrimSpace(req.Comment), CreatedAt: time.Now().UTC().Format(time.RFC3339)}
		if q, ok := f.SelectedQuote(); ok {
			if s, found := f.Seller(q.SellerID); found {
				s.Stage = "return_wait"
				s.State = "rated"
				s.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
			}
			if _, err := h.buyerFlows.UpdateReputation(q.SellerID, req.Stars); err != nil {
				return err
			}
		}
		f.NextAction = "closed"
		f.AddEvent("seller.rated", "Buyer submitted an optional seller rating")
		return nil
	})
}

func (h *Handler) updateBuyerFlow(w http.ResponseWriter, r *http.Request, fn func(*buyerflow.Flow) error) {
	f, err := h.buyerFlows.Update(chi.URLParam(r, "id"), strings.TrimSpace(r.Header.Get("Idempotency-Key")), fn)
	if err != nil {
		writeBuyerFlowError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, f)
}
func lockedWorkspace(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", fmt.Errorf("workspacePath is required for preparation")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(abs)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("workspacePath must be an existing directory")
	}
	return abs, nil
}
func safeName(v string) string {
	v = strings.TrimSpace(v)
	v = strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '.' || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, v)
	if v == "" {
		return "material"
	}
	return v
}
func workspaceSource(root, hint string) (string, bool) {
	hint = strings.TrimSpace(hint)
	if hint == "" {
		return "", false
	}
	candidate := hint
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(root, candidate)
	}
	candidate, err := filepath.Abs(candidate)
	if err != nil {
		return "", false
	}
	rel, err := filepath.Rel(root, candidate)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	info, err := os.Stat(candidate)
	return candidate, err == nil && !info.IsDir()
}
func shortID(v string) string {
	v = strings.ReplaceAll(v, "-", "")
	if len(v) > 10 {
		return v[len(v)-10:]
	}
	return v
}
