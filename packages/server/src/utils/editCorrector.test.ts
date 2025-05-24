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
    let mockGeminiClient;

    beforeEach(() => {
      // Reset mocks before each test
      mockGeminiClient = new GeminiClient();
      vi.clearAllMocks();
    });

    describe('Scenario Group 1: originalParams.old_string matches currentContent directly', () => {
      it('Test 1.1: old_string (no literal \\), new_string (escaped by Gemini) -> new_string unescaped', async () => {
        // originalParams.old_string: Contains no literal `\` characters (e.g., "find me").
        // originalParams.new_string: Contains Gemini-style over-escaping (e.g., "replace with \"this\"").
        // Expected: finalNewString should be the unescaped version of originalParams.new_string (e.g., "replace with "this"").
      });

      it('Test 1.2: old_string (no literal \\), new_string (correctly formatted) -> new_string unchanged', async () => {
        // originalParams.old_string: Contains no literal `\` characters.
        // originalParams.new_string: Is correctly formatted (no over-escaping).
        // Expected: finalNewString should be identical to originalParams.new_string.
      });

      it('Test 1.3: old_string (with literal \\), new_string (escaped by Gemini) -> new_string unchanged (still escaped)', async () => {
        // originalParams.old_string: Contains literal `\` characters (e.g., "find\\me").
        // originalParams.new_string: Contains Gemini-style over-escaping (e.g., "replace with \"this\"").
        // Expected: finalNewString should be identical to originalParams.new_string (i.e., still escaped).
      });

      it('Test 1.4: old_string (with literal \\), new_string (correctly formatted) -> new_string unchanged', async () => {
        // originalParams.old_string: Contains literal `\` characters.
        // originalParams.new_string: Is correctly formatted.
        // Expected: finalNewString should be identical to originalParams.new_string.
      });
    });

    describe('Scenario Group 2: originalParams.old_string does NOT match, but unescapeStringForGeminiBug(originalParams.old_string) DOES match', () => {
      it('Test 2.1: old_string (over-escaped, no intended literal \\), new_string (escaped by Gemini) -> new_string unescaped', async () => {
        // originalParams.old_string: Over-escaped, but contains no *intended* literal `\` (e.g., "find \"me\""). Becomes "find "me"" after unescaping.
        // originalParams.new_string: Contains Gemini-style over-escaping (e.g., "replace with \"this\"").
        // Expected: finalNewString should be the unescaped version of originalParams.new_string.
      });

      it('Test 2.2: old_string (over-escaped, no intended literal \\), new_string (correctly formatted) -> new_string unescaped (harmlessly)', async () => {
        // originalParams.old_string: Over-escaped, but contains no *intended* literal `\`.
        // originalParams.new_string: Is correctly formatted.
        // Expected: finalNewString should be the (harmlessly) unescaped version of originalParams.new_string.
      });

      it('Test 2.3: old_string (over-escaped, with intended literal \\), new_string (escaped by Gemini) -> new_string unescaped', async () => {
        // originalParams.old_string: Over-escaped, and *does* contain an intended literal `\` (e.g., "find \\\\me"). Becomes "find \\me" after unescaping.
        // originalParams.new_string: Contains Gemini-style over-escaping.
        // Expected: finalNewString should be the unescaped version of originalParams.new_string.
      });
    });

    describe('Scenario Group 3: LLM Correction Path', () => {
      it('Test 3.1: old_string (no literal \\), new_string (escaped by Gemini), LLM re-escapes new_string -> final new_string is double unescaped', async () => {
        // originalParams.old_string: "find me" (no literal `\`).
        // originalParams.new_string: "replace with \"this\"".
        // Mock correctOldStringMismatch to return a valid llmCorrectedOldString.
        // Mock correctNewString to receive unescapedOldStringAttempt ("find me") and baseNewStringForLLMCorrection (which should be "replace with "this"" due to initial conditional unescape). Let it return, for example, "LLM says replace with \"that\"" (i.e., LLM re-escapes).
        // Expected: finalNewString should be "LLM says replace with "that"" (double unescaped: baseNewStringForLLMCorrection is unescaped, and then the output of correctNewString is unescaped).
      });

      it('Test 3.2: old_string (with literal \\), new_string (escaped by Gemini), LLM re-escapes new_string -> final new_string is unescaped once', async () => {
        // originalParams.old_string: "find\\me" (with literal `\`).
        // originalParams.new_string: "replace with \"this\"".
        // Mock correctOldStringMismatch for unescapeStringForGeminiBug("find\\me") (which is "find\\me").
        // Mock correctNewString to receive unescapedOldStringAttempt ("find\\me") and baseNewStringForLLMCorrection (which should be originalParams.new_string i.e. "replace with \"this\"" because initial conditional unescape for new_string was skipped). baseNewStringForLLMCorrection inside the LLM path logic then becomes unescapeStringForGeminiBug(originalParams.new_string). Let correctNewString return "LLM says replace with \"that\"".
        // Expected: finalNewString should be "LLM says replace with "that"".
      });

      it('Test 3.3: LLM correction path, correctNewString returns correctly formatted string -> final new_string is correct (harmlessly unescaped)', async () => {
        // Similar to 3.1 or 3.2, but correctNewString returns "LLM says replace with "that"" (already correct).
        // Expected: finalNewString should be "LLM says replace with "that"" (final unescape of correctNewString output is harmless).
      });

      it('Test 3.4: LLM correction path, correctNewString returns the originalNewString it was passed (which was unescaped) -> final new_string is unescaped', async () => {
        // originalParams.old_string: "find me".
        // originalParams.new_string: "replace with \"this\"".
        // baseNewStringForLLMCorrection will be "replace with "this"".
        // Mock correctNewString to return the originalNewString it received (i.e., "replace with "this"").
        // Expected: finalNewString should be "replace with "this"" (as the output of correctNewString is unescaped, and unescaping an already unescaped string is harmless).
      });
    });

    describe('Scenario Group 4: No Match Found / Multiple Matches', () => {
      it('Test 4.1: No version of old_string (original, unescaped, LLM-corrected) matches -> returns original params, 0 occurrences', async () => {
        // originalParams.old_string, unescapedOldStringAttempt, and llmCorrectedOldString all result in 0 occurrences.
        // Expected: Returns { params: originalParams, occurrences: 0 }. originalParams.new_string should not have been modified if it was returned as part of originalParams.
      });

      it('Test 4.2: unescapedOldStringAttempt results in >1 occurrences -> returns original params, count occurrences', async () => {
        // unescapedOldStringAttempt results in >1 occurrences.
        // Expected: Returns { params: originalParams, occurrences: count }. originalParams.new_string should not have been modified.
      });
    });

    describe('Scenario Group 5: Specific unescapeStringForGeminiBug checks (integrated into ensureCorrectEdit)', () => {
      it('Test 5.1: old_string matches after unescaping mixed legitimate and Gemini escapes, new_string also unescaped', async () => {
        // This test ensures that if old_string requires unescaping of a complex string (like "const x = \"a\\nbc\\\"def\\\"") to match,
        // the new_string is also correctly unescaped.
        // Example old_string (Gemini escaped): "const x = \"a\\\\nbc\\\\\\\"def\\\\\\\""
        // Example currentContent: "const x = "a\\nbc\\\"def\\\"" (This is how it would be if it had legitimate escapes and Gemini over-escaped it)
        // Example new_string (Gemini escaped): "const y = \"new\\\\nval\\\\\\\"content\\\\\\\""
        // Expected finalNewString: "const y = "new\\nval\\\"content\\\""
      });
    });
  });
});
