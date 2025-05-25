/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as vitest from 'vitest'; // VITEST IMPORT FIRST

// NOW MOCKS - using vitest.vi
const mockGenerateJson = vitest.vi.fn();
const mockStartChat = vitest.vi.fn();
const mockSendMessageStream = vitest.vi.fn();

vitest.vi.mock('../core/client.js', () => ({
  GeminiClient: vitest.vi.fn().mockImplementation(() => ({
    generateJson: mockGenerateJson,
    startChat: mockStartChat,
    sendMessageStream: mockSendMessageStream,
  })),
}));
// END MOCKS

// THEN OTHER IMPORTS
import { describe, it, expect } from 'vitest';
import {
  countOccurrences,
  ensureCorrectEdit,
  unescapeStringForGeminiBug,
  resetEditCorrectorCaches_TEST_ONLY,
} from './editCorrector.js';
import { GeminiClient } from '../core/client.js'; // This will now import the mock
import type { Config } from '../config/config.js';
import { ToolRegistry } from '../tools/tool-registry.js';

vitest.vi.mock('../tools/tool-registry.js');

describe('editCorrector', () => {
  describe('countOccurrences', () => {
    it('should return 0 for empty string', () => {
      expect(countOccurrences('', 'a')).toBe(0);
    });

    it('should return 0 for empty substring', () => {
      expect(countOccurrences('abc', '')).toBe(0);
    });

    it('should return 0 if substring is not found', () => {
      expect(countOccurrences('abc', 'd')).toBe(0);
    });

    it('should return 1 if substring is found once', () => {
      expect(countOccurrences('abc', 'b')).toBe(1);
    });

    it('should return correct count for multiple occurrences', () => {
      expect(countOccurrences('ababa', 'a')).toBe(3);
      expect(countOccurrences('ababab', 'ab')).toBe(3);
    });

    it('should count non-overlapping occurrences', () => {
      expect(countOccurrences('aaaaa', 'aa')).toBe(2);
      expect(countOccurrences('ababab', 'aba')).toBe(1);
    });

    it('should correctly count occurrences when substring is longer', () => {
      expect(countOccurrences('abc', 'abcdef')).toBe(0);
    });

    it('should be case sensitive', () => {
      expect(countOccurrences('abcABC', 'a')).toBe(1);
      expect(countOccurrences('abcABC', 'A')).toBe(1);
    });
  });

  describe('unescapeStringForGeminiBug', () => {
    it('should unescape common sequences', () => {
      expect(unescapeStringForGeminiBug('\\n')).toBe('\n');
      expect(unescapeStringForGeminiBug('\\t')).toBe('\t');
      expect(unescapeStringForGeminiBug("\\'")).toBe("'");
      expect(unescapeStringForGeminiBug('\\"')).toBe('"');
      expect(unescapeStringForGeminiBug('\\`')).toBe('`');
    });

    it('should handle multiple escaped sequences', () => {
      expect(unescapeStringForGeminiBug('Hello\\nWorld\\tTest')).toBe(
        'Hello\nWorld\tTest',
      );
    });

    it('should not alter already correct sequences', () => {
      expect(unescapeStringForGeminiBug('\n')).toBe('\n');
      expect(unescapeStringForGeminiBug('Correct string')).toBe(
        'Correct string',
      );
    });

    it('should handle mixed correct and incorrect sequences', () => {
      expect(unescapeStringForGeminiBug('\\nCorrect\t\\`')).toBe(
        '\nCorrect\t`',
      );
    });

    it('should handle backslash followed by actual newline character', () => {
      expect(unescapeStringForGeminiBug('\\\n')).toBe('\n');
      expect(unescapeStringForGeminiBug('First line\\\nSecond line')).toBe(
        'First line\nSecond line',
      );
    });

    it('should handle multiple backslashes before an escapable character', () => {
      expect(unescapeStringForGeminiBug('\\\\n')).toBe('\n');
      expect(unescapeStringForGeminiBug('\\\\\\t')).toBe('\t');
      expect(unescapeStringForGeminiBug('\\\\\\\\`')).toBe('`');
    });

    it('should return empty string for empty input', () => {
      expect(unescapeStringForGeminiBug('')).toBe('');
    });

    it('should not alter strings with no targeted escape sequences', () => {
      expect(unescapeStringForGeminiBug('abc def')).toBe('abc def');
      expect(unescapeStringForGeminiBug('C:\\Folder\\File')).toBe(
        'C:\\Folder\\File',
      );
    });

    it('should correctly process strings with some targeted escapes', () => {
      expect(unescapeStringForGeminiBug('C:\\Users\\name')).toBe(
        'C:\\Users\name',
      );
    });

    it('should handle complex cases with mixed slashes and characters', () => {
      expect(
        unescapeStringForGeminiBug('\\\\\\\nLine1\\\nLine2\\tTab\\\\`Tick\\"'),
      ).toBe('\nLine1\nLine2\tTab`Tick"');
    });
  });

  describe('ensureCorrectEdit', () => {
    let mockGeminiClientInstance: vitest.Mocked<GeminiClient>;
    let mockToolRegistry: vitest.Mocked<ToolRegistry>;
    let mockConfigInstance: Config;

    beforeEach(() => {
      mockToolRegistry = new ToolRegistry({} as Config) as vitest.Mocked<ToolRegistry>;

      const configParams = {
        apiKey: 'test-api-key',
        model: 'test-model',
        sandbox: false as boolean | string,
        targetDir: '/test',
        debugMode: false,
        question: undefined as string | undefined,
        fullContext: false,
        coreTools: undefined as string[] | undefined,
        toolDiscoveryCommand: undefined as string | undefined,
        toolCallCommand: undefined as string | undefined,
        mcpServerCommand: undefined as string | undefined,
        mcpServers: undefined as Record<string, any> | undefined,
        userAgent: 'test-agent',
        userMemory: '',
        geminiMdFileCount: 0,
        alwaysSkipModificationConfirmation: false,
      };

      mockConfigInstance = {
        ...configParams,
        getApiKey: vitest.vi.fn(() => configParams.apiKey),
        getModel: vitest.vi.fn(() => configParams.model),
        getSandbox: vitest.vi.fn(() => configParams.sandbox),
        getTargetDir: vitest.vi.fn(() => configParams.targetDir),
        getToolRegistry: vitest.vi.fn(() => mockToolRegistry),
        getDebugMode: vitest.vi.fn(() => configParams.debugMode),
        getQuestion: vitest.vi.fn(() => configParams.question),
        getFullContext: vitest.vi.fn(() => configParams.fullContext),
        getCoreTools: vitest.vi.fn(() => configParams.coreTools),
        getToolDiscoveryCommand: vitest.vi.fn(() => configParams.toolDiscoveryCommand),
        getToolCallCommand: vitest.vi.fn(() => configParams.toolCallCommand),
        getMcpServerCommand: vitest.vi.fn(() => configParams.mcpServerCommand),
        getMcpServers: vitest.vi.fn(() => configParams.mcpServers),
        getUserAgent: vitest.vi.fn(() => configParams.userAgent),
        getUserMemory: vitest.vi.fn(() => configParams.userMemory),
        setUserMemory: vitest.vi.fn((mem: string) => { configParams.userMemory = mem; }),
        getGeminiMdFileCount: vitest.vi.fn(() => configParams.geminiMdFileCount),
        setGeminiMdFileCount: vitest.vi.fn((count: number) => { configParams.geminiMdFileCount = count; }),
        getAlwaysSkipModificationConfirmation: vitest.vi.fn(() => configParams.alwaysSkipModificationConfirmation),
        setAlwaysSkipModificationConfirmation: vitest.vi.fn((skip: boolean) => { configParams.alwaysSkipModificationConfirmation = skip; }),
      } as unknown as Config;

      mockGeminiClientInstance = new GeminiClient(mockConfigInstance) as vitest.Mocked<GeminiClient>;

      mockGenerateJson.mockClear();
      mockStartChat.mockClear();
      mockSendMessageStream.mockClear();
      resetEditCorrectorCaches_TEST_ONLY();
    });

    describe('Scenario Group 1: originalParams.old_string matches currentContent directly', () => {
      it('Test 1.1: old_string (no literal \\), new_string (escaped by Gemini) -> new_string unescaped', async () => {
        const currentContent = 'This is a test string to find me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find me',
          new_string: 'replace with \\"this\\"',
        };
        mockGenerateJson.mockResolvedValueOnce({ corrected_new_string_escaping: 'replace with "this"' });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );
        expect(mockGenerateJson).toHaveBeenCalledTimes(1);
        expect(result.params.new_string).toBe('replace with "this"');
        expect(result.params.old_string).toBe('find me');
        expect(result.occurrences).toBe(1);
      });

      it('Test 1.2: old_string (no literal \\), new_string (correctly formatted) -> new_string unchanged', async () => {
        const currentContent = 'This is a test string to find me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find me',
          new_string: 'replace with this',
        };
        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );
        expect(mockGenerateJson).toHaveBeenCalledTimes(0);
        expect(result.params.new_string).toBe('replace with this');
        expect(result.params.old_string).toBe('find me');
        expect(result.occurrences).toBe(1);
      });

      it('Test 1.3: old_string (with literal \\), new_string (escaped by Gemini) -> new_string unchanged (still escaped)', async () => {
        const currentContent = 'This is a test string to find\\me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find\\me',
          new_string: 'replace with \\"this\\"',
        };
        mockGenerateJson.mockResolvedValueOnce({ corrected_new_string_escaping: 'replace with "this"' });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );
        expect(mockGenerateJson).toHaveBeenCalledTimes(1);
        expect(result.params.new_string).toBe('replace with "this"');
        expect(result.params.old_string).toBe('find\\me');
        expect(result.occurrences).toBe(1);
      });

      it('Test 1.4: old_string (with literal \\), new_string (correctly formatted) -> new_string unchanged', async () => {
        const currentContent = 'This is a test string to find\\me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find\\me',
          new_string: 'replace with this',
        };
        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );
        expect(mockGenerateJson).toHaveBeenCalledTimes(0);
        expect(result.params.new_string).toBe('replace with this');
        expect(result.params.old_string).toBe('find\\me');
        expect(result.occurrences).toBe(1);
      });
    });

    describe('Scenario Group 2: originalParams.old_string does NOT match, but unescapeStringForGeminiBug(originalParams.old_string) DOES match', () => {
      it('Test 2.1: old_string (over-escaped, no intended literal \\), new_string (escaped by Gemini) -> new_string unescaped', async () => {
        const currentContent = 'This is a test string to find "me".';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find \\"me\\"',
          new_string: 'replace with \\"this\\"',
        };
        mockGenerateJson.mockResolvedValueOnce({ corrected_new_string: 'replace with "this"' });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );
        expect(mockGenerateJson).toHaveBeenCalledTimes(1);
        expect(result.params.new_string).toBe('replace with "this"');
        expect(result.params.old_string).toBe('find "me"');
        expect(result.occurrences).toBe(1);
      });

      it('Test 2.2: old_string (over-escaped, no intended literal \\), new_string (correctly formatted) -> new_string unescaped (harmlessly)', async () => {
        const currentContent = 'This is a test string to find "me".';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find \\"me\\"',
          new_string: 'replace with this',
        };
        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );
        expect(mockGenerateJson).toHaveBeenCalledTimes(0);
        expect(result.params.new_string).toBe('replace with this');
        expect(result.params.old_string).toBe('find "me"');
        expect(result.occurrences).toBe(1);
      });

      it('Test 2.3: old_string (over-escaped, with intended literal \\), new_string (escaped by Gemini) -> new_string unescaped', async () => {
        const currentContent = 'This is a test string to find \\me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find \\\\me',
          new_string: 'replace with \\"this\\"',
        };
        mockGenerateJson.mockResolvedValueOnce({ corrected_new_string: 'replace with "this"' });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );
        expect(mockGenerateJson).toHaveBeenCalledTimes(1);
        expect(result.params.new_string).toBe('replace with "this"');
        expect(result.params.old_string).toBe('find \\me');
        expect(result.occurrences).toBe(1);
      });
    });

    describe('Scenario Group 3: LLM Correction Path', () => {
      it('Test 3.1: old_string (no literal \\), new_string (escaped by Gemini), LLM re-escapes new_string -> final new_string is double unescaped', async () => {
        const currentContent = 'This is a test string to corrected find me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find me',
          new_string: 'replace with \\\\"this\\\\"',
        };
        const llmCorrectedOldString = 'corrected find me';
        const llmNewString = 'LLM says replace with "that"';

        mockGenerateJson.mockResolvedValueOnce({ corrected_target_snippet: llmCorrectedOldString });
        mockGenerateJson.mockResolvedValueOnce({ corrected_new_string: llmNewString });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );
        expect(mockGenerateJson).toHaveBeenCalledTimes(2);
        expect(result.params.new_string).toBe(llmNewString);
        expect(result.params.old_string).toBe(llmCorrectedOldString);
        expect(result.occurrences).toBe(1);
      });

      it('Test 3.2: old_string (with literal \\), new_string (escaped by Gemini), LLM re-escapes new_string -> final new_string is unescaped once', async () => {
        const currentContent = 'This is a test string to corrected find\\me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find\\me',
          new_string: 'replace with \\\\"this\\\\"',
        };
        const llmCorrectedOldString = 'corrected find\\me';
        const llmNewString = 'LLM says replace with "that"';

        mockGenerateJson.mockResolvedValueOnce({ corrected_target_snippet: llmCorrectedOldString });
        mockGenerateJson.mockResolvedValueOnce({ corrected_new_string: llmNewString });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );
        expect(mockGenerateJson).toHaveBeenCalledTimes(2);
        expect(result.params.new_string).toBe(llmNewString);
        expect(result.params.old_string).toBe(llmCorrectedOldString);
        expect(result.occurrences).toBe(1);
      });

      it('Test 3.3: LLM correction path, correctNewString returns correctly formatted string -> final new_string is correct (harmlessly unescaped)', async () => {
        const currentContent = 'This is a test string to corrected find me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find me',
          new_string: 'replace with "this"',
        };
        const llmCorrectedOldString = 'corrected find me';
        mockGenerateJson.mockResolvedValueOnce({ corrected_target_snippet: llmCorrectedOldString });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );
        expect(mockGenerateJson).toHaveBeenCalledTimes(1);
        expect(result.params.new_string).toBe('replace with "this"');
        expect(result.params.old_string).toBe(llmCorrectedOldString);
        expect(result.occurrences).toBe(1);
      });

      it('Test 3.4: LLM correction path, correctNewString returns the originalNewString it was passed (which was unescaped) -> final new_string is unescaped', async () => {
        const currentContent = 'This is a test string to corrected find me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find me',
          new_string: 'replace with \\\\"this\\\\"',
        };
        const llmCorrectedOldString = 'corrected find me';
        const newStringForLLMAndReturnedByLLM = 'replace with "this"';

        mockGenerateJson.mockResolvedValueOnce({ corrected_target_snippet: llmCorrectedOldString });
        mockGenerateJson.mockResolvedValueOnce({ corrected_new_string: newStringForLLMAndReturnedByLLM });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );
        expect(mockGenerateJson).toHaveBeenCalledTimes(2);
        expect(result.params.new_string).toBe(newStringForLLMAndReturnedByLLM);
        expect(result.params.old_string).toBe(llmCorrectedOldString);
        expect(result.occurrences).toBe(1);
      });
    });

    describe('Scenario Group 4: No Match Found / Multiple Matches', () => {
      it('Test 4.1: No version of old_string (original, unescaped, LLM-corrected) matches -> returns original params, 0 occurrences', async () => {
        const currentContent = 'This content has nothing to find.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'nonexistent string',
          new_string: 'some new string',
        };
        mockGenerateJson.mockResolvedValueOnce({ corrected_target_snippet: 'still nonexistent' });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );
        expect(mockGenerateJson).toHaveBeenCalledTimes(1);
        expect(result.params).toEqual(originalParams);
        expect(result.occurrences).toBe(0);
      });

      it('Test 4.2: unescapedOldStringAttempt results in >1 occurrences -> returns original params, count occurrences', async () => {
        const currentContent =
          'This content has find "me" and also find "me" again.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find "me"',
          new_string: 'some new string',
        };
        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );
        expect(mockGenerateJson).toHaveBeenCalledTimes(0);
        expect(result.params).toEqual(originalParams);
        expect(result.occurrences).toBe(2);
      });
    });

    describe('Scenario Group 5: Specific unescapeStringForGeminiBug checks (integrated into ensureCorrectEdit)', () => {
      it('Test 5.1: old_string matches after unescaping mixed legitimate and Gemini escapes, new_string also unescaped', async () => {
        const currentContent = 'const x = "a\\nbc\\\\"def\\\\"'; // This is what old_string unescapes to
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'const x = \\\\"a\\\\nbc\\\\\\\\"def\\\\\\\\"', // Overly escaped
          new_string: 'const y = \\\\"new\\\\nval\\\\\\\\"content\\\\\\\\"', // Overly escaped
        };
        const expectedCorrectedNewString = 'const y = "new\\nval\\\\"content\\\\"';
        mockGenerateJson.mockResolvedValueOnce({ corrected_new_string: expectedCorrectedNewString });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );
        expect(mockGenerateJson).toHaveBeenCalledTimes(1);
        expect(result.params.old_string).toBe(currentContent);
        expect(result.params.new_string).toBe(expectedCorrectedNewString);
        expect(result.occurrences).toBe(1);
      });
    });
  });
});
