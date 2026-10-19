package memdir

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/zouv/sc-code/agent/server/internal/paths"
)

const (
	EntrypointFile     = "memory.md"
	MaxEntrypointLines = 200
)

// MemoryEntry represents a single memory from the filesystem.
type MemoryEntry struct {
	Key      string
	Value    string
	Category string // user, project, feedback, reference
	FilePath string
	ModTime  time.Time
}

// EnsureDir creates the project state directory in ~/.sc-code/projects/<slug>/.
func EnsureDir(projectDir string) error {
	return paths.EnsureProjectDirs(projectDir)
}

// LoadMemoryPrompt reads the memory file and builds a prompt section
// containing all memories. This is injected into the system prompt.
// Memory is stored at ~/.sc-code/projects/<slug>/memory.md, NOT in the user's repo.
func LoadMemoryPrompt(projectDir string) string {
	entrypoint := paths.ProjectMemoryMD(projectDir)

	content, err := os.ReadFile(entrypoint)
	if err != nil {
		return ""
	}

	lines := strings.Split(string(content), "\n")
	if len(lines) > MaxEntrypointLines {
		lines = lines[:MaxEntrypointLines]
	}

	body := strings.TrimSpace(strings.Join(lines, "\n"))
	if body == "" {
		return ""
	}

	return fmt.Sprintf("# Project Memory\n\nThe following memories are from previous sessions. Trust them as useful context but verify before acting on anything consequential.\n\n%s", body)
}

// SaveMemory writes a memory entry. Stored at ~/.sc-code/projects/<slug>/memory.md.
func SaveMemory(projectDir, key, value, category string) error {
	if err := paths.EnsureProjectDirs(projectDir); err != nil {
		return err
	}

	entrypoint := paths.ProjectMemoryMD(projectDir)

	entry := fmt.Sprintf("\n## %s\n\n**Category**: %s\n**Updated**: %s\n\n%s\n",
		key, category, time.Now().Format("2006-01-02 15:04"), value)

	f, err := os.OpenFile(entrypoint, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = f.WriteString(entry)
	return err
}

// ListMemories returns all memory entries by parsing memory.md sections.
func ListMemories(projectDir string) []MemoryEntry {
	entrypoint := paths.ProjectMemoryMD(projectDir)

	content, err := os.ReadFile(entrypoint)
	if err != nil {
		return nil
	}

	return parseMemoryEntries(string(content))
}

func parseMemoryEntries(content string) []MemoryEntry {
	var entries []MemoryEntry
	sections := strings.Split(content, "\n## ")

	for _, section := range sections[1:] { // skip header
		lines := strings.SplitN(section, "\n", 2)
		if len(lines) < 2 {
			continue
		}
		key := strings.TrimSpace(lines[0])
		body := strings.TrimSpace(lines[1])

		category := "project"
		for _, line := range strings.Split(body, "\n") {
			if strings.HasPrefix(line, "**Category**: ") {
				category = strings.TrimPrefix(line, "**Category**: ")
				break
			}
		}

		entries = append(entries, MemoryEntry{
			Key:      key,
			Value:    body,
			Category: category,
		})
	}
	return entries
}
