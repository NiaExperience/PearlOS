#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pearl-relay-dispatch-"));
try {
	process.env.PEARLOS_SOURCE_DIR = tmp;
	process.env.PEARL_USER_MEMORY_DIR = path.join(tmp, "user-memory");
	process.env.PEARL_RELAY_STATE_DIR = path.join(tmp, "state");
	process.env.PEARL_DISCORD_IDENTITY_LINKS_PATH = path.join(tmp, "discord-links.json");

	const relayPath = path.resolve("scripts/production-repair-chat-relays.mjs");
	const relay = await import(`${pathToFileURL(relayPath).href}?dispatch_test=${Date.now()}`);
	const helpers = relay.__privateMemoryTesting;
	assert.ok(helpers, "relay test helpers should be exported");

	assert.equal(
		helpers.isPearlBehaviorComplaint("this talking about dispatching but not doing has been a problem we've been working on today"),
		true
	);
	assert.equal(helpers.isPearlBehaviorComplaint("can you queue this to the agency"), false);
	assert.equal(helpers.isTaskFollowupRequest("Check in with Codex CLI for an update"), true);
	assert.equal(helpers.wantsAgencyBossStatus("Are you not able to connect to Codex?"), true);
	assert.equal(helpers.wantsAgencyBossStatus("So no progress has been made on QA list?"), true);
	assert.equal(
		helpers.isDiscordStatusContextTrusted({
			guild_id: "1471441655126167553",
			channel_id: "1491397542364315668",
		}),
		true
	);
	assert.equal(
		helpers.isTrustedDiscordContext({
			guild_id: "1471441655126167553",
			channel_id: "1491397542364315668",
		}),
		false
	);
	assert.equal(
		helpers.conversationWorkProgressMessage({ title: "Discord repair", status: "in_progress", noticeCount: 0 }),
		null
	);
	assert.equal(
		helpers.shouldNotifyDiscordTaskStatus("in_progress", { lastStatus: "pending", createdAt: Date.now() }, null),
		false
	);

	console.log("relay dispatch behavior check passed");
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}
