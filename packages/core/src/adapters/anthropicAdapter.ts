/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  ContentGenerator,
  ContentGeneratorConfig,
} from '../core/contentGenerator.js';
import {
  GenerateContentParameters,
  GenerateContentResponse,
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
  Content,
  Part,
  Tool,
  FunctionCall,
  FunctionResponse,
  FinishReason,
} from '@google/genai';

export class AnthropicAdapter implements ContentGenerator {
  private anthropic: Anthropic;
  private model: string;

  constructor(config: ContentGeneratorConfig) {
    this.anthropic = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.model = config.model;
  }

  async generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {
    try {
      const { messages, system } = this.convertGeminiToAnthropicMessages(request.contents);
      const tools = request.config?.tools ? this.convertGeminiToAnthropicTools(request.config.tools) : [];

      const anthropicRequest: Anthropic.Messages.MessageCreateParams = {
        model: this.model,
        messages,
        max_tokens: request.config?.maxOutputTokens || 1024,
        temperature: request.config?.temperature,
        top_p: request.config?.topP,
        ...(system && { system }),
        ...(tools.length > 0 && { tools }),
      };

      const response = await this.anthropic.messages.create(anthropicRequest);
      return this.convertAnthropicToGeminiResponse(response);
    } catch (error) {
      throw new Error(`Anthropic API error: ${error}`);
    }
  }

  async generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const { messages, system } = this.convertGeminiToAnthropicMessages(request.contents);
      const tools = request.config?.tools ? this.convertGeminiToAnthropicTools(request.config.tools) : [];

    const anthropicRequest: Anthropic.Messages.MessageCreateParams = {
      model: this.model,
      messages,
      max_tokens: request.config?.maxOutputTokens || 1024,
        temperature: request.config?.temperature,
        top_p: request.config?.topP,
      stream: true,
      ...(system && { system }),
      ...(tools.length > 0 && { tools }),
    };

