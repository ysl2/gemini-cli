#!/bin/bash
# Copyright 2025 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0


# This script creates an alias for the Gemini CLI

# Determine the project directory
PROJECT_DIR=$(cd "$(dirname "$0")/.." && pwd)
ALIAS_COMMAND="alias gemini='node $PROJECT_DIR/scripts/start.js'"

# Detect shell and set config file path
if [[ "$SHELL" == *"/bash" ]]; then
    CONFIG_FILE="$HOME/.bashrc"
elif [[ "$SHELL" == *"/zsh" ]]; then
    CONFIG_FILE="$HOME/.zshrc"
else
    echo "Unsupported shell. Only bash and zsh are supported."
    exit 1
fi

echo "This script will add the following alias to your shell configuration file ($CONFIG_FILE):"
echo "  $ALIAS_COMMAND"
echo ""

# Check if the alias already exists
if grep -q "alias gemini=" "$CONFIG_FILE"; then
    echo "A 'gemini' alias already exists in $CONFIG_FILE. No changes were made."
    exit 0
fi

read -p "Do you want to proceed? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "$ALIAS_COMMAND" >> "$CONFIG_FILE"
    echo ""
    echo "Alias added to $CONFIG_FILE."
    echo "Please run 'source $CONFIG_FILE' or open a new terminal to use the 'gemini' command."
else
    echo "Aborted. No changes were made."
fi
