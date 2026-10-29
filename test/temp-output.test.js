import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executable = resolve(root, process.env.MCP_TEST_ENTRY || 'index.js');
const timestamp = '2026-10-29T00-00-00-000Z';
const payload = 'a'.repeat(3000);

async function connect(t) {
    const temporary = join(root, '.tmp');
    await mkdir(temporary, { recursive: true });
    const directory = await mkdtemp(join(temporary, 'temp-security-'));
    const system = join(directory, 'system');
    const custom = join(directory, 'custom');
    await mkdir(system);
    await mkdir(custom);
    const clock = join(directory, 'clock.mjs');
    await writeFile(clock, `const OriginalDate = Date; globalThis.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : ['2026-10-29T00:00:00.000Z'])); } static now() { return 1793232000000; } };`);
    const client = new Client({ name: 'temporary-file-regression', version: '1.0.0' });
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [executable],
        cwd: root,
        env: {
            PATH: process.env.PATH,
            TMPDIR: system,
            BASH_MCP_TEMP_DIR: custom,
            BASH_MCP_MAX_OUTPUT_SIZE: '1024',
            NODE_OPTIONS: `--import=${pathToFileURL(clock).href}`,
        },
        stderr: 'pipe',
    });
    t.after(async () => {
        await client.close();
        await chmod(custom, 0o700);
        await rm(directory, { recursive: true });
    });
    await client.connect(transport);
    await client.callTool({ name: 'run', arguments: { command: 'printf ready' } });
    return { client, directory, system, custom };
}

async function call(client, name, args) {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content[0].text;
    try {
        return JSON.parse(text);
    } catch {
        const matches = [...text.matchAll(/\[Full output saved to: ([^\]\n]+)\]/g)];
        assert.ok(matches.length, text);
        return JSON.parse(await readFile(matches.at(-1)[1], 'utf8'));
    }
}

async function assertPrivate(file, parent) {
    assert.ok(file);
    assert.ok(!relative(parent, file).startsWith('..'), file);
    assert.notEqual(dirname(file), parent, 'output must be inside a private directory');
    assert.equal((await stat(dirname(file))).mode & 0o777, 0o700);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
}

for (const fallback of [false, true]) {
    test(`overflow output resists pre-created symlinks${fallback ? ' during fallback' : ''}`, { timeout: 15000 }, async t => {
        const { client, directory, system, custom } = await connect(t);
        const victim = join(directory, 'existing-data');
        await writeFile(victim, 'preserve existing data');
        const parent = fallback ? system : custom;
        for (const prefix of ['stdout', 'combined']) {
            await symlink(victim, join(parent, `bash-mcp-${prefix}-${timestamp}.txt`));
        }
        if (fallback) await chmod(custom, 0o500);
        const result = await call(client, 'run', { command: `printf '%s' '${payload}'` });
        assert.equal(result.success, true);
        assert.equal(await readFile(victim, 'utf8'), 'preserve existing data');
        await assertPrivate(result.details.stdout.filePath, parent);
        assert.equal(await readFile(result.details.stdout.filePath, 'utf8'), payload);
    });
}

test('background stdout and stderr use private files and preserve symlink targets', { timeout: 15000 }, async t => {
    const { client, directory, system, custom } = await connect(t);
    const victim = join(directory, 'existing-data');
    await writeFile(victim, 'preserve existing data');
    for (const stream of ['stdout', 'stderr']) {
        await symlink(victim, join(system, `bash-mcp-background-security-${stream}-${timestamp}.txt`));
    }
    await call(client, 'run_background', {
        name: 'security',
        command: `printf '%s' '${payload}'; printf '%s' '${payload}' >&2; sleep 1`,
    });
    let processInfo;
    for (let attempt = 0; attempt < 20; attempt++) {
        const result = await call(client, 'list_background', {});
        processInfo = result.processes.find(process => process.name === 'security');
        if (processInfo?.overflowDetails?.stdout?.filePath && processInfo?.overflowDetails?.stderr?.filePath) break;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(processInfo?.overflowDetails?.stdout?.filePath);
    assert.ok(processInfo?.overflowDetails?.stderr?.filePath);
    for (const stream of ['stdout', 'stderr']) {
        const file = processInfo.overflowDetails[stream].filePath;
        for (let attempt = 0; attempt < 60; attempt++) {
            try { if ((await stat(file)).size === payload.length) break; } catch {}
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        await assertPrivate(file, custom);
        assert.equal(await readFile(file, 'utf8'), payload);
    }
    assert.equal(await readFile(victim, 'utf8'), 'preserve existing data');
});
