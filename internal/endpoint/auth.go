package endpoint

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type oauthClientSecret struct {
	TokenURL     string `json:"tokenUrl"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	Scope        string `json:"scope"`
	Audience     string `json:"audience"`
}

type mtlsClientSecret struct {
	CertificatePEM string `json:"certificatePem"`
	PrivateKeyPEM  string `json:"privateKeyPem"`
	CAPEM          string `json:"caPem"`
	ServerName     string `json:"serverName"`
}

type cachedOAuthToken struct {
	Token     string
	ExpiresAt time.Time
}

var endpointOAuthCache = struct {
	sync.Mutex
	items map[[32]byte]cachedOAuthToken
}{items: map[[32]byte]cachedOAuthToken{}}

func applyRequestCredential(ctx context.Context, request *http.Request, authType, name, secret string) (*http.Transport, error) {
	authType = strings.ToLower(strings.TrimSpace(authType))
	switch authType {
	case "", "none":
	case "bearer":
		request.Header.Set("Authorization", "Bearer "+secret)
	case "basic":
		request.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(secret)))
	case "api_key", "header_api_key":
		if strings.TrimSpace(name) == "" {
			name = "X-API-Key"
		}
		request.Header.Set(name, secret)
	case "query_api_key":
		if strings.TrimSpace(name) == "" {
			name = "api_key"
		}
		query := request.URL.Query()
		query.Set(name, secret)
		request.URL.RawQuery = query.Encode()
	case "cookie_api_key":
		if strings.TrimSpace(name) == "" {
			name = "api_key"
		}
		request.AddCookie(&http.Cookie{Name: name, Value: secret, Secure: request.URL.Scheme == "https", HttpOnly: true})
	case "oauth2_client_credentials":
		token, err := endpointOAuthToken(ctx, secret)
		if err != nil {
			return nil, err
		}
		request.Header.Set("Authorization", "Bearer "+token)
	case "mtls":
		transport, err := endpointMTLSTransport(secret)
		if err != nil {
			return nil, err
		}
		return transport, nil
	default:
		return nil, fmt.Errorf("unsupported endpoint authentication type %q", authType)
	}
	return nil, nil
}

func endpointOAuthToken(ctx context.Context, raw string) (string, error) {
	var config oauthClientSecret
	if json.Unmarshal([]byte(raw), &config) != nil || strings.TrimSpace(config.ClientID) == "" || strings.TrimSpace(config.ClientSecret) == "" {
		return "", errors.New("OAuth2 credential must contain tokenUrl, clientId, and clientSecret")
	}
	target, err := url.Parse(strings.TrimSpace(config.TokenURL))
	if err != nil || target.Scheme != "https" || target.Host == "" || target.User != nil {
		return "", errors.New("OAuth2 tokenUrl must be a public HTTPS URL without embedded credentials")
	}
	key := sha256.Sum256([]byte(raw))
	now := time.Now()
	endpointOAuthCache.Lock()
	cached := endpointOAuthCache.items[key]
	endpointOAuthCache.Unlock()
	if cached.Token != "" && now.Add(30*time.Second).Before(cached.ExpiresAt) {
		return cached.Token, nil
	}
	form := url.Values{"grant_type": {"client_credentials"}}
	if config.Scope != "" {
		form.Set("scope", config.Scope)
	}
	if config.Audience != "" {
		form.Set("audience", config.Audience)
	}
	request, _ := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.SetBasicAuth(config.ClientID, config.ClientSecret)
	response, err := (&http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(request)
	if err != nil {
		return "", errors.New("OAuth2 token endpoint is unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("OAuth2 token endpoint returned HTTP %d", response.StatusCode)
	}
	var payload struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&payload) != nil || strings.TrimSpace(payload.AccessToken) == "" {
		return "", errors.New("OAuth2 token response is invalid")
	}
	if payload.ExpiresIn <= 0 {
		payload.ExpiresIn = 300
	}
	endpointOAuthCache.Lock()
	endpointOAuthCache.items[key] = cachedOAuthToken{Token: payload.AccessToken, ExpiresAt: now.Add(time.Duration(payload.ExpiresIn) * time.Second)}
	endpointOAuthCache.Unlock()
	return payload.AccessToken, nil
}

func endpointMTLSTransport(raw string) (*http.Transport, error) {
	var config mtlsClientSecret
	if json.Unmarshal([]byte(raw), &config) != nil {
		return nil, errors.New("mTLS credential JSON is invalid")
	}
	certificate, err := tls.X509KeyPair([]byte(config.CertificatePEM), []byte(config.PrivateKeyPEM))
	if err != nil {
		return nil, errors.New("mTLS certificate or private key is invalid")
	}
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{certificate}, ServerName: strings.TrimSpace(config.ServerName)}
	if strings.TrimSpace(config.CAPEM) != "" {
		roots := x509.NewCertPool()
		if !roots.AppendCertsFromPEM([]byte(config.CAPEM)) {
			return nil, errors.New("mTLS CA bundle is invalid")
		}
		tlsConfig.RootCAs = roots
	}
	return &http.Transport{Proxy: http.ProxyFromEnvironment, TLSClientConfig: tlsConfig, ForceAttemptHTTP2: true}, nil
}
