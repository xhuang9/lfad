#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { computeNextVersion, parseCommits, renderChangelogSection } from '../packages/runtime/dist/index.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginPath = resolve(root, 'plugins/lfad/.claude-plugin/plugin.json')
const marketplacePath = resolve(root, '.claude-plugin/marketplace.json')
const changelogPath = resolve(root, 'CHANGELOG.md')
const dryRun = process.argv.includes('--dry-run')

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', ...options }).trim()
}

let lastTag = null
try {
  lastTag = git(['describe', '--tags', '--abbrev=0'], { stdio: ['ignore', 'pipe', 'ignore'] })
} catch {
  // The first release intentionally aggregates the repository's complete history.
}

const range = lastTag ? [`${lastTag}..HEAD`] : []
const entries = parseCommits(git(['log', '--pretty=%s', ...range]))
const plugin = JSON.parse(readFileSync(pluginPath, 'utf8'))
const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'))
const nextVersion = computeNextVersion(entries, plugin.version)
const section = renderChangelogSection(nextVersion, new Date().toISOString().slice(0, 10), entries)

console.log(`Release ${plugin.version} -> ${nextVersion}`)
console.log(section)

if (!dryRun) {
  plugin.version = nextVersion
  marketplace.metadata.version = nextVersion
  writeFileSync(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`)
  writeFileSync(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`)
  writeFileSync(changelogPath, `# Changelog\n\nAll notable changes to this project will be documented in this file.\n\nThe format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),\nand this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).\n\n${section}`)
}

console.log(`git tag v${nextVersion}`)
