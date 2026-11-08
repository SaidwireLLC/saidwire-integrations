# Use Saidwire with Vapi

Saidwire is real-time English speech-to-text for voice agents. You can make it the transcriber of
any [Vapi](https://vapi.ai) assistant with one change to the assistant's configuration. Your prompt,
model, voice and phone numbers stay as they are.

You need a Saidwire API key from [saidwire.com/dev](https://saidwire.com/dev): 120 free hours, no
card, then $0.30 per audio hour, billed per second of caller audio.

## How it connects

Vapi supports custom transcribers: for each call, it streams the call audio to a WebSocket server
and reads the transcripts back. Saidwire runs that server for you at:

```
wss://vapi.saidwire.com/vapi/transcriber
```

It forwards the caller's audio to Saidwire and returns partial transcripts while the caller speaks,
then a final transcript when they stop. Only the caller's side of the call is transcribed and billed,
not your assistant's.

## Setup (about 3 minutes)

### 1. Add your Saidwire key to Vapi

In the [Vapi dashboard](https://dashboard.vapi.ai), open **Integrations** → **Server Configuration**
→ **Add Custom Credential**:

| Field | Value |
|---|---|
| Authentication Type | Bearer Token |
| Credential Name | `Saidwire` |
| Token | your Saidwire key (`sk_live_...`) |
| Header Name | `Authorization` |
| Include Bearer Prefix | on |

Save, then copy the credential's ID.

### 2. Set the assistant's transcriber

In the assistant's settings, or through the API, set:

```json
{
  "transcriber": {
    "provider": "custom-transcriber",
    "server": {
      "url": "wss://vapi.saidwire.com/vapi/transcriber",
      "credentialId": "YOUR_CREDENTIAL_ID"
    }
  }
}
```

The same change with the Vapi API:

```bash
curl -X PATCH "https://api.vapi.ai/assistant/$ASSISTANT_ID" \
  -H "Authorization: Bearer $VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"transcriber":{"provider":"custom-transcriber","server":{
        "url":"wss://vapi.saidwire.com/vapi/transcriber",
        "credentialId":"YOUR_CREDENTIAL_ID"}}}'
```

### 3. Test it

Start a web call or a phone call with the assistant and speak. The transcripts appear in the call
log.

## Good to know

- **Saved vs. transient assistants.** Vapi sends a stored credential only with saved configuration
  (a saved assistant, phone number or Server Configuration). If you create the assistant inline in
  an API call, put the key in the server headers instead:
  `"server": {"url": "wss://vapi.saidwire.com/vapi/transcriber", "headers": {"Authorization": "Bearer sk_live_..."}}`.
- **Turn-taking.** Saidwire sends partial transcripts while the caller speaks and finalizes after a
  short pause (about 300 ms of caller quiet). Vapi's own start-speaking settings then decide when the
  assistant replies. See Vapi's
  [voice pipeline configuration](https://docs.vapi.ai/customization/voice-pipeline-configuration).
- **Fallback.** If Saidwire can't take a call (for example, the key's hours are used up), the connection
  closes with an error. A Vapi `fallbackPlan` on the transcriber then switches that call to another
  transcriber.
- **Concurrency.** Each call uses one Saidwire stream. Trial keys allow 4 at once. Write to
  support@saidwire.com for more.
- **Language.** English only. Use another transcriber for assistants that need other languages.
- **Privacy.** The connector doesn't store audio, transcripts or keys. It passes your key to
  Saidwire for each call and keeps no copy.

## Troubleshooting

| What you see | Fix |
|---|---|
| No transcripts, and the call log shows a 401 | The credential isn't attached. Check that it's a **Bearer Token** credential and that the assistant references its ID. For transient assistants, use `headers` instead |
| A `402` error | The key's hours are used up. Add credit at [saidwire.com/dev](https://saidwire.com/dev) or write to support@saidwire.com |
| A `429` error | More calls at once than the key allows. Ask support@saidwire.com for a higher limit |
| The assistant answers before the caller finishes | Raise the wait time in Vapi's start-speaking settings |

Questions: support@saidwire.com.
