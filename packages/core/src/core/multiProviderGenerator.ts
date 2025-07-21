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
} from '@google/genai';
import { ContentGenerator, ContentGeneratorConfig } from './contentGenerator.js';

/**
 * Multi-provider content generator that supports OpenAI and Anthropic APIs
 */
export class MultiProviderGenerator implements ContentGenerator {
  private config: ContentGeneratorConfig;

  constructor(config: ContentGeneratorConfig) {
    this.config = config;
  }

  async generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {
    throw new Error('Multi-provider support not fully implemented yet');
  }

  async generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    throw new Error('Multi-provider support not fully implemented yet');
  }

  async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
    throw new Error('Multi-provider support not fully implemented yet');
  }

  async embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse> {
    throw new Error('Multi-provider support not fully implemented yet');
  }
}

export function createMultiProviderGenerator(config: ContentGeneratorConfig): ContentGenerator {
  return new MultiProviderGenerator(config);
}
