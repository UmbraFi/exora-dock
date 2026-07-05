package wallet

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gagliardetto/solana-go"
)

const (
	profileFileName = "profile.json"
	keypairFileName = "solana-keypair.json"
)

type Status struct {
	Address      string `json:"address"`
	LocalKeypair bool   `json:"localKeypair"`
	KeypairPath  string `json:"keypairPath,omitempty"`
	BoundOnly    bool   `json:"boundOnly"`
	CreatedAt    string `json:"createdAt,omitempty"`
	UpdatedAt    string `json:"updatedAt,omitempty"`
	Configured   bool   `json:"configured"`
}

type CreateRequest struct {
	Overwrite bool `json:"overwrite"`
}

type BindRequest struct {
	Address string `json:"address"`
}

type ClearRequest struct {
	DeleteLocalKeypair bool `json:"deleteLocalKeypair"`
}

type Store struct {
	dir         string
	profilePath string
	keypairPath string
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
			dir:         base,
			profilePath: profile,
			keypairPath: filepath.Join(base, keypairFileName),
		}
	}
	return &Store{
		dir:         dir,
		profilePath: filepath.Join(dir, profileFileName),
		keypairPath: filepath.Join(dir, keypairFileName),
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
	if err := writeSolanaKeypairFile(s.keypairPath, []byte(w.PrivateKey)); err != nil {
		return Status{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	status := Status{
		Address:      w.PublicKey().String(),
		LocalKeypair: true,
		KeypairPath:  s.keypairPath,
		BoundOnly:    false,
		CreatedAt:    now,
		UpdatedAt:    now,
		Configured:   true,
	}
	return status, s.save(status)
}

func (s *Store) Bind(req BindRequest) (Status, error) {
	address := strings.TrimSpace(req.Address)
	if address == "" {
		return Status{}, fmt.Errorf("address required")
	}
	if _, err := solana.PublicKeyFromBase58(address); err != nil {
		return Status{}, fmt.Errorf("invalid solana address: %w", err)
	}
	current, err := s.Current()
	if err != nil {
		return Status{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	created := current.CreatedAt
	if created == "" {
		created = now
	}
	status := Status{
		Address:      address,
		LocalKeypair: false,
		BoundOnly:    true,
		CreatedAt:    created,
		UpdatedAt:    now,
		Configured:   true,
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
	return Status{Configured: false}, nil
}

func (s *Store) KeypairPath() string {
	return s.keypairPath
}

func (s *Store) SignPayload(payload []byte) (string, string, error) {
	current, err := s.Current()
	if err != nil {
		return "", "", err
	}
	if !current.Configured || !current.LocalKeypair {
		return "", "", fmt.Errorf("local wallet keypair required")
	}
	keypairPath := strings.TrimSpace(current.KeypairPath)
	if keypairPath == "" {
		keypairPath = s.keypairPath
	}
	privateKey, err := solana.PrivateKeyFromSolanaKeygenFile(keypairPath)
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

func (s *Store) save(status Status) error {
	if err := os.MkdirAll(s.dir, 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(status, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.profilePath, append(data, '\n'), 0600)
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
