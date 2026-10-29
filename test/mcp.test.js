import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executable = resolve(root, process.env.MCP_TEST_ENTRY || 'index.js');

test('the public executable negotiates MCP and executes shell tools', { timeout: 15000 }, async (t) => {
    const tempDir = resolve(root, '.tmp', 'mcp-test');
    await mkdir(tempDir, { recursive: true });
    const client = new Client({ name: 'dependency-regression', version: '1.0.0' });
    const transport = new StdioClientTransport({
        command: executable,
        cwd: root,
        env: { BASH_MCP_TEMP_DIR: tempDir, TMPDIR: tempDir },
        stderr: 'pipe'
    });
    t.after(() => client.close());
    await client.connect(transport);
    assert.equal(client.getServerVersion().name, 'bash-mcp');
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['kill_background', 'list_background', 'run', 'run_background']);

    const run = JSON.parse((await client.callTool({ name: 'run', arguments: { command: 'printf mcp-ok' } })).content[0].text);
    assert.equal(run.success, true);
    assert.equal(run.stdout, 'mcp-ok');
    const failed = JSON.parse((await client.callTool({ name: 'run', arguments: { command: 'printf mcp-error >&2; exit 7' } })).content[0].text);
    assert.equal(failed.success, false);
    assert.equal(failed.code, 7);
    assert.equal(failed.stderr, 'mcp-error');

    const background = JSON.parse((await client.callTool({ name: 'run_background', arguments: { command: 'exec sleep 30', name: 'dependency-regression' } })).content[0].text);
    assert.equal(background.success, true);
    const listed = JSON.parse((await client.callTool({ name: 'list_background', arguments: {} })).content[0].text);
    assert.equal(listed.count, 1);
    assert.equal(listed.processes[0].name, 'dependency-regression');
    const killed = JSON.parse((await client.callTool({ name: 'kill_background', arguments: { name: 'dependency-regression' } })).content[0].text);
    assert.equal(killed.success, true);
    const empty = JSON.parse((await client.callTool({ name: 'list_background', arguments: {} })).content[0].text);
    assert.equal(empty.count, 0);
});
