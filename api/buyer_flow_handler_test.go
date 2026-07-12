package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/exora-dock/exora-dock/internal/buyerflow"
	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/dht"
	"github.com/go-chi/chi/v5"
)

func TestBuyerFlowHappyPathAndDisclosureGate(t *testing.T) {
	c, err := cache.New(100, filepath.Join(t.TempDir(), "cache"))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	h := NewHandler(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, nil, nil, nil, "buyer", RuntimeStores{BuyerFlows: buyerflow.NewStore(c)})
	r := chi.NewRouter()
	r.Post("/buyer-flows", h.CreateBuyerFlow)
	r.Post("/buyer-flows/{id}/plans/approve", h.ApproveBuyerPlans)
	r.Post("/buyer-flows/{id}/preparation/start", h.PrepareBuyerBundle)
	r.Post("/buyer-flows/{id}/bundle/approve", h.ApproveBuyerBundle)
	r.Post("/buyer-flows/{id}/matching/start", h.StartBuyerMatching)
	r.Post("/buyer-flows/{id}/quotes/{quoteId}/select", h.SelectBuyerQuote)
	r.Post("/buyer-flows/{id}/quotes/{quoteId}/publish", h.PublishSellerQuote)
	r.Post("/buyer-flows/{id}/quotes/{quoteId}/update", h.UpdateSellerQuote)
	r.Post("/buyer-flows/{id}/review/questions", h.AskBuyerReviewQuestion)
	r.Post("/buyer-flows/{id}/execution/questions/{questionId}/answer", h.AnswerBuyerExecutionQuestion)
	r.Post("/buyer-flows/{id}/payment/fund", h.FundBuyerEscrow)
	r.Post("/buyer-flows/{id}/execution/deliver", h.DeliverBuyerTask)
	r.Post("/buyer-flows/{id}/acceptance/decide", h.DecideBuyerAcceptance)
	r.Post("/buyer-flows/{id}/rating", h.RateBuyerSeller)
	workspace := t.TempDir()
	created := callBuyerFlow(t, r, http.MethodPost, "/buyer-flows", map[string]any{"workspacePath": workspace, "localPreparationPlan": map[string]any{"summary": "Prepare approved inputs", "steps": []string{"collect", "sanitize"}, "filesToPrepare": []any{}}, "remoteExecutionPlan": map[string]any{"title": "Remote task", "objective": "Produce a result", "instructions": []string{"Use supplied plan"}, "requiredFiles": []any{}, "deliverables": []string{"report.md"}, "acceptanceCriteria": []string{"report is present"}}}, http.StatusCreated)
	id := created.FlowID
	blocked := callBuyerFlow(t, r, http.MethodPost, "/buyer-flows/"+id+"/matching/start", nil, http.StatusConflict)
	if blocked.State != "" {
		t.Fatal("blocked transition unexpectedly returned a flow")
	}
	callBuyerFlow(t, r, http.MethodPost, "/buyer-flows/"+id+"/plans/approve", nil, http.StatusOK)
	prepared := callBuyerFlow(t, r, http.MethodPost, "/buyer-flows/"+id+"/preparation/start", nil, http.StatusOK)
	if prepared.Bundle == nil || prepared.Bundle.ApprovedAt != "" {
		t.Fatal("bundle must require explicit buyer review")
	}
	for _, file := range prepared.Bundle.Files {
		if filepath.IsAbs(file.RelativePath) {
			t.Fatalf("remote manifest leaked absolute path: %s", file.RelativePath)
		}
	}
	callBuyerFlow(t, r, http.MethodPost, "/buyer-flows/"+id+"/bundle/approve", nil, http.StatusOK)
	quoted := callBuyerFlow(t, r, http.MethodPost, "/buyer-flows/"+id+"/matching/start", nil, http.StatusOK)
	if len(quoted.Quotes) != 3 {
		t.Fatalf("got %d quotes", len(quoted.Quotes))
	}
	selected := quoted.Quotes[2]
	if _, err := h.buyerFlows.Update(id, "", func(flow *buyerflow.Flow) error {
		q, _ := flow.Quote(selected.QuoteID)
		q.Status = "draft"
		q.PublishedAt = ""
		s, _ := flow.Seller(selected.SellerID)
		s.State = "draft"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	asked := callBuyerFlow(t, r, http.MethodPost, "/buyer-flows/"+id+"/review/questions", map[string]any{"sellerId": selected.SellerID, "prompt": "Which format?", "options": []map[string]string{{"label": "Markdown", "value": "md"}, {"label": "PDF", "value": "pdf"}}}, http.StatusOK)
	qid := asked.Questions[len(asked.Questions)-1].QuestionID
	callBuyerFlow(t, r, http.MethodPost, "/buyer-flows/"+id+"/execution/questions/"+qid+"/answer", map[string]any{"answer": "md"}, http.StatusOK)
	callBuyerFlow(t, r, http.MethodPost, "/buyer-flows/"+id+"/quotes/"+selected.QuoteID+"/publish", nil, http.StatusOK)
	updated := callBuyerFlow(t, r, http.MethodPost, "/buyer-flows/"+id+"/quotes/"+selected.QuoteID+"/update", map[string]any{"amount": 30, "currency": "USDC", "etaHours": 3, "revisionCount": 3, "deliverables": []string{"report.md"}, "terms": []string{"fixed scope"}}, http.StatusOK)
	if updated.Quotes[2].Version != 2 || updated.Quotes[2].Amount != 30 {
		t.Fatal("quote version was not updated")
	}
	callBuyerFlow(t, r, http.MethodPost, "/buyer-flows/"+id+"/quotes/"+selected.QuoteID+"/select", nil, http.StatusOK)
	callBuyerFlow(t, r, http.MethodPost, "/buyer-flows/"+id+"/quotes/"+selected.QuoteID+"/update", map[string]any{"amount": 1, "currency": "USDC", "etaHours": 1, "revisionCount": 0, "deliverables": []string{"x"}}, http.StatusConflict)
	funded := callBuyerFlow(t, r, http.MethodPost, "/buyer-flows/"+id+"/payment/fund", map[string]any{}, http.StatusOK)
	if funded.Escrow.Status != "funded" || funded.State != "running" {
		t.Fatalf("unexpected funded state: %+v", funded.Escrow)
	}
	callBuyerFlow(t, r, http.MethodPost, "/buyer-flows/"+id+"/execution/deliver", map[string]any{"artifacts": []string{"report.md"}}, http.StatusOK)
	revising := callBuyerFlow(t, r, http.MethodPost, "/buyer-flows/"+id+"/acceptance/decide", map[string]any{"decision": "request_revision", "note": "adjust"}, http.StatusOK)
	if revising.State != "revising" || revising.RevisionsUsed != 1 {
		t.Fatal("revision did not return to execution")
	}
	selectedSeller, _ := revising.Seller(selected.SellerID)
	if selectedSeller.State != "revising" || selectedSeller.RevisionsUsed != 1 {
		t.Fatal("seller revision counters not synchronized")
	}
	callBuyerFlow(t, r, http.MethodPost, "/buyer-flows/"+id+"/execution/deliver", map[string]any{"artifacts": []string{"report-v2.md"}}, http.StatusOK)
	done := callBuyerFlow(t, r, http.MethodPost, "/buyer-flows/"+id+"/acceptance/decide", map[string]any{"decision": "accept"}, http.StatusOK)
	if done.Escrow.Status != "released" || done.State != "completed" {
		t.Fatal("acceptance did not release escrow")
	}
	rated := callBuyerFlow(t, r, http.MethodPost, "/buyer-flows/"+id+"/rating", map[string]any{"stars": 5, "comment": "good"}, http.StatusOK)
	if rated.Rating == nil || rated.Rating.Stars != 5 {
		t.Fatal("rating missing")
	}
	if rep, ok := h.buyerFlows.GetReputation(selected.SellerID); !ok || rep.RatingCount != 1 || rep.Average != 5 {
		t.Fatalf("reputation not updated: %+v", rep)
	}
}

func TestQuotePublishModeMigration(t *testing.T) {
	if quotePublishMode("", true) != "auto" || quotePublishMode("", false) != "manual_review" {
		t.Fatal("legacy autoQuote migration failed")
	}
	if quotePublishMode("manual_review", true) != "manual_review" {
		t.Fatal("explicit publish mode must win")
	}
}

func callBuyerFlow(t *testing.T, h http.Handler, method, path string, body any, want int) buyerflow.Flow {
	t.Helper()
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(raw))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != want {
		t.Fatalf("%s %s: got %d want %d: %s", method, path, rec.Code, want, rec.Body.String())
	}
	var f buyerflow.Flow
	_ = json.Unmarshal(rec.Body.Bytes(), &f)
	return f
}
