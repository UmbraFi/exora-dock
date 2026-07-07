package workrun

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/exora-dock/exora-dock/internal/cache"
)

func TestStoreRecordWritesCheckpointJSONLAndSnapshot(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(nil)
	run, err := store.Ensure(CreateRequest{
		WorkUID:     "work-123",
		ProjectPath: dir,
		Controller:  ControllerExternalMCP,
		Intent:      "rent a gpu",
	})
	if err != nil {
		t.Fatalf("Ensure returned error: %v", err)
	}
	firstCheckpoint := run.LastCheckpointID
	run, checkpoint, err := store.Record(RecordRequest{
		RunID:      run.RunID,
		Status:     StatusWaitingOwnerChoice,
		Step:       StepWaitOwnerSellerChoice,
		NextAction: "choose_seller_option",
		Summary:    "Created owner choice.",
		Result: map[string]any{
			"orderPlan": map[string]any{"planId": "opln-1"},
		},
	})
	if err != nil {
		t.Fatalf("Record returned error: %v", err)
	}
	if checkpoint.CheckpointID == "" || checkpoint.CheckpointID == firstCheckpoint {
		t.Fatalf("checkpoint id was not advanced: first=%q next=%q", firstCheckpoint, checkpoint.CheckpointID)
	}
	if got := ResumeJSON(run).KnownEntities.OrderPlanID; got != "opln-1" {
		t.Fatalf("resume json orderPlanId = %q", got)
	}
	logPath := filepath.Join(dir, ".exora", "work-runs", run.RunID+".jsonl")
	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read jsonl: %v", err)
	}
	if lines := strings.Count(strings.TrimSpace(string(data)), "\n") + 1; lines < 2 {
		t.Fatalf("jsonl lines = %d, want at least 2; data=%s", lines, data)
	}
	snapshotPath := filepath.Join(dir, ".exora", "work-runs", run.RunID+".snapshot.json")
	snapshot, err := os.ReadFile(snapshotPath)
	if err != nil {
		t.Fatalf("read snapshot: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(snapshot, &decoded); err != nil {
		t.Fatalf("snapshot json: %v", err)
	}
	if decoded["resumeJson"] == nil {
		t.Fatalf("snapshot missing resumeJson: %#v", decoded)
	}
}

func TestStoreRedactsSecretsFromCheckpoint(t *testing.T) {
	store := NewStore(nil)
	run, err := store.Ensure(CreateRequest{Controller: ControllerExternalMCP, Intent: "secret test"})
	if err != nil {
		t.Fatalf("Ensure returned error: %v", err)
	}
	run, checkpoint, err := store.Record(RecordRequest{
		RunID:      run.RunID,
		Step:       StepRequestApproval,
		NextAction: "wait_for_owner_approval",
		Result: map[string]any{
			"paymentPin": "123456",
			"apiToken":   "sk-test",
			"summary":    "safe",
		},
	})
	if err != nil {
		t.Fatalf("Record returned error: %v", err)
	}
	data, _ := json.Marshal(map[string]any{"run": run, "checkpoint": checkpoint, "events": store.Events(run.RunID)})
	text := string(data)
	if strings.Contains(text, "123456") || strings.Contains(text, "sk-test") {
		t.Fatalf("secret leaked in checkpoint/events: %s", text)
	}
	if len(checkpoint.Redactions) < 2 {
		t.Fatalf("redactions = %#v, want at least two", checkpoint.Redactions)
	}
}

func TestNoSuitableWorkerCheckpointMessage(t *testing.T) {
	store := NewStore(nil)
	run, err := store.Ensure(CreateRequest{WorkUID: "work-nope", Controller: ControllerExternalMCP, Intent: "impossible task"})
	if err != nil {
		t.Fatalf("Ensure returned error: %v", err)
	}
	run, checkpoint, err := store.Record(RecordRequest{
		RunID:      run.RunID,
		Step:       StepNegotiateTask,
		NextAction: "search_agent_cards_or_refine_task",
		Result: map[string]any{
			"summary": "No seller candidates were available for negotiation.",
		},
	})
	if err != nil {
		t.Fatalf("Record returned error: %v", err)
	}
	if run.Status != StatusNoSuitableWorker {
		t.Fatalf("status = %q, want %q", run.Status, StatusNoSuitableWorker)
	}
	if checkpoint.NextAction != "tell_user_exora_cannot_help" {
		t.Fatalf("nextAction = %q", checkpoint.NextAction)
	}
	if !strings.Contains(mustJSONForTest(t, checkpoint), NoSuitableWorkerMessage()) {
		t.Fatalf("checkpoint missing user-facing no-help message: %#v", checkpoint)
	}
}

