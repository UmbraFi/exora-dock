package sellerdraft

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type cloudProduct struct {
	ProductID string `json:"productId"`
}
type cloudListing struct {
	ListingID string `json:"listingId"`
}

func (s *Service) runResources(ctx context.Context, runID string, policy SellerAutomationPolicy, candidates []Candidate, normalized map[string]any) error {
	if len(candidates) == 0 || len(candidates) > 1000 {
		return errors.New("a resource sheet must contain between 1 and 1000 files")
	}
	if err := s.step(runID, StatusPackaging, 30, "Revalidating each independent resource file"); err != nil {
		return err
	}
	type preparedResource struct {
		candidate Candidate
		size      int64
	}
	prepared := make([]preparedResource, 0, len(candidates))
	items := make([]map[string]any, 0, len(candidates))
	specification := mapValue(normalized, "specification")
	license := textValue(specification, "license")
	grantHours := intNumber(specification, "grantHours", 24)
	for index, candidate := range candidates {
		file, info, _, err := openCandidateFile(policy, candidate)
		if err != nil {
			return err
		}
		_ = file.Close()
		if info.Size() > 1<<30 {
			return fmt.Errorf("resource file %s exceeds 1 GiB", candidate.DisplayName)
		}
		fileName := filepath.Base(firstNonEmpty(candidate.DisplayName, candidate.LocalPath))
		itemTerms := map[string]any{}
		for _, candidateTerms := range anyMaps(specification["resourceItems"]) {
			if textValue(candidateTerms, "candidateId") == candidate.CandidateID || (textValue(candidateTerms, "candidateId") == "" && strings.EqualFold(textValue(candidateTerms, "fileName"), filepath.Base(candidate.DisplayName))) {
				itemTerms = candidateTerms
				break
			}
		}
		description := firstNonEmpty(textValue(itemTerms, "description"), candidate.Summary, textValue(normalized, "description"))
		if strings.TrimSpace(description) == "" {
			description = "Independent resource file " + candidate.DisplayName
		}
		itemPrice := mapValue(itemTerms, "price")
		if itemPrice == nil {
			itemPrice = mapValue(normalized, "price")
		}
		items = append(items, map[string]any{
			"clientId": candidate.CandidateID, "title": firstNonEmpty(textValue(itemTerms, "title"), candidate.DisplayName, fmt.Sprintf("Resource %d", index+1)),
			"description": description, "fileName": fileName, "contentType": "application/octet-stream",
			"license": firstNonEmpty(textValue(itemTerms, "license"), license), "price": cloneMap(itemPrice), "grantHours": intNumber(itemTerms, "grantHours", grantHours),
			"sizeBytes": info.Size(), "sha256": candidate.SourceFingerprint,
		})
		prepared = append(prepared, preparedResource{candidate: candidate, size: info.Size()})
	}
	var sheet struct {
		Product cloudProduct `json:"product"`
		Listing cloudListing `json:"listing"`
	}
	if err := s.cloud.JSON(ctx, http.MethodPost, "/v3/provider/resource-sheets", map[string]any{
		"idempotencyKey": runID + "-sheet", "title": normalized["title"], "description": normalized["description"],
		"category": firstNonEmpty(textValue(specification, "category"), "other"), "license": license, "grantHours": grantHours,
	}, &sheet); err != nil {
		return err
	}
	if sheet.Product.ProductID == "" || sheet.Listing.ListingID == "" {
		return errors.New("Cloud did not return resource sheet ids")
	}
	var created struct {
		Items []struct {
			ResourceItemID string `json:"resourceItemId"`
		} `json:"items"`
	}
	if err := s.cloud.JSON(ctx, http.MethodPost, "/v3/provider/resource-sheets/"+url.PathEscape(sheet.Listing.ListingID)+"/items", map[string]any{
		"idempotencyKey": runID + "-items", "items": items,
	}, &created); err != nil {
		return err
	}
	if len(created.Items) != len(prepared) {
		return errors.New("Cloud returned an incomplete resource item batch")
	}
	if err := s.step(runID, StatusUploading, 50, "Uploading and verifying each resource file independently"); err != nil {
		return err
	}
	lastUploadID := ""
	for index, resource := range prepared {
		uploadID, err := s.uploadResourceCandidate(ctx, policy, created.Items[index].ResourceItemID, resource.candidate, resource.size)
		if err != nil {
			return err
		}
		lastUploadID = uploadID
		_, _ = s.store.UpdateRun(runID, 0, func(run *Run) error {
			run.Progress = 50 + int(float64(index+1)/float64(len(prepared))*40)
			return nil
		})
	}
	if err := s.step(runID, StatusCreatingDraft, 95, "Resource sheet and independently purchasable files are ready for review"); err != nil {
		return err
	}
	return s.complete(runID, RunResult{ProductID: sheet.Product.ProductID, ListingID: sheet.Listing.ListingID, UploadSessionID: lastUploadID})
}

