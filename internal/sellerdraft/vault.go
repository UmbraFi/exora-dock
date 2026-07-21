package sellerdraft

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/exora-dock/exora-dock/internal/accountscope"
)

type credentialRecord struct {
	CredentialMetadata
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

type vaultFile struct {
	Version     int                `json:"version"`
	Credentials []credentialRecord `json:"credentials"`
}

type CredentialVault struct {
	path    string
	keyPath string
	mu      sync.Mutex
}

func NewCredentialVault(dataDir, accountID string) *CredentialVault {
	accountID = strings.TrimSpace(accountID)
	root := filepath.Join(dataDir, "seller-automation", "accounts", accountscope.Namespace(accountID))
	return &CredentialVault{path: filepath.Join(root, "credentials.json"), keyPath: filepath.Join(root, "credentials.key")}
}

func (v *CredentialVault) Put(meta CredentialMetadata, secret string) (CredentialMetadata, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return CredentialMetadata{}, fmt.Errorf("credential secret is required")
	}
	meta.AuthType = strings.ToLower(strings.TrimSpace(meta.AuthType))
	allowed := map[string]bool{"none": true, "bearer": true, "basic": true, "api_key": true, "header_api_key": true, "oauth2_client_credentials": true}
	if !allowed[meta.AuthType] {
		return CredentialMetadata{}, fmt.Errorf("unsupported authType")
	}
	if (meta.AuthType == "api_key" || strings.HasSuffix(meta.AuthType, "_api_key")) && strings.TrimSpace(meta.APIKeyHeader) == "" {
		meta.APIKeyHeader = "X-API-Key"
	}
	file, err := v.load()
	if err != nil {
		return CredentialMetadata{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	index := -1
	for i := range file.Credentials {
		if file.Credentials[i].CredentialRef == meta.CredentialRef && meta.CredentialRef != "" {
			index = i
			meta.CreatedAt = file.Credentials[i].CreatedAt
			break
		}
	}
	if meta.CredentialRef == "" {
		meta.CredentialRef = newID("cred")
	}
	if strings.TrimSpace(meta.Label) == "" {
		meta.Label = meta.CredentialRef
	}
	if meta.CreatedAt == "" {
		meta.CreatedAt = now
	}
	meta.UpdatedAt = now
	nonce, ciphertext, err := v.encrypt([]byte(secret))
	if err != nil {
		return CredentialMetadata{}, err
	}
	record := credentialRecord{CredentialMetadata: meta, Nonce: nonce, Ciphertext: ciphertext}
	if index >= 0 {
		file.Credentials[index] = record
	} else {
		file.Credentials = append(file.Credentials, record)
	}
	return meta, v.save(file)
}

func (v *CredentialVault) List() ([]CredentialMetadata, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	file, err := v.load()
	if err != nil {
		return nil, err
	}
	out := make([]CredentialMetadata, 0, len(file.Credentials))
	for _, record := range file.Credentials {
		out = append(out, record.CredentialMetadata)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Label < out[j].Label })
	return out, nil
}

func (v *CredentialVault) Resolve(ref string, serviceID string) (CredentialMetadata, string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	file, err := v.load()
	if err != nil {
		return CredentialMetadata{}, "", err
	}
	for _, record := range file.Credentials {
		if record.CredentialRef != strings.TrimSpace(ref) {
			continue
		}
		if serviceID != "" && len(record.ServiceIDs) > 0 && !containsString(record.ServiceIDs, serviceID) {
			return CredentialMetadata{}, "", fmt.Errorf("credential is not authorized for this service")
		}
		secret, err := v.decrypt(record.Nonce, record.Ciphertext)
		return record.CredentialMetadata, string(secret), err
	}
	return CredentialMetadata{}, "", fmt.Errorf("credential reference not found")
}

func (v *CredentialVault) Delete(ref string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	file, err := v.load()
	if err != nil {
		return err
	}
	next := file.Credentials[:0]
	for _, record := range file.Credentials {
		if record.CredentialRef != strings.TrimSpace(ref) {
			next = append(next, record)
		}
	}
	file.Credentials = next
	return v.save(file)
}

func (v *CredentialVault) encrypt(plain []byte) (string, string, error) {
	key, err := v.key()
	if err != nil {
		return "", "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", "", err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", "", err
	}
	ciphertext := aead.Seal(nil, nonce, plain, nil)
	return base64.StdEncoding.EncodeToString(nonce), base64.StdEncoding.EncodeToString(ciphertext), nil
}

func (v *CredentialVault) decrypt(nonceText, cipherText string) ([]byte, error) {
	key, err := v.key()
	if err != nil {
		return nil, err
	}
	nonce, err := base64.StdEncoding.DecodeString(nonceText)
	if err != nil {
		return nil, fmt.Errorf("credential vault nonce is invalid")
	}
	ciphertext, err := base64.StdEncoding.DecodeString(cipherText)
	if err != nil {
		return nil, fmt.Errorf("credential vault ciphertext is invalid")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return aead.Open(nil, nonce, ciphertext, nil)
}

func (v *CredentialVault) key() ([]byte, error) {
	if raw, err := os.ReadFile(v.keyPath); err == nil {
		if len(raw) != 32 {
			return nil, fmt.Errorf("credential vault key is invalid")
		}
		return raw, nil
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(v.keyPath), 0700); err != nil {
		return nil, err
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	if err := os.WriteFile(v.keyPath, raw, 0600); err != nil {
		return nil, err
	}
	return raw, nil
}

func (v *CredentialVault) load() (vaultFile, error) {
	raw, err := os.ReadFile(v.path)
	if os.IsNotExist(err) {
		return vaultFile{Version: 1}, nil
	}
	if err != nil {
		return vaultFile{}, err
	}
	var file vaultFile
	if json.Unmarshal(raw, &file) != nil || file.Version != 1 {
		return vaultFile{}, fmt.Errorf("credential vault is invalid")
	}
	return file, nil
}

func (v *CredentialVault) save(file vaultFile) error {
	if err := os.MkdirAll(filepath.Dir(v.path), 0700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	temporary := v.path + ".tmp"
	if err := os.WriteFile(temporary, append(raw, '\n'), 0600); err != nil {
		return err
	}
	return os.Rename(temporary, v.path)
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
