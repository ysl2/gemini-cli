/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Content,
  GenerateContentConfig,
  SchemaUnion,
  Type,
} from '@google/genai';
import { GeminiClient } from '../core/client.js';
import { EditToolParams } from '../tools/edit.js';

const EditModel = 'gemini-2.5-flash-preview-04-17';
const EditConfig: GenerateContentConfig = {
  thinkingConfig: {
    thinkingBudget: 0,
  },
};

/**
 * Counts occurrences of a substring in a string
 */
export function countOccurrences(str: string, substr: string): number {
  if (substr === '') {
    return 0;
  }
  let count = 0;
  let pos = str.indexOf(substr);
  while (pos !== -1) {
    count++;
    pos = str.indexOf(substr, pos + substr.length); // Start search after the current match
  }
  return count;
}

/**
 * Attempts to correct edit parameters if the original old_string is not found.
 * It tries unescaping, and then LLM-based correction.
 *
 * @param currentContent The current content of the file.
 * @param params The original EditToolParams.
 * @param client The GeminiClient for LLM calls.
 * @returns A promise resolving to an object containing the (potentially corrected) EditToolParams and the final occurrences count.
 */
export async function ensureCorrectEdit(
  currentContent: string,
  originalParams: EditToolParams,
  client: GeminiClient,
): Promise<CorrectedEditResult> {
  let finalNewString = originalParams.new_string;
  const newStringPotentiallyEscaped = unescapeStringForGeminiBug(originalParams.new_string) !== originalParams.new_string;

  let finalOldString = originalParams.old_string;
  let occurrences = countOccurrences(currentContent, finalOldString);

  if (occurrences === 1) {
    // originalParams.old_string is good, use it with the (conditionally) unescaped new_string.

    // If our new string is potentially escaped then we should double check it's not a tool calling Gemini escaping issue with an LLM call.
    if (newStringPotentiallyEscaped) {
      finalNewString = await correctNewStringEscaping(
        client,
        finalOldString, // This is originalParams.old_string at this point
        originalParams.new_string, // The original new_string that might be badly escaped
      );
    }

    return {
      params: {
        file_path: originalParams.file_path,
        old_string: finalOldString,
        new_string: finalNewString,
      },
      occurrences,
    };
  } else if (occurrences > 1) {
    // Already mathcing more than we can handle, bail early.
    return { params: originalParams, occurrences };
  }

  // Try unescaping old_string
  const unescapedOldStringAttempt = unescapeStringForGeminiBug(
    originalParams.old_string,
  );
  occurrences = countOccurrences(currentContent, unescapedOldStringAttempt);

  if (occurrences === 1) {
    finalOldString = unescapedOldStringAttempt;

    // If our new string is potentially escaped then we should double check it's not a tool calling Gemini escaping issue with an LLM call.
    if (newStringPotentiallyEscaped) {
      finalNewString = await correctNewString(
        client,
        originalParams.old_string,
        unescapedOldStringAttempt,
        originalParams.new_string,
      );
    }
  } else if (occurrences === 0) {
    // LLM correction for old_string
    const llmCorrectedOldString = await correctOldStringMismatch(
      client,
      currentContent,
      unescapedOldStringAttempt, // Pass the already unescaped old_string attempt
    );
    const llmOldOccurrences = countOccurrences(
      currentContent,
      llmCorrectedOldString,
    );

    if (llmOldOccurrences === 1) {
      finalOldString = llmCorrectedOldString;
      // Now, correct new_string based on the changes to old_string.
      // The new_string passed to correctNewString should be the one that corresponds to the successful old_string strategy.
      // If unescapedOldStringAttempt led to llmCorrectedOldString, then new_string should also be unescaped.
      const baseNewStringForLLMCorrection = unescapeStringForGeminiBug(
        originalParams.new_string,
      );

      const llmCorrectedNewString = await correctNewString(
        client,
        unescapedOldStringAttempt, // The version of old_string before LLM correction
        llmCorrectedOldString,
        baseNewStringForLLMCorrection, // Use the unescaped new_string as base for LLM
      );

      const trimmedLlmCorrectedOldString = llmCorrectedOldString.trim();
      const trmmedLlmOldOccurrences = countOccurrences(
        currentContent,
        trimmedLlmCorrectedOldString,
      );

      if (trmmedLlmOldOccurrences === 1) {
        // Trimmed content still resulted in a match, lets trim both the new and old. The LLM will typically space things out unnecessarily
        finalOldString = trimmedLlmCorrectedOldString;
        finalNewString = llmCorrectedNewString.trim();
      } else {
        finalNewString = llmCorrectedNewString;
      }

      occurrences = 1; // We have a success case here
    } else {
      // LLM correction also failed to find a unique match for old_string
      // Return original params (original old_string, and original new_string) and 0 occurrences
      return { params: originalParams, occurrences: 0 };
    }
  } else {
    // Unescaping old_string resulted in >1 occurrences
    // Return original params (original old_string, and original new_string) and the >1 count.
    return { params: originalParams, occurrences };
  }

  return {
    params: {
      file_path: originalParams.file_path,
      old_string: finalOldString,
      new_string: finalNewString,
    },
    occurrences,
  };
}

