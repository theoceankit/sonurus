// Why a model download failed, in the words of the interface: the backend's error
// event says it as a code (WS /ws/models/{job_id}); its message, the exception as
// raised, stays in the backend's log.

export const DOWNLOAD_FAILURES = ['no_token', 'no_access', 'network', 'failed'] as const
export type DownloadFailure = typeof DOWNLOAD_FAILURES[number]

// A code this UI does not know yet, or none (a lost connection, a backend that would
// not start the download), is a download that did not finish.
export function downloadFailure(code: unknown): DownloadFailure {
  return DOWNLOAD_FAILURES.includes(code as DownloadFailure) ? code as DownloadFailure : 'failed'
}

// apiKeys: the text goes on with a link to API Keys, where the token is entered.
const TEXTS: Record<DownloadFailure, { text: string; apiKeys: boolean }> = {
  no_token: { text: 'A HuggingFace token is needed. Add it in', apiKeys: true },
  no_access: {
    text: "Your HuggingFace token has no access to this model. Accept the model's terms in your HuggingFace account and try again, or check the token in",
    apiKeys: true,
  },
  network: { text: 'No connection to HuggingFace. Check the internet connection and try again.', apiKeys: false },
  failed: { text: 'The download did not finish. Try again.', apiKeys: false },
}

export const downloadFailureText = (failure: DownloadFailure) => TEXTS[failure]

// The same as one line, for a place without the link.
export function downloadFailureLine(failure: DownloadFailure): string {
  const { text, apiKeys } = TEXTS[failure]
  return apiKeys ? `${text} API Keys.` : text
}
