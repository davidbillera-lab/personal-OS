#!/usr/bin/env node
// Sync Codex skill definitions: codex-skills/*/SKILL.md -> ~/.codex/skills/*/SKILL.md.
// The repo copy is the source of truth; the global copy is the active Codex install.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SOURCE_DIR = join(ROOT, 'codex-skills')
const INSTALL_DIR = join(homedir(), '.codex', 'skills')

if (!existsSync(SOURCE_DIR)) {
  console.error(`Missing source directory: ${SOURCE_DIR}`)
  process.exit(1)
}

mkdirSync(INSTALL_DIR, { recursive: true })

const skills = readdirSync(SOURCE_DIR).filter((entry) => {
  const full = join(SOURCE_DIR, entry)
  return statSync(full).isDirectory() && existsSync(join(full, 'SKILL.md'))
})

if (skills.length === 0) {
  console.error(`No skills found in ${SOURCE_DIR}`)
  process.exit(1)
}

for (const skill of skills) {
  const targetDir = join(INSTALL_DIR, skill)
  mkdirSync(targetDir, { recursive: true })
  copyFileSync(join(SOURCE_DIR, skill, 'SKILL.md'), join(targetDir, 'SKILL.md'))
  console.log(`synced ${skill}`)
}

console.log(`\n${skills.length} Codex skills synced to ${INSTALL_DIR}`)