/**
 * Attempts to correct potential formatting/escaping issues in a snippet using an LLM call.
 */
export async function correctOldStringMismatch(
  geminiClient: GeminiClient,
  fileContent: string,
  problematicSnippet: string,
): Promise<string> {
  const prompt = `
Context: A process needs to find an exact literal, unique match for a specific text snippet within a file's content. The provided snippet failed to match exactly. This is most likely because it has been overly escaped.

Task: Analyze the provided file content and the problematic target snippet. Identify the segment in the file content that the snippet was *most likely* intended to match. Output the *exact*, literal text of that segment from the file content. Focus *only* on removing extra escape characters and correcting formatting, whitespace, or minor differences to achieve a PERFECT literal match. The output must be the exact literal text as it appears in the file.

Problematic target snippet:
\`\`\`
${problematicSnippet}
\`\`\`

File Content:
\`\`\`
${fileContent}
\`\`\`

For example, if the problematic target snippet was "\\\\\\nconst greeting = \`Hello \\\\\`\${name}\\\\\`\`;" and the file content had content that looked like "\nconst greeting = \`Hello ${'\\`'}\${name}${'\\`'}\`;", then corrected_target_snippet should likely be "\nconst greeting = \`Hello ${'\\`'}\${name}${'\\`'}\`;" to fix the incorrect escaping to match the original file content.
If the differences are only in whitespace or formatting, apply similar whitespace/formatting changes to the corrected_target_snippet.

Return ONLY the corrected target snippet in the specified JSON format with the key 'corrected_target_snippet'. If no clear, unique match can be found, return an empty string for 'corrected_target_snippet'.
`.trim();

  const contents: Content[] = [{ role: 'user', parts: [{ text: prompt }] }];

  try {
    const result = await geminiClient.generateJson(
      contents,
      OLD_STRING_CORRECTION_SCHEMA,
      EditModel,
      EditConfig,
    );

    if (
      result &&
      typeof result.corrected_target_snippet === 'string' &&
      result.corrected_target_snippet.length > 0
    ) {
      return result.corrected_target_snippet;
    } else {
      return problematicSnippet;
    }
  } catch (error) {
    console.error(
      'Error during LLM call for old string snippet correction:',
      error,
    );
    return problematicSnippet;
  }
}

/**
 * Adjusts the new_string to align with a corrected old_string, maintaining the original intent.
 */
