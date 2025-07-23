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
    const { updateSetting } = context.ui;
    const { settings } = context.services;

    const currentVimMode = settings.merged.vimMode ?? false;
    await updateSetting('vimMode', !currentVimMode);

    // No message - silent toggle
  },
};
