package sellerdraft

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/endpoint"
)

type cloudProduct struct {
	ProductID string `json:"productId"`
}
type cloudListing struct {
	ListingID string `json:"listingId"`
}

func (s *Service) runResources(ctx context.Context, runID string, policy SellerAutomationPolicy, candidates []Candidate, normalized map[string]any) error {
	if err := s.step(runID, StatusPackaging, 30, "Creating a deterministic ZIP inside the Dock daemon"); err != nil {
		return err
	}
	archivePath, size, checksum, err := s.packageResources(policy, runID, candidates)
	if err != nil {
		return err
	}
	defer os.RemoveAll(filepath.Dir(archivePath))
	manifest := provenanceManifest(runID, policy, combinedFingerprint(candidates), mapValue(normalized, "specification"))
	manifest["archiveFormat"], manifest["sourceCount"], manifest["sha256"], manifest["sizeBytes"] = "zip", len(candidates), checksum, size
	productPayload := map[string]any{
		"idempotencyKey": runID + "-product", "productKind": "download", "title": normalized["title"],
		"description": normalized["description"], "manifest": manifest,
	}
	var productResponse struct {
		Product cloudProduct `json:"product"`
	}
	if err := s.cloud.JSON(ctx, http.MethodPost, "/v3/provider/asset-bundles", productPayload, &productResponse); err != nil {
		return err
	}
	if productResponse.Product.ProductID == "" {
		return errors.New("Cloud did not return an asset product id")
	}
	if err := s.step(runID, StatusUploading, 50, "Uploading the verified ZIP with resumable multipart transfer"); err != nil {
		return err
	}
	uploadID, err := s.uploadArchive(ctx, runID, productResponse.Product.ProductID, archivePath, size, checksum, len(candidates))
	if err != nil {
		return err
	}
	if err := s.step(runID, StatusCreatingDraft, 90, "Creating a private Resources Listing draft"); err != nil {
		return err
	}
	listingID, err := s.createGenericListing(ctx, runID, productResponse.Product.ProductID, normalized, map[string]any{
		"valid": true, "uploadVerified": true, "creationActor": "agent", "draftRunId": runID,
		"sourceFingerprint": combinedFingerprint(candidates), "sellerPolicyReceipt": Receipt(policy),
	})
	if err != nil {
		return err
	}
	return s.complete(runID, RunResult{ProductID: productResponse.Product.ProductID, ListingID: listingID, UploadSessionID: uploadID})
}

