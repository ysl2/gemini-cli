/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import OpenAI from 'openai';
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
  FinishReason,
} from '@google/genai';

export class OpenAIAdapter implements ContentGenerator {
  private openai: OpenAI;
  private model: string;

  constructor(config: ContentGeneratorConfig) {
    this.openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.model = config.model;
  }

  async generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {
    try {
      const messages = this.convertGeminiToOpenAIMessages(request.contents);
      const tools = request.config?.tools ? this.convertGeminiToOpenAITools(request.config.tools) : [];

      const openaiRequest: OpenAI.Chat.ChatCompletionCreateParams = {
        model: this.model,
        messages,
        max_tokens: request.config?.maxOutputTokens,
        temperature: request.config?.temperature,
        top_p: request.config?.topP,
        ...(tools.length > 0 && { tools, tool_choice: 'auto' }),
      };

      const response = await this.openai.chat.completions.create(openaiRequest);
      return this.convertOpenAIToGeminiResponse(response);
    } catch (error) {
      throw new Error(`OpenAI API error: ${error}`);
    }
  }

  async generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const messages = this.convertGeminiToOpenAIMessages(request.contents);
    const tools = request.config?.tools ? this.convertGeminiToOpenAITools(request.config.tools) : [];

    const openaiRequest: OpenAI.Chat.ChatCompletionCreateParams = {
      model: this.model,
      messages,
      stream: true,
      max_tokens: request.config?.maxOutputTokens,
      temperature: request.config?.temperature,
      top_p: request.config?.topP,
      ...(tools.length > 0 && { tools, tool_choice: 'auto' }),
    };

    const stream = await this.openai.chat.completions.create(openaiRequest);
    return this.createAsyncGenerator(stream);
  }

  private async *createAsyncGenerator(stream: any): AsyncGenerator<GenerateContentResponse> {
    try {
      for await (const chunk of stream) {
        const geminiResponse = this.convertOpenAIStreamToGeminiResponse(chunk);
        if (geminiResponse) {
          yield geminiResponse;
        }
      }
    } catch (error) {
      throw new Error(`OpenAI API streaming error: ${error}`);
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
    try {
      let text = '';
      
      if (typeof request.contents === 'string') {
        text = request.contents;
      } else if (Array.isArray(request.contents) && request.contents.length > 0) {
        const firstContent = request.contents[0];
        if (typeof firstContent === 'object' && firstContent && 'parts' in firstContent) {
          text = (firstContent as any).parts?.[0]?.text || '';
        } else if (typeof firstContent === 'string') {
          text = firstContent;
        }
      }
      
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: text,
      });

      return {
        embeddings: [{
          values: response.data[0].embedding,
        }],
      };
    } catch (error) {
      throw new Error(`OpenAI embedding error: ${error}`);
    }
  }

  private convertGeminiToOpenAIMessages(contents?: any): OpenAI.Chat.ChatCompletionMessageParam[] {
    if (!contents) return [];

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

    return contentArray.map((content: Content) => {
      const text = content.parts?.filter((part: any) => part.text).map((part: any) => part.text).join('') || '';
      const functionCalls = content.parts?.filter((part: any) => part.functionCall);
      const functionResponses = content.parts?.filter((part: any) => part.functionResponse);

      if (functionCalls?.length) {
        return {
          role: 'assistant' as const,
          content: text || null,
          tool_calls: functionCalls.map((part: any) => ({
            id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'function' as const,
            function: {
              name: part.functionCall?.name || '',
              arguments: JSON.stringify(part.functionCall?.args || {}),
            },
          })),
        };
      }

      if (functionResponses?.length) {
        return {
          role: 'tool' as const,
          content: JSON.stringify(functionResponses[0].functionResponse?.response || {}),
          tool_call_id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        };
      }

      return {
        role: content.role === 'model' ? 'assistant' as const : content.role as 'user' | 'system',
        content: text,
      };
    });
  }

  private convertGeminiToOpenAITools(tools?: any): OpenAI.Chat.ChatCompletionTool[] {
    if (!tools) return [];

    // Handle ToolListUnion which can be Tool[] or FunctionDeclaration[]
    if (Array.isArray(tools)) {
      // If it's an array of FunctionDeclaration
      if (tools.length > 0 && 'name' in tools[0] && 'description' in tools[0]) {
        return tools.map(func => ({
          type: 'function' as const,
          function: {
            name: func.name,
            description: func.description,
            parameters: func.parameters,
          },
        }));
      }
      // If it's an array of Tool objects
      return tools.flatMap(tool => 
        tool.functionDeclarations?.map((func: any) => ({
          type: 'function' as const,
          function: {
            name: func.name,
            description: func.description,
            parameters: func.parameters,
          },
        })) || []
      );
    }

    return [];
  }

  private convertOpenAIToGeminiResponse(response: OpenAI.Chat.ChatCompletion): GenerateContentResponse {
    const choice = response.choices[0];
    const message = choice.message;

    const parts: Part[] = [];

    if (message.content) {
      parts.push({ text: message.content });
    }

    if (message.tool_calls) {
      message.tool_calls.forEach(toolCall => {
        parts.push({
          functionCall: {
            name: toolCall.function.name,
            args: JSON.parse(toolCall.function.arguments || '{}'),
          },
        });
      });
    }

    return {
      candidates: [{
        content: {
          role: 'model',
          parts,
        },
        finishReason: this.mapOpenAIFinishReason(choice.finish_reason),
      }],
      usageMetadata: response.usage ? {
        promptTokenCount: response.usage.prompt_tokens,
        candidatesTokenCount: response.usage.completion_tokens,
        totalTokenCount: response.usage.total_tokens,
      } : undefined,
      text: undefined,
      data: undefined,
      functionCalls: undefined,
      executableCode: undefined,
      codeExecutionResult: undefined,
    };
  }

  private convertOpenAIStreamToGeminiResponse(chunk: OpenAI.Chat.Completions.ChatCompletionChunk): GenerateContentResponse | null {
    const choice = chunk.choices[0];
    if (!choice) return null;

    const delta = choice.delta;
    const parts: Part[] = [];

    if (delta.content) {
      parts.push({ text: delta.content });
    }

    if (delta.tool_calls) {
      delta.tool_calls.forEach(toolCall => {
        if (toolCall.function?.name) {
          parts.push({
            functionCall: {
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments || '{}'),
            },
          });
        }
      });
    }

    if (parts.length === 0) return null;

    return {
      candidates: [{
        content: {
          role: 'model',
          parts,
        },
        finishReason: choice.finish_reason ? this.mapOpenAIFinishReason(choice.finish_reason) : undefined,
      }],
      text: undefined,
      data: undefined,
      functionCalls: undefined,
      executableCode: undefined,
      codeExecutionResult: undefined,
    };
  }

  private mapOpenAIFinishReason(reason: string | null): FinishReason {
    switch (reason) {
      case 'stop':
        return FinishReason.STOP;
      case 'length':
        return FinishReason.MAX_TOKENS;
      case 'function_call':
      case 'tool_calls':
        return FinishReason.STOP;
      case 'content_filter':
        return FinishReason.SAFETY;
      default:
        return FinishReason.OTHER;
    }
  }
}
