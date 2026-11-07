// Tests for the compiled node (run `npm test`, which builds first).
// Unit tests use a mocked n8n execution context. The live tests run only when
// SAIDWIRE_API_KEY and SAIDWIRE_LIVE=1 are set, and call the real API.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { Saidwire } = require('../dist/nodes/Saidwire/Saidwire.node.js');
const { SaidwireApi } = require('../dist/credentials/SaidwireApi.credentials.js');
const { buildMultipart } = require('../dist/nodes/Saidwire/multipart.js');
const pkg = require('../package.json');

const CLIP = process.env.SAIDWIRE_TEST_CLIP || path.join(__dirname, 'fixtures', 'clip.wav');
const LIVE = process.env.SAIDWIRE_LIVE === '1' && !!process.env.SAIDWIRE_API_KEY;

async function parseForm(body, contentType) {
	return new Response(body, { headers: { 'content-type': contentType } }).formData();
}

function makeContext({ params, binary, http, credentials, continueOnFail = false }) {
	const calls = [];
	const node = { name: 'Saidwire', type: 'n8n-nodes-saidwire.saidwire', typeVersion: 1, parameters: {} };
	const ctx = {
		calls,
		getInputData: () => [{ json: {}, binary: { data: binary.meta } }],
		getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
		getNode: () => node,
		continueOnFail: () => continueOnFail,
		getCredentials: async () => credentials ?? { apiKey: 'sk_live_test.secret', baseUrl: 'https://api.saidwire.com/v1/' },
		helpers: {
			assertBinaryData: () => binary.meta,
			getBinaryDataBuffer: async () => binary.data,
			prepareBinaryData: async (buf, fileName, mimeType) => ({
				data: buf.toString('base64'),
				fileName,
				mimeType,
			}),
			httpRequestWithAuthentication: async function (credName, request) {
				calls.push({ credName, request });
				return http(request, credName);
			},
		},
	};
	return ctx;
}

const fakeBinary = {
	meta: { fileName: 'meeting.wav', mimeType: 'audio/wav', fileExtension: 'wav', data: '' },
	data: Buffer.from('RIFF....WAVEfmt fake audio bytes'),
};

test('package.json lists the built node and credential', () => {
	assert.ok(pkg.keywords.includes('n8n-community-node-package'));
	assert.equal(pkg.name, 'n8n-nodes-saidwire');
	assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], 'no runtime dependencies');
	for (const file of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) {
		assert.ok(fs.existsSync(path.join(__dirname, '..', file)), file);
	}
});

test('credential: Bearer header and a models test request', () => {
	const cred = new SaidwireApi();
	assert.equal(cred.name, 'saidwireApi');
	assert.equal(cred.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}');
	assert.equal(cred.test.request.url, '/models');
	assert.equal(cred.properties.find((p) => p.name === 'apiKey').typeOptions.password, true);
});

test('description: Transcribe audio action with five response formats', () => {
	const d = new Saidwire().description;
	const op = d.properties.find((p) => p.name === 'operation');
	assert.equal(op.options[0].action, 'Transcribe audio');
	const rf = d.properties.find((p) => p.name === 'responseFormat');
	assert.deepEqual(rf.options.map((o) => o.value).sort(), ['json', 'srt', 'text', 'verbose_json', 'vtt']);
	assert.equal(d.credentials[0].name, 'saidwireApi');
});

test('multipart body parses back to the same fields and file', async () => {
	const { body, contentType } = buildMultipart(
		[
			['model', 'saidwire-en'],
			['timestamp_granularities[]', 'word'],
		],
		{ fieldName: 'file', fileName: 'a "b".wav', mimeType: 'audio/wav', data: Buffer.from([0, 1, 2, 255]) },
	);
	const form = await parseForm(body, contentType);
	assert.equal(form.get('model'), 'saidwire-en');
	assert.equal(form.get('timestamp_granularities[]'), 'word');
	const file = form.get('file');
	assert.equal(file.type, 'audio/wav');
	assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [0, 1, 2, 255]);
});

test('json format: request shape and output', async () => {
	const ctx = makeContext({
		params: { resource: 'audio', operation: 'transcribe', binaryPropertyName: 'data', responseFormat: 'json', options: {} },
		binary: fakeBinary,
		http: async () => JSON.stringify({ text: 'hello world', usage: { type: 'duration', seconds: 2 } }),
	});
	const [out] = await new Saidwire().execute.call(ctx);
	assert.deepEqual(out[0].json, { text: 'hello world', usage: { type: 'duration', seconds: 2 } });
	assert.deepEqual(out[0].pairedItem, { item: 0 });
	const { credName, request } = ctx.calls[0];
	assert.equal(credName, 'saidwireApi');
	assert.equal(request.method, 'POST');
	assert.equal(request.url, 'https://api.saidwire.com/v1/audio/transcriptions');
	assert.equal(request.encoding, 'text');
	const form = await parseForm(request.body, request.headers['Content-Type']);
	assert.equal(form.get('model'), 'saidwire-en');
	assert.equal(form.get('response_format'), 'json');
	assert.equal(form.get('language'), 'en');
	assert.equal(form.get('timestamp_granularities[]'), null);
	assert.equal(form.get('file').name, 'meeting.wav');
});

