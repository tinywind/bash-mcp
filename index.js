#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn, exec } from "child_process";
import { promisify } from "util";
import { writeFile, stat, access, mkdir } from "fs/promises";
import { constants } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const execAsync = promisify(exec);

// MCP 최대 출력 크기 (환경변수에서 읽거나 기본값 50KB)
const MAX_OUTPUT_SIZE = parseInt(process.env.BASH_MCP_MAX_OUTPUT_SIZE || '51200', 10);

// 임시 디렉토리 유효성 검증 함수
async function validateTempDir(dirPath) {
  try {
    const stats = await stat(dirPath);
    if (!stats.isDirectory()) {
      console.error(`BASH_MCP_TEMP_DIR is not a directory: ${dirPath}`);
      return false;
    }
    // 쓰기 권한 확인
    await access(dirPath, constants.W_OK);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      // 디렉토리가 없으면 생성 시도
      try {
        await mkdir(dirPath, { recursive: true });
        return true;
      } catch (mkdirError) {
        console.error(`Failed to create BASH_MCP_TEMP_DIR: ${dirPath}`, mkdirError);
        return false;
      }
    }
    console.error(`Cannot access BASH_MCP_TEMP_DIR: ${dirPath}`, error);
    return false;
  }
}

// MCP 임시 디렉토리 설정
let TEMP_DIR = tmpdir(); // 기본값
const customTempDir = process.env.BASH_MCP_TEMP_DIR;
if (customTempDir) {
  validateTempDir(customTempDir).then(isValid => {
    if (isValid) {
      TEMP_DIR = customTempDir;
      console.error(`Using custom temp directory: ${TEMP_DIR}`);
    } else {
      console.error(`Falling back to system temp directory: ${TEMP_DIR}`);
    }
  });
}

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

