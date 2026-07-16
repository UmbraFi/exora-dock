package sellerdraft

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/providerworker"
	"gopkg.in/yaml.v3"
)

var readableMaterialExtensions = map[string]bool{
	".json": true, ".yaml": true, ".yml": true, ".md": true, ".markdown": true,
	".txt": true, ".csv": true,
}

func (s *Service) Discover(ctx context.Context, request DiscoverRequest) ([]Candidate, error) {
	policy, err := s.enabledPolicy()
	if err != nil {
		return nil, err
	}
	kinds := compactKinds(request.Kinds)
	if len(kinds) == 0 {
		kinds = append([]string(nil), policy.EnabledKinds...)
	}
	for _, kind := range kinds {
		if !KindEnabled(policy, kind) {
			return nil, fmt.Errorf("seller automation for %s is not authorized", kind)
		}
	}
	maximumResults := policy.Limits.MaxBatch * 20
	if containsKind(kinds, KindResources) && policy.Limits.MaxFiles > maximumResults {
		maximumResults = policy.Limits.MaxFiles
	}
	limit := request.MaxResults
	if limit <= 0 || limit > maximumResults {
		limit = maximumResults
	}
	query := strings.ToLower(strings.TrimSpace(request.Query))
	out := make([]Candidate, 0, limit)
	if containsKind(kinds, KindResources) || containsKind(kinds, KindEndpoint) || containsKind(kinds, KindAPIBridge) {
		files, err := discoverAllowedFiles(policy, kinds, request.TargetHints, query, limit)
		if err != nil {
			return nil, err
		}
		out = append(out, files...)
	}
	if len(out) < limit && (containsKind(kinds, KindEndpoint) || containsKind(kinds, KindAPIBridge)) {
		out = append(out, discoverAllowedServices(policy, kinds, request.TargetHints, query, limit-len(out))...)
	}
	if len(out) < limit && containsKind(kinds, KindVM) {
		candidate, err := discoverVM(ctx, s.worker)
		if err != nil {
			return nil, err
		}
		if matchesCandidate(candidate, request.TargetHints, query) {
			candidate.Metadata["autoInstallImages"] = policy.AutoInstallImages
			out = append(out, candidate)
		}
	}
	if len(out) > limit {
		out = out[:limit]
	}
	for i := range out {
		out[i].CandidateID = newID("cand")
		now := time.Now().UTC()
		out[i].CreatedAt = now.Format(time.RFC3339Nano)
		out[i].ExpiresAt = now.Add(CandidateTTL).Format(time.RFC3339Nano)
		if err := s.store.SaveCandidate(out[i]); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *Service) ReadMaterial(request ReadRequest) (MaterialChunk, error) {
	candidate, ok := s.store.Candidate(request.CandidateID)
	if !ok {
		return MaterialChunk{}, errors.New("candidate is missing or expired; discover it again")
	}
	if candidate.LocalPath == "" || !readableMaterialExtensions[strings.ToLower(filepath.Ext(candidate.LocalPath))] {
		return MaterialChunk{}, errors.New("candidate is not readable seller material")
	}
	policy, err := s.enabledPolicy()
	if err != nil {
		return MaterialChunk{}, err
	}
	file, info, root, err := openCandidateFile(policy, candidate)
	if err != nil {
		return MaterialChunk{}, err
	}
	defer file.Close()
	if root.ID != candidate.RootID || info.Size() > 5<<20 {
		return MaterialChunk{}, errors.New("seller material changed or exceeds the 5 MiB read limit")
	}
	data, err := io.ReadAll(io.LimitReader(file, (5<<20)+1))
	if err != nil || int64(len(data)) != info.Size() || len(data) > 5<<20 {
		return MaterialChunk{}, errors.New("seller material changed or exceeds the 5 MiB read limit")
	}
	sum := sha256.Sum256(data)
	fingerprint := hex.EncodeToString(sum[:])
	if fingerprint != candidate.SourceFingerprint || !candidatePathStillMatches(policy, candidate, info) {
		return MaterialChunk{}, errors.New("seller material changed after discovery; discover it again")
	}
	limit := request.Limit
	if limit <= 0 || limit > 256<<10 {
		limit = 64 << 10
	}
	if request.Offset < 0 || request.Offset > int64(len(data)) {
		return MaterialChunk{}, errors.New("material offset is invalid")
	}
	end := request.Offset + int64(limit)
	if end > int64(len(data)) {
		end = int64(len(data))
	}
	next := end
	chunk := MaterialChunk{CandidateID: candidate.CandidateID, Content: string(data[request.Offset:end]), Offset: request.Offset, EOF: next >= int64(len(data)), SHA256: fingerprint}
	if !chunk.EOF {
		chunk.NextOffset = next
	}
	return chunk, nil
}

func discoverAllowedFiles(policy SellerAutomationPolicy, kinds, hints []string, query string, limit int) ([]Candidate, error) {
	targets := make([]struct {
		path string
		root AllowedRoot
	}, 0)
	for _, root := range policy.AllowedRoots {
		if !rootSupportsAny(root, kinds) {
			continue
		}
		if len(hints) > 0 {
			for _, hint := range hints {
				candidate := strings.TrimSpace(hint)
				if candidate == "" {
					continue
				}
				if !filepath.IsAbs(candidate) {
					candidate = filepath.Join(root.Path, candidate)
				}
				if pathWithinRoot(candidate, root.Path) {
					targets = append(targets, struct {
						path string
						root AllowedRoot
					}{candidate, root})
				}
			}
		} else {
			targets = append(targets, struct {
				path string
				root AllowedRoot
			}{root.Path, root})
		}
	}
	seen := map[string]bool{}
	out := []Candidate{}
	for _, target := range targets {
		if len(out) >= limit {
			break
		}
		resolved, err := filepath.EvalSymlinks(target.path)
		if err != nil || !pathWithinRoot(resolved, target.root.Path) {
			continue
		}
		info, err := os.Stat(resolved)
		if err != nil {
			continue
		}
		add := func(path string, entryInfo os.FileInfo) error {
			if len(out) >= limit || !entryInfo.Mode().IsRegular() || seen[strings.ToLower(path)] {
				return nil
			}
			if entryInfo.Size() < 0 || entryInfo.Size() > policy.Limits.MaxBundleBytes {
				return nil
			}
			if query != "" && !strings.Contains(strings.ToLower(filepath.Base(path)), query) {
				return nil
			}
			fingerprint, err := fileFingerprint(path, policy.Limits.MaxBundleBytes)
			if err != nil {
				return nil
			}
			seen[strings.ToLower(path)] = true
			kind := KindResources
			extension := strings.ToLower(filepath.Ext(path))
			metadata := map[string]any{"fileName": filepath.Base(path), "sizeBytes": entryInfo.Size(), "extension": extension, "readableMaterial": readableMaterialExtensions[extension]}
			if entryInfo.Size() <= 5<<20 && (extension == ".json" || extension == ".yaml" || extension == ".yml") {
				if analysis := analyzeOpenAPIMaterial(path); analysis != nil {
					metadata["openapi"] = analysis
				}
			}
			out = append(out, Candidate{Kind: kind, DisplayName: filepath.Base(path), Summary: fmt.Sprintf("Authorized file (%d bytes)", entryInfo.Size()), RootID: target.root.ID, SourceFingerprint: fingerprint, Metadata: metadata, LocalPath: path})
			return nil
		}
		if info.Mode().IsRegular() {
			_ = add(resolved, info)
			continue
		}
		_ = filepath.WalkDir(resolved, func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil || len(out) >= limit {
				if len(out) >= limit && entry != nil && entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if entry.Type()&os.ModeSymlink != 0 {
				if entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if entry.IsDir() {
				return nil
			}
			actual, err := filepath.EvalSymlinks(path)
			if err != nil || !pathWithinRoot(actual, target.root.Path) {
				return nil
			}
			entryInfo, err := os.Stat(actual)
			if err == nil {
				_ = add(actual, entryInfo)
			}
			return nil
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].DisplayName < out[j].DisplayName })
	return out, nil
}

func discoverAllowedServices(policy SellerAutomationPolicy, kinds, hints []string, query string, limit int) []Candidate {
	out := []Candidate{}
	for _, service := range policy.AllowedServices {
		if len(out) >= limit || !containsKind(kinds, service.Mode) {
			continue
		}
		candidate := Candidate{Kind: service.Mode, DisplayName: firstNonEmpty(service.DisplayName, service.ID), Summary: service.BaseURL, ServiceID: service.ID, SourceFingerprint: serviceFingerprint(service), Metadata: map[string]any{"baseUrl": service.BaseURL, "mode": service.Mode, "credentialRef": service.CredentialRef}}
		if matchesCandidate(candidate, hints, query) {
			out = append(out, candidate)
		}
	}
	return out
}

func discoverVM(ctx context.Context, worker providerworker.Client) (Candidate, error) {
	if runtime.GOOS == "darwin" {
		return Candidate{}, errors.New("unsupported_host: VM seller automation is supported on Windows WSL2 and Linux KVM/libvirt")
	}
	if runtime.GOOS != "windows" && runtime.GOOS != "linux" {
		return Candidate{}, errors.New("unsupported_host: VM seller automation is not supported on this host")
	}
	runtimeInfo, err := worker.Call(ctx, "probe_runtime", map[string]any{})
	if err != nil {
		return Candidate{}, fmt.Errorf("VM runtime is unavailable: %w", err)
	}
	images, _ := worker.Call(ctx, "list_environment_images", map[string]any{})
	host, _ := worker.Call(ctx, "probe_host", map[string]any{})
	metadata := map[string]any{"platform": runtime.GOOS, "runtime": runtimeInfo, "environmentImages": images, "host": host, "autoInstallImages": false}
	raw := fmt.Sprintf("%s|%v|%v", runtime.GOOS, runtimeInfo, images)
	sum := sha256.Sum256([]byte(raw))
	return Candidate{Kind: KindVM, DisplayName: strings.ToUpper(runtime.GOOS) + " VM host", Summary: "Verified installed VM runtime and environment inventory", SourceFingerprint: hex.EncodeToString(sum[:]), Metadata: metadata}, nil
}

func revalidateCandidatePath(policy SellerAutomationPolicy, candidate Candidate) (string, os.FileInfo, AllowedRoot, error) {
	for _, root := range policy.AllowedRoots {
		if root.ID != candidate.RootID {
			continue
		}
		resolved, err := filepath.EvalSymlinks(candidate.LocalPath)
		if err != nil || !pathWithinRoot(resolved, root.Path) {
			return "", nil, AllowedRoot{}, errors.New("candidate escaped its authorized root or was replaced")
		}
		info, err := os.Stat(resolved)
		if err != nil || !info.Mode().IsRegular() {
			return "", nil, AllowedRoot{}, errors.New("candidate is no longer a regular file")
		}
		return resolved, info, root, nil
	}
	return "", nil, AllowedRoot{}, errors.New("candidate root is no longer authorized")
}

func openCandidateFile(policy SellerAutomationPolicy, candidate Candidate) (*os.File, os.FileInfo, AllowedRoot, error) {
	path, before, root, err := revalidateCandidatePath(policy, candidate)
	if err != nil {
		return nil, nil, AllowedRoot{}, err
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, nil, AllowedRoot{}, err
	}
	opened, err := file.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(before, opened) || !candidatePathStillMatches(policy, candidate, opened) {
		_ = file.Close()
		return nil, nil, AllowedRoot{}, errors.New("candidate changed while it was being opened")
	}
	return file, opened, root, nil
}

func candidatePathStillMatches(policy SellerAutomationPolicy, candidate Candidate, opened os.FileInfo) bool {
	_, current, root, err := revalidateCandidatePath(policy, candidate)
	return err == nil && root.ID == candidate.RootID && os.SameFile(opened, current)
}

func pathWithinRoot(path, root string) bool {
	resolved, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return false
	}
	relative, err := filepath.Rel(root, resolved)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func fileFingerprint(path string, maxBytes int64) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	written, err := io.Copy(hash, io.LimitReader(file, maxBytes+1))
	if err != nil {
		return "", err
	}
	if written > maxBytes {
		return "", errors.New("file exceeds authorized size limit")
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func analyzeOpenAPIMaterial(path string) map[string]any {
	raw, err := os.ReadFile(path)
	if err != nil || len(raw) > 5<<20 {
		return nil
	}
	var document struct {
		OpenAPI string `yaml:"openapi"`
		Info    struct {
			Title       string `yaml:"title"`
			Description string `yaml:"description"`
		} `yaml:"info"`
		Servers []struct {
			URL string `yaml:"url"`
		} `yaml:"servers"`
		Paths map[string]map[string]struct {
			OperationID string `yaml:"operationId"`
			Summary     string `yaml:"summary"`
		} `yaml:"paths"`
	}
	if yaml.Unmarshal(raw, &document) != nil || strings.TrimSpace(document.OpenAPI) == "" || len(document.Paths) == 0 {
		return nil
	}
	methods := map[string]bool{"get": true, "post": true, "put": true, "patch": true, "delete": true, "head": true, "options": true}
	paths := make([]string, 0, len(document.Paths))
	for routePath := range document.Paths {
		paths = append(paths, routePath)
	}
	sort.Strings(paths)
	operations := []map[string]any{}
	for _, routePath := range paths {
		methodNames := make([]string, 0, len(document.Paths[routePath]))
		for method := range document.Paths[routePath] {
			method = strings.ToLower(method)
			if methods[method] {
				methodNames = append(methodNames, method)
			}
		}
		sort.Strings(methodNames)
		for _, method := range methodNames {
			operation := document.Paths[routePath][method]
			operationID := strings.TrimSpace(operation.OperationID)
			if !operationIDPattern.MatchString(operationID) {
				sum := sha256.Sum256([]byte(method + " " + routePath))
				operationID = method + "_" + hex.EncodeToString(sum[:6])
			}
			operations = append(operations, map[string]any{"operationId": operationID, "method": strings.ToUpper(method), "path": routePath, "displayName": firstNonEmpty(operation.Summary, operationID)})
			if len(operations) >= 200 {
				break
			}
		}
		if len(operations) >= 200 {
			break
		}
	}
	servers := []string{}
	for _, server := range document.Servers {
		if value := strings.TrimSpace(server.URL); value != "" && !strings.Contains(value, "{") {
			servers = append(servers, value)
		}
	}
	return map[string]any{"version": document.OpenAPI, "title": document.Info.Title, "description": document.Info.Description, "servers": servers, "operations": operations}
}

func rootSupportsAny(root AllowedRoot, kinds []string) bool {
	for _, kind := range kinds {
		if containsKind(root.Kinds, kind) {
			return true
		}
	}
	return false
}

func matchesCandidate(candidate Candidate, hints []string, query string) bool {
	haystack := strings.ToLower(candidate.DisplayName + " " + candidate.Summary + " " + candidate.ServiceID)
	if query != "" && !strings.Contains(haystack, query) {
		return false
	}
	if len(hints) == 0 {
		return true
	}
	for _, hint := range hints {
		if strings.Contains(haystack, strings.ToLower(strings.TrimSpace(hint))) {
			return true
		}
	}
	return false
}

func serviceFingerprint(service AllowedService) string {
	raw := fmt.Sprintf("%s|%s|%s|%v|%v|%s", service.ID, service.Mode, service.BaseURL, service.AllowedPorts, service.AllowedHosts, service.CredentialRef)
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func publicHTTPSURL(ctx context.Context, raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return nil, errors.New("API Bridge base URL must be public HTTPS without embedded credentials")
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, parsed.Hostname())
	if err != nil || len(addresses) == 0 {
		return nil, errors.New("API Bridge hostname could not be resolved")
	}
	for _, address := range addresses {
		ip := address.IP
		if !ip.IsGlobalUnicast() || ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			return nil, errors.New("API Bridge hostname resolved to a non-public address")
		}
	}
	return parsed, nil
}
