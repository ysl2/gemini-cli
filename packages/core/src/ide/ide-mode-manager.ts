/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ideContext,
  OpenFilesNotificationSchema,
} from '../services/ideContext.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const logger = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug: (...args: any[]) =>
    console.debug('[DEBUG] [ImportProcessor]', ...args),
};

/**
 * Manages the connection to and interaction with the IDE server.
 */
export class IdeModeManager {
  client: Client | undefined = undefined;

  constructor() {
    this.connectToMcpServer().catch(() => {});
  }

  getServerStatus() {
    if (!this.client) {
      return {
        type: 'message',
        messageType: 'error',
        content: `🔴 Disconnected`,
      } as const;
    }
    return {
      type: 'message',
      messageType: 'info',
      content: `🟢 Connected`,
    } as const;
  }

  async connectToMcpServer(): Promise<void> {
    this.client = new Client({
      name: 'streamable-http-client',
      version: '1.0.0',
    });
    const idePort = process.env['GEMINI_CLI_IDE_SERVER_PORT'];
    if (!idePort) {
      logger.debug(
        `Unable to connect to IDE mode MCP server. Expected to connect to port ${process.env['GEMINI_CLI_IDE_SERVER_PORT']}`,
      );
    }

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${idePort}/mcp`),
    );
    await this.client.connect(transport);
    this.client.setNotificationHandler(
      OpenFilesNotificationSchema,
      (notification) => {
        ideContext.setOpenFilesContext(notification.params);
      },
    );
  }
}

export const ideModeManager = new IdeModeManager();
