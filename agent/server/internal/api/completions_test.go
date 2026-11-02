package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/zouv/sc-code/agent/server/internal/ai"
)

func TestCompletionsAgentContract(t *testing.T) {
	var prompt string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		var body struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if len(body.Messages) > 1 {
			prompt = body.Messages[1].Content
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"synthetic","choices":[{"message":{"content":"return 1;"}}]}`))
	}))
	defer provider.Close()
	// All model traffic is redirected to this test server; no real profile or paid API.
	t.Setenv("COMPLETION_SERVER_URL", provider.URL)
	t.Setenv("COMPLETION_MODEL", "synthetic")
	t.Setenv("COMPLETION_API_KEY", "synthetic")
	t.Setenv("SC_CODE_HOME", t.TempDir())
	h := &Handler{aiClient: ai.NewClient()}
	response := httptest.NewRecorder()
	h.Completions(response, httptest.NewRequest(http.MethodPost, "/v1/completions", strings.NewReader(`{"prefix":"function example() {","suffix":"}","file_path":"/example.ts","language":"typescript"}`)))
	if response.Code != http.StatusOK {
		t.Fatalf("status %d: %s", response.Code, response.Body.String())
	}
	var result ai.CompletionResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Completion != "return 1;" {
		t.Fatalf("unexpected completion: %+v", result)
	}
	if !strings.Contains(prompt, "function example() {") || !strings.Contains(prompt, "<|fim_suffix|>}") {
		t.Fatalf("prefix/suffix lost: %q", prompt)
	}
}

func TestCompletionsRejectsLegacyPromptOnlyBody(t *testing.T) {
	response := httptest.NewRecorder()
	(&Handler{}).Completions(response, httptest.NewRequest(http.MethodPost, "/v1/completions", strings.NewReader(`{"prompt":"function example() {"}`)))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status: %d", response.Code)
	}
}