export async function correctNewString(
  geminiClient: GeminiClient,
  originalOldString: string,
  correctedOldString: string,
  originalNewString: string,
): Promise<string> {
  if (originalOldString === correctedOldString) {
    return originalNewString;
  }
  
  const prompt = `
Context: A text replacement operation was planned. The original text to be replaced (original_old_string) was slightly different from the actual text in the file (corrected_old_string). The original_old_string has now been corrected to match the file content.
We now need to adjust the replacement text (original_new_string) so that it makes sense as a replacement for the corrected_old_string, while preserving the original intent of the change.

original_old_string (what was initially intended to be found):
\`\`\`
${originalOldString}
\`\`\`

corrected_old_string (what was actually found in the file and will be replaced):
\`\`\`
${correctedOldString}
\`\`\`

original_new_string (what was intended to replace original_old_string):
\`\`\`
${originalNewString}
\`\`\`

Task: Based on the differences between original_old_string and corrected_old_string, and the content of original_new_string, generate a corrected_new_string. This corrected_new_string should be what original_new_string would have been if it was designed to replace corrected_old_string directly, while maintaining the spirit of the original transformation.

For example, if original_old_string was "\\\\\\nconst greeting = \`Hello \\\\\`\${name}\\\\\`\`;" and corrected_old_string is "\nconst greeting = \`Hello ${'\\`'}\${name}${'\\`'}\`;", and original_new_string was "\\\\\\nconst greeting = \`Hello \\\\\`\${name} \${lastName}\\\\\`\`;", then corrected_new_string should likely be "\nconst greeting = \`Hello ${'\\`'}\${name} \${lastName}${'\\`'}\`;" to fix the incorrect escaping.
If the differences are only in whitespace or formatting, apply similar whitespace/formatting changes to the corrected_new_string.

Return ONLY the corrected string in the specified JSON format with the key 'corrected_new_string'. If no adjustment is deemed necessary or possible, return the original_new_string.
  `.trim();

  const contents: Content[] = [{ role: 'user', parts: [{ text: prompt }] }];

  try {
    const result = await geminiClient.generateJson(
      contents,
      NEW_STRING_CORRECTION_SCHEMA,
      EditModel,
      EditConfig,
    );

    if (
      result &&
      typeof result.corrected_new_string === 'string' &&
      result.corrected_new_string.length > 0
    ) {
      return result.corrected_new_string;
    } else {
      return originalNewString;
    }
  } catch (error) {
    console.error('Error during LLM call for new_string correction:', error);
    return originalNewString;
  }
}

export interface CorrectedEditResult {
  params: EditToolParams;
  occurrences: number;
}

// Define the expected JSON schema for the LLM response for old_string correction
const OLD_STRING_CORRECTION_SCHEMA: SchemaUnion = {
  type: Type.OBJECT,
  properties: {
    corrected_target_snippet: {
      type: Type.STRING,
      description:
        'The corrected version of the target snippet that exactly and uniquely matches a segment within the provided file content.',
    },
  },
  required: ['corrected_target_snippet'],
};

// Define the expected JSON schema for the new_string correction LLM response
const NEW_STRING_CORRECTION_SCHEMA: SchemaUnion = {
  type: Type.OBJECT,
  properties: {
    corrected_new_string: {
      type: Type.STRING,
      description:
        'The original_new_string adjusted to be a suitable replacement for the corrected_old_string, while maintaining the original intent of the change.',
    },
  },
  required: ['corrected_new_string'],
};

// Define the expected JSON schema for the new_string escaping correction LLM response
const CORRECT_NEW_STRING_ESCAPING_SCHEMA: SchemaUnion = {
  type: Type.OBJECT,
  properties: {
    corrected_new_string_escaping: {
      type: Type.STRING,
      description:
        'The new_string with corrected escaping, ensuring it is a proper replacement for the old_string, especially considering potential over-escaping issues from previous LLM generations.',
    },
  },
  required: ['corrected_new_string_escaping'],
};

/**
 * Corrects the escaping of a new_string if it was potentially over-escaped by an LLM.
 */
