package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/exora-dock/exora-dock/internal/dht"
)

const voteQuorum = 3 // target number of voters including self

// ConsensusResult aggregates votes from multiple nodes.
type ConsensusResult struct {
	Approved bool           `json:"approved"`
	Votes    []ReviewResult `json:"votes"`
	Quorum   int            `json:"quorum"`
}

// CollectVotes gathers review votes from peer nodes and combines with selfResult.
func CollectVotes(ctx context.Context, ring *dht.Ring, req ReviewRequest, selfResult ReviewResult) ConsensusResult {
	miners := ring.Lookup(req.ProductID, voteQuorum)

	var (
		mu    sync.Mutex
		votes = []ReviewResult{selfResult}
		wg    sync.WaitGroup
	)

	client := &http.Client{Timeout: 30 * time.Second}

	for _, m := range miners {
		if m.Pubkey == selfResult.MinerPubkey {
			continue // skip self
		}
		wg.Add(1)
		go func(endpoint string) {
			defer wg.Done()

			body, err := json.Marshal(req)
			if err != nil {
				return
			}

			voteCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
			defer cancel()

			httpReq, err := http.NewRequestWithContext(voteCtx, "POST", endpoint+"/v1/review/vote", bytes.NewReader(body))
			if err != nil {
				return
			}
			httpReq.Header.Set("Content-Type", "application/json")

			resp, err := client.Do(httpReq)
			if err != nil {
				return
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				return
			}

			var vr ReviewResult
			if err := json.NewDecoder(resp.Body).Decode(&vr); err != nil {
				return
			}

			mu.Lock()
			votes = append(votes, vr)
			mu.Unlock()
		}(m.Endpoint)
	}

	wg.Wait()

	approveCount := 0
	for _, v := range votes {
		if v.Approved {
			approveCount++
		}
	}

	return ConsensusResult{
		Approved: approveCount > len(votes)/2,
		Votes:    votes,
		Quorum:   len(votes),
	}
}

// FormatResultKey returns the Badger key for storing a review result.
func FormatResultKey(productID string) string {
	return fmt.Sprintf("review:%s", productID)
}
