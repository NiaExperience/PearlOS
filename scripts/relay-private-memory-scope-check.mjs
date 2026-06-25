#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pearl-relay-memory-"));
try {
	const sourceDir = path.join(tmp, "source");
	const memoryRoot = path.join(tmp, "user-memory");
	const stateDir = path.join(tmp, "state");
	const linksPath = path.join(tmp, "discord-links.json");
	fs.mkdirSync(sourceDir, { recursive: true });
	fs.writeFileSync(path.join(sourceDir, "USER_FACTS.md"), "ROOT FACT MARKER\n");
	fs.writeFileSync(path.join(sourceDir, "MEMORY.md"), "ROOT MEMORY MARKER\n");

	process.env.PEARLOS_SOURCE_DIR = sourceDir;
	process.env.PEARL_USER_MEMORY_DIR = memoryRoot;
	process.env.PEARL_RELAY_STATE_DIR = stateDir;
	process.env.PEARL_DISCORD_IDENTITY_LINKS_PATH = linksPath;

	const relayPath = path.resolve("scripts/production-repair-chat-relays.mjs");
	const relay = await import(`${pathToFileURL(relayPath).href}?scope_test=${Date.now()}`);
	const helpers = relay.__privateMemoryTesting;
	assert.ok(helpers, "private memory test helpers should be exported");

	const scope = {
		tenantId: "tenant-a",
		userId: "user-a",
		userEmail: "user@example.com"
	};
	const scopedRoot = helpers.scopedPrivateMemoryDir(scope);
	fs.mkdirSync(scopedRoot, { recursive: true });
	fs.writeFileSync(path.join(scopedRoot, "USER_FACTS.md"), "# User Facts\n\nSCOPED FACT MARKER\n");
	fs.writeFileSync(path.join(scopedRoot, "MEMORY.md"), "# User Memory\n\nSCOPED MEMORY MARKER\n");

	assert.equal(helpers.buildPrivateMemoryContext({ surface: "web" }), null);
	const scopedContext = helpers.buildPrivateMemoryContext({ surface: "web", ...scope });
	assert.match(scopedContext, /SCOPED FACT MARKER/);
	assert.match(scopedContext, /SCOPED MEMORY MARKER/);
	assert.doesNotMatch(scopedContext, /ROOT FACT MARKER|ROOT MEMORY MARKER/);

	const unscopedFact = helpers.rememberDurableUserFact(
		"remember that instrument tests must stay scoped",
		{ surface: "web" }
	);
	assert.equal(unscopedFact, null);
	assert.equal(fs.readFileSync(path.join(sourceDir, "USER_FACTS.md"), "utf8"), "ROOT FACT MARKER\n");

	const remembered = helpers.rememberDurableUserFact(
		"remember that secure memory scope smoke test passed",
		{ surface: "web", ...scope }
	);
	assert.ok(remembered, "scoped durable fact should be remembered");
	assert.match(fs.readFileSync(path.join(scopedRoot, "USER_FACTS.md"), "utf8"), /secure memory scope smoke test passed/);
	assert.match(fs.readFileSync(path.join(scopedRoot, "MEMORY.md"), "utf8"), /secure memory scope smoke test passed/);

	fs.writeFileSync(linksPath, JSON.stringify({
		users: {
			"123456789012345678": scope
		}
	}, null, 2));
	const discordContext = helpers.buildPrivateMemoryContext({
		surface: "discord",
		authorId: "123456789012345678",
		guildId: "1471441655126167553",
		channelId: "1471441655650324533"
	});
	assert.match(discordContext, /SCOPED FACT MARKER|secure memory scope smoke test passed/);
	assert.equal(helpers.buildPrivateMemoryContext({
		surface: "discord",
		authorId: "123456789012345678",
		guildId: "not-trusted",
		channelId: "1471441655650324533"
	}), null);

	console.log("relay private memory scope check passed");
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}