export async function correctNewStringEscaping(
  geminiClient: GeminiClient,
  oldString: string, // The correctly matched old_string
  potentiallyProblematicNewString: string,
): Promise<string> {
  const prompt = `
Context: A text replacement operation is planned. The text to be replaced (old_string) has been correctly identified in the file. However, the replacement text (new_string) might have been improperly escaped by a previous LLM generation (e.g. too many backslashes for newlines like \\n instead of \n, or unnecessarily quotes like \\"Hello\\" instead of "Hello").

old_string (this is the exact text that will be replaced):
\`\`\`
${oldString}
\`\`\`

potentially_problematic_new_string (this is the text that should replace old_string, but MIGHT have bad escaping, or might be entirely correct):
\`\`\`
${potentiallyProblematicNewString}
\`\`\`

Task: Analyze the potentially_problematic_new_string. If it's syntactically invalid due to incorrect escaping (e.g., "\n", "\t", "\\", "\\'", "\\""), correct the invalid syntax. The goal is to ensure the new_string, when inserted into the code, will be a valid and correctly interpreted.

For example, if old_string is "foo" and potentially_problematic_new_string is "bar\\nbaz", the corrected_new_string_escaping should be "bar\nbaz".
If potentially_problematic_new_string is console.log(\\"Hello World\\"), it should be console.log("Hello World").

Return ONLY the corrected string in the specified JSON format with the key 'corrected_new_string_escaping'. If no escaping correction is needed, return the original potentially_problematic_new_string.
  `.trim();

  const contents: Content[] = [{role: 'user', parts: [{text: prompt}]}];

  try {
    const result = await geminiClient.generateJson(
      contents,
      CORRECT_NEW_STRING_ESCAPING_SCHEMA,
      EditModel,
      EditConfig,
    );

    if (
      result &&
      typeof result.corrected_new_string_escaping === 'string' &&
      result.corrected_new_string_escaping.length > 0
    ) {
      return result.corrected_new_string_escaping;
    } else {
      return potentiallyProblematicNewString;
    }
  } catch (error) {
    console.error(
      'Error during LLM call for new_string escaping correction:',
      error,
    );
    return potentiallyProblematicNewString;
  }
}
export function unescapeStringForGeminiBug(inputString: string): string {
  // Regex explanation:
  // \\{2,} : Matches two or more literal backslash characters. This is to target sequences like \\n, \\\\n, etc.
  //          We use {2,} because a single backslash followed by n (e.g., in C:\name) is usually NOT an escape needing correction here.
  // (n|t|r|'|"|`|\\|\n) : This is a capturing group. It matches one of the following:
  //   n, t, r, ', ", ` : Literal characters for common escapes.
  //   \\                : A literal backslash. This handles cases like \\\\ -> \\
  //   \n                : An actual newline character. This handles cases like \\\\n (two backslashes then a newline char).
  // g : Global flag, to replace all occurrences.

  // First, handle the \\ -> \\ case specifically for sequences of EXACTLY two backslashes followed by our target chars.
  // This is because \\n should become \n, but \n (already correct) should not be touched by this specific rule.
  let result = inputString.replace(/\\\\(n|t|r|'|"|`|\\)/g, (_match, capturedChar) => {
    return capturedChar; // Just return the character itself, effectively removing one backslash
  });

  // Then, handle more complex over-escapes like \\\\n -> \n or \\\n (backslash + newline) -> \n
  // This regex looks for 1 or more backslashes \\+ followed by n, t, r, ', ", `, or a literal newline \n
  result = result.replace(/\\+(n|t|r|'|"|`|\n)/g, (match, capturedChar) => {
    // 'match' is the entire erroneous sequence, e.g., if the input (in memory) was "\\\\`", match is "\\\\`".
    // 'capturedChar' is the character that determines the true meaning, e.g., '`'.
    switch (capturedChar) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case "'":
        return "'";
      case '"':
        return '"';
      case '`':
        return '`';
      case '\n': // This handles when 'capturedChar' is an actual newline
        return '\n';
      default:
        return match;
    }
  });
  return result;
}
