# ScCode Agent

Local agent runtime used by the ScCode desktop app. The Go server runs on
loopback and provides tools, MCP, memory, sessions, and provider calls.

The desktop app builds and supervises this server. You only need this README if
you are running the server by hand.

## Architecture

```
┌────────────────────┐        WebSocket         ┌────────────────────────┐
│  ScCode (Tauri)    │ ◄──────────────────────► │  sc-code-agent (Go)    │
│                    │                          │                        │
│  • Workbench UI    │                          │  • Provider calls      │
│  • Editor/terminal │                          │  • Context compression │
│  • Tool display    │                          │  • Memory + sessions   │
│  • Streaming       │                          │  • Tool execution      │
└────────────────────┘                          └────────────────────────┘
```

## Layout

```
agent/
├── server/   # Go agent server (built as sc-code-agent / sc-code-agent.exe)
├── core/     # Standalone Rust tool-executor crate
└── cli/      # Standalone Rust CLI client
```

## Tools

| Tool | Description |
|------|-------------|
| `read_file` | Read files with line numbers, auto-compress large files |
| `write_file` | Create/overwrite files, auto-create directories |
| `edit_file` | Find-and-replace with uniqueness checks |
| `list_dir` | List directory contents with sizes |
| `search_files` | Glob-based recursive file search |
| `grep` | Ripgrep-powered content search |
| `shell` | Execute shell commands |
| `glob` | Find files by pattern |
| `tree` | Directory tree visualization |
| `diff` | Git diff output |
| `batch_read` | Read multiple files at once |
| `file_info` | File metadata (size, permissions, timestamps) |

## Features

- **Context compression** — compresses long conversations while preserving
  code-significant lines (definitions, imports, error handling).
- **Persistent memory** — project-scoped memory injected into system prompts.
- **Streaming** — real-time WebSocket streaming with tool call display.
- **Session management** — resume previous conversations.
- **Tool output compression** — large shell/file outputs are truncated with
  head and tail preserved.

## Setup

### Prerequisites

- Go 1.26+
- Rust 1.91+ (CLI only)
- `rg` (ripgrep) on `PATH`
- A model provider: API key, Claude Code / Codex login, or a local server.

### Server

```bash
cd agent/server
go mod tidy
go run ./cmd/server
```

The server listens on `127.0.0.1:7433` by default. Override with
`SC_CODE_PORT`.

### CLI

```bash
cd agent/cli
cargo build --release
```

The binary lands at `target/release/sc-code-agent-cli` (or `.exe` on Windows).

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SC_CODE_PORT` | `7433` | Server port |
| `SC_CODE_BIND_ADDR` | `127.0.0.1` | Bind address (loopback only by default) |
| `SC_CODE_HOME` | `~/.sc-code` | User state root |
| `SC_CODE_DATA_DIR` | `~/.sc-code/data` | Usage database location |
| `SC_CODE_MODEL` | `anthropic/claude-sonnet-4.6` | Default model |
| `SC_CODE_SERVER` | `ws://localhost:7433` | Server URL (CLI) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` | — | Bedrock credentials (optional) |

Provider credentials are passed as `SC_CODE_PROVIDER_<PROVIDER>_KEY`,
`_BASE_URL`, `_AUTH`, and `_ACCOUNT_ID`.

## Usage

```bash
# Interactive mode (default)
sc-code-agent-cli

# One-shot question
sc-code-agent-cli ask "explain this codebase"

# List sessions
sc-code-agent-cli sessions

# Search memories
sc-code-agent-cli memory "database schema"

# Check the server
sc-code-agent-cli status

# Resume a session
sc-code-agent-cli chat --session <id>

# Custom server
sc-code-agent-cli --server ws://myserver:7433
```

### In-session commands

| Command | Action |
|---------|--------|
| `/quit` | Exit |
| `/clear` | Clear screen |
| `/memory` | Show stored memories |
| `/sessions` | List sessions |
| `/status` | Server health check |
