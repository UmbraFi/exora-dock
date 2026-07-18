package endpoint

import (
	"context"
	crand "crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/exora-dock/exora-dock/internal/cloudlink"
	"github.com/exora-dock/exora-dock/internal/providerworker"
	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

const computeTransferFrameSize = 64 << 10
const computeTransferFrameHeaderSize = 8 + sha256.Size

type ComputeTransferStart struct {
	TransferID            string    `json:"transferId"`
	LeaseID               string    `json:"leaseId"`
	LeaseEpoch            int64     `json:"leaseEpoch"`
	Direction             string    `json:"direction"`
	SizeBytes             int64     `json:"sizeBytes"`
	SHA256                string    `json:"sha256"`
	WorkspaceRelativePath string    `json:"workspaceRelativePath,omitempty"`
	LocalPath             string    `json:"localPath,omitempty"`
	CloudURL              string    `json:"-"`
	AuthToken             string    `json:"-"`
	Role                  string    `json:"role"`
	ExpiresAt             time.Time `json:"expiresAt"`
}

type ComputeTransferStatus struct {
	TransferID    string    `json:"transferId"`
	LeaseID       string    `json:"leaseId"`
	Direction     string    `json:"direction"`
	Role          string    `json:"role"`
	Status        string    `json:"status"`
	BytesComplete int64     `json:"bytesComplete"`
	SizeBytes     int64     `json:"sizeBytes"`
	SHA256        string    `json:"sha256,omitempty"`
	Error         string    `json:"error,omitempty"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type transferSignal struct {
	Type            string                   `json:"type"`
	SDP             string                   `json:"sdp,omitempty"`
	Candidate       *webrtc.ICECandidateInit `json:"candidate,omitempty"`
	DevicePublicKey string                   `json:"devicePublicKey,omitempty"`
	Signature       string                   `json:"signature,omitempty"`
}

type transferStartFrame struct {
	Type                  string `json:"type"`
	Direction             string `json:"direction"`
	WorkspaceRelativePath string `json:"workspaceRelativePath"`
	SizeBytes             int64  `json:"sizeBytes"`
	SHA256                string `json:"sha256"`
	ResumeOffset          int64  `json:"resumeOffset,omitempty"`
}

func computeTransferPacket(offset int64, data []byte) []byte {
	packet := make([]byte, computeTransferFrameHeaderSize+len(data))
	binary.BigEndian.PutUint64(packet[:8], uint64(offset))
	digest := sha256.Sum256(data)
	copy(packet[8:computeTransferFrameHeaderSize], digest[:])
	copy(packet[computeTransferFrameHeaderSize:], data)
	return packet
}

func parseComputeTransferPacket(packet []byte) (int64, []byte, error) {
	if len(packet) < computeTransferFrameHeaderSize {
		return 0, nil, errors.New("invalid transfer frame")
	}
	offset := int64(binary.BigEndian.Uint64(packet[:8]))
	data := packet[computeTransferFrameHeaderSize:]
	digest := sha256.Sum256(data)
	if !strings.EqualFold(hex.EncodeToString(packet[8:computeTransferFrameHeaderSize]), hex.EncodeToString(digest[:])) {
		return 0, nil, errors.New("transfer_hash_mismatch")
	}
	return offset, data, nil
}

func transferFileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

func transferInt64(value any) int64 {
	switch typed := value.(type) {
	case float64:
		return int64(typed)
	case int64:
		return typed
	case int:
		return int64(typed)
	default:
		return 0
	}
}

func (c *TunnelClient) setComputeTransferStatus(status ComputeTransferStatus) {
	status.UpdatedAt = time.Now().UTC()
	c.transferMu.Lock()
	c.computeTransfers[status.TransferID] = status
	c.transferMu.Unlock()
}

func (c *TunnelClient) ComputeTransferStatus(id string) (ComputeTransferStatus, bool) {
	c.transferMu.RLock()
	status, found := c.computeTransfers[id]
	c.transferMu.RUnlock()
	return status, found
}

func (c *TunnelClient) StartBuyerTransfer(parent context.Context, start ComputeTransferStart) error {
	start.Role = "buyer"
	if start.TransferID == "" || start.LeaseID == "" || (start.Direction != "upload" && start.Direction != "download") || start.LocalPath == "" || start.WorkspaceRelativePath == "" {
		return errors.New("invalid buyer transfer start")
	}
	if start.CloudURL == "" || start.AuthToken == "" {
		return errors.New("Cloud URL and buyer account key are required")
	}
	c.setComputeTransferStatus(ComputeTransferStatus{TransferID: start.TransferID, LeaseID: start.LeaseID, Direction: start.Direction, Role: start.Role, Status: "connecting", SizeBytes: start.SizeBytes, SHA256: start.SHA256})
	go c.runComputeTransfer(parent, start)
	return nil
}

func (c *TunnelClient) startProviderTransfer(start ComputeTransferStart) error {
	token, err := cloudlink.LoadToken(c.TokenPath)
	if err != nil {
		return err
	}
	start.Role = "provider"
	start.CloudURL = firstNonEmptyTransfer(c.CloudURL, token.CloudURL)
	start.AuthToken = token.CloudToken
	if start.TransferID == "" || start.LeaseID == "" || start.CloudURL == "" || start.AuthToken == "" {
		return errors.New("invalid provider transfer start")
	}
	c.setComputeTransferStatus(ComputeTransferStatus{TransferID: start.TransferID, LeaseID: start.LeaseID, Direction: start.Direction, Role: start.Role, Status: "connecting", SizeBytes: start.SizeBytes, SHA256: start.SHA256})
	go c.runComputeTransfer(context.Background(), start)
	return nil
}

func firstNonEmptyTransfer(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func (c *TunnelClient) runComputeTransfer(parent context.Context, start ComputeTransferStart) {
	deadline := start.ExpiresAt
	if deadline.IsZero() || deadline.After(time.Now().Add(30*time.Minute)) {
		deadline = time.Now().Add(30 * time.Minute)
	}
	ctx, cancel := context.WithDeadline(parent, deadline)
	defer cancel()
	status := ComputeTransferStatus{TransferID: start.TransferID, LeaseID: start.LeaseID, Direction: start.Direction, Role: start.Role, Status: "connecting", SizeBytes: start.SizeBytes, SHA256: start.SHA256}
	if err := c.runComputeTransferPeer(ctx, start, &status); err != nil {
		status.Status, status.Error = "failed", err.Error()
	} else {
		status.Status = "completed"
	}
	c.setComputeTransferStatus(status)
}

func transferWebSocketURL(cloudURL, transferID string) (string, error) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(cloudURL), "/"))
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "https" {
		parsed.Scheme = "wss"
	} else if parsed.Scheme == "http" {
		parsed.Scheme = "ws"
	} else {
		return "", errors.New("Cloud URL must use HTTP or HTTPS")
	}
	parsed.Path = "/v3/compute-transfers/" + url.PathEscape(transferID) + "/signal"
	parsed.RawQuery = ""
	return parsed.String(), nil
}

func (c *TunnelClient) runComputeTransferPeer(ctx context.Context, start ComputeTransferStart, status *ComputeTransferStatus) error {
	signalURL, err := transferWebSocketURL(start.CloudURL, start.TransferID)
	if err != nil {
		return err
	}
	conn, response, err := websocket.DefaultDialer.DialContext(ctx, signalURL, http.Header{"Authorization": []string{"Bearer " + strings.TrimSpace(start.AuthToken)}})
	if err != nil {
		if response != nil {
			return fmt.Errorf("direct signaling failed with HTTP %d", response.StatusCode)
		}
		return err
	}
	defer conn.Close()
	configuration := webrtc.Configuration{}
	if stunURL := strings.TrimSpace(os.Getenv("EXORA_STUN_URL")); strings.HasPrefix(stunURL, "stun:") || strings.HasPrefix(stunURL, "stuns:") {
		configuration.ICEServers = []webrtc.ICEServer{{URLs: []string{stunURL}}}
	}
	peer, err := webrtc.NewPeerConnection(configuration)
	if err != nil {
		return err
	}
	defer peer.Close()
	var signalWriteMu sync.Mutex
	sendSignal := func(message transferSignal) error {
		if message.Type == "offer" || message.Type == "answer" {
			publicKey, keyErr := c.DevicePublicKey()
			if keyErr != nil {
				return keyErr
			}
			message.DevicePublicKey = publicKey
			message.Signature, keyErr = c.SignIdentityPayload([]byte(start.TransferID + "\n" + message.Type + "\n" + message.SDP))
			if keyErr != nil {
				return keyErr
			}
		}
		signalWriteMu.Lock()
		defer signalWriteMu.Unlock()
		return conn.WriteJSON(message)
	}
	peer.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil || candidate.Typ == webrtc.ICECandidateTypeRelay {
			return
		}
		init := candidate.ToJSON()
		_ = sendSignal(transferSignal{Type: "candidate", Candidate: &init})
	})
	done := make(chan error, 1)
	finish := func(err error) {
		select {
		case done <- err:
		default:
		}
	}
	peer.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed {
			finish(errors.New("direct_path_unavailable"))
		}
	})
	configureDataChannel := func(channel *webrtc.DataChannel) {
		channel.SetBufferedAmountLowThreshold(1 << 20)
		if start.Role == "buyer" {
			c.configureBuyerDataChannel(ctx, channel, start, status, finish)
		} else {
			c.configureProviderDataChannel(ctx, channel, start, status, finish)
		}
	}
	if start.Role == "provider" {
		peer.OnDataChannel(configureDataChannel)
	}
	var buyerChannel *webrtc.DataChannel
	if start.Role == "buyer" {
		buyerChannel, err = peer.CreateDataChannel("exora-file-v1", nil)
		if err != nil {
			return err
		}
		configureDataChannel(buyerChannel)
	}
	signalErr := make(chan error, 1)
	go func() {
		for {
			var message transferSignal
			if readErr := conn.ReadJSON(&message); readErr != nil {
				signalErr <- readErr
				return
			}
			switch message.Type {
			case "offer":
				if start.Role != "provider" {
					continue
				}
				if err := peer.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: message.SDP}); err != nil {
					signalErr <- err
					return
				}
				answer, err := peer.CreateAnswer(nil)
				if err != nil {
					signalErr <- err
					return
				}
				if err := peer.SetLocalDescription(answer); err != nil {
					signalErr <- err
					return
				}
				if err := sendSignal(transferSignal{Type: "answer", SDP: answer.SDP}); err != nil {
					signalErr <- err
					return
				}
			case "answer":
				if start.Role == "buyer" {
					if err := peer.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: message.SDP}); err != nil {
						signalErr <- err
						return
					}
				}
			case "candidate":
				if message.Candidate != nil && !strings.Contains(strings.ToLower(message.Candidate.Candidate), " typ relay") {
					if err := peer.AddICECandidate(*message.Candidate); err != nil {
						signalErr <- err
						return
					}
				}
			case "error":
				signalErr <- errors.New("signaling rejected")
				return
			}
		}
	}()
	if start.Role == "buyer" {
		offer, err := peer.CreateOffer(nil)
		if err != nil {
			return err
		}
		if err := peer.SetLocalDescription(offer); err != nil {
			return err
		}
		if err := sendSignal(transferSignal{Type: "offer", SDP: offer.SDP}); err != nil {
			return err
		}
	}
	select {
	case err := <-done:
		return err
	case err := <-signalErr:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func waitDataChannel(ctx context.Context, channel *webrtc.DataChannel) error {
	for channel.BufferedAmount() > 4<<20 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
	}
	return nil
}

func (c *TunnelClient) configureBuyerDataChannel(ctx context.Context, channel *webrtc.DataChannel, start ComputeTransferStart, status *ComputeTransferStatus, finish func(error)) {
	var output *os.File
	var writeMu sync.Mutex
	channel.OnOpen(func() {
		resumeOffset := int64(0)
		if start.Direction == "download" {
			temporary := start.LocalPath + ".part"
			if err := os.MkdirAll(filepath.Dir(start.LocalPath), 0700); err != nil {
				finish(err)
				return
			}
			if info, err := os.Stat(temporary); err == nil && info.Size() <= start.SizeBytes {
				resumeOffset = info.Size()
			}
			output, _ = os.OpenFile(temporary, os.O_CREATE|os.O_RDWR, 0600)
			if output == nil {
				finish(errors.New("cannot create download target"))
				return
			}
			if resumeOffset == 0 {
				_ = output.Truncate(0)
			}
		}
		status.Status, status.BytesComplete = "transferring", resumeOffset
		c.setComputeTransferStatus(*status)
		frame, _ := json.Marshal(transferStartFrame{Type: "start", Direction: start.Direction, WorkspaceRelativePath: start.WorkspaceRelativePath, SizeBytes: start.SizeBytes, SHA256: start.SHA256, ResumeOffset: resumeOffset})
		if err := channel.SendText(string(frame)); err != nil {
			finish(err)
		}
	})
	channel.OnMessage(func(message webrtc.DataChannelMessage) {
		if start.Direction != "download" {
			if message.IsString {
				var control map[string]any
				_ = json.Unmarshal(message.Data, &control)
				if control["type"] == "resume" {
					go c.sendBuyerUpload(ctx, channel, start, transferInt64(control["offset"]), status, finish)
				} else if control["type"] == "complete" {
					finish(nil)
				}
			}
			return
		}
		writeMu.Lock()
		defer writeMu.Unlock()
		if !message.IsString {
			offset, data, err := parseComputeTransferPacket(message.Data)
			if err != nil || output == nil || offset != status.BytesComplete {
				finish(errors.New("transfer_hash_mismatch"))
				return
			}
			if _, err := output.WriteAt(data, offset); err != nil {
				finish(err)
				return
			}
			status.BytesComplete += int64(len(data))
			c.setComputeTransferStatus(*status)
			return
		}
		var control map[string]any
		_ = json.Unmarshal(message.Data, &control)
		if control["type"] == "finish" {
			if output != nil {
				_ = output.Close()
			}
			actual, err := transferFileSHA256(start.LocalPath + ".part")
			if err != nil {
				finish(err)
				return
			}
			if status.BytesComplete != start.SizeBytes || !strings.EqualFold(actual, start.SHA256) {
				finish(errors.New("transfer_hash_mismatch"))
				return
			}
			if err := os.Rename(start.LocalPath+".part", start.LocalPath); err != nil {
				finish(err)
				return
			}
			if err := c.postFinalTransferReceipt(ctx, start, start.AuthToken, "buyer", actual); err != nil {
				finish(err)
				return
			}
			_ = channel.SendText(`{"type":"complete"}`)
			finish(nil)
		}
	})
	channel.OnError(finish)
	channel.OnClose(func() {
		if status.BytesComplete < start.SizeBytes {
			finish(errors.New("direct_path_unavailable"))
		}
	})
}

func (c *TunnelClient) sendBuyerUpload(ctx context.Context, channel *webrtc.DataChannel, start ComputeTransferStart, offset int64, status *ComputeTransferStatus, finish func(error)) {
	if offset < 0 || offset > start.SizeBytes {
		finish(errors.New("provider_local_policy_rejected"))
		return
	}
	file, err := os.Open(start.LocalPath)
	if err != nil {
		finish(err)
		return
	}
	defer file.Close()
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		finish(err)
		return
	}
	status.BytesComplete = offset
	c.setComputeTransferStatus(*status)
	buffer := make([]byte, computeTransferFrameSize)
	for {
		n, readErr := file.Read(buffer)
		if n > 0 {
			if err := waitDataChannel(ctx, channel); err != nil {
				finish(err)
				return
			}
			if err := channel.Send(computeTransferPacket(offset, buffer[:n])); err != nil {
				finish(err)
				return
			}
			offset += int64(n)
			status.BytesComplete = offset
			c.setComputeTransferStatus(*status)
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			finish(readErr)
			return
		}
	}
	_ = channel.SendText(`{"type":"finish"}`)
	if err := c.postFinalTransferReceipt(ctx, start, start.AuthToken, "buyer", start.SHA256); err != nil {
		finish(err)
	}
}

func (c *TunnelClient) configureProviderDataChannel(ctx context.Context, channel *webrtc.DataChannel, start ComputeTransferStart, status *ComputeTransferStatus, finish func(error)) {
	var relative string
	channel.OnMessage(func(message webrtc.DataChannelMessage) {
		if message.IsString {
			var control transferStartFrame
			var generic map[string]any
			_ = json.Unmarshal(message.Data, &generic)
			if generic["type"] == "start" {
				if json.Unmarshal(message.Data, &control) != nil || control.Direction != start.Direction || control.SizeBytes != start.SizeBytes || !strings.EqualFold(control.SHA256, start.SHA256) {
					finish(errors.New("provider_local_policy_rejected"))
					return
				}
				relative = control.WorkspaceRelativePath
				status.Status = "transferring"
				c.setComputeTransferStatus(*status)
				if start.Direction == "download" {
					go c.sendProviderDownload(ctx, channel, start, relative, control.ResumeOffset, status, finish)
				} else {
					partial, err := (providerworker.Client{}).Call(ctx, "lease_workspace_partial_stat", map[string]any{"leaseId": start.LeaseID, "leaseEpoch": start.LeaseEpoch, "relativePath": relative})
					if err != nil {
						finish(err)
						return
					}
					resumeOffset := transferInt64(partial["sizeBytes"])
					if resumeOffset < 0 || resumeOffset > start.SizeBytes {
						finish(errors.New("provider_local_policy_rejected"))
						return
					}
					status.BytesComplete = resumeOffset
					c.setComputeTransferStatus(*status)
					resume, _ := json.Marshal(map[string]any{"type": "resume", "offset": resumeOffset})
					_ = channel.SendText(string(resume))
				}
				return
			}
			if generic["type"] == "finish" && start.Direction == "upload" {
				result, err := (providerworker.Client{}).Call(ctx, "lease_workspace_write", map[string]any{"leaseId": start.LeaseID, "leaseEpoch": start.LeaseEpoch, "relativePath": relative, "finalize": true, "expectedSize": start.SizeBytes, "expectedSha256": start.SHA256})
				if err != nil {
					finish(err)
					return
				}
				actual, _ := result["sha256"].(string)
				if err := c.postFinalTransferReceipt(ctx, start, start.AuthToken, "provider", actual); err != nil {
					finish(err)
					return
				}
				_ = channel.SendText(`{"type":"complete"}`)
				finish(nil)
			}
			if generic["type"] == "complete" && start.Direction == "download" {
				finish(nil)
			}
			return
		}
		if start.Direction != "upload" || relative == "" {
			finish(errors.New("invalid transfer frame"))
			return
		}
		offset, data, err := parseComputeTransferPacket(message.Data)
		if err != nil || offset != status.BytesComplete {
			finish(errors.New("transfer_hash_mismatch"))
			return
		}
		_, err = (providerworker.Client{}).Call(ctx, "lease_workspace_write", map[string]any{"leaseId": start.LeaseID, "leaseEpoch": start.LeaseEpoch, "relativePath": relative, "offset": offset, "dataBase64": base64.StdEncoding.EncodeToString(data)})
		if err != nil {
			finish(err)
			return
		}
		status.BytesComplete = offset + int64(len(data))
		c.setComputeTransferStatus(*status)
	})
	channel.OnError(finish)
}

func (c *TunnelClient) sendProviderDownload(ctx context.Context, channel *webrtc.DataChannel, start ComputeTransferStart, relative string, resumeOffset int64, status *ComputeTransferStatus, finish func(error)) {
	if resumeOffset < 0 || resumeOffset > start.SizeBytes {
		finish(errors.New("buyer_local_policy_rejected"))
		return
	}
	var offset int64
	digest := sha256.New()
	for {
		result, err := (providerworker.Client{}).Call(ctx, "lease_workspace_read", map[string]any{"leaseId": start.LeaseID, "leaseEpoch": start.LeaseEpoch, "relativePath": relative, "offset": offset, "limit": computeTransferFrameSize})
		if err != nil {
			finish(err)
			return
		}
		encoded, _ := result["dataBase64"].(string)
		data, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			finish(err)
			return
		}
		if len(data) > 0 {
			_, _ = digest.Write(data)
			sendFrom := int64(0)
			if resumeOffset > offset {
				sendFrom = resumeOffset - offset
			}
			if sendFrom < int64(len(data)) {
				chunk := data[sendFrom:]
				chunkOffset := offset + sendFrom
				if err := waitDataChannel(ctx, channel); err != nil {
					finish(err)
					return
				}
				if err := channel.Send(computeTransferPacket(chunkOffset, chunk)); err != nil {
					finish(err)
					return
				}
			}
			offset += int64(len(data))
			if offset > resumeOffset {
				status.BytesComplete = offset
			}
			c.setComputeTransferStatus(*status)
		}
		eof, _ := result["eof"].(bool)
		if eof {
			break
		}
	}
	actual := hex.EncodeToString(digest.Sum(nil))
	if offset != start.SizeBytes || !strings.EqualFold(actual, start.SHA256) {
		finish(errors.New("transfer_hash_mismatch"))
		return
	}
	if err := c.postFinalTransferReceipt(ctx, start, start.AuthToken, "provider", actual); err != nil {
		finish(err)
		return
	}
	_ = channel.SendText(`{"type":"finish"}`)
}

func randomReceiptID() string {
	raw := make([]byte, 12)
	_, _ = crand.Read(raw)
	return "rcp_" + hex.EncodeToString(raw)
}

func (c *TunnelClient) postFinalTransferReceipt(ctx context.Context, start ComputeTransferStart, authToken, party, sha string) error {
	publicKey, err := c.DevicePublicKey()
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	receipt := signedTransferReceipt{ReceiptID: randomReceiptID(), TransferID: start.TransferID, LeaseID: start.LeaseID, Party: party, Kind: "final", Approved: true, Direction: start.Direction, SizeBytes: start.SizeBytes, SHA256: strings.ToLower(sha), PolicyVersion: "isolated_control_p2p_v1", DevicePublicKey: publicKey, CreatedAt: now, ExpiresAt: start.ExpiresAt}
	unsigned, _ := json.Marshal(receipt)
	receipt.Signature, err = c.SignIdentityPayload(unsigned)
	if err != nil {
		return err
	}
	body, _ := json.Marshal(receipt)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(start.CloudURL, "/")+"/v3/compute-transfers/"+url.PathEscape(start.TransferID)+"/receipts", strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(authToken))
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("Cloud rejected transfer receipt with HTTP %d", response.StatusCode)
	}
	return nil
}
