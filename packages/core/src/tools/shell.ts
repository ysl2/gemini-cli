/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { Config } from '../config/config.js';
import {
  BaseTool,
  ToolResult,
  ToolCallConfirmationDetails,
  ToolExecuteConfirmationDetails,
  ToolConfirmationOutcome,
  Icon,
} from './tools.js';
import { Type } from '@google/genai';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { getErrorMessage } from '../utils/errors.js';
import { summarizeToolOutput } from '../utils/summarizer.js';
import {
  ShellExecutionService,
  ShellOutputEvent,
} from '../services/shellExecutionService.js';
import { formatMemoryUsage } from '../utils/formatters.js';

export const OUTPUT_UPDATE_INTERVAL_MS = 1000;

export interface ShellToolParams {
  command: string;
  description?: string;
  directory?: string;
}

export class ShellTool extends BaseTool<ShellToolParams, ToolResult> {
  static Name: string = 'run_shell_command';
  private whitelist: Set<string> = new Set();

  constructor(private readonly config: Config) {
    super(
      ShellTool.Name,
      'Shell',
      `This tool executes a given shell command as \`bash -c <command>\`. Command can start background processes using \`&\`. Command is executed as a subprocess that leads its own process group. Command process group can be terminated as \`kill -- -PGID\` or signaled as \`kill -s SIGNAL -- -PGID\`.

The following information is returned:

Command: Executed command.
Directory: Directory (relative to project root) where command was executed, or \`(root)\`.
Stdout: Output on stdout stream. Can be \`(empty)\` or partial on error and for any unwaited background processes.
Stderr: Output on stderr stream. Can be \`(empty)\` or partial on error and for any unwaited background processes.
Error: Error or \`(none)\` if no error was reported for the subprocess.
Exit Code: Exit code or \`(none)\` if terminated by signal.
Signal: Signal number or \`(none)\` if no signal was received.
Background PIDs: List of background processes started or \`(none)\`.
Process Group PGID: Process group started or \`(none)\``,
      Icon.Terminal,
      {
        type: Type.OBJECT,
        properties: {
          command: {
            type: Type.STRING,
            description: 'Exact bash command to execute as `bash -c <command>`',
          },
          description: {
            type: Type.STRING,
            description:
              'Brief description of the command for the user. Be specific and concise. Ideally a single sentence. Can be up to 3 sentences for clarity. No line breaks.',
          },
          directory: {
            type: Type.STRING,
            description:
              '(OPTIONAL) Directory to run the command in, if not the project root directory. Must be relative to the project root directory and must already exist.',
          },
        },
        required: ['command'],
      },
      false, // output is not markdown
      true, // output can be updated
    );
  }

  getDescription(params: ShellToolParams): string {
    let description = `${params.command}`;
    // append optional [in directory]
    // note description is needed even if validation fails due to absolute path
    if (params.directory) {
      description += ` [in ${params.directory}]`;
    }
    // append optional (description), replacing any line breaks with spaces
    if (params.description) {
      description += ` (${params.description.replace(/\n/g, ' ')})`;
    }
    return description;
  }

  /**
   * Extracts the root command from a given shell command string.
   * This is used to identify the base command for permission checks.
   * @param command The shell command string to parse
   * @returns The root command name, or undefined if it cannot be determined
   * @example getCommandRoot("ls -la /tmp") returns "ls"
   * @example getCommandRoot("git status && npm test") returns "git"
   */
  getCommandRoot(command: string): string | undefined {
    return command
      .trim() // remove leading and trailing whitespace
      .replace(/[{}()]/g, '') // remove all grouping operators
      .split(/[\s;&|]+/)[0] // split on any whitespace or separator or chaining operators and take first part
      ?.split(/[/\\]/) // split on any path separators (or return undefined if previous line was undefined)
      .pop(); // take last part and return command root (or undefined if previous line was empty)
  }

