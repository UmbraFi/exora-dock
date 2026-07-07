package wallet

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gagliardetto/solana-go"
	"golang.org/x/crypto/argon2"
)

const (
	profileFileName          = "profile.json"
	keypairFileName          = "solana-keypair.json"
	encryptedKeypairFileName = "solana-keypair.encrypted.json"
	backupVersion            = 1
)

type Status struct {
	Address              string             `json:"address"`
	LocalKeypair         bool               `json:"localKeypair"`
	KeypairPath          string             `json:"keypairPath,omitempty"`
	EncryptedKeypairPath string             `json:"encryptedKeypairPath,omitempty"`
	BoundOnly            bool               `json:"boundOnly"`
	AccountBound         bool               `json:"accountBound"`
	Unlocked             bool               `json:"unlocked"`
	BackupStatus         string             `json:"backupStatus,omitempty"`
	Balances             map[string]Balance `json:"balances,omitempty"`
	FeePolicy            *FeePolicy         `json:"feePolicy,omitempty"`
	USDCMint             string             `json:"usdcMint,omitempty"`
	CreatedAt            string             `json:"createdAt,omitempty"`
	UpdatedAt            string             `json:"updatedAt,omitempty"`
	Configured           bool               `json:"configured"`
}

type CreateRequest struct {
	RecoveryPassword string `json:"recoveryPassword,omitempty"`
	Overwrite        bool   `json:"overwrite"`
}

type UnlockRequest struct {
	RecoveryPassword string `json:"recoveryPassword"`
}

type RestoreRequest struct {
	RecoveryPassword string          `json:"recoveryPassword"`
	Backup           EncryptedBackup `json:"backup"`
}

type ClearRequest struct {
	DeleteLocalKeypair bool `json:"deleteLocalKeypair"`
}

type Balance struct {
	AmountAtomic uint64 `json:"amountAtomic"`
	Decimals     uint8  `json:"decimals,omitempty"`
	Currency     string `json:"currency"`
	Mint         string `json:"mint,omitempty"`
	Status       string `json:"status,omitempty"`
	UpdatedAt    string `json:"updatedAt,omitempty"`
}

type FeePolicy struct {
	Currency            string `json:"currency"`
	RelayFeeAtomic      uint64 `json:"relayFeeAtomic"`
	RelayFeeDescription string `json:"relayFeeDescription,omitempty"`
	GasPaidBy           string `json:"gasPaidBy"`
}

type KDFParams struct {
	Name    string `json:"name"`
	Salt    string `json:"salt"`
	Time    uint32 `json:"time"`
	Memory  uint32 `json:"memory"`
	Threads uint8  `json:"threads"`
	KeyLen  uint32 `json:"keyLen"`
}

type EncryptedBackup struct {
	Version   int       `json:"version"`
	PublicKey string    `json:"publicKey"`
	Cipher    string    `json:"cipher"`
	KDF       KDFParams `json:"kdf"`
	Nonce     string    `json:"nonce"`
	Data      string    `json:"data"`
	CreatedAt string    `json:"createdAt"`
	UpdatedAt string    `json:"updatedAt"`
}

type Store struct {
	dir                  string
	profilePath          string
	keypairPath          string
	encryptedKeypairPath string
	mu                   sync.Mutex
	unlocked             *solana.PrivateKey
}

func NewStore(path string) *Store {
	dir := strings.TrimSpace(path)
	if dir == "" {
		dir = filepath.Join(".", "data", "wallet")
	}
	if strings.EqualFold(filepath.Ext(dir), ".json") {
		profile := dir
		base := filepath.Dir(profile)
		return &Store{
			dir:                  base,
			profilePath:          profile,
			keypairPath:          filepath.Join(base, keypairFileName),
			encryptedKeypairPath: filepath.Join(base, encryptedKeypairFileName),
		}
	}
	return &Store{
		dir:                  dir,
		profilePath:          filepath.Join(dir, profileFileName),
		keypairPath:          filepath.Join(dir, keypairFileName),
		encryptedKeypairPath: filepath.Join(dir, encryptedKeypairFileName),
	}
}

