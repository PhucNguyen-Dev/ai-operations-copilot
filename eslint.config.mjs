import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({ baseDirectory: __dirname })

const eslintConfig = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.next-build/**',
      'out/**',
      'build/**',
      'test-results/**',
      'playwright-report/**',
      'next-env.d.ts',
      // Other AI tools' worktrees inside the repo — not this project's source.
      '.kilo/**',
      '.freebuff/**',
      '.zcode/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
]

export default eslintConfig
