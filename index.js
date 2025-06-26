#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn, exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// MCP 최대 출력 크기 (대략 1MB)
const MAX_OUTPUT_SIZE = 1024 * 1024;

const server = new Server(
  {
    name: "bash-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 백그라운드 프로세스 저장소
const backgroundProcesses = new Map();

// 출력 크기 제한 함수
function truncateOutput(output, maxSize = MAX_OUTPUT_SIZE) {
  if (output.length <= maxSize) return output;
  const truncated = output.substring(0, maxSize);
  return truncated + "\n\n[Output truncated - exceeded size limit]";
}

// 도구 목록
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "run",
      description: "Execute a shell command and return output",
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Shell command to execute",
          },
          cwd: {
            type: "string",
            description: "Working directory (optional)",
          },
          timeout: {
            type: "number",
            description: "Timeout in milliseconds (default: 30000)",
          },
        },
        required: ["command"],
      },
    },
    {
      name: "run_background",
      description: "Run a command in background",
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Command to run in background",
          },
          name: {
            type: "string",
            description: "Unique name for this background process",
          },
          cwd: {
            type: "string",
            description: "Working directory (optional)",
          },
        },
        required: ["command", "name"],
      },
    },
    {
      name: "kill_background",
      description: "Kill a background process by name",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Name of the background process to kill",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "list_background",
      description: "List all running background processes",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ],
}));

// 도구 실행 핸들러
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "run": {
      const { command, cwd, timeout = 30000 } = args;

      try {
        const options = {
          cwd,
          timeout,
          maxBuffer: 10 * 1024 * 1024, // 10MB
        };

        const { stdout, stderr } = await execAsync(command, options);

        // 전체 출력 (stdout + stderr)
        const fullOutput = JSON.stringify(
          {
            success: true,
            stdout: truncateOutput(stdout.toString()),
            stderr: truncateOutput(stderr.toString()),
            command,
          },
          null,
          2
        );

        return {
          content: [
            {
              type: "text",
              text: truncateOutput(fullOutput),
            },
          ],
        };
      } catch (error) {
        const errorOutput = JSON.stringify(
          {
            success: false,
            error: error.message,
            stdout: truncateOutput(error.stdout?.toString() || ""),
            stderr: truncateOutput(error.stderr?.toString() || ""),
            code: error.code,
            signal: error.signal,
            command,
          },
          null,
          2
        );

        return {
          content: [
            {
              type: "text",
              text: truncateOutput(errorOutput),
            },
          ],
        };
      }
    }

    case "run_background": {
      const { command, name: processName, cwd } = args;

      if (backgroundProcesses.has(processName)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: `Process '${processName}' is already running`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      try {
        const child = spawn(command, {
          shell: true,
          cwd,
          detached: false,
          stdio: ["ignore", "pipe", "pipe"],
        });

        const processInfo = {
          pid: child.pid,
          command,
          startTime: new Date().toISOString(),
          output: [],
          errors: [],
          totalOutputSize: 0,
          totalErrorSize: 0,
        };

        // 출력 수집 (크기 제한 적용)
        child.stdout.on("data", (data) => {
          const chunk = data.toString();
          if (processInfo.totalOutputSize + chunk.length <= MAX_OUTPUT_SIZE) {
            processInfo.output.push(chunk);
            processInfo.totalOutputSize += chunk.length;

            // 100줄 제한
            if (processInfo.output.length > 100) {
              const removed = processInfo.output.shift();
              processInfo.totalOutputSize -= removed.length;
            }
          }
        });

        child.stderr.on("data", (data) => {
          const chunk = data.toString();
          if (processInfo.totalErrorSize + chunk.length <= MAX_OUTPUT_SIZE) {
            processInfo.errors.push(chunk);
            processInfo.totalErrorSize += chunk.length;

            // 100줄 제한
            if (processInfo.errors.length > 100) {
              const removed = processInfo.errors.shift();
              processInfo.totalErrorSize -= removed.length;
            }
          }
        });

        child.on("exit", (code, signal) => {
          processInfo.exitCode = code;
          processInfo.exitSignal = signal;
          processInfo.endTime = new Date().toISOString();
          backgroundProcesses.delete(processName);
        });

        child.on("error", (error) => {
          processInfo.error = error.message;
          backgroundProcesses.delete(processName);
        });

        backgroundProcesses.set(processName, { child, info: processInfo });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  name: processName,
                  pid: child.pid,
                  command,
                  message: `Started background process '${processName}' (PID: ${child.pid})`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: error.message,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }

    case "kill_background": {
      const { name: processName } = args;

      const process = backgroundProcesses.get(processName);
      if (!process) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: `No background process found with name '${processName}'`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      try {
        process.child.kill("SIGTERM");
        backgroundProcesses.delete(processName);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: `Killed process '${processName}' (PID: ${process.info.pid})`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        // 강제 종료 시도
        try {
          process.child.kill("SIGKILL");
          backgroundProcesses.delete(processName);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    message: `Force killed process '${processName}' (PID: ${process.info.pid})`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (killError) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    error: killError.message,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }
    }

    case "list_background": {
      const processes = Array.from(backgroundProcesses.entries()).map(
        ([name, { info }]) => ({
          name,
          pid: info.pid,
          command: info.command,
          startTime: info.startTime,
          running: !info.endTime,
          exitCode: info.exitCode,
          recentOutput: truncateOutput(info.output.slice(-10).join(""), 1000),
          recentErrors: truncateOutput(info.errors.slice(-10).join(""), 1000),
          outputSize: info.totalOutputSize,
          errorSize: info.totalErrorSize,
        })
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                count: processes.length,
                processes,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    default:
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: false,
                error: `Unknown tool: ${name}`,
              },
              null,
              2
            ),
          },
        ],
      };
  }
});

// 서버 시작
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Bash MCP Server started successfully");
}

// 종료 시 모든 백그라운드 프로세스 정리
process.on("SIGINT", () => {
  console.error("Shutting down...");
  for (const [name, { child }] of backgroundProcesses) {
    try {
      child.kill("SIGTERM");
      console.error(`Killed background process: ${name}`);
    } catch (e) {
      // 무시
    }
  }
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.error("Received SIGTERM...");
  for (const [name, { child }] of backgroundProcesses) {
    try {
      child.kill("SIGTERM");
    } catch (e) {
      // 무시
    }
  }
  process.exit(0);
});

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
