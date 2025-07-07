export const VOICE = "shimmer";

export const OPENAI_WEBSOCKET_URL = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";

export const CALL_END_PHRASES = [
  "goodbye",
  "take care", 
  "have a nice day"
];

export const CALL_END_DELAY = 6000; // 6 seconds

export const REDIS_TTL = 3600; // 1 hour in seconds