package buyerflow

import (
	"path/filepath"
	"testing"

	"github.com/exora-dock/exora-dock/internal/cache"
)

func TestStorePersistsAndDeduplicatesMutation(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "cache")
	c, err := cache.New(50, dir)
	if err != nil {
		t.Fatal(err)
	}
	s := NewStore(c)
	f, err := s.Create(CreateRequest{WorkspacePath: t.TempDir(), LocalPreparationPlan: LocalPreparationPlan{Summary: "prepare", Steps: []string{"one"}}, RemoteExecutionPlan: RemoteExecutionPlan{Objective: "do work", Deliverables: []string{"out"}, AcceptanceCriteria: []string{"exists"}}})
	if err != nil {
		t.Fatal(err)
	}
	mutate := func(flow *Flow) error { flow.State = "approved"; flow.AddEvent("test.approved", ""); return nil }
	first, err := s.Update(f.FlowID, "same-key", mutate)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Update(f.FlowID, "same-key", mutate)
	if err != nil {
		t.Fatal(err)
	}
	if second.Version != first.Version || len(second.Events) != len(first.Events) {
		t.Fatal("idempotent mutation was applied twice")
	}
	if err = c.Close(); err != nil {
		t.Fatal(err)
	}
	c2, err := cache.New(50, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer c2.Close()
	restored, ok := NewStore(c2).Get(f.FlowID)
	if !ok || restored.State != "approved" || restored.Version != first.Version {
		t.Fatalf("flow was not restored: %+v", restored)
	}
}