    const stream = await this.anthropic.messages.create(anthropicRequest);
    return this.createAsyncGenerator(stream);
  }

  private async *createAsyncGenerator(stream: any): AsyncGenerator<GenerateContentResponse> {
    try {
      for await (const chunk of stream) {
        const geminiResponse = this.convertAnthropicStreamToGeminiResponse(chunk);
        if (geminiResponse) {
          yield geminiResponse;
        }
      }
    } catch (error) {
      throw new Error(`Anthropic API streaming error: ${error}`);
    }
  }

  async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
    let text = '';
    
    if (typeof request.contents === 'string') {
      text = request.contents;
    } else if (Array.isArray(request.contents)) {
      text = request.contents.map((content: any) => {
        if (typeof content === 'string') {
          return content;
        } else if (content && typeof content === 'object' && 'parts' in content) {
          return content.parts?.map((part: any) => part.text || '').join(' ') || '';
        }
        return '';
      }).join(' ') || '';
    }
    
    const estimatedTokens = Math.ceil(text.length / 4);
    
    return {
      totalTokens: estimatedTokens,
    };
  }

  async embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse> {
    throw new Error('Anthropic does not support embeddings. Consider using OpenAI or other embedding services.');
  }

  private convertGeminiToAnthropicMessages(contents?: any): { 
    messages: Anthropic.Messages.MessageParam[], 
    system?: string 
  } {
    if (!contents) return { messages: [] };
    
    let contentArray: Content[] = [];
    if (typeof contents === 'string') {
      contentArray = [{ role: 'user', parts: [{ text: contents }] }];
    } else if (Array.isArray(contents)) {
      // Handle array of Content or PartUnion
      contentArray = contents.map((item: any) => {
        if (typeof item === 'string') {
          return { role: 'user', parts: [{ text: item }] };
        } else if ('role' in item && 'parts' in item) {
          return item as Content;
        } else {
          return { role: 'user', parts: [item] };
        }
      });
    } else if (typeof contents === 'object' && 'role' in contents) {
      contentArray = [contents as Content];
    }

    let systemMessage = '';
    const messages: Anthropic.Messages.MessageParam[] = [];

    contentArray.forEach((content: Content) => {
      const text = content.parts?.filter((part: any) => part.text).map((part: any) => part.text).join('') || '';
      const functionCalls = content.parts?.filter((part: any) => part.functionCall);
      const functionResponses = content.parts?.filter((part: any) => part.functionResponse);

      if (content.role === 'system') {
        systemMessage += text;
        return;
      }

      const messageContent: (Anthropic.Messages.TextBlockParam | Anthropic.Messages.ToolUseBlockParam | Anthropic.Messages.ToolResultBlockParam)[] = [];

      if (text) {
        messageContent.push({
          type: 'text',
          text,
        });
      }

      if (functionCalls?.length) {
        functionCalls.forEach((part: any) => {
          messageContent.push({
            type: 'tool_use',
            id: `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: part.functionCall?.name || '',
            input: part.functionCall?.args || {},
          });
        });
      }

      if (functionResponses?.length) {
        functionResponses.forEach((part: any) => {
          messageContent.push({
            type: 'tool_result',
            tool_use_id: `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            content: JSON.stringify(part.functionResponse?.response || {}),
          });
        });
      }

      if (messageContent.length > 0) {
        messages.push({
          role: content.role === 'model' ? 'assistant' : content.role as 'user',
          content: messageContent,
        });
      }
    });

    return { 
      messages, 
      system: systemMessage || undefined 
    };
  }

  private convertGeminiToAnthropicTools(tools?: any): Anthropic.Messages.Tool[] {
    if (!tools) return [];

    // Handle ToolListUnion which can be Tool[] or FunctionDeclaration[]
    if (Array.isArray(tools)) {
      // If it's an array of FunctionDeclaration
      if (tools.length > 0 && 'name' in tools[0] && 'description' in tools[0]) {
        return tools.map(func => ({
          name: func.name || '',
          description: func.description || '',
          input_schema: func.parameters || { type: 'object', properties: {} },
        }));
      }
      // If it's an array of Tool objects
      return tools.flatMap((tool: any) => 
        tool.functionDeclarations?.map((func: any) => ({
          name: func.name || '',
          description: func.description || '',
          input_schema: func.parameters || { type: 'object', properties: {} },
        })) || []
      );
    }

    return [];
  }

  private convertAnthropicToGeminiResponse(response: Anthropic.Messages.Message): GenerateContentResponse {
    const parts: Part[] = [];

    response.content.forEach(content => {
      if (content.type === 'text') {
        parts.push({ text: content.text });
      } else if (content.type === 'tool_use') {
        parts.push({
          functionCall: {
            name: content.name,
            args: content.input as Record<string, unknown>,
          },
        });
      }
    });

    return {
      candidates: [{
        content: {
          role: 'model',
          parts,
        },
        finishReason: this.mapAnthropicStopReason(response.stop_reason),
      }],
      usageMetadata: response.usage ? {
        promptTokenCount: response.usage.input_tokens,
        candidatesTokenCount: response.usage.output_tokens,
        totalTokenCount: response.usage.input_tokens + response.usage.output_tokens,
      } : undefined,
      text: undefined,
      data: undefined,
      functionCalls: undefined,
      executableCode: undefined,
      codeExecutionResult: undefined,
    };
  }

  private convertAnthropicStreamToGeminiResponse(chunk: Anthropic.Messages.MessageStreamEvent): GenerateContentResponse | null {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      return {
        candidates: [{
          content: {
            role: 'model',
            parts: [{ text: chunk.delta.text }],
          },
        }],
        text: undefined,
        data: undefined,
        functionCalls: undefined,
        executableCode: undefined,
        codeExecutionResult: undefined,
      };
    }

    if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
      return {
        candidates: [{
          content: {
            role: 'model',
            parts: [{
              functionCall: {
                name: chunk.content_block.name,
                args: chunk.content_block.input as Record<string, unknown>,
              },
            }],
          },
        }],
        text: undefined,
        data: undefined,
        functionCalls: undefined,
        executableCode: undefined,
        codeExecutionResult: undefined,
      };
    }

    if (chunk.type === 'message_stop') {
      return {
        candidates: [{
          content: {
            role: 'model',
            parts: [],
          },
          finishReason: FinishReason.STOP,
        }],
        text: undefined,
        data: undefined,
        functionCalls: undefined,
        executableCode: undefined,
        codeExecutionResult: undefined,
      };
    }

    return null;
  }

  private mapAnthropicStopReason(reason: string | null): FinishReason {
    switch (reason) {
      case 'end_turn':
        return FinishReason.STOP;
      case 'max_tokens':
        return FinishReason.MAX_TOKENS;
      case 'stop_sequence':
        return FinishReason.STOP;
      case 'tool_use':
        return FinishReason.STOP;
      default:
        return FinishReason.OTHER;
    }
  }
}
