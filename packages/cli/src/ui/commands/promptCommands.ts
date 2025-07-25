/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  SlashCommandActionReturn,
  CommandContext,
  CommandKind,
} from './types.js';
import {
  Config,
  getMCPServerPrompts,
  getErrorMessage,
  invokeMcpPrompt,
  connectToMcpServer,
} from '@google/gemini-cli-core';

export function createPromptCommands(config: Config | null): SlashCommand[] {
  const promptCommands: SlashCommand[] = [];
  if (config) {
    const mcpServers = config.getMcpServers() || {};
    for (const serverName in mcpServers) {
      const prompts = getMCPServerPrompts(serverName) || [];
      for (const prompt of prompts) {
        const commandName = `${prompt.name}`;
        const newPromptCommand: SlashCommand = {
          name: commandName,
          description: prompt.description || `Invoke prompt ${prompt.name}`,
          kind: CommandKind.BUILT_IN,
          subCommands: [
            {
              name: 'help',
              description: 'Show help for this prompt',
              kind: CommandKind.BUILT_IN,
              action: async (): Promise<SlashCommandActionReturn> => {
                if (!prompt.arguments || prompt.arguments.length === 0) {
                  return {
                    type: 'message',
                    messageType: 'info',
                    content: `Prompt "${prompt.name}" has no arguments.`,
                  };
                }

                let helpMessage = `Arguments for "${prompt.name}":\n\n`;
                for (const arg of prompt.arguments) {
                  helpMessage += `  --${arg.name}\n`;
                  if (arg.description) {
                    helpMessage += `    ${arg.description}\n`;
                  }
                  helpMessage += `    (required: ${arg.required ? 'yes' : 'no'})\n\n`;
                }
                return {
                  type: 'message',
                  messageType: 'info',
                  content: helpMessage,
                };
              },
            },
          ],
          action: async (
            context: CommandContext,
            args: string,
          ): Promise<SlashCommandActionReturn> => {
            const { config } = context.services;
            if (!config) {
              return {
                type: 'message',
                messageType: 'error',
                content: 'Config not loaded.',
              };
            }

            const promptArgs = args.trim();

            const argValues: { [key: string]: string } = {};
            // arg parsing: --key="value" or --key=value
            const argRegex = /--([^=]+)=(?:"((?:\\.|[^"\\])*)"|([^ ]*))/g;
            let match;
            while ((match = argRegex.exec(promptArgs)) !== null) {
              const key = match[1];
              const value = match[2] ?? match[3]; // Quoted or unquoted value
              argValues[key] = value;
            }

            const promptInputs: Record<string, unknown> = {};
            if (prompt.arguments) {
              for (const arg of prompt.arguments) {
                const value = argValues[arg.name];
                if (value) {
                  promptInputs[arg.name] = value;
                } else if (arg.required) {
                  return {
                    type: 'message',
                    messageType: 'error',
                    content: `Missing required argument: --${arg.name}`,
                  };
                }
              }
            }

            const mcpServer = config.getMcpServers()?.[serverName];
            if (!mcpServer) {
              return {
                type: 'message',
                messageType: 'error',
                content: `MCP server not found: ${serverName}`,
              };
            }

            let mcpClient;
            try {
              mcpClient = await connectToMcpServer(
                serverName,
                mcpServer,
                false,
              );
              const result = await invokeMcpPrompt(
                serverName,
                mcpClient,
                prompt.name,
                promptInputs,
              );

              if (result.error) {
                return {
                  type: 'message',
                  messageType: 'error',
                  content: `Error invoking prompt: ${result.error}`,
                };
              }

              if (!result.messages?.[0]?.content?.text) {
                return {
                  type: 'message',
                  messageType: 'error',
                  content:
                    'Received an empty or invalid prompt response from the server.',
                };
              }

              return {
                type: 'submit_prompt',
                content: JSON.stringify(result.messages[0].content.text),
              };
            } catch (error) {
              return {
                type: 'message',
                messageType: 'error',
                content: `Error: ${getErrorMessage(error)}`,
              };
            } finally {
              mcpClient?.close();
            }
          },
          completion: async (_: CommandContext, partialArg: string) => {
            if (!prompt || !prompt.arguments) {
              return [];
            }

            const suggestions: string[] = [];
            const usedArgNames = new Set(
              (partialArg.match(/--([^=]+)/g) || []).map((s) => s.substring(2)),
            );

            for (const arg of prompt.arguments) {
              if (!usedArgNames.has(arg.name)) {
                suggestions.push(`${partialArg}--${arg.name}=""`);
              }
            }

            return suggestions;
          },
        };
        promptCommands.push(newPromptCommand);
      }
    }
  }

  return promptCommands;
}
