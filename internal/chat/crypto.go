package chat

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"fmt"
	"io"
	"math/big"
)

// SharedSecret derives a shared secret from sender's ed25519 private key and
// receiver's ed25519 public key using X25519 key exchange.
// Ed25519 keys are converted to Curve25519 for ECDH.
func SharedSecret(privKey ed25519.PrivateKey, peerPubKey ed25519.PublicKey) ([]byte, error) {
	curvPriv := edPrivToCurve25519(privKey)
	curvPub, err := edPubToCurve25519(peerPubKey)
	if err != nil {
		return nil, err
	}

	shared := x25519Multiply(curvPriv, curvPub)
	// HKDF-like derivation: SHA256(shared || "umbra-chat-v1")
	h := sha256.New()
	h.Write(shared)
	h.Write([]byte("umbra-chat-v1"))
	return h.Sum(nil), nil
}

// Encrypt encrypts plaintext using AES-256-GCM with the shared secret.
// Returns hex-encoded nonce+ciphertext.
func Encrypt(sharedSecret []byte, plaintext []byte) (string, error) {
	block, err := aes.NewCipher(sharedSecret[:32])
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	return hex.EncodeToString(ciphertext), nil
}

// Decrypt decrypts hex-encoded nonce+ciphertext using AES-256-GCM.
func Decrypt(sharedSecret []byte, ciphertextHex string) ([]byte, error) {
	data, err := hex.DecodeString(ciphertextHex)
	if err != nil {
		return nil, err
	}

	block, err := aes.NewCipher(sharedSecret[:32])
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}

	return gcm.Open(nil, data[:nonceSize], data[nonceSize:], nil)
}

// --- Ed25519 to Curve25519 conversion ---

// edPrivToCurve25519 converts an ed25519 private key to a curve25519 private key.
func edPrivToCurve25519(priv ed25519.PrivateKey) []byte {
	h := sha512.New()
	h.Write(priv.Seed())
	digest := h.Sum(nil)

	digest[0] &= 248
	digest[31] &= 127
	digest[31] |= 64

	return digest[:32]
}

// edPubToCurve25519 converts an ed25519 public key to a curve25519 public key.
// Uses the birational map from Edwards to Montgomery form.
func edPubToCurve25519(pub ed25519.PublicKey) ([]byte, error) {
	// Ed25519 point (x, y) on Edwards curve: -x^2 + y^2 = 1 + d*x^2*y^2
	// Montgomery u = (1 + y) / (1 - y)

	p := new(big.Int).SetBytes(reverse(pub))
	// Clear top bit (sign bit)
	p.SetBit(p, 255, 0)

	prime := edwards25519Prime()
	one := big.NewInt(1)

	// numerator = 1 + y
	num := new(big.Int).Add(one, p)
	num.Mod(num, prime)

	// denominator = 1 - y
	den := new(big.Int).Sub(one, p)
	den.Mod(den, prime)

	// modular inverse of denominator
	denInv := new(big.Int).ModInverse(den, prime)
	if denInv == nil {
		return nil, fmt.Errorf("invalid public key: cannot invert")
	}

	u := new(big.Int).Mul(num, denInv)
	u.Mod(u, prime)

	// Convert to 32 bytes little-endian
	uBytes := u.Bytes()
	result := make([]byte, 32)
	for i, b := range uBytes {
		result[len(uBytes)-1-i] = b
	}

	return result, nil
}

func edwards25519Prime() *big.Int {
	p := new(big.Int).SetInt64(1)
	p.Lsh(p, 255)
	p.Sub(p, big.NewInt(19))
	return p
}

func reverse(b []byte) []byte {
	r := make([]byte, len(b))
	for i := range b {
		r[len(b)-1-i] = b[i]
	}
	return r
}

// x25519Multiply performs scalar multiplication on Curve25519.
// This is a simplified implementation — in production use golang.org/x/crypto/curve25519.
func x25519Multiply(scalar, point []byte) []byte {
	// Montgomery ladder on Curve25519
	p := edwards25519Prime()

	k := new(big.Int).SetBytes(reverse(scalar))
	u := new(big.Int).SetBytes(reverse(point))

	// Clamp scalar
	kBytes := k.Bytes()
	if len(kBytes) >= 32 {
		kBytes[0] &= 248
		kBytes[31] &= 127
		kBytes[31] |= 64
	}
	k.SetBytes(kBytes)

	a24 := big.NewInt(121665)

	x_1 := new(big.Int).Set(u)
	x_2 := big.NewInt(1)
	z_2 := big.NewInt(0)
	x_3 := new(big.Int).Set(u)
	z_3 := big.NewInt(1)
	swap := big.NewInt(0)

	tmp := new(big.Int)

	for t := 254; t >= 0; t-- {
		k_t := new(big.Int).Rsh(k, uint(t))
		k_t.And(k_t, big.NewInt(1))

		tmp.Xor(swap, k_t)
		cswap(tmp, x_2, x_3)
		cswap(tmp, z_2, z_3)
		swap.Set(k_t)

		A := new(big.Int).Add(x_2, z_2)
		A.Mod(A, p)
		AA := new(big.Int).Mul(A, A)
		AA.Mod(AA, p)
		B := new(big.Int).Sub(x_2, z_2)
		B.Mod(B, p)
		if B.Sign() < 0 {
			B.Add(B, p)
		}
		BB := new(big.Int).Mul(B, B)
		BB.Mod(BB, p)
		E := new(big.Int).Sub(AA, BB)
		E.Mod(E, p)
		if E.Sign() < 0 {
			E.Add(E, p)
		}
		C := new(big.Int).Add(x_3, z_3)
		C.Mod(C, p)
		D := new(big.Int).Sub(x_3, z_3)
		D.Mod(D, p)
		if D.Sign() < 0 {
			D.Add(D, p)
		}
		DA := new(big.Int).Mul(D, A)
		DA.Mod(DA, p)
		CB := new(big.Int).Mul(C, B)
		CB.Mod(CB, p)

		sum := new(big.Int).Add(DA, CB)
		sum.Mod(sum, p)
		x_3.Mul(sum, sum)
		x_3.Mod(x_3, p)

		diff := new(big.Int).Sub(DA, CB)
		diff.Mod(diff, p)
		if diff.Sign() < 0 {
			diff.Add(diff, p)
		}
		z_3.Mul(diff, diff)
		z_3.Mod(z_3, p)
		z_3.Mul(z_3, x_1)
		z_3.Mod(z_3, p)

		x_2.Mul(AA, BB)
		x_2.Mod(x_2, p)

		tmp2 := new(big.Int).Mul(a24, E)
		tmp2.Mod(tmp2, p)
		tmp2.Add(AA, tmp2)
		tmp2.Mod(tmp2, p)
		z_2.Mul(E, tmp2)
		z_2.Mod(z_2, p)
	}

	cswap(swap, x_2, x_3)
	cswap(swap, z_2, z_3)

	z_2Inv := new(big.Int).ModInverse(z_2, p)
	result := new(big.Int).Mul(x_2, z_2Inv)
	result.Mod(result, p)

	rBytes := result.Bytes()
	out := make([]byte, 32)
	for i, b := range rBytes {
		out[len(rBytes)-1-i] = b
	}
	return out
}

func cswap(swap, a, b *big.Int) {
	if swap.Sign() != 0 {
		tmp := new(big.Int).Set(a)
		a.Set(b)
		b.Set(tmp)
	}
}