func (s *Service) uploadResourceCandidate(ctx context.Context, policy SellerAutomationPolicy, resourceItemID string, candidate Candidate, size int64) (string, error) {
	var started struct {
		Upload struct {
			UploadSessionID string `json:"uploadSessionId"`
		} `json:"upload"`
		ZeroByte bool `json:"zeroByte"`
	}
	if err := s.cloud.JSON(ctx, http.MethodPost, "/v3/provider/resource-items/"+url.PathEscape(resourceItemID)+"/multipart", map[string]any{}, &started); err != nil {
		return "", err
	}
	if started.ZeroByte {
		return "", nil
	}
	uploadID := started.Upload.UploadSessionID
	if uploadID == "" {
		return "", errors.New("Cloud did not return a resource upload session id")
	}
	file, info, _, err := openCandidateFile(policy, candidate)
	if err != nil {
		return uploadID, err
	}
	defer file.Close()
	if info.Size() != size {
		return uploadID, errors.New("resource changed before upload; discover it again")
	}
	const partSize int64 = 16 << 20
	count := int((size + partSize - 1) / partSize)
	numbers := make([]int, count)
	for i := range numbers {
		numbers[i] = i + 1
	}
	var presigned struct {
		URLs map[string]string `json:"urls"`
	}
	if err := s.cloud.JSON(ctx, http.MethodPost, "/v3/provider/uploads/"+url.PathEscape(uploadID)+"/parts/presign", map[string]any{"partNumbers": numbers}, &presigned); err != nil {
		return uploadID, err
	}
	parts := make([]map[string]any, 0, count)
	for _, partNumber := range numbers {
		offset := int64(partNumber-1) * partSize
		length := partSize
		if remaining := size - offset; remaining < length {
			length = remaining
		}
		etag, err := s.cloud.PUTPart(ctx, presigned.URLs[strconv.Itoa(partNumber)], io.NewSectionReader(file, offset, length), length)
		if err != nil {
			return uploadID, err
		}
		parts = append(parts, map[string]any{"partNumber": partNumber, "etag": etag})
	}
	if err := s.cloud.JSON(ctx, http.MethodPost, "/v3/provider/uploads/"+url.PathEscape(uploadID)+"/complete", map[string]any{"parts": parts}, nil); err != nil {
		return uploadID, err
	}
	return uploadID, nil
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
	manifest["price"] = cloneMap(mapValue(normalized, "price"))
	manifest["limits"] = cloneMap(mapValue(normalized, "limits"))
	manifest["workloadPolicy"] = cloneMap(mapValue(normalized, "workloadPolicy"))
	manifest["performancePolicy"] = cloneMap(mapValue(normalized, "performancePolicy"))
	productID, err := s.createGenericProduct(ctx, runID, ApplicationVM, "compute", normalized, manifest)
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

func (s *Service) createGenericProduct(ctx context.Context, runID string, source ApplicationSource, kind string, normalized, manifest map[string]any) (string, error) {
	var response struct {
		Product cloudProduct `json:"product"`
	}
	err := s.cloud.JSON(ctx, http.MethodPost, "/v3/provider/products", map[string]any{
		"idempotencyKey": runID + "-product", "productKind": kind, "applicationSource": source, "title": normalized["title"], "description": normalized["description"], "manifest": manifest,
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
		"idempotencyKey": runID + "-listing", "productId": productID, "price": normalized["price"], "limits": normalized["limits"], "workloadPolicy": normalized["workloadPolicy"], "performancePolicy": normalized["performancePolicy"],
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