func (s *Service) packageResources(policy SellerAutomationPolicy, runID string, candidates []Candidate) (string, int64, string, error) {
	if len(candidates) == 0 || len(candidates) > policy.Limits.MaxFiles {
		return "", 0, "", fmt.Errorf("resource file count must be between 1 and %d", policy.Limits.MaxFiles)
	}
	directory := filepath.Join(s.dataDir, "seller-automation", "runs", runID)
	if err := os.MkdirAll(directory, 0700); err != nil {
		return "", 0, "", err
	}
	archivePath := filepath.Join(directory, "bundle.zip")
	file, err := os.OpenFile(archivePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", 0, "", err
	}
	writer := zip.NewWriter(file)
	usedNames := map[string]int{}
	var sourceBytes int64
	for _, candidate := range candidates {
		source, info, _, err := openCandidateFile(policy, candidate)
		if err != nil {
			_ = writer.Close()
			_ = file.Close()
			return "", 0, "", err
		}
		sourceBytes += info.Size()
		if sourceBytes > policy.Limits.MaxBundleBytes {
			_ = source.Close()
			_ = writer.Close()
			_ = file.Close()
			return "", 0, "", fmt.Errorf("resource bundle exceeds %d bytes", policy.Limits.MaxBundleBytes)
		}
		name := candidate.DisplayName
		if strings.TrimSpace(name) == "" {
			name = "resource"
		}
		name = filepath.Base(name)
		usedNames[name]++
		if usedNames[name] > 1 {
			extension := filepath.Ext(name)
			name = strings.TrimSuffix(name, extension) + "-" + strconv.Itoa(usedNames[name]) + extension
		}
		header, _ := zip.FileInfoHeader(info)
		header.Name = name
		header.Method = zip.Deflate
		header.SetMode(0600)
		header.Modified = time.Unix(0, 0).UTC()
		entry, err := writer.CreateHeader(header)
		if err != nil {
			_ = source.Close()
			_ = writer.Close()
			_ = file.Close()
			return "", 0, "", err
		}
		hash := sha256.New()
		written, copyErr := io.Copy(io.MultiWriter(entry, hash), io.LimitReader(source, info.Size()+1))
		closeErr := source.Close()
		fingerprint := hex.EncodeToString(hash.Sum(nil))
		if copyErr != nil || closeErr != nil || written != info.Size() || fingerprint != candidate.SourceFingerprint || !candidatePathStillMatches(policy, candidate, info) {
			_ = writer.Close()
			_ = file.Close()
			if copyErr == nil && closeErr == nil {
				copyErr = errors.New("resource changed during packaging; discover it again")
			}
			return "", 0, "", firstError(copyErr, closeErr)
		}
	}
	if err := writer.Close(); err != nil {
		_ = file.Close()
		return "", 0, "", err
	}
	if err := file.Close(); err != nil {
		return "", 0, "", err
	}
	info, err := os.Stat(archivePath)
	if err != nil {
		return "", 0, "", err
	}
	if info.Size() > policy.Limits.MaxBundleBytes {
		return "", 0, "", fmt.Errorf("ZIP exceeds %d bytes", policy.Limits.MaxBundleBytes)
	}
	checksum, err := fileFingerprint(archivePath, policy.Limits.MaxBundleBytes)
	return archivePath, info.Size(), checksum, err
}

func (s *Service) uploadArchive(ctx context.Context, runID, productID, archivePath string, size int64, checksum string, sourceCount int) (string, error) {
	run, _ := s.store.GetRun(runID)
	uploadID := run.Result.UploadSessionID
	completedParts := cloneStringMap(run.Result.UploadedParts)
	if uploadID == "" {
		var started struct {
			Upload struct {
				UploadSessionID string `json:"uploadSessionId"`
			} `json:"upload"`
		}
		if err := s.cloud.JSON(ctx, http.MethodPost, "/v3/provider/asset-bundles/"+url.PathEscape(productID)+"/multipart", map[string]any{
			"fileName": "bundle.zip", "sizeBytes": size, "sha256": checksum, "contentType": "application/zip", "archiveFormat": "zip", "sourceCount": sourceCount,
		}, &started); err != nil {
			return "", err
		}
		uploadID = started.Upload.UploadSessionID
		if uploadID == "" {
			return "", errors.New("Cloud did not return an upload session id")
		}
		_, _ = s.store.UpdateRun(runID, 0, func(run *Run) error {
			run.Result.UploadSessionID = uploadID
			run.Result.UploadedParts = map[string]string{}
			return nil
		})
	}
	const partSize int64 = 16 << 20
	count := int((size + partSize - 1) / partSize)
	if count == 0 {
		count = 1
	}
	numbers := make([]int, 0, count)
	for i := 1; i <= count; i++ {
		if strings.TrimSpace(completedParts[strconv.Itoa(i)]) == "" {
			numbers = append(numbers, i)
		}
	}
	var presigned struct {
		URLs map[string]string `json:"urls"`
	}
	if len(numbers) > 0 {
		if err := s.cloud.JSON(ctx, http.MethodPost, "/v3/provider/uploads/"+url.PathEscape(uploadID)+"/parts/presign", map[string]any{"partNumbers": numbers}, &presigned); err != nil {
			return uploadID, err
		}
	}
	file, err := os.Open(archivePath)
	if err != nil {
		return uploadID, err
	}
	defer file.Close()
	for _, partNumber := range numbers {
		index := partNumber - 1
		offset := int64(index) * partSize
		length := partSize
		if remaining := size - offset; remaining < length {
			length = remaining
		}
		etag, err := s.cloud.PUTPart(ctx, presigned.URLs[strconv.Itoa(partNumber)], io.NewSectionReader(file, offset, length), length)
		if err != nil {
			return uploadID, err
		}
		completedParts[strconv.Itoa(partNumber)] = etag
		_, _ = s.store.UpdateRun(runID, 0, func(run *Run) error {
			if run.Result.UploadedParts == nil {
				run.Result.UploadedParts = map[string]string{}
			}
			run.Result.UploadedParts[strconv.Itoa(partNumber)] = etag
			run.Progress = 50 + int(float64(len(run.Result.UploadedParts))/float64(count)*35)
			return nil
		})
	}
	parts := make([]map[string]any, 0, count)
	for partNumber := 1; partNumber <= count; partNumber++ {
		etag := strings.TrimSpace(completedParts[strconv.Itoa(partNumber)])
		if etag == "" {
			return uploadID, fmt.Errorf("multipart part %d is missing after upload", partNumber)
		}
		parts = append(parts, map[string]any{"partNumber": partNumber, "etag": etag})
	}
	if err := s.cloud.JSON(ctx, http.MethodPost, "/v3/provider/uploads/"+url.PathEscape(uploadID)+"/complete", map[string]any{"parts": parts}, nil); err != nil {
		return uploadID, err
	}
	return uploadID, nil
}

