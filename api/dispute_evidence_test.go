package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/exora-dock/exora-dock/internal/agent"
	"github.com/exora-dock/exora-dock/internal/approval"
	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/chat"
	"github.com/exora-dock/exora-dock/internal/dht"
	"github.com/exora-dock/exora-dock/internal/payment"
	"github.com/exora-dock/exora-dock/internal/task"
	"github.com/go-chi/chi/v5"
)

func TestGetDisputeEvidenceRedactsAndAggregates(t *testing.T) {
	dir := t.TempDir()
	c, err := cache.New(128, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()

	tasks := task.NewStore(c, filepath.Join(dir, "artifacts"))
	approvals := approval.NewStore(c)
	payments := payment.NewStore(c)
	runs := agent.NewRunStore(c)
	if err := tasks.Save(task.Task{
		ID:              "task-1",
		OrderID:         "order-1",
		ProjectPath:     filepath.Join(dir, "private-project"),
		RequesterPubkey: "buyer",
		AgentID:         "agent-1",
		Type:            "compute.test",
		Goal:            "verify output",
		InputFiles: []task.InputFile{{
			Name:   "input.txt",
			URI:    "file:///private/input.txt",
			SHA256: "input-hash",
		}},
		Status: task.StatusCompleted,
		Quote: &task.Quote{
			ID:             "quote-1",
			ProviderPubkey: "seller",
			PriceAmount:    2,
			Currency:       "USD",
		},
		Artifacts: []task.Artifact{{
			Name:      "output.json",
			SizeBytes: 12,
			SHA256:    "artifact-hash",
			URL:       "file:///private/output.json",
		}},
		CreatedAt: "2026-07-05T00:00:00Z",
		UpdatedAt: "2026-07-05T00:01:00Z",
	}); err != nil {
		t.Fatal(err)
	}
	if err := approvals.Save(approval.Approval{
		ID:         "appr-1",
		TaskID:     "task-1",
		Action:     "approve_quote",
		UserPubkey: "buyer",
		AgentID:    "agent-1",
		Status:     approval.StatusApproved,
		Decision: &approval.DecisionReceipt{
			Approved:  true,
			DecidedBy: "owner",
			UserNote:  "ok",
			DecidedAt: "2026-07-05T00:02:00Z",
		},
	}); err != nil {
		t.Fatal(err)
	}
	if err := payments.Save(payment.Record{
		ID:         "pay-1",
		ApprovalID: "appr-1",
		TaskID:     "task-1",
		Amount:     2,
		Currency:   "USD",
		Mode:       "simulated",
		Status:     payment.StatusConfirmedSimulated,
		ProofRef:   "simulated-proof",
	}); err != nil {
		t.Fatal(err)
	}
	if err := runs.Save(agent.AgentRun{
		RunID:  "arun-1",
		Status: agent.RunStatusCompleted,
		Intent: "run job",
		Turns: []agent.AgentTurn{{
			TurnID:   "turn-1",
			Role:     "tool",
			ToolName: "request_approval",
			ToolArgs: map[string]any{
				"paymentPin": "123456",
				"apiKey":     "secret-token",
			},
		}},
	}); err != nil {
		t.Fatal(err)
	}

	handler := NewHandler(c, nil, nil, chat.NewHub(), dht.NewRing(), nil, nil, nil, nil, nil, nil, nil, nil, "dock-1", RuntimeStores{
		Tasks:     tasks,
		Approvals: approvals,
		Payments:  payments,
		AgentRuns: runs,
	})
	router := chi.NewRouter()
	router.Get("/dispute-evidence", handler.GetDisputeEvidence)

	req := httptest.NewRequest(http.MethodGet, "/dispute-evidence?side=buyer&disputeId=disp_1&taskId=task-1&agentRunIds=arun-1", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, secret := range []string{"123456", "secret-token", "file:///private", "private-project"} {
		if strings.Contains(body, secret) {
			t.Fatalf("evidence leaked %q in %s", secret, body)
		}
	}
	for _, expected := range []string{"artifactManifest", "artifact-hash", "approvals", "payments", "agentRuns", "[redacted]"} {
		if !strings.Contains(body, expected) {
			t.Fatalf("expected %q in %s", expected, body)
		}
	}
}
