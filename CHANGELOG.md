# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2025-01-24

### Added

  - New `cd` tool to change persistent working directory that persists across tool calls
  - New `pwd` tool to get current persistent working directory
  - Server-level state management for working directory within each Claude Desktop session
  - `BASH_DEFAULT_CWD` to set default working directory at server startup
  - `BASH_SHELL` for shell configuration with auto-detection of shell types (bash, PowerShell, cmd, etc.)
  - Automatic shell command flag detection (e.g., `-c` for bash, `-Command` for PowerShell)
  - Validation for `BASH_DEFAULT_CWD` with graceful fallback to current directory
  - New `validateDirectory()` function with path validation
  - Prevention of path traversal attacks
  - Improved error messages for directory access issues

### Changed

- `run` and `run_background` tools now automatically use persistent working directory when no explicit `cwd` is provided
- Existing `cwd` parameters continue to work as overrides to persistent directory
- Enhanced path resolution supporting both absolute and relative paths
- Cross-platform compatibility improvements for Windows and Unix-like systems

### Fixed

- Shell variable expansion issues with commands like awk (e.g., `$2`, `$NF` now work correctly)
- Previous directory tracking now updates properly when changing directories

### Technical

- Server version updated to 1.2.0
- Comprehensive documentation updates with usage examples
- Backward compatibility maintained for all existing functionality

## [1.1.0] - 2025-06-28

### Added

- Automatic output truncation when output exceeds configurable size limit
- Environment variable `BASH_MCP_MAX_OUTPUT_SIZE` to configure maximum output size (default: 50KB)
- Environment variable `BASH_MCP_TEMP_DIR` to configure directory for overflow files (default: system temp)
- Full output preservation in temporary files when truncated
- Automatic validation and fallback for custom temp directory:
  - Creates directory if it doesn't exist
  - Validates write permissions
  - Falls back to system temp if custom directory is invalid
- Consistent response structure across all APIs with overflow information

### Changed

- Default output size limit reduced from 1MB to 50KB for better performance
- All API responses now include consistent fields: `success`, `stdout`, `stderr`, `command`
- Improved error handling with fallback to system temp directory

### Fixed

- API response consistency across all endpoints

## [1.0.2] - Previous version

### Features

- Execute shell commands without permission prompts
- Run long-running processes in the background
- Manage background processes (list, kill)
- Capture stdout and stderr
- Set working directory for commands
- Configure timeout for commands
- Automatic cleanup on server shutdown
