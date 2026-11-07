import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { buildMultipart } from './multipart';

type ResponseFormat = 'json' | 'verbose_json' | 'text' | 'srt' | 'vtt';

const TEXT_FORMATS: ResponseFormat[] = ['text', 'srt', 'vtt'];

const FILE_TYPES: Record<string, { extension: string; mimeType: string }> = {
	text: { extension: 'txt', mimeType: 'text/plain' },
	srt: { extension: 'srt', mimeType: 'application/x-subrip' },
	vtt: { extension: 'vtt', mimeType: 'text/vtt' },
};

export class Saidwire implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Saidwire',
		name: 'saidwire',
		icon: { light: 'file:saidwire.svg', dark: 'file:saidwire.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Transcribe English audio to text, timestamps or subtitles with Saidwire',
		defaults: {
			name: 'Saidwire',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'saidwireApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Audio',
						value: 'audio',
					},
				],
				default: 'audio',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['audio'],
					},
				},
				options: [
					{
						name: 'Transcribe',
						value: 'transcribe',
						description: 'Transcribe an audio file to text',
						action: 'Transcribe audio',
					},
				],
				default: 'transcribe',
			},
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				required: true,
				default: 'data',
				placeholder: 'e.g. data',
				hint: 'The name of the input binary field containing the audio file',
				displayOptions: {
					show: {
						resource: ['audio'],
						operation: ['transcribe'],
					},
				},
				description:
					'WAV, MP3, FLAC, Ogg/Opus, WebM or M4A/MP4, up to 100 MB and 60 minutes. English speech only.',
			},
			{
				displayName: 'Response Format',
				name: 'responseFormat',
				type: 'options',
				displayOptions: {
					show: {
						resource: ['audio'],
						operation: ['transcribe'],
					},
				},
				options: [
					{
						name: 'JSON (Text Only)',
						value: 'json',
						description: 'Returns the transcript text and the audio duration',
					},
					{
						name: 'Plain Text',
						value: 'text',
						description: 'Returns the transcript as a plain string',
					},
					{
						name: 'SRT Subtitles',
						value: 'srt',
						description: 'Returns SubRip subtitles',
					},
					{
						name: 'Verbose JSON (Segments and Timestamps)',
						value: 'verbose_json',
						description: 'Returns segments with start and end times, and optionally word timestamps',
					},
					{
						name: 'WebVTT Subtitles',
						value: 'vtt',
						description: 'Returns WebVTT subtitles',
					},
				],
				default: 'json',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: {
					show: {
						resource: ['audio'],
						operation: ['transcribe'],
					},
				},
				options: [
					{
						displayName: 'Language',
						name: 'language',
						type: 'string',
						default: 'en',
						description:
							'Saidwire transcribes English only. Use en or a regional code such as en-US, or leave empty.',
					},
					{
						displayName: 'Output Binary Field',
						name: 'binaryPropertyOutput',
						type: 'string',
						default: 'data',
						description:
							'With Put Output in File on, the binary field that receives the text, SRT or VTT file',
					},
					{
						displayName: 'Put Output in File',
						name: 'outputToFile',
						type: 'boolean',
						default: false,
						description:
							'Whether to also return Plain Text, SRT or WebVTT output as a binary file (ignored for the JSON formats)',
					},
					{
						displayName: 'Timestamp Granularities',
						name: 'timestampGranularities',
						type: 'multiOptions',
						options: [
							{ name: 'Segment', value: 'segment' },
							{ name: 'Word', value: 'word' },
						],
						default: ['segment'],
						description: 'Which timestamps to include. Only used with Verbose JSON.',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				if (resource !== 'audio' || operation !== 'transcribe') {
					throw new NodeOperationError(
						this.getNode(),
						`Unsupported operation "${operation}" for resource "${resource}"`,
						{ itemIndex: i },
					);
				}

				const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
				const responseFormat = this.getNodeParameter('responseFormat', i) as ResponseFormat;
				const options = this.getNodeParameter('options', i, {}) as {
					language?: string;
					timestampGranularities?: string[];
					outputToFile?: boolean;
					binaryPropertyOutput?: string;
				};

				const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);
				const audio = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);

				const fields: Array<[string, string]> = [
					['model', 'saidwire-en'],
					['response_format', responseFormat],
				];
				const language = (options.language ?? 'en').trim();
				if (language !== '') fields.push(['language', language]);
				if (responseFormat === 'verbose_json') {
					for (const granularity of options.timestampGranularities ?? ['segment']) {
						fields.push(['timestamp_granularities[]', granularity]);
					}
				}

				const { body, contentType } = buildMultipart(fields, {
					fieldName: 'file',
					fileName: binaryData.fileName ?? `audio.${binaryData.fileExtension ?? 'wav'}`,
					mimeType: binaryData.mimeType || 'application/octet-stream',
					data: audio,
				});

				const credentials = await this.getCredentials('saidwireApi', i);
				const baseUrl = String(credentials.baseUrl || 'https://api.saidwire.com/v1').replace(
					/\/+$/,
					'',
				);

				const request: IHttpRequestOptions = {
					method: 'POST',
					url: `${baseUrl}/audio/transcriptions`,
					headers: { 'Content-Type': contentType },
					body,
					encoding: 'text',
					json: false,
				};

				let raw: string;
				try {
					raw = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'saidwireApi',
						request,
					)) as string;
				} catch (error) {
					throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
				}

				if (TEXT_FORMATS.includes(responseFormat)) {
					const text = String(raw);
					const json: IDataObject =
						responseFormat === 'text' ? { text } : { subtitles: text, format: responseFormat };
					const out: INodeExecutionData = { json, pairedItem: { item: i } };
					if (options.outputToFile) {
						const fileType = FILE_TYPES[responseFormat];
						const baseName = (binaryData.fileName ?? 'audio').replace(/\.[^.]+$/, '');
						out.binary = {
							[options.binaryPropertyOutput || 'data']: await this.helpers.prepareBinaryData(
								Buffer.from(text, 'utf8'),
								`${baseName}.${fileType.extension}`,
								fileType.mimeType,
							),
						};
					}
					returnData.push(out);
				} else {
					const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as IDataObject;
					returnData.push({ json: parsed, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeApiError) {
					// returns the same instance, keeping the HTTP status and message
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
