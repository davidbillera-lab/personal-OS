#!/usr/bin/env node
import { spawn } from 'child_process'
import { join } from 'path'

const cwd = new URL('..', import.meta.url).pathname.replace(/\/+$/, '')
const serverPath = './mcp-server.mjs'

function sendJson(child, msg) {
    child.stdin.write(JSON.stringify(msg) + '\n')
}

function makeMsg(id, method, params) {
    return { jsonrpc: '2.0', id, method, params }
}

async function run() {
    console.log('[handshake] spawning mcp-server.mjs')
    const child = spawn('node', [serverPath], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'inherit'] })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
        for (const line of chunk.split('\n').map(l => l.trim()).filter(Boolean)) {
            try {
                const msg = JSON.parse(line)
                console.log('[mcp-server] ->', JSON.stringify(msg))
            } catch (err) {
                console.log('[mcp-server] raw ->', line)
            }
        }
    })

    // Wait a short moment then send initialize
    await new Promise(r => setTimeout(r, 200))

    sendJson(child, makeMsg(1, 'initialize', {}))
    await new Promise(r => setTimeout(r, 200))

    // Request tools list
    sendJson(child, makeMsg(2, 'tools/list', {}))
    await new Promise(r => setTimeout(r, 400))

    // Call a simple tool: mc_list_skills
    sendJson(child, makeMsg(3, 'tools/call', { name: 'mc_list_skills', arguments: {} }))

    // Give server time to respond then exit
    setTimeout(() => {
        console.log('[handshake] done — exiting')
        child.stdin.end()
        child.kill()
        process.exit(0)
    }, 1500)
}

run().catch(err => {
    console.error('[handshake] error', err)
    process.exit(1)
})