func cloneStringMap(source map[string]string) map[string]string {
	out := make(map[string]string, len(source))
	for key, value := range source {
		out[key] = value
	}
	return out
}

func (s *Service) runVM(ctx context.Context, runID string, policy SellerAutomationPolicy, candidate Candidate, normalized map[string]any) error {
	if runtime.GOOS == "darwin" {
		return errors.New("unsupported_host: macOS VM seller automation is not supported")
	}
	if err := s.step(runID, StatusProbing, 35, "Checking the installed VM runtime and current host capacity"); err != nil {
		return err
	}
	specification := mapValue(normalized, "specification")
	validation, err := s.validateSelectedVMEnvironment(ctx, runID, candidate, specification)
	if err != nil {
		return err
	}
	capacity, err := s.worker.Call(ctx, "capacity_check", map[string]any{})
	if err != nil {
		return fmt.Errorf("VM capacity check failed: %w", err)
	}
	network, networkErr := scanHostNetwork(ctx)
	if networkErr != nil {
		network = map[string]any{"error": networkErr.Error(), "checkedAt": time.Now().UTC().Format(time.RFC3339Nano)}
	}
	diskBytes, _ := numberValue(specification, "diskBytes")
	if diskBytes < 1<<30 {
		return errors.New("specification.diskBytes must reserve at least 1 GiB")
	}
	if err := s.step(runID, StatusReserving, 55, "Reserving VM disk capacity for 24 hours"); err != nil {
		return err
	}
	reservationInput := cloneMap(specification)
	reservationInput["slotId"] = runID
	reservationInput["sizeBytes"] = int64(diskBytes)
	reservation, err := s.worker.Call(ctx, "reserve_disk", reservationInput)
	if err != nil {
		return fmt.Errorf("VM capacity reservation failed: %w", err)
	}
	expiresAt := time.Now().UTC().Add(24 * time.Hour)
	_, _ = s.store.UpdateRun(runID, 0, func(run *Run) error { run.ReservationExpiresAt = expiresAt.Format(time.RFC3339Nano); return nil })
	release := true
	defer func() {
		if release {
			_, _ = s.worker.Call(context.Background(), "release_disk", reservationInput)
		}
	}()
	if err := s.step(runID, StatusCreatingDraft, 80, "Creating compute Product and private VM Listing draft"); err != nil {
		return err
	}
	manifest := provenanceManifest(runID, policy, candidate.SourceFingerprint, specification)
	manifest["applicationSource"] = "vm"
	manifest["runtimeBackend"] = map[bool]string{true: "wsl2", false: "kvm"}[runtime.GOOS == "windows"]
	manifest["runtimeValidation"] = validation
	manifest["capacitySnapshot"], manifest["reservation"] = capacity, reservation
	manifest["networkSnapshot"] = network
	manifest["reservationExpiresAt"] = expiresAt.Format(time.RFC3339Nano)
	productID, err := s.createGenericProduct(ctx, runID, "compute", normalized, manifest)
	if err != nil {
		return err
	}
	listingID, err := s.createGenericListing(ctx, runID, productID, normalized, map[string]any{
		"valid": true, "capacityReserved": true, "reservationExpiresAt": expiresAt.Format(time.RFC3339Nano),
		"creationActor": "agent", "draftRunId": runID, "sourceFingerprint": candidate.SourceFingerprint, "sellerPolicyReceipt": Receipt(policy),
	})
	if err != nil {
		return err
	}
	release = false
	return s.complete(runID, RunResult{ProductID: productID, ListingID: listingID})
}

