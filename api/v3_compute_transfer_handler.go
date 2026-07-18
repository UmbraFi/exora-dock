package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/exora-dock/exora-dock/internal/cloudlink"
	"github.com/exora-dock/exora-dock/internal/endpoint"
)

type localTransferReceipt struct {
	ReceiptID       string    `json:"receiptId"`
	TransferID      string    `json:"transferId"`
	LeaseID         string    `json:"leaseId"`
	Party           string    `json:"party"`
	Kind            string    `json:"kind"`
	Approved        bool      `json:"approved"`
	Direction       string    `json:"direction"`
	SizeBytes       int64     `json:"sizeBytes"`
	SHA256          string    `json:"sha256,omitempty"`
	PolicyVersion   string    `json:"policyVersion"`
	DevicePublicKey string    `json:"devicePublicKey"`
	CreatedAt       time.Time `json:"createdAt"`
	ExpiresAt       time.Time `json:"expiresAt"`
	Signature       string    `json:"signature"`
}

func localTransferID() string {
	raw := make([]byte, 16)
	_, _ = rand.Read(raw)
	return "xfr_" + hex.EncodeToString(raw)
}

func localPathWithin(root, target string) (string, error) {
	root, err := filepath.Abs(strings.TrimSpace(root))
	if err != nil || root == "" {
		return "", errors.New("authorizedLocalRoot is required")
	}
	target, err = filepath.Abs(strings.TrimSpace(target))
	if err != nil || (target != root && !strings.HasPrefix(target, root+string(os.PathSeparator))) {
		return "", errors.New("buyer_local_policy_rejected: local path is outside the authorized transfer root")
	}
	return target, nil
}

func fileSHA256(path string) (int64, string, error) {
	file, err := os.Open(path)
	if err != nil {
		return 0, "", err
	}
	defer file.Close()
	digest := sha256.New()
	size, err := io.Copy(digest, file)
	if err != nil {
		return 0, "", err
	}
	return size, hex.EncodeToString(digest.Sum(nil)), nil
}

