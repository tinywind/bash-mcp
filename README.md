# DEPRECATED_bash-mcp

> **This project is no longer maintained.** Development and support ended on October 29, 2026. No new features, bug fixes, dependency updates, or security patches will be provided. Do not use this project for new integrations.

Use your coding agent's built-in shell tools when available. [Claude Code](https://code.claude.com/docs/en/interactive-mode#background-bash-commands) supports shell commands, background tasks, and output retrieval. For MCP clients that need a separate terminal server, evaluate [Desktop Commander](https://github.com/wonderwhy-er/DesktopCommanderMCP). Its configuration and tool names differ from bash-mcp.

## Historical documentation

The documentation below is retained for historical reference.

A simple MCP (Model Context Protocol) server that enables Claude to execute shell commands without permission prompts.

⚠️ **Security Warning**: This server executes arbitrary shell commands. Use with caution and only in trusted environments.

## Installation

```bash
# Install globally
npm install -g bash-mcp

# Or use with npx
npx bash-mcp
```

## Quick Start

### For Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bash": {
      "command": "npx",
      "args": ["bash-mcp"]
    }
  }
}
```

### For Claude Code (Cursor, VS Code)

1. Open command palette (Cmd/Ctrl + Shift + P)
2. Run "MCP: Add Server"
3. Select "NPM" as the server type
4. Enter: `bash-mcp`

## Available Tools

### `run` - Execute a command
```javascript
// Simple command
run("ls -la")

// With working directory
run("npm test", { cwd: "/path/to/project" })

// With timeout (milliseconds)
run("long-running-command", { timeout: 60000 })
```

### `run_background` - Start a background process
```javascript
// Start a dev server
run_background("npm run dev", "frontend")

// Start backend service with working directory
run_background("./gradlew bootRun", "backend", { cwd: "./backend" })
```

### `kill_background` - Stop a background process
```javascript
kill_background("frontend")
```

### `list_background` - List all background processes
```javascript
list_background()
```

## Example Usage

```
User: Start the development servers
Assistant: I'll start both frontend and backend servers for you.

[Uses run_background tool]
Started frontend server (PID: 12345)
Started backend server (PID: 12346)

User: Check if they're running
Assistant: [Uses list_background tool]
Both servers are running successfully!
```

## Response Format

All tools return JSON formatted responses:

```json
{
  "success": true,
  "stdout": "command output",
  "stderr": "error output if any",
  "command": "executed command"
}
```

For background processes:
```json
{
  "success": true,
  "name": "frontend",
  "pid": 12345,
  "command": "npm run dev",
  "message": "Started background process 'frontend' (PID: 12345)"
}
```

## Features

- Execute any shell command without permission prompts
- Run long-running processes in the background
- Manage background processes (list, kill)
- Capture stdout and stderr
- Set working directory for commands
- Configure timeout for commands
- Automatic cleanup on server shutdown
- **NEW**: Automatic output truncation with full output saved to temp files
- **NEW**: Configurable output size limits and temp directory via environment variables

## Environment Variables

- `BASH_MCP_MAX_OUTPUT_SIZE`: Maximum output size in bytes before truncation (default: 51200/50KB)
- `BASH_MCP_TEMP_DIR`: Directory for storing full output when truncated (default: system temp directory)

### Example Configuration

```json
{
  "mcpServers": {
    "bash": {
      "command": "npx",
      "args": ["bash-mcp"],
      "env": {
        "BASH_MCP_MAX_OUTPUT_SIZE": "102400",
        "BASH_MCP_TEMP_DIR": "/tmp/bash-mcp-outputs"
      }
    }
  }
}
```

## Output Overflow Handling

When command output exceeds `BASH_MCP_MAX_OUTPUT_SIZE`:
1. Output is truncated to the specified limit
2. Full output is saved to a temporary file
3. The response includes the file path where full output can be found
4. If custom temp directory fails, falls back to system temp directory

## Security Considerations

This MCP server executes arbitrary shell commands with the same privileges as the Node.js process. Only use in development environments or trusted contexts.

## Requirements

- Node.js >= 20.0.0
- npm or npx

## License

MIT

## Author

tinywind <tinywind0@gmail.com>

## Contributing

This project no longer accepts feature requests, bug reports, or pull requests. Fork the repository if you need to maintain a version.
### Temporary output security

Overflow output is written to a private directory under `BASH_MCP_TEMP_DIR`, with an operating-system temporary directory fallback. On POSIX systems, directories use mode `0700` and files use mode `0600`. Files are created exclusively, and background process names are not used as path components. Full output files remain available at the paths returned by the tools.

`npm test` exercises the public MCP executable and verifies that pre-created symlinks cannot overwrite existing files for normal output, fallback output, or background stdout/stderr.