func scanHostNetwork(ctx context.Context) (map[string]any, error) {
	client := &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	result := map[string]any{"checkedAt": time.Now().UTC().Format(time.RFC3339Nano)}
	metaRequest, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://speed.cloudflare.com/meta", nil)
	if response, err := client.Do(metaRequest); err == nil {
		defer response.Body.Close()
		var metadata map[string]any
		if response.StatusCode == http.StatusOK && json.NewDecoder(io.LimitReader(response.Body, 256<<10)).Decode(&metadata) == nil {
			for _, key := range []string{"clientIp", "city", "region", "country", "asOrganization"} {
				if value := metadata[key]; value != nil {
					result[key] = value
				}
			}
		}
	}
	latencies := []float64{}
	for index := 0; index < 3; index++ {
		started := time.Now()
		request, _ := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("https://speed.cloudflare.com/__down?bytes=0&cache=%d", time.Now().UnixNano()), nil)
		response, err := client.Do(request)
		if err != nil {
			continue
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1024))
		_ = response.Body.Close()
		if response.StatusCode >= 200 && response.StatusCode < 300 {
			latencies = append(latencies, float64(time.Since(started).Microseconds())/1000)
		}
	}
	if len(latencies) == 0 {
		return result, errors.New("public network latency probe failed")
	}
	var latency float64
	for _, value := range latencies {
		latency += value
	}
	result["latencyMs"] = latency / float64(len(latencies))
	const sampleBytes = 1 << 20
	started := time.Now()
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("https://speed.cloudflare.com/__down?bytes=%d&cache=%d", sampleBytes, time.Now().UnixNano()), nil)
	response, err := client.Do(request)
	if err != nil {
		return result, fmt.Errorf("public network throughput probe failed: %w", err)
	}
	written, copyErr := io.Copy(io.Discard, io.LimitReader(response.Body, sampleBytes+1))
	_ = response.Body.Close()
	if copyErr != nil || response.StatusCode < 200 || response.StatusCode >= 300 || written != sampleBytes {
		return result, errors.New("public network throughput probe returned an invalid sample")
	}
	result["downloadMbps"] = (float64(written) * 8 / 1_000_000) / time.Since(started).Seconds()
	return result, nil
}

func (s *Service) validateSelectedVMEnvironment(ctx context.Context, runID string, candidate Candidate, specification map[string]any) (map[string]any, error) {
	inventory := mapValue(candidate.Metadata, "environmentImages")
	if runtime.GOOS == "windows" {
		environmentID := firstNonEmpty(textValue(specification, "environmentId"), textValue(specification, "environmentImageId"))
		if environmentID == "" || !inventoryContains(inventory["environments"], environmentID, "environmentId", "name") {
			return nil, errors.New("selected VM environment is not installed; discover the host again or enable an explicit image installation workflow")
		}
		input := cloneMap(specification)
		input["environmentId"] = environmentID
		validated, err := s.worker.Call(ctx, "validate_environment_image", input)
		if err != nil {
			return nil, fmt.Errorf("installed WSL2 environment validation failed: %w", err)
		}
		return validated, nil
	}
	templateID := textValue(specification, "templateId")
	if templateID == "" {
		domain := textValue(specification, "domain")
		if domain == "" || !eligibleDomain(inventory["domains"], domain) {
			return nil, errors.New("selected KVM domain is not installed and shut off; discover the host again")
		}
		templateID = stableLocalID("tpl", runID)
		if _, err := s.worker.Call(ctx, "import_template", map[string]any{"domain": domain, "templateId": templateID}); err != nil {
			return nil, fmt.Errorf("KVM domain import failed: %w", err)
		}
		specification["templateId"] = templateID
	}
	validated, err := s.worker.Call(ctx, "validate_template", map[string]any{"templateId": templateID})
	if err != nil {
		return nil, fmt.Errorf("KVM template validation failed: %w", err)
	}
	return validated, nil
}

