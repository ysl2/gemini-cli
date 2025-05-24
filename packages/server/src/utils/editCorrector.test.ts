/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  countOccurrences,
  ensureCorrectEdit,
  unescapeStringForGeminiBug,
} from './editCorrector.js';
import { GeminiClient } from '../core/client.js';

// Mock GeminiClient
vi.mock('../core/client.js', () => {
  const GeminiClient = vi.fn();
  GeminiClient.prototype.generateJson = vi.fn();
  GeminiClient.prototype.correctOldStringMismatch = vi.fn();
  GeminiClient.prototype.correctNewString = vi.fn();
  return { GeminiClient };
});

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
      expect(countOccurrences('aaaaa', 'aa')).toBe(2); // Non-overlapping: aa_aa_
      expect(countOccurrences('ababab', 'aba')).toBe(1); // Non-overlapping: aba_ab -> 1
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
      expect(unescapeStringForGeminiBug('\\\\n')).toBe('\n'); // \\n -> \n

      expect(unescapeStringForGeminiBug('\\\\\\t')).toBe('\t'); // \\\t -> \t
      expect(unescapeStringForGeminiBug('\\\\\\\\`')).toBe('`'); // \\\\` -> `
    });

    it('should return empty string for empty input', () => {
      expect(unescapeStringForGeminiBug('')).toBe('');
    });

    it('should not alter strings with no targeted escape sequences', () => {
      expect(unescapeStringForGeminiBug('abc def')).toBe('abc def');
      // \\F and \\S are not targeted escapes, so they should remain as \\F and \\S
      expect(unescapeStringForGeminiBug('C:\\Folder\\File')).toBe(
        'C:\\Folder\\File',
      );
    });

    it('should correctly process strings with some targeted escapes', () => {
      // \\U is not targeted, \\n is.
      expect(unescapeStringForGeminiBug('C:\\Users\\name')).toBe(
        'C:\\Users\name',
      );
    });

    it('should handle complex cases with mixed slashes and characters', () => {
      expect(
        unescapeStringForGeminiBug('\\\\\\nLine1\\\nLine2\\tTab\\\\`Tick\\"'),
      ).toBe('\nLine1\nLine2\tTab`Tick"');
    });
  });

  describe('ensureCorrectEdit', () => {
    // Mock GeminiClient instance
    let mockGeminiClient: vi.Mocked<GeminiClient>;

    beforeEach(() => {
      // Reset mocks before each test
      mockGeminiClient = new GeminiClient({
        apiKey: 'test-api-key',
      }) as vi.Mocked<GeminiClient>;
      vi.clearAllMocks();
    });

    describe('Scenario Group 1: originalParams.old_string matches currentContent directly', () => {
      it('Test 1.1: old_string (no literal \\), new_string (escaped by Gemini) -> new_string unescaped', async () => {
        const currentContent = 'This is a test string to find me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find me',
          new_string: 'replace with \\\\"this\\\\"',
        };
        mockGeminiClient.correctOldStringMismatch.mockResolvedValue(
          'find me',
        );

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClient,
        );

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
        mockGeminiClient.correctOldStringMismatch.mockResolvedValue(
          'find me',
        );

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClient,
        );

        expect(result.params.new_string).toBe('replace with this');
        expect(result.params.old_string).toBe('find me');
        expect(result.occurrences).toBe(1);
      });

      it('Test 1.3: old_string (with literal \\), new_string (escaped by Gemini) -> new_string unchanged (still escaped)', async () => {
        const currentContent = 'This is a test string to find\\me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find\\me',
          new_string: 'replace with \\\\"this\\\\"',
        };
        mockGeminiClient.correctOldStringMismatch.mockResolvedValue(
          'find\\me',
        );

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClient,
        );

        expect(result.params.new_string).toBe('replace with \\\\"this\\\\"');
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
        mockGeminiClient.correctOldStringMismatch.mockResolvedValue(
          'find\\me',
        );

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClient,
        );

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
          old_string: 'find \\\\"me\\\\"',
          new_string: 'replace with \\\\"this\\\\"',
        };
        // Mock LLM correction path to not be taken for this test
        mockGeminiClient.correctOldStringMismatch.mockResolvedValue(
          unescapeStringForGeminiBug(originalParams.old_string),
        );

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClient,
        );

        expect(result.params.new_string).toBe('replace with "this"');
        expect(result.params.old_string).toBe('find "me"');
        expect(result.occurrences).toBe(1);
      });

      it('Test 2.2: old_string (over-escaped, no intended literal \\), new_string (correctly formatted) -> new_string unescaped (harmlessly)', async () => {
        const currentContent = 'This is a test string to find "me".';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find \\\\"me\\\\"', // "find \"me\""
          new_string: 'replace with this',
        };
        mockGeminiClient.correctOldStringMismatch.mockResolvedValue(
          unescapeStringForGeminiBug(originalParams.old_string),
        );

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClient,
        );

        expect(result.params.new_string).toBe('replace with this');
        expect(result.params.old_string).toBe('find "me"');
        expect(result.occurrences).toBe(1);
      });

      it('Test 2.3: old_string (over-escaped, with intended literal \\), new_string (escaped by Gemini) -> new_string unescaped', async () => {
        const currentContent = 'This is a test string to find \\me.'; // Content has one literal backslash
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find \\\\\\\\me', // "find \\\\me" -> unescapes to "find \\me"
          new_string: 'replace with \\\\"this\\\\"', // "replace with \"this\""
        };
        mockGeminiClient.correctOldStringMismatch.mockResolvedValue(
          unescapeStringForGeminiBug(originalParams.old_string),
        );

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClient,
        );

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
        const llmNewString = 'LLM says replace with \\\\"that\\\\"';

        mockGeminiClient.correctOldStringMismatch.mockResolvedValue(
          llmCorrectedOldString,
        );
        mockGeminiClient.correctNewString.mockResolvedValue(llmNewString);

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClient,
        );

        expect(mockGeminiClient.correctOldStringMismatch).toHaveBeenCalledWith(
          currentContent,
          originalParams.old_string,
          unescapeStringForGeminiBug(originalParams.old_string),
        );
        expect(mockGeminiClient.correctNewString).toHaveBeenCalledWith(
          currentContent,
          llmCorrectedOldString, // it should be called with the version of old_string that matches
          unescapeStringForGeminiBug(originalParams.new_string), // new_string is unescaped because original old_string had no literal backslash
        );
        expect(result.params.new_string).toBe('LLM says replace with "that"');
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
        const llmNewString = 'LLM says replace with \\\\"that\\\\"';

        mockGeminiClient.correctOldStringMismatch.mockResolvedValue(
          llmCorrectedOldString,
        );
        mockGeminiClient.correctNewString.mockResolvedValue(llmNewString);

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClient,
        );
        expect(mockGeminiClient.correctOldStringMismatch).toHaveBeenCalledWith(
          currentContent,
          originalParams.old_string,
          unescapeStringForGeminiBug(originalParams.old_string),
        );
        expect(mockGeminiClient.correctNewString).toHaveBeenCalledWith(
          currentContent,
          llmCorrectedOldString,
          originalParams.new_string, // new_string is NOT unescaped because original old_string HAD a literal backslash
        );
        expect(result.params.new_string).toBe('LLM says replace with "that"');
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
        const llmNewString = 'LLM says replace with "that"'; // Correctly formatted

        mockGeminiClient.correctOldStringMismatch.mockResolvedValue(
          llmCorrectedOldString,
        );
        mockGeminiClient.correctNewString.mockResolvedValue(llmNewString);

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClient,
        );

        expect(mockGeminiClient.correctNewString).toHaveBeenCalledWith(
          currentContent,
          llmCorrectedOldString,
          unescapeStringForGeminiBug(originalParams.new_string), // "replace with "this""
        );
        expect(result.params.new_string).toBe('LLM says replace with "that"');
        expect(result.params.old_string).toBe(llmCorrectedOldString);
        expect(result.occurrences).toBe(1);
      });

      it('Test 3.4: LLM correction path, correctNewString returns the originalNewString it was passed (which was unescaped) -> final new_string is unescaped', async () => {
        const currentContent = 'This is a test string to corrected find me.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find me',
          new_string: 'replace with \\\\"this\\\\"', // Gemini-escaped
        };
        const llmCorrectedOldString = 'corrected find me';
        // This is what correctNewString will be called with as new_string_to_correct, and what it will return
        const newStringForLLMAndReturnedByLLM = 'replace with "this"';

        mockGeminiClient.correctOldStringMismatch.mockResolvedValue(
          llmCorrectedOldString,
        );
        mockGeminiClient.correctNewString.mockResolvedValue(
          newStringForLLMAndReturnedByLLM,
        );

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClient,
        );

        expect(mockGeminiClient.correctNewString).toHaveBeenCalledWith(
          currentContent,
          llmCorrectedOldString,
          newStringForLLMAndReturnedByLLM, // Based on unescape(originalParams.new_string)
        );
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

        // Mock LLM correction to also return a non-matching string
        mockGeminiClient.correctOldStringMismatch.mockResolvedValue(
          'still nonexistent',
        );

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClient,
        );

        expect(result.params).toEqual(originalParams);
        expect(result.occurrences).toBe(0);
        expect(mockGeminiClient.correctNewString).not.toHaveBeenCalled();
      });

      it('Test 4.2: unescapedOldStringAttempt results in >1 occurrences -> returns original params, count occurrences', async () => {
        const currentContent =
          'This content has find "me" and also find "me" again.';
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'find "me"', // unescapes to 'find "me"'
          new_string: 'some new string',
        };

        // Mock LLM correction to simulate it doesn't find a unique match either
        mockGeminiClient.correctOldStringMismatch.mockResolvedValue(
          'llm corrected non-unique',
        );

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClient,
        );

        expect(result.params).toEqual(originalParams);
        // unescapedOldStringAttempt ('find "me"') occurs 2 times
        // originalParams.old_string ('find "me"') occurs 0 times
        // llmCorrectedOldString ('llm corrected non-unique') occurs 0 times
        // The function should report the occurrences of unescapedOldStringAttempt if it's > 1
        expect(result.occurrences).toBe(2);
        expect(mockGeminiClient.correctNewString).not.toHaveBeenCalled();
      });
    });

    describe('Scenario Group 5: Specific unescapeStringForGeminiBug checks (integrated into ensureCorrectEdit)', () => {
      it('Test 5.1: old_string matches after unescaping mixed legitimate and Gemini escapes, new_string also unescaped', async () => {
        const currentContent = 'const x = "a\\nbc\\\\"def\\\\"'; // Legitimate escapes
        const originalParams = {
          file_path: '/test/file.txt',
          old_string: 'const x = \\"a\\\\nbc\\\\\\\\"def\\\\\\\\"',
          new_string: 'const y = \\"new\\\\nval\\\\\\\\"content\\\\\\\\"',
        };

        // Mock LLM correction path to not be taken
        mockGeminiClient.correctOldStringMismatch.mockResolvedValue(
          unescapeStringForGeminiBug(originalParams.old_string),
        );

        const result = await ensureCorrectEdit(
          currentContent,
          originalParams,
          mockGeminiClient,
        );

        expect(result.params.old_string).toBe(currentContent);
        expect(result.params.new_string).toBe(
          'const y = "new\\nval\\\\"content\\\\"'
        );
        expect(result.occurrences).toBe(1);
      });
    });
  });
});
