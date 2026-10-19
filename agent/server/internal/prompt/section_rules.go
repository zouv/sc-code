package prompt

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/zouv/sc-code/agent/server/internal/paths"
)

// LoadRulesPrompt reads all custom workspace rules from project-local
// (.sc-code/rules/) and user-global (~/.sc-code/rules/) directories and
// compiles them into a unified section inside the system prompt.
func LoadRulesPrompt(workspacePath string) string {
	var rules []string

	// Helper to load md/mdc rules from a directory
	loadFromDir := func(dir string) {
		info, err := os.Stat(dir)
		if err != nil || !info.IsDir() {
			return
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range entries {
			if !e.IsDir() && (strings.HasSuffix(e.Name(), ".md") || strings.HasSuffix(e.Name(), ".mdc")) {
				filePath := filepath.Join(dir, e.Name())
				if data, err := os.ReadFile(filePath); err == nil {
					content := strings.TrimSpace(string(data))
					if content != "" {
						ruleName := strings.TrimSuffix(e.Name(), filepath.Ext(e.Name()))
						rules = append(rules, fmt.Sprintf("### Rule: %s\n\n%s", ruleName, content))
					}
				}
			}
		}
	}

	// Load user-global rules (~/.sc-code/rules/)
	loadFromDir(paths.GlobalRulesDir())

	// Load project-local rules (<project>/.sc-code/rules/)
	loadFromDir(paths.InRepoRulesDir(workspacePath))

	if len(rules) == 0 {
		return ""
	}

	return fmt.Sprintf("<custom_workspace_rules>\n# Custom Workspace Rules\n\nThe following custom rules and guidelines are configured for this workspace. You MUST follow them strictly:\n\n%s\n</custom_workspace_rules>", strings.Join(rules, "\n\n"))
}
