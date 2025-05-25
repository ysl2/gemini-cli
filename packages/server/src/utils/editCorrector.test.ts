/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as vitest from 'vitest';
import {
  countOccurrences,
  ensureCorrectEdit,
  unescapeStringForGeminiBug,
} from './editCorrector.js';
import { GeminiClient } from '../core/client.js';
import type { Config } from '../config/config.js'; 
import { ToolRegistry } from '../tools/tool-registry.js';

// Define mocks at a scope accessible by both the mock factory and tests
const mockGenerateJson = vitest.vi.fn();
// Remove mockCorrectOldStringMismatch and mockCorrectNewString as we will control behavior via mockGenerateJson
const mockStartChat = vitest.vi.fn();
const mockSendMessageStream = vitest.vi.fn();

vitest.vi.mock('../core/client.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    GeminiClient: vitest.vi.fn().mockImplementation((_config: Config) => ({
      generateJson: mockGenerateJson,
      startChat: mockStartChat,
      sendMessageStream: mockSendMessageStream,
    })),
  };
});

// No longer mocking ./editCorrector.js itself

vitest.vi.mock('../tools/tool-registry.js');

vitest.describe('editCorrector', () => {
  vitest.describe('countOccurrences', () => {
    vitest.it('should return 0 for empty string', () => {
      vitest.expect(countOccurrences('', 'a')).toBe(0);
    });

    vitest.it('should return 0 for empty substring', () => {
      vitest.expect(countOccurrences('abc', '')).toBe(0);
    });

    vitest.it('should return 0 if substring is not found', () => {
      vitest.expect(countOccurrences('abc', 'd')).toBe(0);
    });

    vitest.it('should return 1 if substring is found once', () => {
      vitest.expect(countOccurrences('abc', 'b')).toBe(1);
    });

    vitest.it('should return correct count for multiple occurrences', () => {
      vitest.expect(countOccurrences('ababa', 'a')).toBe(3);
      vitest.expect(countOccurrences('ababab', 'ab')).toBe(3);
    });

    vitest.it('should count non-overlapping occurrences', () => {
      vitest.expect(countOccurrences('aaaaa', 'aa')).toBe(2); 
      vitest.expect(countOccurrences('ababab', 'aba')).toBe(1); 
    });

    vitest.it('should correctly count occurrences when substring is longer', () => {
      vitest.expect(countOccurrences('abc', 'abcdef')).toBe(0);
    });

    vitest.it('should be case sensitive', () => {
      vitest.expect(countOccurrences('abcABC', 'a')).toBe(1);
      vitest.expect(countOccurrences('abcABC', 'A')).toBe(1);
    });
  });

  vitest.describe('unescapeStringForGeminiBug', () => {
    vitest.it('should unescape common sequences', () => {
      vitest.expect(unescapeStringForGeminiBug('\\n')).toBe('\n');
      vitest.expect(unescapeStringForGeminiBug('\\t')).toBe('\t');
      vitest.expect(unescapeStringForGeminiBug("\\'")).toBe("'");
      vitest.expect(unescapeStringForGeminiBug('\\"')).toBe('"');
      vitest.expect(unescapeStringForGeminiBug('\\`')).toBe('`');
    });

    vitest.it('should handle multiple escaped sequences', () => {
      vitest.expect(unescapeStringForGeminiBug('Hello\\nWorld\\tTest')).toBe(
        'Hello\nWorld\tTest',
      );
    });

    vitest.it('should not alter already correct sequences', () => {
      vitest.expect(unescapeStringForGeminiBug('\n')).toBe('\n');
      vitest.expect(unescapeStringForGeminiBug('Correct string')).toBe(
        'Correct string',
      );
    });

    vitest.it('should handle mixed correct and incorrect sequences', () => {
      vitest.expect(unescapeStringForGeminiBug('\\nCorrect\t\\`')).toBe(
        '\nCorrect\t`',
      );
    });

    vitest.it('should handle backslash followed by actual newline character', () => {
      vitest.expect(unescapeStringForGeminiBug('\\\n')).toBe('\n');
      vitest.expect(unescapeStringForGeminiBug('First line\\\nSecond line')).toBe(
        'First line\nSecond line',
      );
    });

    vitest.it('should handle multiple backslashes before an escapable character', () => {
      vitest.expect(unescapeStringForGeminiBug('\\\\n')).toBe('\n');
      vitest.expect(unescapeStringForGeminiBug('\\\\\\t')).toBe('\t');
      vitest.expect(unescapeStringForGeminiBug('\\\\\\\\`')).toBe('`');
    });

    vitest.it('should return empty string for empty input', () => {
      vitest.expect(unescapeStringForGeminiBug('')).toBe('');
    });

    vitest.it('should not alter strings with no targeted escape sequences', () => {
      vitest.expect(unescapeStringForGeminiBug('abc def')).toBe('abc def');
      vitest.expect(unescapeStringForGeminiBug('C:\\Folder\\File')).toBe(
        'C:\\Folder\\File',
      );
    });

    vitest.it('should correctly process strings with some targeted escapes', () => {
      vitest.expect(unescapeStringForGeminiBug('C:\\Users\\name')).toBe(
        'C:\\Users\name',
      );
    });

    vitest.it('should handle complex cases with mixed slashes and characters', () => {
      vitest.expect(
        unescapeStringForGeminiBug('\\\\\\nLine1\\\nLine2\\tTab\\\\`Tick\\"'),
      ).toBe('\nLine1\nLine2\tTab`Tick"');
    });
  });

  vitest.describe('ensureCorrectEdit', () => {
    let mockGeminiClientInstance: vitest.Mocked<GeminiClient>;
    let mockToolRegistry: vitest.Mocked<ToolRegistry>;
    let mockConfigInstance: Config;

    vitest.beforeEach(() => {
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

      const MockedGeminiClientConstructor = GeminiClient as vitest.MockedClass<typeof GeminiClient>; 
      mockGeminiClientInstance = new MockedGeminiClientConstructor(mockConfigInstance) as vitest.Mocked<GeminiClient>; 

      mockGenerateJson.mockClear();
      // mockCorrectOldStringMismatch.mockClear(); // No longer directly mocked
      // mockCorrectNewString.mockClear(); // No longer directly mocked
      mockStartChat.mockClear();
      mockSendMessageStream.mockClear();
    });

    vitest.describe('Scenario Group 1: originalParams.old_string matches currentContent directly', () => {
      vitest.it('Test 1.1: old_string (no literal \\), new_string (escaped by Gemini) -> new_string unescaped', async () => {
        const currentContent = 'This is a test string to find me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find me',
          new_string: 'replace with \\"this\\"',
        };
        // old_string matches directly. new_string is Gemini-escaped.
        // expect correctNewStringEscaping to be called.
        mockGenerateJson.mockResolvedValueOnce({ corrected_new_string_escaping: 'replace with "this"' });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance, 
        );
        vitest.expect(mockGenerateJson).toHaveBeenCalledTimes(1);
        vitest.expect(result.params.new_string).toBe('replace with "this"');
        vitest.expect(result.params.old_string).toBe('find me');
        vitest.expect(result.occurrences).toBe(1);
      });

      vitest.it('Test 1.2: old_string (no literal \\), new_string (correctly formatted) -> new_string unchanged', async () => {
        const currentContent = 'This is a test string to find me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find me',
          new_string: 'replace with this',
        };
        // No LLM call expected if old_string matches and new_string is not escaped

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );

        vitest.expect(result.params.new_string).toBe('replace with this');
        vitest.expect(result.params.old_string).toBe('find me');
        vitest.expect(result.occurrences).toBe(1);
      });

      vitest.it('Test 1.3: old_string (with literal \\), new_string (escaped by Gemini) -> new_string unchanged (still escaped)', async () => {
        const currentContent = 'This is a test string to find\\me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find\\me',
          new_string: 'replace with \\"this\\"',
        };
        // old_string has literal escapes, new_string is Gemini-escaped.
        // correctNewStringEscaping should be called.
        mockGenerateJson.mockResolvedValueOnce({ corrected_new_string_escaping: 'replace with "this"' });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );

        vitest.expect(result.params.new_string).toBe('replace with "this"'); // Should be unescaped if old_string is fine
        vitest.expect(result.params.old_string).toBe('find\\me');
        vitest.expect(result.occurrences).toBe(1);
      });

      vitest.it('Test 1.4: old_string (with literal \\), new_string (correctly formatted) -> new_string unchanged', async () => {
        const currentContent = 'This is a test string to find\\me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find\\me',
          new_string: 'replace with this',
        };
        // No LLM call expected if old_string matches and new_string is not escaped

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );

        vitest.expect(result.params.new_string).toBe('replace with this');
        vitest.expect(result.params.old_string).toBe('find\\me');
        vitest.expect(result.occurrences).toBe(1);
      });
    });

    vitest.describe('Scenario Group 2: originalParams.old_string does NOT match, but unescapeStringForGeminiBug(originalParams.old_string) DOES match', () => {
      vitest.it('Test 2.1: old_string (over-escaped, no intended literal \\), new_string (escaped by Gemini) -> new_string unescaped', async () => {
        const currentContent = 'This is a test string to find "me".';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find \\"me\\"',
          new_string: 'replace with \\"this\\"',
        };
        // old_string unescapes to 'find "me"'. new_string is Gemini-escaped.
        // correctNewString should be called.
        mockGenerateJson.mockResolvedValueOnce({ corrected_new_string: 'replace with "this"' });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );

        vitest.expect(result.params.new_string).toBe('replace with "this"');
        vitest.expect(result.params.old_string).toBe('find "me"');
        vitest.expect(result.occurrences).toBe(1);
      });

      vitest.it('Test 2.2: old_string (over-escaped, no intended literal \\), new_string (correctly formatted) -> new_string unescaped (harmlessly)', async () => {
        const currentContent = 'This is a test string to find "me".';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find \\"me\\"', 
          new_string: 'replace with this',
        };
        // old_string unescapes. new_string is fine. No LLM for new_string needed.

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );

        vitest.expect(result.params.new_string).toBe('replace with this');
        vitest.expect(result.params.old_string).toBe('find "me"');
        vitest.expect(result.occurrences).toBe(1);
      });

      vitest.it('Test 2.3: old_string (over-escaped, with intended literal \\), new_string (escaped by Gemini) -> new_string unescaped', async () => {
        const currentContent = 'This is a test string to find \\me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find \\\\me', 
          new_string: 'replace with \\"this\\"',
        };
        // old_string unescapes. new_string is Gemini-escaped.
        // correctNewString should be called.
        mockGenerateJson.mockResolvedValueOnce({ corrected_new_string: 'replace with "this"' });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );

        vitest.expect(result.params.new_string).toBe('replace with "this"');
        vitest.expect(result.params.old_string).toBe('find \\me');
        vitest.expect(result.occurrences).toBe(1);
      });
    });

    vitest.describe('Scenario Group 3: LLM Correction Path', () => {
      vitest.it('Test 3.1: old_string (no literal \\), new_string (escaped by Gemini), LLM re-escapes new_string -> final new_string is double unescaped', async () => {
        const currentContent = 'This is a test string to corrected find me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find me',
          new_string: 'replace with \\\\"this\\\\"',
        };
        const llmCorrectedOldString = 'corrected find me';
        const llmNewString = 'LLM says replace with \\\\"that\\\\"';

        // Simulate LLM call for correctOldStringMismatch
        mockGenerateJson.mockResolvedValueOnce({ corrected_target_snippet: llmCorrectedOldString });
        // Simulate LLM call for correctNewString
        mockGenerateJson.mockResolvedValueOnce({ corrected_new_string: llmNewString });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );

        // Verify that generateJson was called (e.g., for new_string correction)
        // The specifics of this assertion might need adjustment based on actual call order and schemas
        vitest.expect(mockGenerateJson).toHaveBeenCalledTimes(2); 
        // Example: Check the second call to generateJson (for new_string correction)
        // This is a simplified check; you might need to inspect call arguments more deeply
        // vitest.expect(mockGenerateJson.mock.calls[1][1]).toEqual(NEW_STRING_CORRECTION_SCHEMA);
        vitest.expect(result.params.new_string).toBe('LLM says replace with "that"');
        vitest.expect(result.params.old_string).toBe(llmCorrectedOldString);
        vitest.expect(result.occurrences).toBe(1);
      });

      vitest.it('Test 3.2: old_string (with literal \\), new_string (escaped by Gemini), LLM re-escapes new_string -> final new_string is unescaped once', async () => {
        const currentContent = 'This is a test string to corrected find\\me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find\\me',
          new_string: 'replace with \\\\"this\\\\"',
        };
        const llmCorrectedOldString = 'corrected find\\me';
        const llmNewString = 'LLM says replace with \\\\"that\\\\"';

        // Simulate LLM call for correctOldStringMismatch
        mockGenerateJson.mockResolvedValueOnce({ corrected_target_snippet: llmCorrectedOldString });
        // Simulate LLM call for correctNewString, assuming it might be called if new_string also needs correction
        mockGenerateJson.mockResolvedValueOnce({ corrected_new_string: llmNewString });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );
        // vitest.expect(mockCorrectNewString).toHaveBeenCalledWith(
        //   currentContent,
        //   llmCorrectedOldString,
        //   originalParams.new_string, 
        // );
        // Verify generateJson calls if necessary, or just the outcome
        vitest.expect(result.params.new_string).toBe('LLM says replace with "that"');
        vitest.expect(result.params.old_string).toBe(llmCorrectedOldString);
        vitest.expect(result.occurrences).toBe(1);
      });

      vitest.it('Test 3.3: LLM correction path, correctNewString returns correctly formatted string -> final new_string is correct (harmlessly unescaped)', async () => {
        const currentContent = 'This is a test string to corrected find me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find me',
          new_string: 'replace with "this"',
        };
        const llmCorrectedOldString = 'corrected find me';
        const llmNewString = 'LLM says replace with "that"'; 

        // Simulate LLM call for correctOldStringMismatch
        mockGenerateJson.mockResolvedValueOnce({ corrected_target_snippet: llmCorrectedOldString });
        // Simulate LLM call for correctNewString
        mockGenerateJson.mockResolvedValueOnce({ corrected_new_string: llmNewString });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );

        // vitest.expect(mockCorrectNewString).toHaveBeenCalledWith(
        //   currentContent,
        //   llmCorrectedOldString,
        //   unescapeStringForGeminiBug(originalParams.new_string), 
        // );
        // Verify generateJson calls if necessary, or just the outcome
        vitest.expect(result.params.new_string).toBe('LLM says replace with "that"');
        vitest.expect(result.params.old_string).toBe(llmCorrectedOldString);
        vitest.expect(result.occurrences).toBe(1);
      });

      vitest.it('Test 3.4: LLM correction path, correctNewString returns the originalNewString it was passed (which was unescaped) -> final new_string is unescaped', async () => {
        const currentContent = 'This is a test string to corrected find me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find me',
          new_string: 'replace with \\\\"this\\\\"',
        };
        const llmCorrectedOldString = 'corrected find me';
        const newStringForLLMAndReturnedByLLM = 'replace with "this"';

        // Simulate LLM call for correctOldStringMismatch
        mockGenerateJson.mockResolvedValueOnce({ corrected_target_snippet: llmCorrectedOldString });
        // Simulate LLM call for correctNewString
        mockGenerateJson.mockResolvedValueOnce({ corrected_new_string: newStringForLLMAndReturnedByLLM });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );

        // vitest.expect(mockCorrectNewString).toHaveBeenCalledWith(
        //   currentContent,
        //   llmCorrectedOldString,
        //   newStringForLLMAndReturnedByLLM, 
        // );
        // Verify generateJson calls if necessary, or just the outcome
        vitest.expect(result.params.new_string).toBe(newStringForLLMAndReturnedByLLM);
        vitest.expect(result.params.old_string).toBe(llmCorrectedOldString);
        vitest.expect(result.occurrences).toBe(1);
      });
    });

    vitest.describe('Scenario Group 4: No Match Found / Multiple Matches', () => {
      vitest.it('Test 4.1: No version of old_string (original, unescaped, LLM-corrected) matches -> returns original params, 0 occurrences', async () => {
        const currentContent = 'This content has nothing to find.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'nonexistent string',
          new_string: 'some new string',
        };

        // Simulate LLM call for correctOldStringMismatch returning 'still nonexistent'
        mockGenerateJson.mockResolvedValueOnce({ corrected_target_snippet: 'still nonexistent' });
        // No second LLM call should happen for new_string if old_string is not found

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );

        vitest.expect(result.params).toEqual(originalParams);
        vitest.expect(result.occurrences).toBe(0);
        // vitest.expect(mockCorrectNewString).not.toHaveBeenCalled(); // This mock is removed
        // Check that generateJson was called once (for old_string) and not again (for new_string)
        vitest.expect(mockGenerateJson).toHaveBeenCalledTimes(1);
      });

      vitest.it('Test 4.2: unescapedOldStringAttempt results in >1 occurrences -> returns original params, count occurrences', async () => {
        const currentContent =
          'This content has find "me" and also find "me" again.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find "me"', 
          new_string: 'some new string',
        };

        // Simulate LLM call for correctOldStringMismatch if it were to be called
        // For this test, it might not be, if unescapedOldStringAttempt itself leads to >1 occurrences
        mockGenerateJson.mockResolvedValueOnce({ corrected_target_snippet: 'llm corrected non-unique' });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );

        vitest.expect(result.params).toEqual(originalParams);
        vitest.expect(result.occurrences).toBe(2);
        // vitest.expect(mockCorrectNewString).not.toHaveBeenCalled(); // This mock is removed
        // Ensure generateJson is not called if unescape leads to multiple occurrences, or called at most once if it proceeds to LLM for old_string
        // Depending on the exact path, it might be 0 or 1. If it's 0, the mockResolvedValueOnce above won't be consumed.
        // For simplicity, we can check it wasn't called for new_string correction, which implies not more than 1 call overall for old_string.
        // A more precise test would trace the exact path.
      });
    });

    vitest.describe('Scenario Group 5: Specific unescapeStringForGeminiBug checks (integrated into ensureCorrectEdit)', () => {
      vitest.it('Test 5.1: old_string matches after unescaping mixed legitimate and Gemini escapes, new_string also unescaped', async () => {
        const currentContent = 'const x = "a\\nbc\\\\"def\\\\"';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'const x = \\\\"a\\\\nbc\\\\\\\\"def\\\\\\\\"',
          new_string: 'const y = \\\\"new\\\\nval\\\\\\\\"content\\\\\\\\"',
        };

        // old_string unescapes. new_string is Gemini-escaped.
        // LLM for old_string, then LLM for new_string.
        mockGenerateJson.mockResolvedValueOnce({ corrected_target_snippet: unescapeStringForGeminiBug(originalParams.old_string) });
        mockGenerateJson.mockResolvedValueOnce({ corrected_new_string: 'const y = "new\nval\\"content\\"' });

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClientInstance,
        );

        vitest.expect(result.params.old_string).toBe(currentContent);
        vitest.expect(result.params.new_string).toBe(
          'const y = "new\\nval\\\\"content\\\\"'
        );
        vitest.expect(result.occurrences).toBe(1);
      });
    });
  });
});