  /**
   * Determines whether a given shell command is allowed to execute based on
   * the tool's configuration including allowlists and blocklists.
   * @param command The shell command string to validate
   * @returns An object with 'allowed' boolean and optional 'reason' string if not allowed
   */
  isCommandAllowed(command: string): { allowed: boolean; reason?: string } {
    // 0. Disallow command substitution
    if (command.includes('$(')) {
      return {
        allowed: false,
        reason:
          'Command substitution using $() is not allowed for security reasons',
      };
    }

    const SHELL_TOOL_NAMES = [ShellTool.name, ShellTool.Name];

    const normalize = (cmd: string): string => cmd.trim().replace(/\s+/g, ' ');

    /**
     * Checks if a command string starts with a given prefix, ensuring it's a
     * whole word match (i.e., followed by a space or it's an exact match).
     * e.g., `isPrefixedBy('npm install', 'npm')` -> true
     * e.g., `isPrefixedBy('npm', 'npm')` -> true
     * e.g., `isPrefixedBy('npminstall', 'npm')` -> false
     */
    const isPrefixedBy = (cmd: string, prefix: string): boolean => {
      if (!cmd.startsWith(prefix)) {
        return false;
      }
      return cmd.length === prefix.length || cmd[prefix.length] === ' ';
    };

    /**
     * Extracts and normalizes shell commands from a list of tool strings.
     * e.g., 'ShellTool("ls -l")' becomes 'ls -l'
     */
    const extractCommands = (tools: string[]): string[] =>
      tools.flatMap((tool) => {
        for (const toolName of SHELL_TOOL_NAMES) {
          if (tool.startsWith(`${toolName}(`) && tool.endsWith(')')) {
            return [normalize(tool.slice(toolName.length + 1, -1))];
          }
        }
        return [];
      });

    const coreTools = this.config.getCoreTools() || [];
    const excludeTools = this.config.getExcludeTools() || [];

    // Check if the shell tool is globally disabled.
    if (SHELL_TOOL_NAMES.some((name) => excludeTools.includes(name))) {
      return {
        allowed: false,
        reason: 'Shell tool is globally disabled in configuration',
      };
    }

    const blockedCommands = new Set(extractCommands(excludeTools));
    const allowedCommands = new Set(extractCommands(coreTools));

    const hasSpecificAllowedCommands = allowedCommands.size > 0;
    const isWildcardAllowed = SHELL_TOOL_NAMES.some((name) =>
      coreTools.includes(name),
    );

    const commandsToValidate = command.split(/&&|\|\||\||;/).map(normalize);

    const blockedCommandsArr = [...blockedCommands];

    for (const cmd of commandsToValidate) {
      // Check if the command is on the blocklist.
      const isBlocked = blockedCommandsArr.some((blocked) =>
        isPrefixedBy(cmd, blocked),
      );
      if (isBlocked) {
        return {
          allowed: false,
          reason: `Command '${cmd}' is blocked by configuration`,
        };
      }

      // If in strict allow-list mode, check if the command is permitted.
      const isStrictAllowlist =
        hasSpecificAllowedCommands && !isWildcardAllowed;
      const allowedCommandsArr = [...allowedCommands];
      if (isStrictAllowlist) {
        const isAllowed = allowedCommandsArr.some((allowed) =>
          isPrefixedBy(cmd, allowed),
        );
        if (!isAllowed) {
          return {
            allowed: false,
            reason: `Command '${cmd}' is not in the allowed commands list`,
          };
        }
      }
    }

    // If all checks pass, the command is allowed.
    return { allowed: true };
  }

