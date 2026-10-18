package paths

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ExpandUser expands a leading "~" or "~/" in a path to the user's home
// directory. Environment variables like SIDEX_DATA_DIR are often set with a
// literal tilde that the shell never expanded; Go treats that as a relative
// path and silently creates a "./~" directory, so we expand it here.
func ExpandUser(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") || strings.HasPrefix(p, `~\`) {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, strings.TrimLeft(p[1:], "/\\"))
		}
	}
	return p
}

// SidexHome returns the root of sidex's user-level state directory.
// Defaults to ~/.sc-code; SC_CODE_HOME takes precedence over the SIDEX_HOME compatibility alias.
func SidexHome() string {
	if env := os.Getenv("SC_CODE_HOME"); env != "" {
		return ExpandUser(env)
	}
	if env := os.Getenv("SIDEX_HOME"); env != "" {
		return ExpandUser(env)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), ".sc-code")
	}
	return filepath.Join(home, ".sc-code")
}

// GlobalConfig returns the path to the global config file (~/.sc-code/config.json).
func GlobalConfig() string {
	return filepath.Join(SidexHome(), "config.json")
}

// GlobalMCP returns the path to the global MCP server definitions (~/.sc-code/mcp.json).
func GlobalMCP() string {
	return filepath.Join(SidexHome(), "mcp.json")
}

// GlobalSkillsDir returns the path to user-global skills (~/.sc-code/skills/).
func GlobalSkillsDir() string {
	return filepath.Join(SidexHome(), "skills")
}

// GlobalRulesDir returns the path to user-global rules (~/.sc-code/rules/).
func GlobalRulesDir() string {
	return filepath.Join(SidexHome(), "rules")
}

// GlobalAgentsDir returns the path to user-global custom subagents (~/.sc-code/agents/).
func GlobalAgentsDir() string {
	return filepath.Join(SidexHome(), "agents")
}

// PlansDir returns the path to agent plan files (~/.sc-code/plans/).
func PlansDir() string {
	return filepath.Join(SidexHome(), "plans")
}

// StateDB returns the path to the global BoltDB state file (~/.sc-code/state.db).
func StateDB() string {
	return filepath.Join(SidexHome(), "state.db")
}

// ProjectsDir returns the root projects directory (~/.sc-code/projects/).
func ProjectsDir() string {
	return filepath.Join(SidexHome(), "projects")
}

// ProjectDir returns the per-project state directory for a given workspace path.
// The workspace path is converted to a slug: absolute path with "/" replaced by "-"
// and the leading separator removed. Example:
//
//	/Users/bob/code/myapp → Users-bob-code-myapp
func ProjectDir(workspacePath string) string {
	slug := WorkspaceSlug(workspacePath)
	return filepath.Join(ProjectsDir(), slug)
}

// WorkspaceSlug converts an absolute workspace path to a directory-safe slug.
func WorkspaceSlug(workspacePath string) string {
	// Preserve POSIX absolute identity when importing from another platform.
	normalized := strings.ReplaceAll(workspacePath, "\\", "/")
	if !strings.HasPrefix(normalized, "/") && !(len(normalized) >= 3 && normalized[1] == ':' && normalized[2] == '/') {
		if abs, err := filepath.Abs(workspacePath); err == nil {
			normalized = filepath.ToSlash(abs)
		}
	}
	normalized = strings.TrimLeft(normalized, "/")
	normalized = strings.ReplaceAll(normalized, "/", "-")
	var slug strings.Builder
	for _, char := range normalized {
		if char < 32 || strings.ContainsRune(":<>\"|?*%", char) {
			fmt.Fprintf(&slug, "%%%02X", char)
		} else {
			slug.WriteRune(char)
		}
	}
	result := strings.TrimRight(slug.String(), " .")
	if result == "" {
		return "workspace-root"
	}
	return result
}

// ProjectMemoryDB returns the SQLite memory database path for a workspace.
func ProjectMemoryDB(workspacePath string) string {
	return filepath.Join(ProjectDir(workspacePath), "memory.db")
}

// ProjectMemoryMD returns the human-readable memory markdown path for a workspace.
func ProjectMemoryMD(workspacePath string) string {
	return filepath.Join(ProjectDir(workspacePath), "memory.md")
}

// ProjectTranscriptsDir returns the transcripts directory for a workspace.
func ProjectTranscriptsDir(workspacePath string) string {
	return filepath.Join(ProjectDir(workspacePath), "transcripts")
}

// ProjectTerminalsDir returns the terminals directory for a workspace.
func ProjectTerminalsDir(workspacePath string) string {
	return filepath.Join(ProjectDir(workspacePath), "terminals")
}

// ProjectAssetsDir returns the assets directory for a workspace.
func ProjectAssetsDir(workspacePath string) string {
	return filepath.Join(ProjectDir(workspacePath), "assets")
}

// ProjectToolsDir returns the tool output cache directory for a workspace.
func ProjectToolsDir(workspacePath string) string {
	return filepath.Join(ProjectDir(workspacePath), "tools")
}

// ProjectCanvasesDir returns the canvases directory for a workspace.
func ProjectCanvasesDir(workspacePath string) string {
	return filepath.Join(ProjectDir(workspacePath), "canvases")
}

// ProjectUploadsDir returns the uploads directory for a workspace.
func ProjectUploadsDir(workspacePath string) string {
	return filepath.Join(ProjectDir(workspacePath), "uploads")
}

// ProjectMCPDir returns the MCP tool descriptor cache directory for a workspace.
func ProjectMCPDir(workspacePath string) string {
	return filepath.Join(ProjectDir(workspacePath), "mcps")
}

// InRepoRulesDir returns the in-repo rules directory (<project>/.sidex/rules/).
// This is the ONLY state we write inside the user's git repo.
func InRepoRulesDir(workspacePath string) string {
	return filepath.Join(workspacePath, ".sidex", "rules")
}

// InRepoSkillsDir returns the in-repo skills directory (<project>/.sidex/skills/).
func InRepoSkillsDir(workspacePath string) string {
	return filepath.Join(workspacePath, ".sidex", "skills")
}

// EnsureProjectDirs creates all the per-project subdirectories if they don't exist.
func EnsureProjectDirs(workspacePath string) error {
	dirs := []string{
		ProjectDir(workspacePath),
		ProjectTranscriptsDir(workspacePath),
		ProjectTerminalsDir(workspacePath),
		ProjectAssetsDir(workspacePath),
		ProjectToolsDir(workspacePath),
		ProjectCanvasesDir(workspacePath),
		ProjectUploadsDir(workspacePath),
		ProjectMCPDir(workspacePath),
	}
	for _, d := range dirs {
		if err := os.MkdirAll(d, 0755); err != nil {
			return err
		}
	}
	return nil
}

// EnsureGlobalDirs creates the top-level ~/.sc-code structure.
func EnsureGlobalDirs() error {
	dirs := []string{
		SidexHome(),
		GlobalSkillsDir(),
		GlobalRulesDir(),
		GlobalAgentsDir(),
		PlansDir(),
		ProjectsDir(),
	}
	for _, d := range dirs {
		if err := os.MkdirAll(d, 0755); err != nil {
			return err
		}
	}
	return nil
}
