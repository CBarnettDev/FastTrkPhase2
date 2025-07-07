import WebSocket from "ws";
import { OPENAI_API_KEY } from "../config/env.js";
import {
	OPENAI_WEBSOCKET_URL,
	CALL_END_PHRASES,
	CALL_END_DELAY,
} from "../utils/constants.js";
import {
	getCallContext,
	deleteCallContext,
	storeTranscriptEntry,
	getTranscript,
	deleteTranscript,
} from "../services/redis.js";
import { endCall } from "../services/twilio.js";
import { sendTranscriptEmail } from "../services/email.js";
import { createSessionUpdate } from "../services/openai.js";

export const handleWebSocketConnection = (conn, req) => {
	let streamSid = null;
	let latestMediaTimestamp = 0;
	let lastAssistantItem = null;
	let markQueue = [];
	let responseStartTimestampTwilio = null;
	let callSid = null;

	// Initialize OpenAI WebSocket connection
	const openAiWs = new WebSocket(OPENAI_WEBSOCKET_URL, {
		headers: {
			Authorization: `Bearer ${OPENAI_API_KEY}`,
			"OpenAI-Beta": "realtime=v1",
		},
	});

	const initializeSession = (context) => {
		const sessionUpdate = createSessionUpdate(context);

		openAiWs.on("open", () => {
			console.log("✅ OpenAI WS connected!");
			console.log("📨 Sending sessionUpdate to OpenAI", sessionUpdate);
			openAiWs.send(JSON.stringify(sessionUpdate));
		});
	};

	const handleSpeechStartedEvent = () => {
		if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
			const elapsed = latestMediaTimestamp - responseStartTimestampTwilio;

			if (lastAssistantItem) {
				openAiWs.send(
					JSON.stringify({
						type: "conversation.item.truncate",
						item_id: lastAssistantItem,
						content_index: 0,
						audio_end_ms: elapsed,
					})
				);
			}

			conn.send(JSON.stringify({ event: "clear", streamSid }));
			markQueue = [];
			lastAssistantItem = null;
			responseStartTimestampTwilio = null;
		}
	};

	const sendMark = () => {
		if (streamSid) {
			conn.send(
				JSON.stringify({
					event: "mark",
					streamSid,
					mark: { name: "responsePart" },
				})
			);
			markQueue.push("responsePart");
		}
	};

	const handleCallEnd = async (transcript) => {
		if (callSid) {
			setTimeout(async () => {
				try {
					await endCall(callSid);
					console.log(`✅ Call ${callSid} ended by AI after delay.`);
				} catch (err) {
					console.error(`❌ Failed to end call ${callSid}:`, err);
				}

				try {
					const conversation = await getTranscript(callSid);
					console.log("📜 Full conversation transcript:", conversation);

					await sendTranscriptEmail(callSid, conversation);
					console.log(`📧 Transcript emailed for call ${callSid}`);
				} catch (e) {
					console.error("❌ Failed to handle post-call tasks:", e);
				}
			}, CALL_END_DELAY);
		} else {
			console.warn(`⚠️ callSid is missing, cannot end call.`);
		}
	};

	// OpenAI WebSocket event handlers
	openAiWs.on("message", async (data) => {
		try {
			const res = JSON.parse(data);

			if (
				res.type === "conversation.item.input_audio_transcription.completed"
			) {
				const userSpeech = res.transcript;
				if (callSid) {
					await storeTranscriptEntry(callSid, {
						role: "user",
						text: userSpeech,
					});
				}
			}

			if (res.type === "response.audio_transcript.done") {
				console.log("[Full Transcript]", res.transcript);

				const lowerTranscript = res.transcript.toLowerCase();
				if (callSid) {
					await storeTranscriptEntry(callSid, {
						role: "agent",
						text: res.transcript,
					});
				}

				// Check for call end phrases
				const shouldEndCall = CALL_END_PHRASES.some((phrase) =>
					lowerTranscript.includes(phrase)
				);

				if (shouldEndCall) {
					await handleCallEnd(res.transcript);
				}
			}

			if (res.type === "response.audio.delta" && res.delta) {
				conn.send(
					JSON.stringify({
						event: "media",
						streamSid,
						media: { payload: res.delta },
					})
				);

				if (!responseStartTimestampTwilio) {
					responseStartTimestampTwilio = latestMediaTimestamp;
				}

				if (res.item_id) {
					lastAssistantItem = res.item_id;
				}

				sendMark();
			}

			if (res.type === "input_audio_buffer.speech_started") {
				handleSpeechStartedEvent();
			}
		} catch (e) {
			console.error("Error handling OpenAI message", e);
		}
	});

	// Twilio WebSocket event handlers
	conn.on("message", async (message) => {
		try {
			const msg = JSON.parse(message);

			switch (msg.event) {
				case "start":
					streamSid = msg.start.streamSid;
					responseStartTimestampTwilio = null;
					latestMediaTimestamp = 0;
					callSid = msg.start.callSid;

					const context = await getCallContext(callSid);
					console.log("📦 Loaded context from Redis:", context);
					initializeSession(context);
					break;

				case "media":
					latestMediaTimestamp = msg.media.timestamp;
					if (openAiWs.readyState === WebSocket.OPEN) {
						openAiWs.send(
							JSON.stringify({
								type: "input_audio_buffer.append",
								audio: msg.media.payload,
							})
						);
					}
					break;

				case "mark":
					markQueue.shift();
					break;

				default:
					console.log("Unhandled event:", msg.event);
			}
		} catch (e) {
			console.error("Error parsing message", e);
		}
	});

	// Cleanup handlers
	const cleanup = async () => {
		if (callSid) {
			await deleteCallContext(callSid);
			await deleteTranscript(callSid);
			console.log(`🧹 Redis context & transcript deleted for ${callSid}`);
		}
	};

	conn.on("close", async () => {
		await cleanup();
		console.log(`Connection closed for callSid ${callSid}`);
	});

	openAiWs.on("close", async () => {
		console.log("OpenAI WebSocket connection closed");
		if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
		await cleanup();
	});

	openAiWs.on("error", (err) => console.error("OpenAI WS error:", err));
};
