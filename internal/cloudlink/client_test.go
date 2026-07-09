package cloudlink

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"testing"
)

func TestDecryptCommandEnvelope(t *testing.T) {
	privateKey, publicKey, err := generateCommandKeypair()
	if err != nil {
		t.Fatal(err)
	}
	body := map[string]any{"paymentPin": "123456", "optionId": "opt-1"}
	encryptedBody, encryption := encryptCommandEnvelopeForTest(t, publicKey, body)
	plaintext, err := decryptCommandEnvelope(privateKey, encryptedBody, encryption)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(plaintext, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["paymentPin"] != "123456" || decoded["optionId"] != "opt-1" {
		t.Fatalf("decoded body = %#v", decoded)
	}
}

func encryptCommandEnvelopeForTest(t *testing.T, publicKeyB64 string, body map[string]any) (map[string]any, map[string]any) {
	t.Helper()
	curve := ecdh.P256()
	recipientBytes, err := decodeBase64URL(publicKeyB64)
	if err != nil {
		t.Fatal(err)
	}
	recipient, err := curve.NewPublicKey(recipientBytes)
	if err != nil {
		t.Fatal(err)
	}
	ephemeral, err := curve.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	shared, err := ephemeral.ECDH(recipient)
	if err != nil {
		t.Fatal(err)
	}
	key := sha256.Sum256(shared)
	block, err := aes.NewCipher(key[:])
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	iv := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(iv); err != nil {
		t.Fatal(err)
	}
	plaintext, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	aad := "exora-remote-command-v1"
	return map[string]any{
			"ciphertext": encodeBase64URL(gcm.Seal(nil, iv, plaintext, []byte(aad))),
		}, map[string]any{
			"alg":                "ECDH-P256+A256GCM",
			"ephemeralPublicKey": encodeBase64URL(ephemeral.PublicKey().Bytes()),
			"iv":                 encodeBase64URL(iv),
			"aad":                aad,
		}
}