  validateToolParams(params: ShellToolParams): string | null {
    const commandCheck = this.isCommandAllowed(params.command);
    if (!commandCheck.allowed) {
      if (!commandCheck.reason) {
        console.error(
          'Unexpected: isCommandAllowed returned false without a reason',
        );
        return `Command is not allowed: ${params.command}`;
      }
      return commandCheck.reason;
    }
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }
    if (!params.command.trim()) {
      return 'Command cannot be empty.';
    }
    if (!this.getCommandRoot(params.command)) {
      return 'Could not identify command root to obtain permission from user.';
    }
    if (params.directory) {
      if (path.isAbsolute(params.directory)) {
        return 'Directory cannot be absolute. Must be relative to the project root directory.';
      }
      const directory = path.resolve(
        this.config.getTargetDir(),
        params.directory,
      );
      if (!fs.existsSync(directory)) {
        return 'Directory must exist.';
      }
    }
    return null;
  }

  async shouldConfirmExecute(
    params: ShellToolParams,
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    if (this.validateToolParams(params)) {
      return false; // skip confirmation, execute call will fail immediately
    }
    const rootCommand = this.getCommandRoot(params.command)!; // must be non-empty string post-validation
    if (this.whitelist.has(rootCommand)) {
      return false; // already approved and whitelisted
    }
    const confirmationDetails: ToolExecuteConfirmationDetails = {
      type: 'exec',
      title: 'Confirm Shell Command',
      command: params.command,
      rootCommand,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.whitelist.add(rootCommand);
        }
      },
    };
    return confirmationDetails;
  }

  async execute(
    params: ShellToolParams,
    abortSignal: AbortSignal,
    updateOutput?: (chunk: string) => void,
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: [
          `Command rejected: ${params.command}`,
          `Reason: ${validationError}`,
        ].join('\n'),
        returnDisplay: `Error: ${validationError}`,
      };
    }

    if (abortSignal.aborted) {
      return {
        llmContent: 'Command was cancelled by user before it could start.',
        returnDisplay: 'Command cancelled by user.',
      };
    }

    const isWindows = os.platform() === 'win32';
    const tempFileName = `shell_pgrep_${crypto
      .randomBytes(6)
      .toString('hex')}.tmp`;
    const tempFilePath = path.join(os.tmpdir(), tempFileName);

    // pgrep is not available on Windows, so we can't get background PIDs
    const command = isWindows
      ? params.command
      : (() => {
          // wrap command to append subprocess pids (via pgrep) to temporary file
          let command = params.command.trim();
          if (!command.endsWith('&')) command += ';';
          return `{ ${command} }; __code=$?; pgrep -g 0 >${tempFilePath} 2>&1; exit $__code;`;
        })();

    const cwd = path.resolve(
      this.config.getTargetDir(),
      params.directory || '',
    );

    let cumulativeStdout = '';
    let cumulativeStderr = '';

    let lastUpdateTime = Date.now();
    let isBinaryStream = false;

    const { result: resultPromise } = ShellExecutionService.execute(
      command,
      cwd,
      (event: ShellOutputEvent) => {
        if (!updateOutput) {
          return;
        }

        let currentDisplayOutput = '';
        let shouldUpdate = false;

        switch (event.type) {
          case 'data':
            if (isBinaryStream) break; // Don't process text if we are in binary mode
            if (event.stream === 'stdout') {
              cumulativeStdout += event.chunk;
            } else {
              cumulativeStderr += event.chunk;
            }
            currentDisplayOutput =
              cumulativeStdout +
              (cumulativeStderr ? `\n${cumulativeStderr}` : '');
            if (Date.now() - lastUpdateTime > OUTPUT_UPDATE_INTERVAL_MS) {
              shouldUpdate = true;
            }
            break;
          case 'binary_detected':
            isBinaryStream = true;
            currentDisplayOutput =
              '[Binary output detected. Halting stream...]';
            shouldUpdate = true;
            break;
          case 'binary_progress':
            isBinaryStream = true;
            currentDisplayOutput = `[Receiving binary output... ${formatMemoryUsage(
              event.bytesReceived,
            )} received]`;
            if (Date.now() - lastUpdateTime > OUTPUT_UPDATE_INTERVAL_MS) {
              shouldUpdate = true;
            }
            break;
          default: {
            throw new Error('An unhandled ShellOutputEvent was found.');
          }
        }

        if (shouldUpdate) {
          updateOutput(currentDisplayOutput);
          lastUpdateTime = Date.now();
        }
      },
      abortSignal,
    );

    const result = await resultPromise;

    const backgroundPIDs: number[] = [];
    if (os.platform() !== 'win32') {
      if (fs.existsSync(tempFilePath)) {
        const pgrepLines = fs
          .readFileSync(tempFilePath, 'utf8')
          .split('\n')
          .filter(Boolean);
        for (const line of pgrepLines) {
          if (!/^\d+$/.test(line)) {
            console.error(`pgrep: ${line}`);
          }
          const pid = Number(line);
          if (pid !== result.pid) {
            backgroundPIDs.push(pid);
          }
        }
        fs.unlinkSync(tempFilePath);
      } else {
        if (!abortSignal.aborted) {
          console.error('missing pgrep output');
        }
      }
    }

    let llmContent = '';
    if (result.aborted) {
      llmContent = 'Command was cancelled by user before it could complete.';
      if (result.output.trim()) {
        llmContent += ` Below is the output (on stdout and stderr) before it was cancelled:\n${result.output}`;
      } else {
        llmContent += ' There was no output before it was cancelled.';
      }
    } else {
      // Create a formatted error string for display, replacing the wrapper command
      // with the user-facing command.
      const finalError = result.error
        ? result.error.message.replace(command, params.command)
        : '(none)';

      llmContent = [
        `Command: ${params.command}`,
        `Directory: ${params.directory || '(root)'}`,
        `Stdout: ${result.stdout || '(empty)'}`,
        `Stderr: ${result.stderr || '(empty)'}`,
        `Error: ${finalError}`, // Use the cleaned error string.
        `Exit Code: ${result.exitCode ?? '(none)'}`,
        `Signal: ${result.signal ?? '(none)'}`,
        `Background PIDs: ${backgroundPIDs.length ? backgroundPIDs.join(', ') : '(none)'}`,
        `Process Group PGID: ${result.pid ?? '(none)'}`,
      ].join('\n');
    }

    let returnDisplayMessage = '';
    if (this.config.getDebugMode()) {
      returnDisplayMessage = llmContent;
    } else {
      if (result.output.trim()) {
        returnDisplayMessage = result.output;
      } else {
        if (result.aborted) {
          returnDisplayMessage = 'Command cancelled by user.';
        } else if (result.signal) {
          returnDisplayMessage = `Command terminated by signal: ${result.signal}`;
        } else if (result.error) {
          returnDisplayMessage = `Command failed: ${getErrorMessage(
            result.error,
          )}`;
        } else if (result.exitCode !== null && result.exitCode !== 0) {
          returnDisplayMessage = `Command exited with code: ${result.exitCode}`;
        }
        // If output is empty and command succeeded (code 0, no error/signal/abort),
        // returnDisplayMessage will remain empty, which is fine.
      }
    }

    const summarizeConfig = this.config.getSummarizeToolOutputConfig();
    if (summarizeConfig && summarizeConfig[this.name]) {
      const summary = await summarizeToolOutput(
        llmContent,
        this.config.getGeminiClient(),
        abortSignal,
        summarizeConfig[this.name].tokenBudget,
      );
      return {
        llmContent: summary,
        returnDisplay: returnDisplayMessage,
      };
    }

    return {
      llmContent,
      returnDisplay: returnDisplayMessage,
    };
  }
}