test('verbose_json sends granularities; empty language is left out', async () => {
	const ctx = makeContext({
		params: {
			resource: 'audio',
			operation: 'transcribe',
			binaryPropertyName: 'data',
			responseFormat: 'verbose_json',
			options: { language: '', timestampGranularities: ['segment', 'word'] },
		},
		binary: fakeBinary,
		http: async () => JSON.stringify({ text: 'hi', segments: [], words: [] }),
	});
	await new Saidwire().execute.call(ctx);
	const { request } = ctx.calls[0];
	const form = await parseForm(request.body, request.headers['Content-Type']);
	assert.deepEqual(form.getAll('timestamp_granularities[]'), ['segment', 'word']);
	assert.equal(form.get('language'), null);
});

test('srt format with Put Output in File returns a binary file', async () => {
	const srt = '1\n00:00:00,000 --> 00:00:01,000\nhello\n';
	const ctx = makeContext({
		params: {
			resource: 'audio',
			operation: 'transcribe',
			binaryPropertyName: 'data',
			responseFormat: 'srt',
			options: { outputToFile: true, binaryPropertyOutput: 'subs' },
		},
		binary: fakeBinary,
		http: async () => srt,
	});
	const [out] = await new Saidwire().execute.call(ctx);
	assert.deepEqual(out[0].json, { subtitles: srt, format: 'srt' });
	assert.equal(out[0].binary.subs.fileName, 'meeting.srt');
	assert.equal(out[0].binary.subs.mimeType, 'application/x-subrip');
	assert.equal(Buffer.from(out[0].binary.subs.data, 'base64').toString(), srt);
});

test('API errors become NodeApiError, or an error item with Continue On Fail', async () => {
	const apiError = Object.assign(new Error('Request failed with status code 401'), {
		response: { status: 401, data: { error: { message: 'Incorrect API key provided.' } } },
	});
	const params = { resource: 'audio', operation: 'transcribe', binaryPropertyName: 'data', responseFormat: 'json', options: {} };
	const failing = makeContext({ params, binary: fakeBinary, http: async () => { throw apiError; } });
	await assert.rejects(() => new Saidwire().execute.call(failing), (e) => e.constructor.name === 'NodeApiError');
	const tolerant = makeContext({ params, binary: fakeBinary, http: async () => { throw apiError; }, continueOnFail: true });
	const [out] = await new Saidwire().execute.call(tolerant);
	assert.ok(out[0].json.error);
});

// ---------------------------------------------------------------- live
async function liveHttp(request) {
	const res = await fetch(request.url, {
		method: request.method,
		headers: { ...request.headers, Authorization: `Bearer ${process.env.SAIDWIRE_API_KEY.trim()}` },
		body: request.body,
	});
	const text = await res.text();
	if (!res.ok) {
		throw Object.assign(new Error(`Request failed with status code ${res.status}`), {
			httpCode: String(res.status),
			response: { status: res.status, data: text },
		});
	}
	return text;
}

function liveBinary() {
	const data = fs.readFileSync(CLIP);
	return { meta: { fileName: path.basename(CLIP), mimeType: 'audio/wav', fileExtension: 'wav', data: '' }, data };
}

test('live: credential test request (GET /models)', { skip: !LIVE }, async () => {
	const res = await fetch('https://api.saidwire.com/v1/models', {
		headers: { Authorization: `Bearer ${process.env.SAIDWIRE_API_KEY.trim()}` },
	});
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.ok(body.data.some((m) => m.id === 'saidwire-en'));
});

for (const format of ['json', 'verbose_json', 'srt', 'vtt', 'text']) {
	test(`live: transcribe ${format}`, { skip: !LIVE }, async () => {
		const ctx = makeContext({
			params: {
				resource: 'audio',
				operation: 'transcribe',
				binaryPropertyName: 'data',
				responseFormat: format,
				options: format === 'verbose_json' ? { timestampGranularities: ['segment', 'word'] } : {},
			},
			binary: liveBinary(),
			http: liveHttp,
		});
		const t0 = Date.now();
		const [out] = await new Saidwire().execute.call(ctx);
		const ms = Date.now() - t0;
		const json = out[0].json;
		const text = json.text ?? json.subtitles;
		assert.match(text, /Supreme Court/);
		if (format === 'verbose_json') {
			assert.ok(json.segments.length > 0);
			assert.ok(json.words.length > 0);
		}
		if (format === 'srt') assert.match(text, /-->/);
		if (format === 'vtt') assert.match(text, /^WEBVTT/);
		console.log(`# live ${format}: ${ms} ms ${JSON.stringify(String(text).slice(0, 60))}`);
	});
}

test('live: bad key gives NodeApiError 401', { skip: !LIVE }, async () => {
	const ctx = makeContext({
		params: { resource: 'audio', operation: 'transcribe', binaryPropertyName: 'data', responseFormat: 'json', options: {} },
		binary: liveBinary(),
		http: async (request) => {
			const res = await fetch(request.url, {
				method: 'POST',
				headers: { ...request.headers, Authorization: 'Bearer sk_live_bad.bad' },
				body: request.body,
			});
			throw Object.assign(new Error(`Request failed with status code ${res.status}`), {
				httpCode: String(res.status),
				response: { status: res.status, data: await res.text() },
			});
		},
	});
	await assert.rejects(() => new Saidwire().execute.call(ctx), (e) => e.constructor.name === 'NodeApiError' && /401/.test(e.httpCode ?? e.message));
});
