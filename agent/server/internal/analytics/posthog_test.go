package analytics

import "testing"

func TestTelemetryRequiresExplicitOptInEvenWithLegacyKey(t *testing.T) {
	t.Setenv("SC_CODE_TELEMETRY", "")
	t.Setenv("POSTHOG_API_KEY", "short")
	if NewAnalytics().IsEnabled() {
		t.Fatal("legacy telemetry must not be enabled implicitly")
	}
}
