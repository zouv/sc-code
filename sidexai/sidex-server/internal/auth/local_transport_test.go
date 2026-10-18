package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLocalTransport(t *testing.T) {
	token := strings.Repeat("a", 32)
	origins := map[string]bool{"https://tauri.localhost": true}
	for _, tc := range []struct {
		name, path, host, origin, auth, upgrade, configured string
		want                                                int
	}{
		{"no credential", "/v1/models", "127.0.0.1:7433", "", "", "", token, 401},
		{"authorized REST", "/v1/models", "127.0.0.1:7433", "https://tauri.localhost", "Bearer " + token, "", token, 200},
		{"bad origin", "/v1/models", "127.0.0.1:7433", "https://evil.test", "Bearer " + token, "", token, 403},
		{"dns rebinding", "/v1/models", "evil.test:7433", "", "Bearer " + token, "", token, 403},
		{"health", "/v1/health", "127.0.0.1:7433", "", "", "", token, 200},
		{"query REST rejected", "/v1/models?token=" + token, "127.0.0.1:7433", "", "", "", token, 401},
		{"WS", "/v1/stream?token=" + token, "localhost:7433", "https://tauri.localhost", "", "websocket", token, 200},
		{"wrong WS", "/v1/stream?token=bad", "localhost:7433", "", "", "websocket", token, 401},
		{"empty configuration", "/v1/models", "127.0.0.1:7433", "", "", "", "", 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "http://"+tc.host+tc.path, nil)
			req.Header.Set("Origin", tc.origin)
			req.Header.Set("Authorization", tc.auth)
			req.Header.Set("Upgrade", tc.upgrade)
			w := httptest.NewRecorder()
			LocalTransportMiddleware(tc.configured, origins)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })).ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("got %d want %d", w.Code, tc.want)
			}
		})
	}
}