func inventoryContains(value any, target string, keys ...string) bool {
	for _, item := range anyMaps(value) {
		for _, key := range keys {
			if strings.EqualFold(strings.TrimSpace(fmt.Sprint(item[key])), strings.TrimSpace(target)) {
				return true
			}
		}
	}
	return false
}

func eligibleDomain(value any, target string) bool {
	for _, item := range anyMaps(value) {
		if strings.EqualFold(strings.TrimSpace(fmt.Sprint(item["name"])), strings.TrimSpace(target)) {
			eligible, _ := item["eligible"].(bool)
			return eligible
		}
	}
	return false
}

func anyMaps(value any) []map[string]any {
	out := []map[string]any{}
	switch items := value.(type) {
	case []map[string]any:
		return items
	case []any:
		for _, item := range items {
			if mapped, ok := item.(map[string]any); ok {
				out = append(out, mapped)
			}
		}
	}
	return out
}

func (s *Service) runEndpoint(ctx context.Context, runID string, policy SellerAutomationPolicy, candidate Candidate, normalized map[string]any) error {
	service, err := authorizedService(policy, candidate)
	if err != nil {
		return err
	}
	specification := mapValue(normalized, "specification")
	routes := endpointRoutes(specification["routes"])
	authType, header, secret, err := s.resolveCredential(normalized, service)
	if err != nil {
		return err
	}
	if err := s.step(runID, StatusProbing, 40, "Probing the authorized local/private Endpoint"); err != nil {
		return err
	}
	endpointID := stableLocalID("epd", runID)
	probe := endpoint.Probe(ctx, endpoint.ProbeInput{Config: endpoint.Config{EndpointID: endpointID, LocalBaseURL: service.BaseURL, HealthPath: textValue(specification, "healthPath"), Routes: routes}, AuthType: authType, APIKeyHeader: header, Secret: secret})
	if !probe.Healthy {
		return fmt.Errorf("Endpoint health probe failed: %s", firstNonEmpty(probe.Error, strconv.Itoa(probe.Status)))
	}
	if s.endpoints == nil {
		return errors.New("local Endpoint store is unavailable")
	}
	limits := mapValue(normalized, "limits")
	timeout := intNumber(limits, "timeoutSeconds", 120)
	concurrency := intNumber(limits, "concurrency", 1)
	saved, err := s.endpoints.Save(ctx, endpoint.Config{EndpointID: endpointID, LocalBaseURL: service.BaseURL, HealthPath: textValue(specification, "healthPath"), Routes: routes, AuthType: authType, CredentialRef: textValue(normalized, "credentialRef"), LastProbeHealthy: true, LastProbeAt: probe.CheckedAt, TimeoutSeconds: timeout, Concurrency: concurrency})
	if err != nil {
		return err
	}
	if s.notifyEndpoint != nil {
		s.notifyEndpoint()
	}
	_, _ = s.store.UpdateRun(runID, 0, func(run *Run) error {
		run.Result.EndpointID = saved.EndpointID
		return nil
	})
	if err := s.step(runID, StatusCreatingDraft, 75, "Creating a reviewed Endpoint draft and private Listing"); err != nil {
		return err
	}
	result, err := s.createServiceApplication(ctx, runID, policy, candidate, normalized, saved.EndpointID, "dock_tunnel", "none", "", "")
	if err != nil {
		return err
	}
	result.EndpointID = saved.EndpointID
	return s.complete(runID, result)
}

