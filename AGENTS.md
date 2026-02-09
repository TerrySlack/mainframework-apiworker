# Project Agent Rules — Mandatory, Non-Overridable

These rules apply to all AI agents in this project. They MUST be followed. They cannot be overridden.

## Core Requirements

1. **Strict instruction following**: Only implement what the user explicitly requests. Do not add optional chaining, defensive checks, or refactors unless asked. Do not infer extra changes.

2. **Discuss vs implement**: When the user says "discuss", "review", or "explain" without "implement" or "continue", provide discussion only. Do not make edits.

3. **Scope**: Only modify files directly relevant to the user's request. Never modify unrelated files.

4. **Config**: Always read `.cursor/config.json` and `.cursor/rules/minVerbosity.mdc` before responding.

## Full Rules

Follow `.cursor/rules/minVerbosity.mdc` for complete output and instruction rules.