func (s *Store) Current() (Status, error) {
	data, err := os.ReadFile(s.profilePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Status{Configured: false}, nil
		}
		return Status{}, err
	}
	var status Status
	if err := json.Unmarshal(data, &status); err != nil {
		return Status{}, err
	}
	status.Configured = strings.TrimSpace(status.Address) != ""
	status.AccountBound = status.Configured && !status.BoundOnly
	status.EncryptedKeypairPath = firstNonEmpty(status.EncryptedKeypairPath, s.encryptedKeypairPath)
	status.Unlocked = s.isUnlocked(status)
	if status.BackupStatus == "" && status.Configured {
		status.BackupStatus = s.deriveBackupStatus(status)
	}
	return status, nil
}

func (s *Store) Create(req CreateRequest) (Status, error) {
	if !req.Overwrite {
		current, err := s.Current()
		if err != nil {
			return Status{}, err
		}
		if current.Configured {
			return Status{}, fmt.Errorf("wallet already configured")
		}
	}

	w := solana.NewWallet()
	if err := os.MkdirAll(s.dir, 0700); err != nil {
		return Status{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	keypairPath := ""
	encryptedPath := ""
	backupStatus := "local_only"
	if strings.TrimSpace(req.RecoveryPassword) == "" {
		if err := writeSolanaKeypairFile(s.keypairPath, []byte(w.PrivateKey)); err != nil {
			return Status{}, err
		}
		keypairPath = s.keypairPath
	} else {
		backup, err := EncryptPrivateKey(w.PrivateKey, req.RecoveryPassword, now)
		if err != nil {
			return Status{}, err
		}
		if err := s.writeBackup(backup); err != nil {
			return Status{}, err
		}
		encryptedPath = s.encryptedKeypairPath
		backupStatus = "encrypted_local"
		s.setUnlocked(w.PrivateKey)
		_ = os.Remove(s.keypairPath)
	}
	status := Status{
		Address:              w.PublicKey().String(),
		LocalKeypair:         true,
		KeypairPath:          keypairPath,
		EncryptedKeypairPath: encryptedPath,
		BoundOnly:            false,
		AccountBound:         true,
		Unlocked:             true,
		BackupStatus:         backupStatus,
		CreatedAt:            now,
		UpdatedAt:            now,
		Configured:           true,
	}
	return status, s.save(status)
}

func (s *Store) Unlock(req UnlockRequest) (Status, error) {
	if strings.TrimSpace(req.RecoveryPassword) == "" {
		return Status{}, fmt.Errorf("recoveryPassword required")
	}
	current, err := s.Current()
	if err != nil {
		return Status{}, err
	}
	if !current.Configured || current.BoundOnly {
		return Status{}, fmt.Errorf("account wallet is not configured")
	}
	backup, err := s.Backup()
	if err != nil {
		return Status{}, err
	}
	privateKey, err := DecryptPrivateKey(backup, req.RecoveryPassword)
	if err != nil {
		return Status{}, err
	}
	address := privateKey.PublicKey().String()
	if current.Address != "" && current.Address != address {
		return Status{}, fmt.Errorf("wallet backup does not match profile")
	}
	s.setUnlocked(privateKey)
	current.Unlocked = true
	current.BackupStatus = "encrypted_local"
	current.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return current, s.save(current)
}

func (s *Store) Restore(req RestoreRequest) (Status, error) {
	if strings.TrimSpace(req.RecoveryPassword) == "" {
		return Status{}, fmt.Errorf("recoveryPassword required")
	}
	privateKey, err := DecryptPrivateKey(req.Backup, req.RecoveryPassword)
	if err != nil {
		return Status{}, err
	}
	if strings.TrimSpace(req.Backup.PublicKey) != "" && req.Backup.PublicKey != privateKey.PublicKey().String() {
		return Status{}, fmt.Errorf("wallet backup public key mismatch")
	}
	if err := os.MkdirAll(s.dir, 0700); err != nil {
		return Status{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	backup := req.Backup
	backup.PublicKey = privateKey.PublicKey().String()
	if backup.CreatedAt == "" {
		backup.CreatedAt = now
	}
	backup.UpdatedAt = now
	if err := s.writeBackup(backup); err != nil {
		return Status{}, err
	}
	_ = os.Remove(s.keypairPath)
	s.setUnlocked(privateKey)
	status := Status{
		Address:              privateKey.PublicKey().String(),
		LocalKeypair:         true,
		EncryptedKeypairPath: s.encryptedKeypairPath,
		BoundOnly:            false,
		AccountBound:         true,
		Unlocked:             true,
		BackupStatus:         "encrypted_local",
		CreatedAt:            firstNonEmpty(backup.CreatedAt, now),
		UpdatedAt:            now,
		Configured:           true,
	}
	return status, s.save(status)
}

func (s *Store) Clear(req ClearRequest) (Status, error) {
	current, err := s.Current()
	if err != nil {
		return Status{}, err
	}
	if err := os.Remove(s.profilePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return Status{}, err
	}
	if req.DeleteLocalKeypair && current.LocalKeypair && current.KeypairPath != "" {
		if err := os.Remove(current.KeypairPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return Status{}, err
		}
	}
	if req.DeleteLocalKeypair {
		if err := os.Remove(s.encryptedKeypairPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return Status{}, err
		}
		s.mu.Lock()
		s.unlocked = nil
		s.mu.Unlock()
	}
	return Status{Configured: false}, nil
}

func (s *Store) KeypairPath() string {
	return s.keypairPath
}

func (s *Store) Backup() (EncryptedBackup, error) {
	data, err := os.ReadFile(s.encryptedKeypairPath)
	if err != nil {
		return EncryptedBackup{}, err
	}
	var backup EncryptedBackup
	if err := json.Unmarshal(data, &backup); err != nil {
		return EncryptedBackup{}, err
	}
	return backup, nil
}

func (s *Store) SignPayload(payload []byte) (string, string, error) {
	current, err := s.Current()
	if err != nil {
		return "", "", err
	}
	if !current.Configured || !current.LocalKeypair {
		return "", "", fmt.Errorf("local wallet keypair required")
	}
	privateKey, err := s.signingPrivateKey(current)
	if err != nil {
		return "", "", err
	}
	address := privateKey.PublicKey().String()
	if strings.TrimSpace(current.Address) != "" && current.Address != address {
		return "", "", fmt.Errorf("wallet profile does not match local keypair")
	}
	sig, err := privateKey.Sign(payload)
	if err != nil {
		return "", "", err
	}
	return address, sig.String(), nil
}

func (s *Store) PublicSigningAddress() (string, error) {
	current, err := s.Current()
	if err != nil {
		return "", err
	}
	if !current.Configured || current.BoundOnly {
		return "", fmt.Errorf("account wallet is not configured")
	}
	return current.Address, nil
}

func (s *Store) save(status Status) error {
	if err := os.MkdirAll(s.dir, 0700); err != nil {
		return err
	}
	status.Unlocked = false
	status.Balances = nil
	status.FeePolicy = nil
	status.USDCMint = ""
	data, err := json.MarshalIndent(status, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.profilePath, append(data, '\n'), 0600)
}

func (s *Store) writeBackup(backup EncryptedBackup) error {
	if err := os.MkdirAll(s.dir, 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(backup, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.encryptedKeypairPath, append(data, '\n'), 0600)
}

func (s *Store) signingPrivateKey(current Status) (solana.PrivateKey, error) {
	keypairPath := strings.TrimSpace(current.KeypairPath)
	if keypairPath == "" {
		keypairPath = s.keypairPath
	}
	if _, err := os.Stat(keypairPath); err == nil {
		return solana.PrivateKeyFromSolanaKeygenFile(keypairPath)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.unlocked != nil {
		return clonePrivateKey(*s.unlocked), nil
	}
	return nil, fmt.Errorf("wallet locked")
}

func (s *Store) setUnlocked(privateKey solana.PrivateKey) {
	key := clonePrivateKey(privateKey)
	s.mu.Lock()
	s.unlocked = &key
	s.mu.Unlock()
}

func (s *Store) isUnlocked(status Status) bool {
	if !status.Configured || status.BoundOnly {
		return false
	}
	keypairPath := strings.TrimSpace(status.KeypairPath)
	if keypairPath == "" {
		keypairPath = s.keypairPath
	}
	if _, err := os.Stat(keypairPath); err == nil {
		return true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.unlocked != nil
}

func (s *Store) deriveBackupStatus(status Status) string {
	if status.BoundOnly {
		return "deprecated_external_binding"
	}
	if _, err := os.Stat(s.encryptedKeypairPath); err == nil {
		return "encrypted_local"
	}
	if _, err := os.Stat(s.keypairPath); err == nil {
		return "local_unencrypted_legacy"
	}
	return "missing"
}

func EncryptPrivateKey(privateKey solana.PrivateKey, recoveryPassword string, now string) (EncryptedBackup, error) {
	recoveryPassword = strings.TrimSpace(recoveryPassword)
	if recoveryPassword == "" {
		return EncryptedBackup{}, fmt.Errorf("recoveryPassword required")
	}
	salt := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return EncryptedBackup{}, err
	}
	nonce := make([]byte, 12)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return EncryptedBackup{}, err
	}
	kdf := KDFParams{
		Name:    "argon2id",
		Salt:    encodeBase64(salt),
		Time:    3,
		Memory:  64 * 1024,
		Threads: 2,
		KeyLen:  32,
	}
	key, err := deriveKey(recoveryPassword, kdf)
	if err != nil {
		return EncryptedBackup{}, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return EncryptedBackup{}, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return EncryptedBackup{}, err
	}
	publicKey := privateKey.PublicKey().String()
	ciphertext := gcm.Seal(nil, nonce, []byte(privateKey), []byte(publicKey))
	return EncryptedBackup{
		Version:   backupVersion,
		PublicKey: publicKey,
		Cipher:    "aes-256-gcm",
		KDF:       kdf,
		Nonce:     encodeBase64(nonce),
		Data:      encodeBase64(ciphertext),
		CreatedAt: now,
		UpdatedAt: now,
	}, nil
}

func DecryptPrivateKey(backup EncryptedBackup, recoveryPassword string) (solana.PrivateKey, error) {
	if backup.Version != backupVersion {
		return nil, fmt.Errorf("unsupported wallet backup version")
	}
	if !strings.EqualFold(backup.Cipher, "aes-256-gcm") {
		return nil, fmt.Errorf("unsupported wallet backup cipher")
	}
	key, err := deriveKey(recoveryPassword, backup.KDF)
	if err != nil {
		return nil, err
	}
	nonce, err := decodeBase64(backup.Nonce)
	if err != nil {
		return nil, fmt.Errorf("wallet backup nonce is invalid")
	}
	ciphertext, err := decodeBase64(backup.Data)
	if err != nil {
		return nil, fmt.Errorf("wallet backup data is invalid")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	plain, err := gcm.Open(nil, nonce, ciphertext, []byte(strings.TrimSpace(backup.PublicKey)))
	if err != nil {
		return nil, fmt.Errorf("invalid recovery password or corrupt wallet backup")
	}
	privateKey := solana.PrivateKey(plain)
	if len(privateKey) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("wallet backup private key is invalid")
	}
	if backup.PublicKey != "" && privateKey.PublicKey().String() != backup.PublicKey {
		return nil, fmt.Errorf("wallet backup public key mismatch")
	}
	return privateKey, nil
}

func deriveKey(password string, params KDFParams) ([]byte, error) {
	if !strings.EqualFold(params.Name, "argon2id") {
		return nil, fmt.Errorf("unsupported wallet backup kdf")
	}
	salt, err := decodeBase64(params.Salt)
	if err != nil {
		return nil, fmt.Errorf("wallet backup salt is invalid")
	}
	timeCost := params.Time
	if timeCost == 0 {
		timeCost = 3
	}
	memory := params.Memory
	if memory == 0 {
		memory = 64 * 1024
	}
	threads := params.Threads
	if threads == 0 {
		threads = 2
	}
	keyLen := params.KeyLen
	if keyLen == 0 {
		keyLen = 32
	}
	return argon2.IDKey([]byte(strings.TrimSpace(password)), salt, timeCost, memory, threads, keyLen), nil
}

func clonePrivateKey(privateKey solana.PrivateKey) solana.PrivateKey {
	out := make([]byte, len(privateKey))
	copy(out, privateKey)
	return solana.PrivateKey(out)
}

func writeSolanaKeypairFile(path string, privateKey []byte) error {
	values := make([]int, len(privateKey))
	for i, value := range privateKey {
		values[i] = int(value)
	}
	data, err := json.MarshalIndent(values, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0600)
}

func encodeBase64(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}

func decodeBase64(value string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(strings.TrimSpace(value))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