// 출력 크기 제한 함수 (파일 저장 기능 추가)
async function truncateOutput(output, maxSize = MAX_OUTPUT_SIZE, prefix = 'output') {
  if (output.length <= maxSize) {
    return { content: output, filePath: null, overflow: false, originalSize: output.length };
  }
  
  // 임시 파일에 전체 출력 저장
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `bash-mcp-${prefix}-${timestamp}.txt`;
  const filePath = join(TEMP_DIR, filename);
  
  try {
    await writeFile(filePath, output, 'utf8');
    const truncated = output.substring(0, maxSize);
    const message = `\n\n[Output truncated - exceeded ${maxSize} bytes limit]\n[Full output saved to: ${filePath}]`;
    return { 
      content: truncated + message, 
      filePath, 
      overflow: true, 
      originalSize: output.length,
      truncatedSize: maxSize
    };
  } catch (error) {
    // 파일 저장 실패 시 시스템 temp 디렉토리로 재시도
    console.error(`Failed to save to ${filePath}:`, error);
    
    if (TEMP_DIR !== tmpdir()) {
      // 커스텀 디렉토리 실패 시 시스템 기본 디렉토리로 재시도
      const fallbackPath = join(tmpdir(), filename);
      try {
        await writeFile(fallbackPath, output, 'utf8');
        const truncated = output.substring(0, maxSize);
        const message = `\n\n[Output truncated - exceeded ${maxSize} bytes limit]\n[Full output saved to: ${fallbackPath}]`;
        return { 
          content: truncated + message, 
          filePath: fallbackPath, 
          overflow: true, 
          originalSize: output.length,
          truncatedSize: maxSize
        };
      } catch (fallbackError) {
        console.error(`Failed to save to fallback path ${fallbackPath}:`, fallbackError);
      }
    }
    
    // 모든 파일 저장 시도 실패 시
    const truncated = output.substring(0, maxSize);
    return { 
      content: truncated + "\n\n[Output truncated - exceeded size limit, failed to save full output]", 
      filePath: null, 
      overflow: true, 
      originalSize: output.length,
      truncatedSize: maxSize
    };
  }
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

        // 각 출력에 대해 제한 확인
        const stdoutResult = await truncateOutput(stdout.toString(), MAX_OUTPUT_SIZE, 'stdout');
        const stderrResult = await truncateOutput(stderr.toString(), MAX_OUTPUT_SIZE, 'stderr');

        // overflow 정보 수집
        const overflowInfo = {};
        if (stdoutResult.overflow || stderrResult.overflow) {
          overflowInfo.overflow = true;
          overflowInfo.details = {};
          
          if (stdoutResult.overflow) {
            overflowInfo.details.stdout = {
              originalSize: stdoutResult.originalSize,
              truncatedSize: stdoutResult.truncatedSize,
              filePath: stdoutResult.filePath
            };
          }
          
          if (stderrResult.overflow) {
            overflowInfo.details.stderr = {
              originalSize: stderrResult.originalSize,
              truncatedSize: stderrResult.truncatedSize,
              filePath: stderrResult.filePath
            };
          }
        }

        // 전체 출력 (stdout + stderr)
        const responseData = {
          success: true,
          stdout: stdoutResult.content,
          stderr: stderrResult.content,
          command,
          ...overflowInfo
        };

        const fullOutput = JSON.stringify(responseData, null, 2);
        const finalResult = await truncateOutput(fullOutput, MAX_OUTPUT_SIZE, 'combined');

        return {
          content: [
            {
              type: "text",
              text: finalResult.content,
            },
          ],
        };
      } catch (error) {
        // 에러 시에도 출력 제한 처리
        const stdoutResult = error.stdout ? await truncateOutput(error.stdout.toString(), MAX_OUTPUT_SIZE, 'stdout-error') : { content: "", filePath: null, overflow: false };
        const stderrResult = error.stderr ? await truncateOutput(error.stderr.toString(), MAX_OUTPUT_SIZE, 'stderr-error') : { content: "", filePath: null, overflow: false };

        // overflow 정보 수집
        const overflowInfo = {};
        if (stdoutResult.overflow || stderrResult.overflow) {
          overflowInfo.overflow = true;
          overflowInfo.details = {};
          
          if (stdoutResult.overflow) {
            overflowInfo.details.stdout = {
              originalSize: stdoutResult.originalSize,
              truncatedSize: stdoutResult.truncatedSize,
              filePath: stdoutResult.filePath
            };
          }
          
          if (stderrResult.overflow) {
            overflowInfo.details.stderr = {
              originalSize: stderrResult.originalSize,
              truncatedSize: stderrResult.truncatedSize,
              filePath: stderrResult.filePath
            };
          }
        }

        const responseData = {
          success: false,
          error: error.message,
          stdout: stdoutResult.content,
          stderr: stderrResult.content,
          code: error.code,
          signal: error.signal,
          command,
          ...overflowInfo
        };

        const errorOutput = JSON.stringify(responseData, null, 2);
        const finalResult = await truncateOutput(errorOutput, MAX_OUTPUT_SIZE, 'error-combined');

        return {
          content: [
            {
              type: "text",
              text: finalResult.content,
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
          outputOverflow: false,
          errorOverflow: false,
          outputFilePath: null,
          errorFilePath: null,
        };

        // 출력 수집 (크기 제한 적용)
        child.stdout.on("data", (data) => {
          const chunk = data.toString();
          processInfo.output.push(chunk);
          processInfo.totalOutputSize += chunk.length;
          
          if (processInfo.totalOutputSize > MAX_OUTPUT_SIZE && !processInfo.outputOverflow) {
            processInfo.outputOverflow = true;
            // 비동기로 파일 저장 예약
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `bash-mcp-background-${processName}-stdout-${timestamp}.txt`;
            processInfo.outputFilePath = join(tmpdir(), filename);
          }

          // 메모리 관리를 위해 100개 청크로 제한
          if (processInfo.output.length > 100) {
            processInfo.output.shift();
          }
        });

        child.stderr.on("data", (data) => {
          const chunk = data.toString();
          processInfo.errors.push(chunk);
          processInfo.totalErrorSize += chunk.length;
          
          if (processInfo.totalErrorSize > MAX_OUTPUT_SIZE && !processInfo.errorOverflow) {
            processInfo.errorOverflow = true;
            // 비동기로 파일 저장 예약
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `bash-mcp-background-${processName}-stderr-${timestamp}.txt`;
            processInfo.errorFilePath = join(tmpdir(), filename);
          }

          // 메모리 관리를 위해 100개 청크로 제한
          if (processInfo.errors.length > 100) {
            processInfo.errors.shift();
          }
        });

        child.on("exit", async (code, signal) => {
          processInfo.exitCode = code;
          processInfo.exitSignal = signal;
          processInfo.endTime = new Date().toISOString();
          
          // 종료 시 overflow된 출력을 파일로 저장
          if (processInfo.outputOverflow && processInfo.outputFilePath) {
            try {
              await writeFile(processInfo.outputFilePath, processInfo.output.join(''), 'utf8');
            } catch (e) {
              // 파일 저장 실패 무시
            }
          }
          
          if (processInfo.errorOverflow && processInfo.errorFilePath) {
            try {
              await writeFile(processInfo.errorFilePath, processInfo.errors.join(''), 'utf8');
            } catch (e) {
              // 파일 저장 실패 무시
            }
          }
          
          backgroundProcesses.delete(processName);
        });

        child.on("error", (error) => {
          processInfo.error = error.message;
          backgroundProcesses.delete(processName);
        });

        backgroundProcesses.set(processName, { child, info: processInfo });

        const responseData = {
          success: true,
          name: processName,
          pid: child.pid,
          command,
          message: `Started background process '${processName}' (PID: ${child.pid})`,
          stdout: "",
          stderr: ""
        };

        const fullOutput = JSON.stringify(responseData, null, 2);
        const finalResult = await truncateOutput(fullOutput, MAX_OUTPUT_SIZE, 'run-background-response');

        return {
          content: [
            {
              type: "text",
              text: finalResult.content,
            },
          ],
        };
      } catch (error) {
        const responseData = {
          success: false,
          error: error.message,
          stdout: "",
          stderr: "",
          command
        };

        const fullOutput = JSON.stringify(responseData, null, 2);
        const finalResult = await truncateOutput(fullOutput, MAX_OUTPUT_SIZE, 'run-background-error');

        return {
          content: [
            {
              type: "text",
              text: finalResult.content,
            },
          ],
        };
      }
    }

    case "kill_background": {
      const { name: processName } = args;

      const process = backgroundProcesses.get(processName);
      if (!process) {
        const responseData = {
          success: false,
          error: `No background process found with name '${processName}'`,
          stdout: "",
          stderr: "",
          command: ""
        };

        const fullOutput = JSON.stringify(responseData, null, 2);
        const finalResult = await truncateOutput(fullOutput, MAX_OUTPUT_SIZE, 'kill-background-error');

        return {
          content: [
            {
              type: "text",
              text: finalResult.content,
            },
          ],
        };
      }

      try {
        process.child.kill("SIGTERM");
        backgroundProcesses.delete(processName);

        const responseData = {
          success: true,
          message: `Killed process '${processName}' (PID: ${process.info.pid})`,
          stdout: "",
          stderr: "",
          command: process.info.command
        };

        const fullOutput = JSON.stringify(responseData, null, 2);
        const finalResult = await truncateOutput(fullOutput, MAX_OUTPUT_SIZE, 'kill-background-response');

        return {
          content: [
            {
              type: "text",
              text: finalResult.content,
            },
          ],
        };
      } catch (error) {
        // 강제 종료 시도
        try {
          process.child.kill("SIGKILL");
          backgroundProcesses.delete(processName);
          
          const responseData = {
            success: true,
            message: `Force killed process '${processName}' (PID: ${process.info.pid})`,
            stdout: "",
            stderr: "",
            command: process.info.command
          };

          const fullOutput = JSON.stringify(responseData, null, 2);
          const finalResult = await truncateOutput(fullOutput, MAX_OUTPUT_SIZE, 'kill-background-force');

          return {
            content: [
              {
                type: "text",
                text: finalResult.content,
              },
            ],
          };
        } catch (killError) {
          const responseData = {
            success: false,
            error: killError.message,
            stdout: "",
            stderr: "",
            command: process.info.command
          };

          const fullOutput = JSON.stringify(responseData, null, 2);
          const finalResult = await truncateOutput(fullOutput, MAX_OUTPUT_SIZE, 'kill-background-kill-error');

          return {
            content: [
              {
                type: "text",
                text: finalResult.content,
              },
            ],
          };
        }
      }
    }

    case "list_background": {
      const processes = Array.from(backgroundProcesses.entries()).map(
        ([name, { info }]) => {
          const processData = {
            name,
            pid: info.pid,
            command: info.command,
            startTime: info.startTime,
            running: !info.endTime,
            exitCode: info.exitCode,
            recentOutput: info.output.slice(-10).join("").substring(0, 1000),
            recentErrors: info.errors.slice(-10).join("").substring(0, 1000),
            outputSize: info.totalOutputSize,
            errorSize: info.totalErrorSize,
          };
          
          // overflow 정보 추가
          if (info.outputOverflow || info.errorOverflow) {
            processData.overflow = true;
            processData.overflowDetails = {};
            
            if (info.outputOverflow) {
              processData.overflowDetails.stdout = {
                filePath: info.outputFilePath,
                size: info.totalOutputSize
              };
            }
            
            if (info.errorOverflow) {
              processData.overflowDetails.stderr = {
                filePath: info.errorFilePath,
                size: info.totalErrorSize
              };
            }
          }
          
          return processData;
        }
      );

      const responseData = {
        success: true,
        count: processes.length,
        processes,
        stdout: "",
        stderr: "",
        command: "list_background"
      };

      const fullOutput = JSON.stringify(responseData, null, 2);
      const finalResult = await truncateOutput(fullOutput, MAX_OUTPUT_SIZE, 'list-background-response');

      return {
        content: [
          {
            type: "text",
            text: finalResult.content,
          },
        ],
      };
    }

    default:
      const errorResponse = {
        success: false,
        error: `Unknown tool: ${name}`,
        stdout: "",
        stderr: "",
        command: name
      };

      const errorOutput = JSON.stringify(errorResponse, null, 2);
      const errorResult = await truncateOutput(errorOutput, MAX_OUTPUT_SIZE, 'unknown-tool');

      return {
        content: [
          {
            type: "text",
            text: errorResult.content,
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
