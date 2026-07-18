package providerworker

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const workerWorkspaceChunkLimit = 512 << 10

func workerInt64(value any) int64 {
	switch typed := value.(type) {
	case int:
		return int64(typed)
	case int64:
		return typed
	case float64:
		return int64(typed)
	case json.Number:
		out, _ := typed.Int64()
		return out
	default:
		return 0
	}
}

func safeWorkspacePath(root, relative string) (string, error) {
	root, err := filepath.Abs(strings.TrimSpace(root))
	if err != nil || root == "" {
		return "", errors.New("workspace root is unavailable")
	}
	relative = filepath.FromSlash(strings.TrimSpace(relative))
	if relative == "" || filepath.IsAbs(relative) || filepath.VolumeName(relative) != "" {
		return "", errors.New("workspace relativePath is required")
	}
	clean := filepath.Clean(relative)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return "", errors.New("workspace_scope_violation")
	}
	target := filepath.Join(root, clean)
	resolved, err := filepath.Abs(target)
	if err != nil || (resolved != root && !strings.HasPrefix(resolved, root+string(os.PathSeparator))) {
		return "", errors.New("workspace_scope_violation")
	}
	return resolved, nil
}

func workspaceStatResult(root, relative string) (map[string]any, error) {
	target, err := safeWorkspacePath(root, relative)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(target)
	if err != nil {
		return nil, err
	}
	return map[string]any{"exists": true, "sizeBytes": info.Size(), "directory": info.IsDir(), "modifiedAt": info.ModTime().UTC()}, nil
}

func workspacePartialStatResult(root, relative string) (map[string]any, error) {
	target, err := safeWorkspacePath(root, relative)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(target + ".part")
	if errors.Is(err, os.ErrNotExist) {
		return map[string]any{"exists": false, "sizeBytes": int64(0)}, nil
	}
	if err != nil || info.IsDir() {
		return nil, errors.New("provider_local_policy_rejected: partial workspace file is unavailable")
	}
	return map[string]any{"exists": true, "sizeBytes": info.Size()}, nil
}

func workspaceReadResult(root, relative string, offset, limit int64) (map[string]any, error) {
	if offset < 0 {
		return nil, errors.New("offset must be non-negative")
	}
	if limit <= 0 || limit > workerWorkspaceChunkLimit {
		limit = workerWorkspaceChunkLimit
	}
	target, err := safeWorkspacePath(root, relative)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(target)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return nil, err
	}
	buffer := make([]byte, limit)
	n, readErr := file.Read(buffer)
	if readErr != nil && !errors.Is(readErr, io.EOF) {
		return nil, readErr
	}
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	return map[string]any{"dataBase64": base64.StdEncoding.EncodeToString(buffer[:n]), "offset": offset, "sizeBytes": info.Size(), "eof": offset+int64(n) >= info.Size()}, nil
}

func workspaceWriteResult(root, relative, dataBase64 string, offset int64, finalize bool, expectedSize int64, expectedSHA256 string) (map[string]any, error) {
	if offset < 0 {
		return nil, errors.New("offset must be non-negative")
	}
	target, err := safeWorkspacePath(root, relative)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		return nil, err
	}
	temporary := target + ".part"
	if dataBase64 != "" {
		data, decodeErr := base64.StdEncoding.DecodeString(dataBase64)
		if decodeErr != nil || len(data) > workerWorkspaceChunkLimit {
			return nil, errors.New("invalid workspace chunk")
		}
		file, openErr := os.OpenFile(temporary, os.O_CREATE|os.O_WRONLY, 0600)
		if openErr != nil {
			return nil, openErr
		}
		_, writeErr := file.WriteAt(data, offset)
		closeErr := file.Close()
		if writeErr != nil {
			return nil, writeErr
		}
		if closeErr != nil {
			return nil, closeErr
		}
	}
	info, err := os.Stat(temporary)
	if err != nil {
		return nil, err
	}
	if !finalize {
		return map[string]any{"writtenBytes": info.Size(), "finalized": false}, nil
	}
	if expectedSize < 0 || info.Size() != expectedSize {
		return nil, fmt.Errorf("transfer size mismatch: got %d want %d", info.Size(), expectedSize)
	}
	file, err := os.Open(temporary)
	if err != nil {
		return nil, err
	}
	digest := sha256.New()
	_, hashErr := io.Copy(digest, file)
	_ = file.Close()
	if hashErr != nil {
		return nil, hashErr
	}
	actual := hex.EncodeToString(digest.Sum(nil))
	if !strings.EqualFold(actual, strings.TrimSpace(expectedSHA256)) {
		return nil, errors.New("transfer_hash_mismatch")
	}
	if err := os.Rename(temporary, target); err != nil {
		return nil, err
	}
	return map[string]any{"writtenBytes": info.Size(), "finalized": true, "sha256": actual}, nil
}
