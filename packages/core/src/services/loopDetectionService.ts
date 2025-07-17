/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'crypto';
import { GeminiEventType, ServerGeminiStreamEvent } from '../core/turn.js';
import { logLoopDetected } from '../telemetry/loggers.js';
import { LoopDetectedEvent, LoopType } from '../telemetry/types.js';
import { Config, DEFAULT_GEMINI_FLASH_MODEL } from '../config/config.js';
import { SchemaUnion, Type } from '@google/genai';

const TOOL_CALL_LOOP_THRESHOLD = 5;
const CONTENT_LOOP_THRESHOLD = 10;
const LLM_LOOP_CHECK_HISTORY_COUNT = 20;

const LLM_CHECK_AFTER_TURNS = 10;
const LLM_CHECK_INTERVAL = 3;

const SENTENCE_ENDING_PUNCTUATION_REGEX = /[.!?]+(?=\s|$)/;

/**
 * Service for detecting and preventing infinite loops in AI responses.
 * Monitors tool call repetitions and content sentence repetitions.
 */
export class LoopDetectionService {
  private readonly config: Config;

  // Tool call tracking
  private lastToolCallKey: string | null = null;
  private toolCallRepetitionCount: number = 0;

  // Content streaming tracking
  private lastRepeatedSentence: string = '';
  private sentenceRepetitionCount: number = 0;
  private partialContent: string = '';

  // LLM loop track tracking
  private turnsInCurrentPrompt = 0;

  constructor(config: Config) {
    this.config = config;
  }

  private getToolCallKey(toolCall: { name: string; args: object }): string {
    const argsString = JSON.stringify(toolCall.args);
    const keyString = `${toolCall.name}:${argsString}`;
    return createHash('sha256').update(keyString).digest('hex');
  }

  /**
   * Processes a stream event and checks for loop conditions.
   * @param event - The stream event to process
   * @returns true if a loop is detected, false otherwise
   */
  addAndCheck(event: ServerGeminiStreamEvent): boolean {
    switch (event.type) {
      case GeminiEventType.ToolCallRequest:
        // content chanting only happens in one single stream, reset if there
        // is a tool call in between
        this.resetSentenceCount();
        return this.checkToolCallLoop(event.value);
      case GeminiEventType.Content:
        return this.checkContentLoop(event.value);
      default:
        return false;
    }
  }

  async turnStarted(signal: AbortSignal) {
    this.turnsInCurrentPrompt++;

    if (
      this.turnsInCurrentPrompt >= LLM_CHECK_AFTER_TURNS &&
      this.turnsInCurrentPrompt % LLM_CHECK_INTERVAL === 0
    ) {
      return await this.checkForLoopWithLLM(signal);
    }

    return false;
  }

  private checkToolCallLoop(toolCall: { name: string; args: object }): boolean {
    const key = this.getToolCallKey(toolCall);
    if (this.lastToolCallKey === key) {
      this.toolCallRepetitionCount++;
    } else {
      this.lastToolCallKey = key;
      this.toolCallRepetitionCount = 1;
    }
    if (this.toolCallRepetitionCount >= TOOL_CALL_LOOP_THRESHOLD) {
      logLoopDetected(
        this.config,
        new LoopDetectedEvent(LoopType.CONSECUTIVE_IDENTICAL_TOOL_CALLS),
      );
      return true;
    }
    return false;
  }

  private checkContentLoop(content: string): boolean {
    this.partialContent += content;

    if (!SENTENCE_ENDING_PUNCTUATION_REGEX.test(this.partialContent)) {
      return false;
    }

    const completeSentences =
      this.partialContent.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [];
    if (completeSentences.length === 0) {
      return false;
    }

    const lastSentence = completeSentences[completeSentences.length - 1];
    const lastCompleteIndex = this.partialContent.lastIndexOf(lastSentence);
    const endOfLastSentence = lastCompleteIndex + lastSentence.length;
    this.partialContent = this.partialContent.slice(endOfLastSentence);

    for (const sentence of completeSentences) {
      const trimmedSentence = sentence.trim();
      if (trimmedSentence === '') {
        continue;
      }

      if (this.lastRepeatedSentence === trimmedSentence) {
        this.sentenceRepetitionCount++;
      } else {
        this.lastRepeatedSentence = trimmedSentence;
        this.sentenceRepetitionCount = 1;
      }

      if (this.sentenceRepetitionCount >= CONTENT_LOOP_THRESHOLD) {
        logLoopDetected(
          this.config,
          new LoopDetectedEvent(LoopType.CHANTING_IDENTICAL_SENTENCES),
        );
        return true;
      }
    }
    return false;
  }

  private async checkForLoopWithLLM(signal: AbortSignal) {
    const recentHistory = this.config
      .getGeminiClient()
      .getHistory()
      .slice(-LLM_LOOP_CHECK_HISTORY_COUNT);

    const prompt = `You are an expert at detecting conversation loops.
The following is the recent history of a conversation with an AI assistant.
Please analyze it to determine if the conversation is stuck in a repetitive loop.
A loop is defined as the AI assistant making a sequence of 5 or more tool calls that are repetitive and not making progress.
This can be a single tool call repeated 5 times, or a repeating pattern of tool calls (e.g., A, B, A, B, A, B, A, B, A, B).

Analyze the tool calls made by the model in the conversation history to identify such patterns.
Respond with JSON. The JSON object should have a single key "loopDetected" with a boolean value.

Conversation history:
${JSON.stringify(recentHistory, null, 2)}
`;
    const schema: SchemaUnion = {
      type: Type.OBJECT,
      properties: {
        loopDetected: {
          type: Type.BOOLEAN,
          description:
            'Whether the conversation is looping and not making forward progress.',
        },
        reasoning: {
          type: Type.STRING,
          description:
            'Your reasoning on if the conversation is looping without forward progress',
        },
        confidence: {
          type: Type.NUMBER,
          description: 'Confidence interval between 0 and 1.',
        },
      },
      required: ['loopDetected', 'reasoning', 'confidence'],
    };
    let result;
    try {
      result = await this.config
        .getGeminiClient()
        .generateJson(
          [{ role: 'user', parts: [{ text: prompt }] }],
          schema,
          signal,
          DEFAULT_GEMINI_FLASH_MODEL,
        );
      console.log(result);
    } catch (e) {
      // Do nothing, treat it as a non-loop.
      this.config.getDebugMode() ? console.error(e) : console.debug(e);
      return false;
    }

    if (typeof result.is_loop === 'boolean' && result.is_loop) {
      logLoopDetected(
        this.config,
        new LoopDetectedEvent(LoopType.LLM_DETECTED_LOOP),
      );
      return true;
    }
    return false;
  }

  /**
   * Resets all loop detection state.
   */
  reset(): void {
    this.resetToolCallCount();
    this.resetSentenceCount();
    this.resetTurns();
  }

  private resetToolCallCount(): void {
    this.lastToolCallKey = null;
    this.toolCallRepetitionCount = 0;
  }

  private resetSentenceCount(): void {
    this.lastRepeatedSentence = '';
    this.sentenceRepetitionCount = 0;
    this.partialContent = '';
  }

  private resetTurns(): void {
    this.turnsInCurrentPrompt = 0;
  }
}
