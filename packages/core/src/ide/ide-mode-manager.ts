/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// import {
//   OpenFilesNotificationSchema,
//   IDE_SERVER_NAME,
//   ideContext,
// } from '../services/ideContext.js';

import {
  // IDE_SERVER_NAME,
  ideContext,
  // OpenFiles,
  OpenFilesNotificationSchema,
} from '../services/ideContext.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * Manages the connection and interaction with the IDE MCP server.
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
      console.log('unable to connect');
    }
    const url = `http://localhost:${idePort}/mcp`;

    const transport = new StreamableHTTPClientTransport(new URL(url));
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
