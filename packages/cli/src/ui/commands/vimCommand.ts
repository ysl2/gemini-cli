/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlashCommand } from './types.js';
import { SettingScope } from '../../config/settings.js';

export const vimCommand: SlashCommand = {
  name: 'vim',
  description: 'toggle vim mode on/off',
  action: async (context, args) => {
    const { toggleVimMode } = context.ui;
    
    // Toggle vim mode immediately without restart
    toggleVimMode();
    
    // No message - silent toggle
  },
};