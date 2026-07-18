package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteCloudPayloadExplainsUnsupportedCloudOperation(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeCloudPayload(recorder, http.StatusMethodNotAllowed, []byte("Method Not Allowed\n"))
	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Error          string `json:"error"`
		Code           string `json:"code"`
		UpstreamStatus int    `json:"upstreamStatus"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Code != "cloud_operation_not_supported" || body.UpstreamStatus != http.StatusMethodNotAllowed || !strings.Contains(body.Error, "matching Cloud API and database migration") {
		t.Fatalf("unexpected response: %+v", body)
	}
}