func TestRenderRentalRecoverySnapshotsAcrossStages(t *testing.T) {
	dir := t.TempDir()
	c, err := cache.New(100, filepath.Join(dir, "cache"))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	store := NewStore(c)
	run, err := store.Ensure(CreateRequest{
		WorkUID:     "work-video-render",
		ProjectPath: dir,
		Controller:  ControllerExternalMCP,
		Intent:      "rent a server to render a video",
		Status:      StatusRunning,
		Step:        StepDiscoverAgentCards,
		NextAction:  "submit_cloud_matching",
	})
	if err != nil {
		t.Fatal(err)
	}
	stages := []RecordRequest{
		{
			RunID:      run.RunID,
			Status:     StatusRunning,
			Step:       StepNegotiateTask,
			NextAction: "wait_for_seller_valuation",
			Summary:    "Cloud matched a seller for video rendering.",
			Result: map[string]any{
				"task":       map[string]any{"taskId": "task-render-1", "orderPlanId": "opln-render-1"},
				"orderState": map[string]any{"state": "cloud_matching", "orderId": "ord-render-1"},
			},
		},
		{
			RunID:      run.RunID,
			Status:     StatusWaitingOwnerChoice,
			Step:       StepCreateOrderPlan,
			NextAction: "review_remote_task_manifest",
			Summary:    "Seller returned a render quote.",
			Result: map[string]any{
				"valuation": map[string]any{"valuationId": "val-render-1"},
				"orderPlan": map[string]any{"planId": "opln-render-1"},
			},
		},
		{
			RunID:      run.RunID,
			Status:     StatusWaitingOwnerApproval,
			Step:       StepWaitOwnerApprovalPayment,
			NextAction: "authorize_provider_execution",
			Summary:    "Buyer accepted the quote and authorized execution.",
			Result: map[string]any{
				"task":            map[string]any{"taskId": "task-render-1"},
				"paymentEvidence": map[string]any{"paymentEvidenceId": "pevd-render-1"},
			},
		},
		{
			RunID:      run.RunID,
			Status:     StatusWaitingWorker,
			Step:       StepSubmitWorkerJob,
			NextAction: "poll_worker_job",
			Summary:    "Provider execution plan committed.",
			Result: map[string]any{
				"providerJob": map[string]any{"jobId": "job-render-1"},
				"task":        map[string]any{"taskId": "task-render-1"},
			},
		},
		{
			RunID:      run.RunID,
			Status:     StatusCompleted,
			Step:       StepVerifyArtifacts,
			NextAction: "complete",
			Summary:    "Rendered video artifacts verified.",
			Result: map[string]any{
				"artifactManifest": []any{
					map[string]any{"path": "rendered-video.mp4", "sha256": "sha256:rendered-video"},
				},
				"task": map[string]any{"taskId": "task-render-1"},
			},
		},
	}
	checkpoints := map[string]bool{run.LastCheckpointID: true}
	for _, stage := range stages {
		run, _, err = store.Record(stage)
		if err != nil {
			t.Fatal(err)
		}
		if checkpoints[run.LastCheckpointID] {
			t.Fatalf("checkpoint did not advance for stage %s", stage.Step)
		}
		checkpoints[run.LastCheckpointID] = true
	}
	resume := ResumeJSON(run)
	if resume.KnownEntities.OrderPlanID != "opln-render-1" ||
		resume.KnownEntities.TaskID != "task-render-1" ||
		resume.KnownEntities.PaymentEvidenceID != "pevd-render-1" ||
		resume.KnownEntities.ProviderJobID != "job-render-1" {
		t.Fatalf("resume entities = %#v", resume.KnownEntities)
	}
	restarted := NewStore(c)
	recovered, ok := restarted.LatestByWorkUID("work-video-render")
	if !ok {
		t.Fatal("work run was not recoverable by workUid after store restart")
	}
	if recovered.RunID != run.RunID || recovered.LastCheckpointID != run.LastCheckpointID {
		t.Fatalf("recovered run mismatch: got=%#v want=%#v", recovered, run)
	}
	snapshotPath := filepath.Join(dir, ".exora", "work-runs", run.RunID+".snapshot.json")
	snapshot, err := os.ReadFile(snapshotPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(snapshot), `"resumeJson"`) || !strings.Contains(string(snapshot), "job-render-1") {
		t.Fatalf("snapshot missing resume data: %s", snapshot)
	}
	if got := len(restarted.Events(run.RunID)); got < len(stages)+1 {
		t.Fatalf("events after restart = %d, want at least %d", got, len(stages)+1)
	}
}

func mustJSONForTest(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