func (h *Handler) V3StartLocalComputeTransfer(w http.ResponseWriter, r *http.Request) {
	if h.endpointTunnel == nil || h.localAuth == nil {
		writeJSON(w, 503, map[string]string{"error": "compute transfer service is unavailable"})
		return
	}
	var input struct {
		LeaseID               string `json:"leaseId"`
		Direction             string `json:"direction"`
		LocalPath             string `json:"localPath"`
		AuthorizedLocalRoot   string `json:"authorizedLocalRoot"`
		WorkspaceRelativePath string `json:"workspaceRelativePath"`
		SizeBytes             int64  `json:"sizeBytes"`
		SHA256                string `json:"sha256"`
	}
	if decodeJSONBody(r, &input) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid transfer request"})
		return
	}
	input.Direction = strings.ToLower(strings.TrimSpace(input.Direction))
	input.SHA256 = strings.ToLower(strings.TrimSpace(input.SHA256))
	localPath, err := localPathWithin(input.AuthorizedLocalRoot, input.LocalPath)
	if err != nil {
		writeJSON(w, 403, map[string]string{"error": err.Error()})
		return
	}
	if input.Direction == "upload" {
		input.SizeBytes, input.SHA256, err = fileSHA256(localPath)
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
	} else if input.Direction == "download" {
		if input.SizeBytes < 0 || len(input.SHA256) != 64 {
			writeJSON(w, 400, map[string]string{"error": "download sizeBytes and sha256 are required"})
			return
		}
	} else {
		writeJSON(w, 400, map[string]string{"error": "direction must be upload or download"})
		return
	}
	status, payload, err := h.accountCloudRequest(r, http.MethodGet, "/v3/leases/"+input.LeaseID, nil)
	if err != nil || status != 200 {
		writeJSON(w, 502, map[string]string{"error": "active Lease could not be loaded"})
		return
	}
	var leaseBody struct {
		Lease struct {
			LeaseID              string    `json:"leaseId"`
			LeaseEpoch           int64     `json:"leaseEpoch"`
			SecurityMode         string    `json:"securityMode"`
			BuyerDevicePublicKey string    `json:"buyerDevicePublicKey"`
			ExpiresAt            time.Time `json:"expiresAt"`
		} `json:"lease"`
	}
	if json.Unmarshal(payload, &leaseBody) != nil || leaseBody.Lease.SecurityMode != "isolated_control_p2p_v1" {
		writeJSON(w, 409, map[string]string{"error": "Lease does not support isolated direct transfer"})
		return
	}
	publicKey, err := h.endpointTunnel.DevicePublicKey()
	if err != nil || leaseBody.Lease.BuyerDevicePublicKey != publicKey {
		writeJSON(w, 409, map[string]string{"error": "Buyer Dock identity does not match the Lease snapshot"})
		return
	}
	transferID := localTransferID()
	now := time.Now().UTC()
	expiresAt := now.Add(10 * time.Minute)
	if leaseBody.Lease.ExpiresAt.Before(expiresAt) {
		expiresAt = leaseBody.Lease.ExpiresAt
	}
	receipt := localTransferReceipt{ReceiptID: "rcp_" + transferID, TransferID: transferID, LeaseID: input.LeaseID, Party: "buyer", Kind: "local_review", Approved: true, Direction: input.Direction, SizeBytes: input.SizeBytes, SHA256: input.SHA256, PolicyVersion: "isolated_control_p2p_v1", DevicePublicKey: publicKey, CreatedAt: now, ExpiresAt: expiresAt}
	unsigned, _ := json.Marshal(receipt)
	receipt.Signature, err = h.endpointTunnel.SignIdentityPayload(unsigned)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	createBody := map[string]any{"transferId": transferID, "direction": input.Direction, "sizeBytes": input.SizeBytes, "sha256": input.SHA256, "buyerReviewReceipt": receipt}
	status, payload, err = h.accountCloudRequest(r, http.MethodPost, "/v3/leases/"+input.LeaseID+"/transfers", createBody)
	if err != nil || status < 200 || status >= 300 {
		if len(payload) > 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_, _ = w.Write(payload)
			return
		}
		writeJSON(w, 502, map[string]string{"error": "Cloud rejected compute transfer"})
		return
	}
	_, accountKey, ok := h.localAuth.AccountKey()
	if !ok {
		writeJSON(w, 503, map[string]string{"error": "account key unavailable"})
		return
	}
	token, err := cloudlink.LoadToken(h.cloudTokenPath)
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": "Cloud link unavailable"})
		return
	}
	cloudURL := firstNonEmpty(strings.TrimSpace(h.cloudURL), strings.TrimSpace(token.CloudURL))
	err = h.endpointTunnel.StartBuyerTransfer(r.Context(), endpoint.ComputeTransferStart{TransferID: transferID, LeaseID: input.LeaseID, LeaseEpoch: leaseBody.Lease.LeaseEpoch, Direction: input.Direction, SizeBytes: input.SizeBytes, SHA256: input.SHA256, WorkspaceRelativePath: input.WorkspaceRelativePath, LocalPath: localPath, CloudURL: cloudURL, AuthToken: accountKey, ExpiresAt: expiresAt})
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"transferId": transferID, "status": "connecting", "sizeBytes": input.SizeBytes, "sha256": input.SHA256})
}

func (h *Handler) V3LocalComputeTransfer(w http.ResponseWriter, r *http.Request) {
	if h.endpointTunnel == nil {
		writeJSON(w, 503, map[string]string{"error": "compute transfer service is unavailable"})
		return
	}
	status, found := h.endpointTunnel.ComputeTransferStatus(r.PathValue("id"))
	if !found {
		writeJSON(w, 404, map[string]string{"error": "compute transfer not found"})
		return
	}
	writeJSON(w, 200, map[string]any{"transfer": status})
}

func (h *Handler) V3LocalDeviceIdentity(w http.ResponseWriter, _ *http.Request) {
	if h.endpointTunnel == nil {
		writeJSON(w, 503, map[string]string{"error": "Dock device identity is unavailable"})
		return
	}
	publicKey, err := h.endpointTunnel.DevicePublicKey()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"devicePublicKey": publicKey, "algorithm": "Ed25519"})
}
