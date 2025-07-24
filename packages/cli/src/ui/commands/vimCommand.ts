/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommandKind, SlashCommand } from './types.js';

export const vimCommand: SlashCommand = {
  name: 'vim',
  description: 'toggle vim mode on/off',
  kind: CommandKind.BUILT_IN,
  action: async (context, _args) => {
    context.ui.toggleVimEnabled();
    // No message - silent toggle
  },
};
