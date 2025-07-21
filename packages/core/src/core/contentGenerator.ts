/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  GoogleGenAI,
} from '@google/genai';
import { createCodeAssistContentGenerator } from '../code_assist/codeAssist.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
import { Config } from '../config/config.js';
import { getEffectiveModel } from './modelCheck.js';
import { UserTierId } from '../code_assist/types.js';

/**
 * Interface abstracting the core functionalities for generating content and counting tokens.
 */
export interface ContentGenerator {
  generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse>;

  generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;

  embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;

  getTier?(): Promise<UserTierId | undefined>;
}

export enum AuthType {
  LOGIN_WITH_GOOGLE = 'oauth-personal',
  USE_GEMINI = 'gemini-api-key',
  USE_VERTEX_AI = 'vertex-ai',
  CLOUD_SHELL = 'cloud-shell',
  USE_OPENAI = 'openai-api-key',
  USE_ANTHROPIC = 'anthropic-api-key',
}

export type ContentGeneratorConfig = {
  model: string;
  apiKey?: string;
  vertexai?: boolean;
  authType?: AuthType | undefined;
  proxy?: string | undefined;
  baseUrl?: string | undefined;
};

export function createContentGeneratorConfig(
  config: Config,
  authType: AuthType | undefined,
): ContentGeneratorConfig {
  const geminiApiKey = process.env.GEMINI_API_KEY || undefined;
  const googleApiKey = process.env.GOOGLE_API_KEY || undefined;
  const googleCloudProject = process.env.GOOGLE_CLOUD_PROJECT || undefined;
  const googleCloudLocation = process.env.GOOGLE_CLOUD_LOCATION || undefined;
  const openaiApiKey = process.env.OPENAI_API_KEY || undefined;
  const openaiBaseUrl = process.env.OPENAI_BASE_URL || undefined;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || undefined;
  const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL || undefined;
  const geminiApiService = process.env.GEMINI_API_SERVICE || undefined;

  // Use runtime model from config if available, otherwise fallback to parameter or default
  const effectiveModel = config.getModel() || DEFAULT_GEMINI_MODEL;

  const contentGeneratorConfig: ContentGeneratorConfig = {
    model: effectiveModel,
    authType,
    proxy: config?.getProxy(),
  };

  // If we are using Google auth or we are in Cloud Shell, there is nothing else to validate for now
  if (
    authType === AuthType.LOGIN_WITH_GOOGLE ||
    authType === AuthType.CLOUD_SHELL
  ) {
    return contentGeneratorConfig;
  }

  if (authType === AuthType.USE_GEMINI && geminiApiKey) {
    contentGeneratorConfig.apiKey = geminiApiKey;
    contentGeneratorConfig.vertexai = false;
    getEffectiveModel(
      contentGeneratorConfig.apiKey,
      contentGeneratorConfig.model,
      contentGeneratorConfig.proxy,
    );

    return contentGeneratorConfig;
  }

  if (
    authType === AuthType.USE_VERTEX_AI &&
    (googleApiKey || (googleCloudProject && googleCloudLocation))
  ) {
    contentGeneratorConfig.apiKey = googleApiKey;
    contentGeneratorConfig.vertexai = true;

    return contentGeneratorConfig;
  }

  if (authType === AuthType.USE_OPENAI && openaiApiKey) {
    contentGeneratorConfig.apiKey = openaiApiKey;
    contentGeneratorConfig.baseUrl = openaiBaseUrl;
    return contentGeneratorConfig;
  }

  if (authType === AuthType.USE_ANTHROPIC && anthropicApiKey) {
    contentGeneratorConfig.apiKey = anthropicApiKey;
    contentGeneratorConfig.baseUrl = anthropicBaseUrl;
    return contentGeneratorConfig;
  }

  // Handle GEMINI_API_SERVICE environment variable for explicit service selection
  if (!authType && geminiApiService) {
    if (geminiApiService === 'openai' && openaiApiKey) {
      contentGeneratorConfig.authType = AuthType.USE_OPENAI;
      contentGeneratorConfig.apiKey = openaiApiKey;
      contentGeneratorConfig.baseUrl = openaiBaseUrl;
      return contentGeneratorConfig;
    }
    
    if (geminiApiService === 'anthropic' && anthropicApiKey) {
      contentGeneratorConfig.authType = AuthType.USE_ANTHROPIC;
      contentGeneratorConfig.apiKey = anthropicApiKey;
      contentGeneratorConfig.baseUrl = anthropicBaseUrl;
      return contentGeneratorConfig;
    }
  }

  // Automatic provider detection when authType is not explicitly set
  if (!authType) {
    if (anthropicApiKey) {
      contentGeneratorConfig.authType = AuthType.USE_ANTHROPIC;
      contentGeneratorConfig.apiKey = anthropicApiKey;
      contentGeneratorConfig.baseUrl = anthropicBaseUrl;
      return contentGeneratorConfig;
    }
    
    if (openaiApiKey) {
      contentGeneratorConfig.authType = AuthType.USE_OPENAI;
      contentGeneratorConfig.apiKey = openaiApiKey;
      contentGeneratorConfig.baseUrl = openaiBaseUrl;
      return contentGeneratorConfig;
    }
    
    if (geminiApiKey) {
      contentGeneratorConfig.authType = AuthType.USE_GEMINI;
      contentGeneratorConfig.apiKey = geminiApiKey;
      contentGeneratorConfig.vertexai = false;
      return contentGeneratorConfig;
    }
  }

  return contentGeneratorConfig;
}

export async function createContentGenerator(
  config: ContentGeneratorConfig,
  gcConfig: Config,
  sessionId?: string,
): Promise<ContentGenerator> {
  const version = process.env.CLI_VERSION || process.version;
  const httpOptions = {
    headers: {
      'User-Agent': `GeminiCLI/${version} (${process.platform}; ${process.arch})`,
    },
  };
  if (
    config.authType === AuthType.LOGIN_WITH_GOOGLE ||
    config.authType === AuthType.CLOUD_SHELL
  ) {
    return createCodeAssistContentGenerator(
      httpOptions,
      config.authType,
      gcConfig,
      sessionId,
    );
  }

  if (
    config.authType === AuthType.USE_GEMINI ||
    config.authType === AuthType.USE_VERTEX_AI
  ) {
    const googleGenAI = new GoogleGenAI({
      apiKey: config.apiKey === '' ? undefined : config.apiKey,
      vertexai: config.vertexai,
      httpOptions,
    });

    return googleGenAI.models;
  }

  if (
    config.authType === AuthType.USE_OPENAI ||
    config.authType === AuthType.USE_ANTHROPIC
  ) {
    // For OpenAI and Anthropic, we'll create a compatible content generator
    return createCompatibleContentGenerator(config);
  }

  throw new Error(
    `Error creating contentGenerator: Unsupported authType: ${config.authType}`,
  );
}

async function createCompatibleContentGenerator(config: ContentGeneratorConfig): Promise<ContentGenerator> {
  const { OpenAIAdapter } = await import('../adapters/openaiAdapter.js');
  const { AnthropicAdapter } = await import('../adapters/anthropicAdapter.js');
  
  if (config.authType === AuthType.USE_OPENAI) {
    return new OpenAIAdapter(config);
  }
  
  if (config.authType === AuthType.USE_ANTHROPIC) {
    return new AnthropicAdapter(config);
  }
  
  throw new Error(`Unsupported auth type for compatible content generator: ${config.authType}`);
}
