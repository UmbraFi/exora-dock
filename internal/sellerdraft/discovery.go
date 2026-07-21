package sellerdraft

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var readableMaterialExtensions = map[string]bool{".json": true, ".yaml": true, ".yml": true, ".md": true, ".txt": true, ".go": true, ".js": true, ".ts": true, ".py": true}

func (s *Service) Discover(_ context.Context, request DiscoverRequest) ([]Candidate, error) {
	policy, err := s.enabledPolicy()
	if err != nil {
		return nil, err
	}
	if kinds := compactKinds(request.Kinds); len(request.Kinds) > 0 && len(kinds) == 0 {
		return nil, errors.New("only api discovery is supported")
	}
	limit := request.MaxResults
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	query := strings.ToLower(strings.TrimSpace(request.Query))
	hints := map[string]bool{}
	for _, hint := range request.TargetHints {
		hints[strings.ToLower(filepath.Base(strings.TrimSpace(hint)))] = true
	}
	out := []Candidate{}
	for _, root := range policy.AllowedRoots {
		_ = filepath.WalkDir(root.Path, func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil || len(out) >= limit {
				if entry != nil && entry.IsDir() {
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
				if path != root.Path && filepath.Base(path) == ".exora" {
					return filepath.SkipDir
				}
				return nil
			}
			resolved, resolveErr := filepath.EvalSymlinks(path)
			if resolveErr != nil || !pathWithinRoot(resolved, root.Path) {
				return nil
			}
			info, statErr := os.Stat(resolved)
			if statErr != nil || !info.Mode().IsRegular() || info.Size() > 5<<20 {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(resolved))
			if !readableMaterialExtensions[ext] {
				return nil
			}
			name := strings.ToLower(filepath.Base(resolved))
			if query != "" && !strings.Contains(name, query) {
				return nil
			}
			if len(hints) > 0 && !hints[name] {
				return nil
			}
			raw, readErr := os.ReadFile(resolved)
			if readErr != nil {
				return nil
			}
			sum := sha256.Sum256(raw)
			now := time.Now().UTC()
			candidate := Candidate{CandidateID: newID("cand"), Kind: KindAPI, DisplayName: filepath.Base(resolved), Summary: fmt.Sprintf("Authorized project material (%d bytes)", len(raw)), RootID: root.ID, SourceFingerprint: hex.EncodeToString(sum[:]), Metadata: map[string]any{"extension": ext, "sizeBytes": len(raw), "readableMaterial": true}, CreatedAt: now.Format(time.RFC3339Nano), ExpiresAt: now.Add(CandidateTTL).Format(time.RFC3339Nano), LocalPath: resolved}
			if saveErr := s.store.SaveCandidate(candidate); saveErr != nil {
				return saveErr
			}
			out = append(out, candidate)
			return nil
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].DisplayName < out[j].DisplayName })
	return out, nil
}

func (s *Service) ReadMaterial(request ReadRequest) (MaterialChunk, error) {
	candidate, ok := s.store.Candidate(request.CandidateID)
	if !ok {
		return MaterialChunk{}, errors.New("candidate is missing or expired")
	}
	policy, err := s.enabledPolicy()
	if err != nil {
		return MaterialChunk{}, err
	}
	var root string
	for _, allowed := range policy.AllowedRoots {
		if allowed.ID == candidate.RootID {
			root = allowed.Path
		}
	}
	if root == "" {
		return MaterialChunk{}, errors.New("candidate root is no longer authorized")
	}
	resolved, err := filepath.EvalSymlinks(candidate.LocalPath)
	if err != nil || !pathWithinRoot(resolved, root) {
		return MaterialChunk{}, errors.New("candidate escaped its authorized root")
	}
	info, err := os.Lstat(resolved)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() > 5<<20 {
		return MaterialChunk{}, errors.New("candidate is no longer a bounded regular file")
	}
	file, err := os.Open(resolved)
	if err != nil {
		return MaterialChunk{}, err
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, (5<<20)+1))
	if err != nil || len(raw) > 5<<20 {
		return MaterialChunk{}, errors.New("material exceeds 5 MiB")
	}
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:])
	if hash != candidate.SourceFingerprint {
		return MaterialChunk{}, errors.New("candidate changed after discovery")
	}
	if request.Offset < 0 || request.Offset > int64(len(raw)) {
		return MaterialChunk{}, errors.New("offset is outside material")
	}
	limit := request.Limit
	if limit <= 0 || limit > 256<<10 {
		limit = 64 << 10
	}
	end := request.Offset + int64(limit)
	if end > int64(len(raw)) {
		end = int64(len(raw))
	}
	return MaterialChunk{CandidateID: candidate.CandidateID, Content: string(raw[request.Offset:end]), Offset: request.Offset, NextOffset: end, EOF: end == int64(len(raw)), SHA256: hash}, nil
}

func pathWithinRoot(path, root string) bool {
	relative, err := filepath.Rel(filepath.Clean(root), filepath.Clean(path))
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative)
}
