import Redis from "ioredis";
import { REDIS_URL } from "../config/env.js";

// Initialize Redis connection
export const redis = new Redis(REDIS_URL);

// Call context management
export const storeCallContext = async (callSid, context) => {
  try {
    await redis.set(
      `call_context:${callSid}`,
      JSON.stringify(context),
      "EX",
      3600 // Expire in 1 hour
    );
    console.log(`📦 Context stored for call ${callSid}`);
  } catch (error) {
    console.error(`❌ Failed to store context for ${callSid}:`, error);
    throw error;
  }
};

export const getCallContext = async (callSid) => {
  try {
    const raw = await redis.get(`call_context:${callSid}`);
    const context = raw ? JSON.parse(raw) : null;
    console.log(`📦 Context retrieved for call ${callSid}:`, context);
    return context;
  } catch (error) {
    console.error(`❌ Failed to get context for ${callSid}:`, error);
    return null;
  }
};

export const deleteCallContext = async (callSid) => {
  try {
    await redis.del(`call_context:${callSid}`);
    console.log(`🧹 Context deleted for call ${callSid}`);
  } catch (error) {
    console.error(`❌ Failed to delete context for ${callSid}:`, error);
  }
};

// Transcript management
export const storeTranscriptEntry = async (callSid, entry) => {
  try {
    await redis.rpush(`transcript:${callSid}`, JSON.stringify(entry));
    await redis.expire(`transcript:${callSid}`, 3600); // Expire in 1 hour
  } catch (error) {
    console.error(`❌ Failed to store transcript entry for ${callSid}:`, error);
  }
};

export const getTranscript = async (callSid) => {
  try {
    const items = await redis.lrange(`transcript:${callSid}`, 0, -1);
    return items.map(JSON.parse);
  } catch (error) {
    console.error(`❌ Failed to get transcript for ${callSid}:`, error);
    return [];
  }
};

export const deleteTranscript = async (callSid) => {
  try {
    await redis.del(`transcript:${callSid}`);
    console.log(`🧹 Transcript deleted for call ${callSid}`);
  } catch (error) {
    console.error(`❌ Failed to delete transcript for ${callSid}:`, error);
  }
};