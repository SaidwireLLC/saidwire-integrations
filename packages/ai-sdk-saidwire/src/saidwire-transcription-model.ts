import type {
  JSONObject,
  SharedV4Warning,
  TranscriptionModelV4,
  TranscriptionModelV4CallOptions,
} from '@ai-sdk/provider';
import {
  combineHeaders,
  convertBase64ToUint8Array,
  createJsonResponseHandler,
  mediaTypeToExtension,
  parseProviderOptions,
  postFormDataToApi,
  resolve,
  serializeModelOptions,
  WORKFLOW_DESERIALIZE,
  WORKFLOW_SERIALIZE,
  type FetchFunction,
  type Resolvable,
} from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';
import { saidwireFailedResponseHandler } from './saidwire-error';
import {
  saidwireTranscriptionModelOptionsSchema,
  type SaidwireTranscriptionModelId,
  type SaidwireTranscriptionModelOptions,
} from './saidwire-transcription-options';

export type SaidwireTranscriptionModelConfig = {
  provider: string;
  url: (options: { path: string; modelId: string }) => string;
  headers?: Resolvable<Record<string, string | undefined>>;
  fetch?: FetchFunction;
  _internal?: { currentDate?: () => Date };
};

export type SaidwireTranscriptionCallOptions = Omit<
  TranscriptionModelV4CallOptions,
  'providerOptions'
> & {
  providerOptions?: {
    saidwire?: SaidwireTranscriptionModelOptions;
    [provider: string]: JSONObject | undefined;
  };
};

// Minimal response schema: only the fields we map.
const saidwireTranscriptionResponseSchema = z.object({
  text: z.string(),
  language: z.string().nullish(),
  duration: z.number().nullish(),
  segments: z
    .array(z.object({ text: z.string(), start: z.number(), end: z.number() }))
    .nullish(),
  words: z
    .array(z.object({ word: z.string(), start: z.number(), end: z.number() }))
    .nullish(),
  usage: z
    .object({ type: z.string().nullish(), seconds: z.number().nullish() })
    .passthrough()
    .nullish(),
});

function toLanguageCode(language: string | null | undefined): string | undefined {
  if (language == null || language === '') return undefined;
  const lower = language.toLowerCase();
  if (lower === 'english') return 'en';
  if (/^[a-z]{2}$/.test(lower)) return lower;
  const tag = lower.match(/^([a-z]{2})-[a-z0-9]+$/);
  return tag?.[1];
}

export class SaidwireTranscriptionModel implements TranscriptionModelV4 {
  readonly specificationVersion = 'v4';

  static [WORKFLOW_SERIALIZE](model: SaidwireTranscriptionModel) {
    return serializeModelOptions({ modelId: model.modelId, config: model.config });
  }

  static [WORKFLOW_DESERIALIZE](options: {
    modelId: SaidwireTranscriptionModelId;
    config: SaidwireTranscriptionModelConfig;
  }) {
    return new SaidwireTranscriptionModel(options.modelId, options.config);
  }

  get provider(): string {
    return this.config.provider;
  }

  constructor(
    readonly modelId: SaidwireTranscriptionModelId,
    private readonly config: SaidwireTranscriptionModelConfig,
  ) {}

  private async getArgs({ audio, mediaType, providerOptions }: SaidwireTranscriptionCallOptions) {
    const warnings: SharedV4Warning[] = [];

    const options = await parseProviderOptions({
      provider: 'saidwire',
      providerOptions,
      schema: saidwireTranscriptionModelOptionsSchema,
    });

    const bytes = audio instanceof Uint8Array ? audio : convertBase64ToUint8Array(audio);
    const extension = mediaTypeToExtension(mediaType);

    const formData = new FormData();
    formData.append('model', this.modelId);
    formData.append(
      'file',
      new File([bytes as Uint8Array<ArrayBuffer>], `audio.${extension}`, { type: mediaType }),
      `audio.${extension}`,
    );
    formData.append('response_format', 'verbose_json');

    const granularities = options?.timestampGranularities ?? ['segment'];
    for (const granularity of granularities) {
      formData.append('timestamp_granularities[]', granularity);
    }
    if (options?.language != null && options.language !== '') {
      formData.append('language', options.language);
    }

    return { formData, warnings };
  }

  async doGenerate(
    options: SaidwireTranscriptionCallOptions,
  ): Promise<Awaited<ReturnType<TranscriptionModelV4['doGenerate']>>> {
    const currentDate = this.config._internal?.currentDate?.() ?? new Date();
    const { formData, warnings } = await this.getArgs(options);

    const {
      value: response,
      responseHeaders,
      rawValue: rawResponse,
    } = await postFormDataToApi({
      url: this.config.url({ path: '/audio/transcriptions', modelId: this.modelId }),
      headers: combineHeaders(await resolve(this.config.headers), options.headers),
      formData,
      failedResponseHandler: saidwireFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(saidwireTranscriptionResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const segments =
      response.segments?.map(segment => ({
        text: segment.text.trim(),
        startSecond: segment.start,
        endSecond: segment.end,
      })) ??
      response.words?.map(word => ({
        text: word.word,
        startSecond: word.start,
        endSecond: word.end,
      })) ??
      [];

    const durationInSeconds =
      response.duration ??
      (typeof response.usage?.seconds === 'number' ? response.usage.seconds : undefined);

    return {
      text: response.text,
      segments,
      language: toLanguageCode(response.language),
      durationInSeconds,
      warnings,
      ...(response.usage != null && { usage: response.usage as JSONObject }),
      response: {
        timestamp: currentDate,
        modelId: this.modelId,
        headers: responseHeaders,
        body: rawResponse,
      },
      ...(response.words != null && {
        providerMetadata: {
          saidwire: {
            words: response.words.map(word => ({
              word: word.word,
              start: word.start,
              end: word.end,
            })),
          },
        },
      }),
    };
  }
}
