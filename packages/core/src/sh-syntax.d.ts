/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

declare module 'sh-syntax' {
  export interface File {
    Name: string;
    Stmts: unknown[];
    Pos: { Offset: number; Line: number; Col: number };
    End: { Offset: number; Line: number; Col: number };
  }

  export function parse(text: string, options?: unknown): Promise<File>;
  export function print(
    ast: File | string,
    options?: { originalText?: string },
  ): Promise<string>;
}
