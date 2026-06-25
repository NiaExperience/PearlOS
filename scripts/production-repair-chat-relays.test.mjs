import assert from "node:assert/strict";
import test from "node:test";

process.env.PEARL_RELAY_STATE_DIR = "/tmp/pearl-relay-node-test-state";
process.env.DISCORD_DM_LINK_SECRET = "test-secret";
process.env.PEARL_TASKS_API = "http://tasks.test/api/tasks";

const relay = await import("./production-repair-chat-relays.mjs");

function discordMsg(discordId, overrides = {}) {
	return {
		id: `message-${discordId}`,
		guild_id: null,
		channel_id: `channel-${discordId}`,
		content: "hey pearl",
		author: {
			id: discordId,
			username: `user-${discordId.slice(-4)}`
		},
		mentions: [],
		attachments: [],
		...overrides
	};
}

function installFetchMock() {
	const calls = [];
	globalThis.fetch = async (url, init = {}) => {
		const body = init.body ? JSON.parse(String(init.body)) : undefined;
		calls.push({ url: String(url), init, body });
		if (String(url).includes("/api/discord/dm-link/check")) {
			const discordUserId = new URL(String(url)).searchParams.get("discordUserId");
			const linked = {
				"111111111111111111": {
					allowed: true,
					discordUserId,
					userId: "alice-id",
					email: "alice@example.com",
					tenantId: "tenant-a"
				},
				"222222222222222222": {
					allowed: true,
					discordUserId,
					userId: "bob-id",
					email: "bob@example.com",
					tenantId: "tenant-b"
				}
			};
			return new Response(JSON.stringify(linked[String(discordUserId)] ?? { allowed: false }), { status: 200 });
		}
		if (String(url).includes("/api/discord/dm-link/issue")) {
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}
		if (String(url) === "http://tasks.test/api/tasks") {
			return new Response(JSON.stringify({ task: { id: "queued-task" } }), { status: 200 });
		}
		return new Response(JSON.stringify({ ok: true }), { status: 200 });
	};
	return calls;
}

test("dispatches PearlOS changes with the exact linked requester scope", async () => {
	const calls = installFetchMock();
	const reply = await relay.__privateMemoryTesting.createAgencyTask({
		config: {},
		token: "discord-token",
		msg: discordMsg("111111111111111111"),
		content: "ask the agency to add a PearlOS notes button for me"
	});

	const taskCall = calls.find((call) => call.url === "http://tasks.test/api/tasks");
	assert.match(reply, /tracked work/);
	assert.deepEqual(
		{
			requester_email: taskCall.body.requester_email,
			requester_user_id: taskCall.body.requester_user_id,
			requester_tenant_id: taskCall.body.requester_tenant_id,
			created_by: taskCall.body.created_by
		},
		{
			requester_email: "alice@example.com",
			requester_user_id: "alice-id",
			requester_tenant_id: "tenant-a",
			created_by: "discord:111111111111111111"
		}
	);
	assert.equal("workspace_mode" in taskCall.body, false);
	assert.equal("workspace_path" in taskCall.body, false);
	assert.equal("staging_source_edits_enabled" in taskCall.body, false);
	assert.equal("staging_source" in taskCall.body, false);
	// The task body must attribute the request to the linked account, never default to Blair.
	assert.match(taskCall.body.task, /Discord request from alice@example\.com/);
	assert.equal(/\bBlair\b/.test(taskCall.body.task), false);
});