func (s *Service) runAPIBridge(ctx context.Context, runID string, policy SellerAutomationPolicy, candidate Candidate, normalized map[string]any) error {
	service, err := authorizedService(policy, candidate)
	if err != nil {
		return err
	}
	authType, header, secret, err := s.resolveCredential(normalized, service)
	if err != nil {
		return err
	}
	if err := s.step(runID, StatusProbing, 35, "Probing the public HTTPS API without redirects or private-network resolution"); err != nil {
		return err
	}
	if err := probePublicService(ctx, service.BaseURL, textValue(mapValue(normalized, "specification"), "healthPath"), authType, header, secret); err != nil {
		return err
	}
	if err := s.step(runID, StatusCreatingDraft, 70, "Creating a reviewed API Bridge draft for Cloud verification"); err != nil {
		return err
	}
	result, err := s.createServiceApplication(ctx, runID, policy, candidate, normalized, "", "transparent", authType, header, secret)
	if err != nil {
		return err
	}
	return s.complete(runID, result)
}

func (s *Service) createServiceApplication(ctx context.Context, runID string, policy SellerAutomationPolicy, candidate Candidate, normalized map[string]any, endpointID, bridgeMode, authType, header, secret string) (RunResult, error) {
	run, _ := s.store.GetRun(runID)
	specification := mapValue(normalized, "specification")
	draftPayload := map[string]any{
		"title": normalized["title"], "description": normalized["description"], "bridgeMode": bridgeMode,
		"protocol": specification["protocol"], "healthPath": specification["healthPath"], "routes": specification["routes"],
		"agentNotes": "Created by Dock seller automation run " + runID, "unresolvedFields": []string{},
	}
	if bridgeMode == "transparent" {
		draftPayload["baseUrl"] = textValue(mapValue(normalized, "service"), "baseUrl")
	}
	var draftResponse map[string]any
	if run.Result.DraftID != "" {
		if err := s.cloud.JSON(ctx, http.MethodGet, "/v3/provider/api-bridge-drafts/"+url.PathEscape(run.Result.DraftID), nil, &draftResponse); err != nil {
			return RunResult{}, err
		}
	} else {
		if err := s.cloud.JSON(ctx, http.MethodPost, "/v3/provider/api-bridge-drafts", draftPayload, &draftResponse); err != nil {
			return RunResult{}, err
		}
	}
	draft := mapValue(draftResponse, "draft")
	draftID := textValue(draft, "draftId")
	version := int64(intNumber(draft, "version", 0))
	if draftID == "" || version <= 0 {
		return RunResult{}, errors.New("Cloud did not return a versioned service draft")
	}
	if run.Result.DraftID == "" {
		_, _ = s.store.UpdateRun(runID, 0, func(current *Run) error {
			current.Result.DraftID = draftID
			return nil
		})
	}
	receipt, err := serviceReviewReceipt(draft, bridgeMode)
	if err != nil {
		return RunResult{}, err
	}
	payload := map[string]any{
		"idempotencyKey": runID + "-import", "draftId": draftID, "draftVersion": version, "reviewReceipt": receipt,
		"authType": authType, "apiKeyHeader": header, "secret": secret, "price": normalized["price"], "limits": normalized["limits"],
		"sellerPolicyReceipt": Receipt(policy), "creationActor": "agent", "draftRunId": runID,
		"sourceFingerprint": candidate.SourceFingerprint, "mcpConnection": run.Request.MCPConnectionID,
	}
	path := "/v3/provider/api-bridge-imports"
	if bridgeMode == "dock_tunnel" {
		path = "/v3/provider/endpoint-imports"
		payload["endpointId"] = endpointID
		payload["localConnectivityPassed"] = true
	} else {
		payload["materialFingerprint"] = candidate.SourceFingerprint
	}
	var imported struct {
		Product cloudProduct `json:"product"`
		Listing cloudListing `json:"listing"`
	}
	if err := s.cloud.JSON(ctx, http.MethodPost, path, payload, &imported); err != nil {
		return RunResult{}, err
	}
	return RunResult{ProductID: imported.Product.ProductID, ListingID: imported.Listing.ListingID, DraftID: draftID}, nil
}

