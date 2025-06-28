# Changelog

All notable changes to this project will be documented in this file.

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
