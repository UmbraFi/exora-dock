package ipfs

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Client talks to a local IPFS daemon via its HTTP API and falls back to a
// local content-addressed store when the daemon is not available.
type Client struct {
	apiURL     string
	localDir   string
	httpClient *http.Client
}

func NewClient(apiURL string, localDir string) *Client {
	return &Client{
		apiURL:     apiURL,
		localDir:   localDir,
		httpClient: &http.Client{},
	}
}

// Add pins a file to IPFS and returns its CID.
func (c *Client) Add(filename string, data io.Reader) (string, error) {
	raw, err := io.ReadAll(data)
	if err != nil {
		return "", fmt.Errorf("ipfs: read data: %w", err)
	}

	if c.apiURL != "" {
		if cid, err := c.addRemote(filename, raw); err == nil {
			return cid, nil
		}
	}

	return c.addLocal(filename, raw)
}

func (c *Client) addRemote(filename string, raw []byte) (string, error) {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, err := w.CreateFormFile("file", filename)
	if err != nil {
		return "", fmt.Errorf("ipfs: create form file: %w", err)
	}
	if _, err := io.Copy(part, bytes.NewReader(raw)); err != nil {
		return "", fmt.Errorf("ipfs: copy data: %w", err)
	}
	w.Close()

	req, err := http.NewRequest("POST", c.apiURL+"/api/v0/add?pin=true", &body)
	if err != nil {
		return "", fmt.Errorf("ipfs: new request: %w", err)
	}
	req.Header.Set("Content-Type", w.FormDataContentType())

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("ipfs: add request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("ipfs: add status %d: %s", resp.StatusCode, b)
	}

	// Response is JSON: {"Hash":"Qm...","Name":"...","Size":"..."}
	var result struct {
		Hash string `json:"Hash"`
	}
	if err := readJSON(resp.Body, &result); err != nil {
		return "", fmt.Errorf("ipfs: decode add response: %w", err)
	}
	return result.Hash, nil
}

func (c *Client) addLocal(filename string, raw []byte) (string, error) {
	if c.localDir == "" {
		return "", fmt.Errorf("ipfs: local store not configured")
	}
	if err := os.MkdirAll(c.localDir, 0o755); err != nil {
		return "", fmt.Errorf("ipfs: create local store: %w", err)
	}

	sum := sha256.Sum256(raw)
	ext := filepath.Ext(filename)
	cid := "local-" + hex.EncodeToString(sum[:16]) + ext
	path := filepath.Join(c.localDir, filepath.Base(cid))
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		return "", fmt.Errorf("ipfs: write local object: %w", err)
	}
	return cid, nil
}

// Cat retrieves the raw bytes for a CID.
func (c *Client) Cat(cid string) (io.ReadCloser, error) {
	if strings.HasPrefix(cid, "local-") {
		return c.catLocal(cid)
	}

	if c.apiURL != "" {
		resp, err := c.httpClient.Post(c.apiURL+"/api/v0/cat?arg="+cid, "", nil)
		if err == nil && resp.StatusCode == http.StatusOK {
			return resp.Body, nil
		}
		if resp != nil {
			resp.Body.Close()
		}
	}

	return c.catLocal(cid)
}

func (c *Client) catLocal(cid string) (io.ReadCloser, error) {
	if c.localDir == "" {
		return nil, fmt.Errorf("ipfs: local store not configured")
	}
	path := filepath.Join(c.localDir, filepath.Base(cid))
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("ipfs: local cat: %w", err)
	}
	return f, nil
}

// Unpin removes a pin for a CID.
func (c *Client) Unpin(cid string) error {
	if strings.HasPrefix(cid, "local-") {
		if c.localDir == "" {
			return nil
		}
		err := os.Remove(filepath.Join(c.localDir, filepath.Base(cid)))
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if c.apiURL == "" {
		return nil
	}

	resp, err := c.httpClient.Post(c.apiURL+"/api/v0/pin/rm?arg="+cid, "", nil)
	if err != nil {
		return fmt.Errorf("ipfs: unpin request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("ipfs: unpin status %d: %s", resp.StatusCode, b)
	}
	return nil
}
