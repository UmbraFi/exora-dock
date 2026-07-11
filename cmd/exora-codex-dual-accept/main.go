package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/agentdriver"
)

type roleResult struct {
	Role            string `json:"role"`
	ThreadID        string `json:"threadId"`
	FirstTurnID     string `json:"firstTurnId"`
	ResumedThreadID string `json:"resumedThreadId"`
	SecondTurnID    string `json:"secondTurnId"`
	FirstCompleted  bool   `json:"firstCompleted"`
	SecondCompleted bool   `json:"secondCompleted"`
}

func main() {
	root, err := os.MkdirTemp("", "exora-codex-dual-accept-")
	must(err)
	defer os.RemoveAll(root)
	results := make([]roleResult, 0, 2)
	for _, role := range []string{"buyer", "seller"} {
		workspace := filepath.Join(root, role)
		must(os.MkdirAll(workspace, 0700))
		results = append(results, runRole(role, workspace))
	}
	passed := results[0].ThreadID != "" && results[1].ThreadID != "" && results[0].ThreadID != results[1].ThreadID
	for _, result := range results {
		passed = passed && result.FirstCompleted && result.SecondCompleted && result.ThreadID == result.ResumedThreadID
	}
	report := map[string]any{"passed": passed, "driver": "codex app-server", "roles": results}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	must(encoder.Encode(report))
	if !passed {
		os.Exit(1)
	}
}

func runRole(role, workspace string) roleResult {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	firstDriver := newDriver()
	report, err := firstDriver.Probe(ctx)
	must(err)
	if !report.Installed || !report.Authenticated {
		panic("Codex is not installed and logged in: " + report.AuthStatus)
	}
	session, err := firstDriver.StartSession(ctx, agentdriver.SessionRequest{CWD: workspace, PermissionProfile: "read-only"})
	must(err)
	firstTurn, firstDone := runTurn(ctx, firstDriver, session.ThreadID, fmt.Sprintf("You are the %s role in a local Exora acceptance check. Do not use tools or modify files. Reply briefly that role readiness is confirmed.", role))
	must(firstDriver.Close())

	secondDriver := newDriver()
	resumed, err := secondDriver.ResumeSession(ctx, agentdriver.ResumeRequest{ThreadID: session.ThreadID, PermissionProfile: "read-only", AdditionalParams: map[string]any{"cwd": workspace}})
	must(err)
	secondTurn, secondDone := runTurn(ctx, secondDriver, resumed.ThreadID, "This is a restart-resume check. Do not use tools or modify files. Reply briefly that the same thread resumed.")
	must(secondDriver.Close())
	return roleResult{Role: role, ThreadID: session.ThreadID, FirstTurnID: firstTurn, ResumedThreadID: resumed.ThreadID, SecondTurnID: secondTurn, FirstCompleted: firstDone, SecondCompleted: secondDone}
}

func newDriver() *agentdriver.CodexDriver {
	return agentdriver.NewCodex(agentdriver.CodexConfig{
		Command: "codex", RequestTimeout: 90 * time.Second, ProbeTimeout: 15 * time.Second,
		SessionParams: map[string]any{"developerInstructions": "Read-only Exora acceptance check. Never use tools, access secrets, or modify files."},
		ResumeParams:  map[string]any{"developerInstructions": "Read-only Exora acceptance check. Never use tools, access secrets, or modify files."},
	})
}

func runTurn(ctx context.Context, driver agentdriver.Driver, threadID, prompt string) (string, bool) {
	done := make(chan bool, 1)
	turn, err := driver.StartTurn(ctx, agentdriver.TurnRequest{ThreadID: threadID, Prompt: prompt}, agentdriver.EventSinkFunc(func(event agentdriver.Event) {
		method := strings.ToLower(strings.TrimSpace(event.Method))
		if strings.Contains(method, "turn/completed") || strings.Contains(method, "turn/failed") || strings.Contains(method, "turn/cancel") {
			select {
			case done <- strings.Contains(method, "completed"):
			default:
			}
		}
	}))
	must(err)
	select {
	case completed := <-done:
		return turn.TurnID, completed
	case <-ctx.Done():
		panic("Codex turn timed out: " + ctx.Err().Error())
	}
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
