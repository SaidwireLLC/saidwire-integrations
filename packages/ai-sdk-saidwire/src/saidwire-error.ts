import { createJsonErrorResponseHandler } from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';

// Error body: {"error": {"message", "type", "param", "code"}}
export const saidwireErrorDataSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().nullish(),
    param: z.any().nullish(),
    code: z.union([z.string(), z.number()]).nullish(),
  }),
});

export type SaidwireErrorData = z.infer<typeof saidwireErrorDataSchema>;

export const saidwireFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: saidwireErrorDataSchema,
  errorToMessage: data => data.error.message,
  // 429 for a used-up quota carries `x-should-retry: false`; plain 429 (busy)
  // and 5xx are worth a retry.
  isRetryable: (response, error) => {
    if (response.headers.get('x-should-retry') === 'false') return false;
    if (error?.error.code === 'insufficient_quota') return false;
    return response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
  },
});
