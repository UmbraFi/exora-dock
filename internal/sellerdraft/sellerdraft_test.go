package sellerdraft

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/exora-dock/exora-dock/internal/cache"
	"github.com/exora-dock/exora-dock/internal/cloudlink"
)

func testSellerService(t *testing.T, root string, defaults map[string]map[string]any) (*Service, *cache.Cache) {
	t.Helper()
	c, err := cache.New(100, filepath.Join(t.TempDir(), "cache"))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(c)
	policy, err := NormalizePolicy(SellerAutomationPolicy{
		Enabled: true, EnabledKinds: []string{KindResources},
		AllowedRoots: []AllowedRoot{{ID: "files", Path: root, Kinds: []string{KindResources}}},
		Defaults:     defaults, Attestations: Attestations{Pricing: true, Rights: true},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SavePolicy(policy); err != nil {
		t.Fatal(err)
	}
	return NewService(ServiceOptions{Store: store, Vault: NewCredentialVault(t.TempDir()), DataDir: t.TempDir()}), c
}

func TestDiscoveryAndMaterialReadStayInsideAuthorizedRoot(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.txt")
	if err := os.WriteFile(filepath.Join(root, "offer.md"), []byte("authorized material"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(outside, []byte("secret outside"), 0600); err != nil {
		t.Fatal(err)
	}
	service, c := testSellerService(t, root, nil)
	defer c.Close()
	candidates, err := service.Discover(context.Background(), DiscoverRequest{Kinds: []string{KindResources}, TargetHints: []string{"offer.md", outside}})
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 1 || candidates[0].DisplayName != "offer.md" {
		t.Fatalf("unexpected candidates: %+v", candidates)
	}
	chunk, err := service.ReadMaterial(ReadRequest{CandidateID: candidates[0].CandidateID, Limit: 8})
	if err != nil || chunk.Content != "authoriz" || chunk.EOF {
		t.Fatalf("unexpected material chunk: %+v err=%v", chunk, err)
	}
	if strings.Contains(chunk.Content, "outside") {
		t.Fatal("outside material leaked")
	}
}

func TestCandidateReplacementIsRejected(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "data.txt")
	if err := os.WriteFile(path, []byte("version one"), 0600); err != nil {
		t.Fatal(err)
	}
	service, c := testSellerService(t, root, nil)
	defer c.Close()
	candidates, err := service.Discover(context.Background(), DiscoverRequest{Kinds: []string{KindResources}})
	if err != nil || len(candidates) != 1 {
		t.Fatalf("discover err=%v candidates=%+v", err, candidates)
	}
	if err := os.WriteFile(path, []byte("version two"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ReadMaterial(ReadRequest{CandidateID: candidates[0].CandidateID}); err == nil || !strings.Contains(err.Error(), "changed") {
		t.Fatalf("changed candidate accepted: %v", err)
	}
}

func TestDiscoveryParsesAuthorizedOpenAPIMaterialInDaemon(t *testing.T) {
	root := t.TempDir()
	document := "openapi: 3.1.0\ninfo:\n  title: Reports\npaths:\n  /reports:\n    get:\n      operationId: listReports\n      summary: List reports\n"
	if err := os.WriteFile(filepath.Join(root, "openapi.yaml"), []byte(document), 0600); err != nil {
		t.Fatal(err)
	}
	service, c := testSellerService(t, root, nil)
	defer c.Close()
	candidates, err := service.Discover(context.Background(), DiscoverRequest{Kinds: []string{KindResources}})
	if err != nil || len(candidates) != 1 {
		t.Fatalf("discover err=%v candidates=%+v", err, candidates)
	}
	analysis := mapValue(candidates[0].Metadata, "openapi")
	operations, _ := analysis["operations"].([]map[string]any)
	if textValue(analysis, "title") != "Reports" || len(operations) != 1 || textValue(operations[0], "operationId") != "listReports" {
		t.Fatalf("OpenAPI analysis missing from candidate metadata: %+v", analysis)
	}
}

func TestSymlinkEscapeIsNotDiscovered(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.txt")
	if err := os.WriteFile(outside, []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "escape.txt")
	if err := os.Symlink(outside, link); err != nil {
		if runtime.GOOS == "windows" {
			t.Skipf("symlink privilege unavailable: %v", err)
		}
		t.Fatal(err)
	}
	service, c := testSellerService(t, root, nil)
	defer c.Close()
	candidates, err := service.Discover(context.Background(), DiscoverRequest{Kinds: []string{KindResources}})
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 0 {
		t.Fatalf("symlink escape discovered: %+v", candidates)
	}
}

func TestMissingCommercialFieldsEnterNeedsInputAndCreateIsIdempotent(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "bundle.txt"), []byte("hello"), 0600); err != nil {
		t.Fatal(err)
	}
	service, c := testSellerService(t, root, nil)
	defer c.Close()
	candidates, err := service.Discover(context.Background(), DiscoverRequest{Kinds: []string{KindResources}})
	if err != nil || len(candidates) != 1 {
		t.Fatalf("discover err=%v candidates=%+v", err, candidates)
	}
	request := CreateRequest{Kind: KindResources, CandidateIDs: []string{candidates[0].CandidateID}, Specification: map[string]any{"version": "1.0.0", "license": "commercial"}, IdempotencyKey: "stable-resource-run"}
	first, err := service.Create(request)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.Create(request)
	if err != nil || second.RunID != first.RunID {
		t.Fatalf("create replay duplicated run: first=%s second=%s err=%v", first.RunID, second.RunID, err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		run, _ := service.Get(first.RunID)
		if run.Status == StatusNeedsInput {
			if len(run.MissingFields) != 1 || run.MissingFields[0] != "commercial.price" {
				t.Fatalf("unexpected missing fields: %+v", run.MissingFields)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("run did not reach needs_input: %+v", run)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestCreateEnforcesSellerPolicyConcurrencyLimit(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "bundle.txt"), []byte("hello"), 0600); err != nil {
		t.Fatal(err)
	}
	service, c := testSellerService(t, root, nil)
	defer c.Close()
	candidates, err := service.Discover(context.Background(), DiscoverRequest{Kinds: []string{KindResources}})
	if err != nil || len(candidates) != 1 {
		t.Fatalf("discover err=%v candidates=%+v", err, candidates)
	}
	policy, _ := service.Policy()
	_, err = service.store.CreateRun(CreateRequest{Kind: KindResources, CandidateIDs: []string{candidates[0].CandidateID}, IdempotencyKey: "already-running-draft"}, Receipt(policy))
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.Create(CreateRequest{Kind: KindResources, CandidateIDs: []string{candidates[0].CandidateID}, IdempotencyKey: "another-draft-run"})
	if err == nil || !strings.Contains(err.Error(), "concurrency limit") {
		t.Fatalf("active run did not enforce concurrency limit: %v", err)
	}
}

func TestExplicitCommercialValueOverridesDefaultWithoutInference(t *testing.T) {
	policy := SellerAutomationPolicy{Defaults: map[string]map[string]any{KindResources: {"commercial": map[string]any{"price": map[string]any{"amount": float64(5), "currency": "USDC"}}, "specification": map[string]any{"version": "1.0.0", "license": "commercial"}}}}
	request := CreateRequest{Kind: KindResources, Commercial: map[string]any{"price": map[string]any{"amount": float64(0), "currency": "USDC"}}}
	normalized, missing, err := normalizeRunInput(policy, request, []Candidate{{DisplayName: "bundle", Summary: "files"}})
	if err != nil || len(missing) != 0 {
		t.Fatalf("normalize err=%v missing=%v", err, missing)
	}
	price := mapValue(normalized, "price")
	if amount, _ := numberValue(price, "amount"); amount != 0 {
		t.Fatalf("explicit zero price was not preserved: %+v", price)
	}
	request.Commercial["price"] = map[string]any{"amount": -1}
	if _, _, err := normalizeRunInput(policy, request, []Candidate{{DisplayName: "bundle"}}); err == nil {
		t.Fatal("negative explicit price accepted")
	}
}

func TestExplicitNestedCommercialFieldKeepsSavedSiblingDefaults(t *testing.T) {
	policy := SellerAutomationPolicy{Defaults: map[string]map[string]any{KindResources: {"commercial": map[string]any{"price": map[string]any{"amount": float64(5), "currency": "USDC"}}, "specification": map[string]any{"version": "1.0.0", "license": "commercial"}}}}
	request := CreateRequest{Kind: KindResources, Commercial: map[string]any{"price": map[string]any{"amount": float64(2)}}}
	normalized, missing, err := normalizeRunInput(policy, request, []Candidate{{DisplayName: "bundle"}})
	if err != nil || len(missing) != 0 {
		t.Fatalf("normalize err=%v missing=%v", err, missing)
	}
	price := mapValue(normalized, "price")
	if amount, _ := numberValue(price, "amount"); amount != 2 || textValue(price, "currency") != "USDC" {
		t.Fatalf("explicit nested override discarded saved sibling defaults: %+v", price)
	}
}

func TestResourcesRejectVMMountDelivery(t *testing.T) {
	policy := SellerAutomationPolicy{Defaults: map[string]map[string]any{KindResources: {
		"commercial":    map[string]any{"price": map[string]any{"amount": float64(5), "currency": "USDC"}},
		"specification": map[string]any{"version": "1.0.0", "license": "commercial"},
	}}}
	request := CreateRequest{Kind: KindResources, Specification: map[string]any{"delivery": "downloadable_and_environment"}}
	if _, _, err := normalizeRunInput(policy, request, []Candidate{{DisplayName: "bundle"}}); err == nil || !strings.Contains(err.Error(), "Resources cannot be mounted") {
		t.Fatalf("cross-system Resources delivery accepted: %v", err)
	}
}

func TestCredentialVaultNeverStoresOrReturnsSecretInMetadata(t *testing.T) {
	dataDir := t.TempDir()
	vault := NewCredentialVault(dataDir)
	metadata, err := vault.Put(CredentialMetadata{Label: "Reports API", AuthType: "bearer", ServiceIDs: []string{"reports"}}, "super-secret-token")
	if err != nil {
		t.Fatal(err)
	}
	listed, err := vault.List()
	if err != nil || len(listed) != 1 || listed[0].CredentialRef != metadata.CredentialRef {
		t.Fatalf("unexpected metadata: %+v err=%v", listed, err)
	}
	raw, err := os.ReadFile(filepath.Join(dataDir, "seller-automation", "credentials.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "super-secret-token") {
		t.Fatal("credential vault persisted plaintext")
	}
	if _, _, err := vault.Resolve(metadata.CredentialRef, "other-service"); err == nil {
		t.Fatal("credential service authorization was not enforced")
	}
}

func TestRunErrorsRedactResolvedCredentialMaterial(t *testing.T) {
	message := safeRunError(errors.New("upstream rejected token super-secret-token"), "super-secret-token")
	if strings.Contains(message, "super-secret-token") || !strings.Contains(message, "[REDACTED]") {
		t.Fatalf("credential leaked through safe run error: %q", message)
	}
}

func TestPublicHTTPSRejectsPrivateResolution(t *testing.T) {
	if _, err := publicHTTPSURL(context.Background(), "https://127.0.0.1/api"); err == nil {
		t.Fatal("private API Bridge address accepted")
	}
}

func TestMultipartUploadResumesOnlyMissingParts(t *testing.T) {
	var presigned []int
	completed := false
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer cloud-token" && r.URL.Path != "/part/2" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/v3/provider/uploads/upl_resume/parts/presign":
			var input struct {
				PartNumbers []int `json:"partNumbers"`
			}
			_ = json.NewDecoder(r.Body).Decode(&input)
			presigned = input.PartNumbers
			_ = json.NewEncoder(w).Encode(map[string]any{"urls": map[string]string{"2": "http://" + r.Host + "/part/2"}})
		case "/part/2":
			_, _ = io.Copy(io.Discard, r.Body)
			w.Header().Set("ETag", `"part-2"`)
			w.WriteHeader(http.StatusOK)
		case "/v3/provider/uploads/upl_resume/complete":
			var input struct {
				Parts []map[string]any `json:"parts"`
			}
			_ = json.NewDecoder(r.Body).Decode(&input)
			completed = len(input.Parts) == 2
			w.WriteHeader(http.StatusOK)
		default:
			http.NotFound(w, r)
		}
	}))
	defer cloud.Close()

	directory := t.TempDir()
	c, err := cache.New(32, filepath.Join(directory, "cache"))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	store := NewStore(c)
	run, err := store.CreateRun(CreateRequest{Kind: KindResources, IdempotencyKey: "multipart-resume"}, PolicyReceipt{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.UpdateRun(run.RunID, run.StateVersion, func(current *Run) error {
		current.Result.UploadSessionID = "upl_resume"
		current.Result.UploadedParts = map[string]string{"1": `"part-1"`}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	tokenPath := filepath.Join(directory, "cloud-token.json")
	if err := cloudlink.SaveToken(tokenPath, cloudlink.TokenFile{CloudURL: cloud.URL, CloudToken: "cloud-token"}); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(directory, "archive.zip")
	file, err := os.OpenFile(archive, os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate((16 << 20) + 1024); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	service := NewService(ServiceOptions{Store: store, Vault: NewCredentialVault(directory), DataDir: directory, CloudURL: cloud.URL, CloudTokenPath: tokenPath})
	if _, err := service.uploadArchive(context.Background(), run.RunID, "prd_resume", archive, (16<<20)+1024, "checksum", 1); err != nil {
		t.Fatal(err)
	}
	if len(presigned) != 1 || presigned[0] != 2 || !completed {
		t.Fatalf("multipart resume did not skip completed part: presigned=%v completed=%v", presigned, completed)
	}
}