func (s *Service) createGenericProduct(ctx context.Context, runID, kind string, normalized, manifest map[string]any) (string, error) {
	var response struct {
		Product cloudProduct `json:"product"`
	}
	err := s.cloud.JSON(ctx, http.MethodPost, "/v3/provider/products", map[string]any{
		"idempotencyKey": runID + "-product", "productKind": kind, "title": normalized["title"], "description": normalized["description"], "manifest": manifest,
	}, &response)
	if err != nil {
		return "", err
	}
	if response.Product.ProductID == "" {
		return "", errors.New("Cloud did not return a product id")
	}
	return response.Product.ProductID, nil
}

func (s *Service) createGenericListing(ctx context.Context, runID, productID string, normalized map[string]any, validation map[string]any) (string, error) {
	var response struct {
		Listing cloudListing `json:"listing"`
	}
	run, _ := s.store.GetRun(runID)
	err := s.cloud.JSON(ctx, http.MethodPost, "/v3/provider/listings", map[string]any{
		"idempotencyKey": runID + "-listing", "productId": productID, "price": normalized["price"], "limits": normalized["limits"],
		"availability": map[string]any{"availableNow": false, "reason": "Draft awaiting seller publication"}, "validation": validation,
		"creationActor": "agent", "draftRunId": runID, "sourceFingerprint": run.SourceFingerprint,
		"mcpConnection": run.Request.MCPConnectionID, "sellerPolicyReceipt": run.PolicyReceipt,
	}, &response)
	if err != nil {
		return "", err
	}
	if response.Listing.ListingID == "" {
		return "", errors.New("Cloud did not return a listing id")
	}
	return response.Listing.ListingID, nil
}

func provenanceManifest(runID string, policy SellerAutomationPolicy, fingerprint string, specification map[string]any) map[string]any {
	manifest := cloneMap(specification)
	manifest["creationActor"] = "agent"
	manifest["draftRunId"] = runID
	manifest["sourceFingerprint"] = fingerprint
	manifest["sellerPolicyReceipt"] = Receipt(policy)
	manifest["applicationSource"] = "resources"
	return manifest
}

func (s *Service) resolveCredential(normalized map[string]any, service AllowedService) (string, string, string, error) {
	ref := textValue(normalized, "credentialRef")
	if ref == "" {
		return "none", "", "", nil
	}
	metadata, secret, err := s.vault.Resolve(ref, service.ID)
	if err != nil {
		return "", "", "", err
	}
	return metadata.AuthType, metadata.APIKeyHeader, secret, nil
}

func endpointRoutes(value any) []endpoint.Route {
	routes := []endpoint.Route{}
	raw, _ := value.([]map[string]any)
	if raw == nil {
		items, _ := value.([]any)
		for _, item := range items {
			if route, ok := item.(map[string]any); ok {
				raw = append(raw, route)
			}
		}
	}
	for _, route := range raw {
		routes = append(routes, endpoint.Route{OperationID: textValue(route, "operationId"), Method: textValue(route, "method"), Path: textValue(route, "path")})
	}
	return routes
}

