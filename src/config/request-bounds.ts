/** The native CLI bridge independently refuses required prompts above this transport bound. */
export const NATIVE_CLI_PROMPT_MAX_BYTES = 128 * 1024;
/** Conservative model admission framing allocation; wire bytes are not measured tokens. */
export const MODEL_REQUEST_FRAMING_RESERVE_BYTES = 2048;
/** Default only: explicit role, global, session and saved allocations retain authority. */
export const NATIVE_CLI_DEFAULT_CONTEXT_ALLOCATION = NATIVE_CLI_PROMPT_MAX_BYTES + MODEL_REQUEST_FRAMING_RESERVE_BYTES;
