package ipfs

import (
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
)

// Client talks to a local IPFS daemon via its HTTP API.
type Client struct {
	apiURL     string
	httpClient *http.Client
}

func NewClient(apiURL string) *Client {
	return &Client{
		apiURL:     apiURL,
		httpClient: &http.Client{},
	}
}

// Add pins a file to IPFS and returns its CID.
func (c *Client) Add(filename string, data io.Reader) (string, error) {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, err := w.CreateFormFile("file", filename)
	if err != nil {
		return "", fmt.Errorf("ipfs: create form file: %w", err)
	}
	if _, err := io.Copy(part, data); err != nil {
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

// Cat retrieves the raw bytes for a CID.
func (c *Client) Cat(cid string) (io.ReadCloser, error) {
	resp, err := c.httpClient.Post(c.apiURL+"/api/v0/cat?arg="+cid, "", nil)
	if err != nil {
		return nil, fmt.Errorf("ipfs: cat request: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("ipfs: cat status %d", resp.StatusCode)
	}
	return resp.Body, nil
}

// Unpin removes a pin for a CID.
func (c *Client) Unpin(cid string) error {
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
