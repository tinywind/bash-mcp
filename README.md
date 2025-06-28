# bash-mcp

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

- Node.js >= 16.0.0
- npm or npx

## License

MIT

## Author

tinywind <tinywind0@gmail.com>

## Contributing

Issues and pull requests are welcome at [GitHub](https://github.com/tinywind/bash-mcp).