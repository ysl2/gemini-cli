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

export enum IDEConnectionStatus {
  Connected = 'connected',
  Disconnected = 'disconnected',
  Connecting = 'connecting',
}

/**
 * Manages the connection to and interaction with the IDE server.
 */
export class IdeModeManager {
  client: Client | undefined = undefined;
  connectionStatus: IDEConnectionStatus = IDEConnectionStatus.Disconnected;

  constructor() {
    this.connectToMcpServer().catch((err) => {
      logger.debug('Failed to initialize IdeModeManager:', err);
    });
  }
  getConnectionStatus(): IDEConnectionStatus {
    return this.connectionStatus;
  }

  async connectToMcpServer(): Promise<void> {
    this.connectionStatus = IDEConnectionStatus.Connecting;
    const idePort = process.env['GEMINI_CLI_IDE_SERVER_PORT'];
    if (!idePort) {
      logger.debug(
        'Unable to connect to IDE mode MCP server. GEMINI_CLI_IDE_SERVER_PORT environment variable is not set.',
      );
      this.connectionStatus = IDEConnectionStatus.Disconnected;
      return;
    }

    try {
      this.client = new Client({
        name: 'streamable-http-client',
        version: '1.0.0',
      });
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
      this.connectionStatus = IDEConnectionStatus.Connected;
    } catch (error) {
      this.connectionStatus = IDEConnectionStatus.Disconnected;
      logger.debug('Failed to connect to MCP server:', error);
    }
  }
}

export const ideModeManager = new IdeModeManager();
