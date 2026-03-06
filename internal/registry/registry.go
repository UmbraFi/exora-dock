package registry

import (
	"context"
	"log"

	"github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

type Registry struct {
	client    *rpc.Client
	programID solana.PublicKey
	wallet    solana.PrivateKey
}

func New(rpcURL string, programID string, keyPath string) (*Registry, error) {
	pk, err := solana.PrivateKeyFromSolanaKeygenFile(keyPath)
	if err != nil {
		return nil, err
	}

	pid, err := solana.PublicKeyFromBase58(programID)
	if err != nil {
		return nil, err
	}

	return &Registry{
		client:    rpc.New(rpcURL),
		programID: pid,
		wallet:    pk,
	}, nil
}

// Register sends a registration transaction to the on-chain program.
// This is a placeholder — the actual instruction data depends on the deployed program.
func (r *Registry) Register(ctx context.Context, endpointURL string) error {
	log.Printf("[registry] registering node %s with endpoint %s", r.wallet.PublicKey(), endpointURL)
	// TODO: Build and send the actual register instruction once the program IDL is finalized.
	// For now, just log the intent.
	log.Println("[registry] registration placeholder — program not yet deployed")
	return nil
}

func (r *Registry) PublicKey() solana.PublicKey {
	return r.wallet.PublicKey()
}
