package auth

import (
	"crypto/subtle"
	"net"
	"net/http"
	"net/url"
	"strings"
)

// LocalTransportMiddleware protects shell/file APIs from other local clients
// and websites. User identity middleware alone is not authentication.
func LocalTransportMiddleware(token string, origins map[string]bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			host := r.Host
			if h, _, err := net.SplitHostPort(host); err == nil {
				host = h
			}
			if host != "localhost" && host != "127.0.0.1" && host != "::1" {
				http.Error(w, "invalid local host", http.StatusForbidden)
				return
			}
			origin := r.Header.Get("Origin")
			if origin != "" && !origins[origin] {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
			if r.URL.Path == "/v1/health" && r.Method == http.MethodGet {
				next.ServeHTTP(w, r)
				return
			}
			// Preflight reveals no data; the actual method still authenticates.
			if r.Method == http.MethodOptions && origin != "" && origins[origin] {
				next.ServeHTTP(w, r)
				return
			}
			actual := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			// Query tokens are accepted exclusively on the WS upgrade route.
			if r.URL.Path == "/v1/stream" && strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
				if q, err := url.ParseQuery(r.URL.RawQuery); err == nil {
					actual = q.Get("token")
				}
			}
			if len(token) < 32 || len(actual) != len(token) || subtle.ConstantTimeCompare([]byte(actual), []byte(token)) != 1 {
				http.Error(w, "unauthorized local client", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
