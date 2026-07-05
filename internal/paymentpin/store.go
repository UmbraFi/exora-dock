package paymentpin

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"
)

const (
	version      = 1
	saltBytes    = 16
	keyBytes     = 32
	argonTime    = 3
	argonMemory  = 64 * 1024
	argonThreads = 2
)

var pinPattern = regexp.MustCompile(`^\d{6}$`)

type Status struct {
	Configured     bool   `json:"configured"`
	UpdatedAt      string `json:"updatedAt,omitempty"`
	FailedAttempts int    `json:"failedAttempts,omitempty"`
}

type fileData struct {
	Version        int    `json:"version"`
	Salt           string `json:"salt"`
	Hash           string `json:"hash"`
	UpdatedAt      string `json:"updatedAt"`
	FailedAttempts int    `json:"failedAttempts,omitempty"`
}

type Store struct {
	path string
}

func New(path string) *Store {
	if strings.TrimSpace(path) == "" {
		path = filepath.Join(".", "data", "payment-pin.json")
	}
	return &Store{path: path}
}

func (s *Store) Path() string {
	return s.path
}

func (s *Store) Status() (Status, error) {
	data, err := s.read()
	if err != nil {
		if os.IsNotExist(err) {
			return Status{Configured: false}, nil
		}
		return Status{}, err
	}
	return Status{
		Configured:     data.Hash != "" && data.Salt != "",
		UpdatedAt:      data.UpdatedAt,
		FailedAttempts: data.FailedAttempts,
	}, nil
}

func (s *Store) Set(pin string) (Status, error) {
	if !pinPattern.MatchString(strings.TrimSpace(pin)) {
		return Status{}, fmt.Errorf("payment_pin must be exactly 6 digits")
	}
	salt := make([]byte, saltBytes)
	if _, err := rand.Read(salt); err != nil {
		return Status{}, err
	}
	hash := hashPIN(pin, salt)
	now := time.Now().UTC().Format(time.RFC3339)
	data := fileData{
		Version:   version,
		Salt:      base64.StdEncoding.EncodeToString(salt),
		Hash:      base64.StdEncoding.EncodeToString(hash),
		UpdatedAt: now,
	}
	if err := s.write(data); err != nil {
		return Status{}, err
	}
	return Status{Configured: true, UpdatedAt: now}, nil
}

func (s *Store) Verify(pin string) error {
	if !pinPattern.MatchString(strings.TrimSpace(pin)) {
		return fmt.Errorf("invalid_payment_pin")
	}
	data, err := s.read()
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("payment_pin_not_configured")
		}
		return err
	}
	salt, err := base64.StdEncoding.DecodeString(data.Salt)
	if err != nil {
		return fmt.Errorf("payment_pin_corrupt")
	}
	expected, err := base64.StdEncoding.DecodeString(data.Hash)
	if err != nil {
		return fmt.Errorf("payment_pin_corrupt")
	}
	actual := hashPIN(pin, salt)
	if subtle.ConstantTimeCompare(actual, expected) != 1 {
		data.FailedAttempts++
		_ = s.write(data)
		return fmt.Errorf("invalid_payment_pin")
	}
	if data.FailedAttempts != 0 {
		data.FailedAttempts = 0
		_ = s.write(data)
	}
	return nil
}

func (s *Store) read() (fileData, error) {
	raw, err := os.ReadFile(s.path)
	if err != nil {
		return fileData{}, err
	}
	var data fileData
	if err := json.Unmarshal(raw, &data); err != nil {
		return fileData{}, err
	}
	return data, nil
}

func (s *Store) write(data fileData) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, append(raw, '\n'), 0600)
}

func hashPIN(pin string, salt []byte) []byte {
	return argon2.IDKey([]byte(strings.TrimSpace(pin)), salt, argonTime, argonMemory, argonThreads, keyBytes)
}