test("refuses unlinked PearlOS changes without dispatching a task", async () => {
	const calls = installFetchMock();
	const reply = await relay.__privateMemoryTesting.createAgencyTask({
		config: {},
		token: "discord-token",
		msg: discordMsg("333333333333333333"),
		content: "ask the agency to change my PearlOS homepage"
	});

	assert.match(reply, /can't change your PearlOS/);
	assert.equal(calls.some((call) => call.url === "http://tasks.test/api/tasks"), false);
	assert.equal(calls.some((call) => call.url.includes("/api/discord/dm-link/issue")), true);
});

test("accepts DMs for link guidance and still requires guild mentions by config", async () => {
	installFetchMock();
	const dmAllowed = await relay.__privateMemoryTesting.shouldHandleDiscordMessage(
		{ channels: { discord: { dm: { enabled: true } } } },
		discordMsg("333333333333333333"),
		"pearl-bot"
	);
	const guildWithoutMention = await relay.__privateMemoryTesting.shouldHandleDiscordMessage(
		{ channels: { discord: { requireMention: true, channels: ["1471441655650324533"] } } },
		discordMsg("111111111111111111", { guild_id: "1471441655126167553", channel_id: "1471441655650324533" }),
		"pearl-bot"
	);
	const guildWithMention = await relay.__privateMemoryTesting.shouldHandleDiscordMessage(
		{ channels: { discord: { requireMention: true, channels: ["1471441655650324533"] } } },
		discordMsg("111111111111111111", {
			guild_id: "1471441655126167553",
			channel_id: "1471441655650324533",
			mentions: [{ id: "pearl-bot" }]
		}),
		"pearl-bot"
	);

	assert.equal(dmAllowed, true);
	assert.equal(guildWithoutMention, false);
	assert.equal(guildWithMention, true);
});

test("does not dispatch change requests from untrusted guild channels", async () => {
	const calls = installFetchMock();
	const reply = await relay.__privateMemoryTesting.createAgencyTask({
		config: {},
		token: "discord-token",
		msg: discordMsg("111111111111111111", {
			guild_id: "999999999999999999",
			channel_id: "888888888888888888"
		}),
		content: "ask the agency to change my PearlOS homepage"
	});

	assert.equal(reply, null);
	assert.equal(calls.some((call) => call.url === "http://tasks.test/api/tasks"), false);
});

test("keeps linked users isolated from each other", async () => {
	const calls = installFetchMock();
	await relay.__privateMemoryTesting.createAgencyTask({
		config: {},
		token: "discord-token",
		msg: discordMsg("111111111111111111"),
		content: "ask the agency to fix my PearlOS chat UI"
	});
	await relay.__privateMemoryTesting.createAgencyTask({
		config: {},
		token: "discord-token",
		msg: discordMsg("222222222222222222"),
		content: "ask the agency to fix my PearlOS chat UI"
	});

	const bodies = calls.filter((call) => call.url === "http://tasks.test/api/tasks").map((call) => call.body);
	assert.equal(bodies.length, 2);
	assert.equal(bodies[0].requester_user_id, "alice-id");
	assert.equal(bodies[0].requester_tenant_id, "tenant-a");
	assert.equal(bodies[0].requester_email, "alice@example.com");
	assert.equal(bodies[0].created_by, "discord:111111111111111111");
	assert.equal(bodies[1].requester_user_id, "bob-id");
	assert.equal(bodies[1].requester_tenant_id, "tenant-b");
	assert.equal(bodies[1].requester_email, "bob@example.com");
	assert.equal(bodies[1].created_by, "discord:222222222222222222");
	// No cross-contamination: neither task may carry the other user's scope, and
	// neither may be silently attributed to Blair.
	assert.equal(bodies.every((body) => body.created_by === "blair"), false);
	assert.equal(bodies[0].requester_tenant_id === bodies[1].requester_tenant_id, false);
	assert.match(bodies[0].task, /alice@example\.com/);
	assert.equal(/bob@example\.com/.test(bodies[0].task), false);
	assert.match(bodies[1].task, /bob@example\.com/);
	assert.equal(/alice@example\.com/.test(bodies[1].task), false);
});

test("strips read/path tool markup from outbound Discord text", () => {
	const clean = relay.__privateMemoryTesting.normalizeDiscordOutboundText(
		[
			"Alright, dispatching.",
			"<read>",
			"<path>/home/deploy/OpenClaw/skills/coding-agent/SKILL.md</path>",
			"</read>",
			"Queued."
		].join("\n")
	);

	assert.equal(clean, "Alright, dispatching.\n\nQueued.");
});