func probePublicService(ctx context.Context, baseURL, healthPath, authType, apiKeyHeader, secret string) error {
	base, err := publicHTTPSURL(ctx, baseURL)
	if err != nil {
		return err
	}
	target := base.ResolveReference(&url.URL{Path: healthPath})
	dialer := &net.Dialer{Timeout: 8 * time.Second}
	transport := &http.Transport{TLSHandshakeTimeout: 8 * time.Second, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil || len(addresses) == 0 {
			return nil, errors.New("API Bridge hostname could not be resolved")
		}
		for _, address := range addresses {
			ip := address.IP
			if !ip.IsGlobalUnicast() || ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
				return nil, errors.New("API Bridge DNS rebinding or non-public address rejected")
			}
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(addresses[0].IP.String(), port))
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	request := func(method string) (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, method, target.String(), nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", "application/json, text/event-stream;q=0.9, */*;q=0.5")
		applyAuth(req.Header, authType, apiKeyHeader, secret)
		return client.Do(req)
	}
	response, err := request(http.MethodHead)
	if err == nil && (response.StatusCode == http.StatusMethodNotAllowed || response.StatusCode == http.StatusNotImplemented) {
		_ = response.Body.Close()
		response, err = request(http.MethodGet)
	}
	if err != nil {
		return fmt.Errorf("API Bridge health probe failed: %w", err)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4<<10))
	if response.StatusCode < 200 || response.StatusCode >= 400 {
		return fmt.Errorf("API Bridge health probe returned HTTP %d", response.StatusCode)
	}
	if response.StatusCode >= 300 {
		return errors.New("API Bridge redirects are not allowed")
	}
	return nil
}

func applyAuth(headers http.Header, authType, apiKeyHeader, secret string) {
	switch authType {
	case "bearer":
		headers.Set("Authorization", "Bearer "+secret)
	case "basic":
		headers.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(secret)))
	case "api_key":
		headers.Set(firstNonEmpty(apiKeyHeader, "X-API-Key"), secret)
	}
}

func serviceReviewReceipt(draft map[string]any, bridgeMode string) ([]map[string]any, error) {
	var service any
	if bridgeMode == "transparent" {
		service = struct {
			Title       string `json:"title"`
			Description string `json:"description"`
			Protocol    string `json:"protocol"`
			BaseURL     string `json:"baseUrl"`
			HealthPath  string `json:"healthPath"`
		}{textValue(draft, "title"), textValue(draft, "description"), textValue(draft, "protocol"), textValue(draft, "baseUrl"), textValue(draft, "healthPath")}
	} else {
		service = struct {
			Title       string `json:"title"`
			Description string `json:"description"`
			Protocol    string `json:"protocol"`
			HealthPath  string `json:"healthPath"`
		}{textValue(draft, "title"), textValue(draft, "description"), textValue(draft, "protocol"), textValue(draft, "healthPath")}
	}
	receipt := []map[string]any{{"id": "service", "fingerprint": reviewFingerprint(service)}}
	routes, ok := draft["routes"].([]any)
	if !ok || len(routes) == 0 {
		return nil, errors.New("Cloud service draft returned no routes")
	}
	for _, item := range routes {
		route, ok := item.(map[string]any)
		if !ok {
			return nil, errors.New("Cloud service draft returned an invalid route")
		}
		var fingerprint any
		if bridgeMode == "transparent" {
			fingerprint = struct {
				OperationID                  string `json:"operationId"`
				Method                       string `json:"method"`
				Path                         string `json:"path"`
				Title                        string `json:"title"`
				Pricing                      any    `json:"pricing"`
				MaxChargePerInvocationAtomic any    `json:"maxChargePerInvocationAtomic"`
			}{textValue(route, "operationId"), textValue(route, "method"), textValue(route, "path"), textValue(route, "displayName"), route["pricing"], route["maxChargePerInvocationAtomic"]}
		} else {
			fingerprint = struct {
				OperationID                  string `json:"operationId"`
				Method                       string `json:"method"`
				Path                         string `json:"path"`
				DisplayName                  string `json:"displayName"`
				Pricing                      any    `json:"pricing"`
				MaxChargePerInvocationAtomic any    `json:"maxChargePerInvocationAtomic"`
			}{textValue(route, "operationId"), textValue(route, "method"), textValue(route, "path"), textValue(route, "displayName"), route["pricing"], route["maxChargePerInvocationAtomic"]}
		}
		receipt = append(receipt, map[string]any{"id": "route:" + textValue(route, "routeId"), "fingerprint": reviewFingerprint(fingerprint)})
	}
	return receipt, nil
}

func reviewFingerprint(value any) string {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(value)
	return strings.TrimSuffix(buffer.String(), "\n")
}

func stableLocalID(prefix, seed string) string {
	sum := sha256.Sum256([]byte(seed))
	return prefix + "_" + hex.EncodeToString(sum[:12])
}

func intNumber(value map[string]any, key string, fallback int) int {
	if number, ok := numberValue(value, key); ok {
		return int(number)
	}
	return fallback
}

func firstError(values ...error) error {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}
