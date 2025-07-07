// Remove Fastify imports - these are handled by main server
import WebSocket from "ws";
import dotenv from "dotenv";
import twilio from "twilio";
import sgMail from "@sendgrid/mail";
import { OpenAI } from "openai";
import Redis from "ioredis";

// Load env vars
dotenv.config({ path: ".env" });

const {
  OPENAI_API_KEY,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  REDIS_URL,
} = process.env;

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Validate environment variables
if (
  !OPENAI_API_KEY ||
  !TWILIO_ACCOUNT_SID ||
  !TWILIO_AUTH_TOKEN ||
  !TWILIO_PHONE_NUMBER ||
  !REDIS_URL
) {
  console.error("Missing environment variables. Check your .env file.");
  process.exit(1);
}

// DTMF payloads for digit recognition
const DTMF_PAYLOADS = {
  0: "//uQxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
  1: "//uQxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGlsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGx==",
  2: "//uQxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZg==",
  3: "//uQxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAqampqampqampqampqampqampqampqampqampqag==",
  4: "//uQxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXVXQ==",
  5: "//uQxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubmZg==",
  6: "//uQxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZA==",
  7: "//uQxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZ==",
  8: "//uQxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAICAgICAgICAgICAgICAgICAgICAgICAgICAA==",
  9: "//uQxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAICAgICAgICAgICAgICAgICAgICAgICAgICAgIA==",
  "*": "//uQxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUg==",
  "#": "//uQxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAmpqamprampramprampramprampramprampramg==",
};

// Initialize clients
const redis = new Redis(REDIS_URL);
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const VOICE = "shimmer";

// Redis utility functions
const storeCallContext = async (callSid, context) => {
  await redis.set(
    `call_context:${callSid}`,
    JSON.stringify(context),
    "EX",
    3600
  );
};

const getCallContext = async (callSid) => {
  const raw = await redis.get(`call_context:${callSid}`);
  return raw ? JSON.parse(raw) : null;
};

const deleteCallContext = async (callSid) => {
  await redis.del(`call_context:${callSid}`);
};

const storeTranscriptEntry = async (callSid, entry) => {
  await redis.rpush(`transcript:${callSid}`, JSON.stringify(entry));
  await redis.expire(`transcript:${callSid}`, 3600);
};

const getTranscript = async (callSid) => {
  const items = await redis.lrange(`transcript:${callSid}`, 0, -1);
  return items.map(JSON.parse);
};

const deleteTranscript = async (callSid) => {
  await redis.del(`transcript:${callSid}`);
};

const storeCallResult = async (callSid, resultObj) => {
  await redis.set(
    `call_context:${callSid}_callresult`,
    JSON.stringify(resultObj),
    "EX",
    3600
  );
};

const getCallResult = async (callSid) => {
  const raw = await redis.get(`call_context:${callSid}`);
  return raw ? JSON.parse(raw) : null;
};

// Utility functions
const formatDateNatural = (rawDate) => {
  const date = new Date(rawDate);
  const day = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "long" });
  const suffixes = ["th", "st", "nd", "rd"];
  const suffix = suffixes[(day - 20) % 10] || suffixes[day] || suffixes[0];
  return `${month} ${day}${suffix}`;
};

const numberWords = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

const formatPriceNatural = (priceStr) => {
  const cleanPrice = priceStr.replace(/[^\dkK.]/gi, "").toLowerCase();
  if (cleanPrice.includes("k")) {
    const numValue = parseFloat(cleanPrice.replace("k", "")) * 1000;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(numValue);
  }
  const numValue = parseFloat(cleanPrice);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(numValue);
};

const parseVehicleInfo = (vehicleStr) => {
  const [namePart, pricePart] = vehicleStr.split("-").map((s) => s.trim());
  return {
    vehicleName: namePart,
    vehiclePrice: pricePart ? formatPriceNatural(pricePart) : null,
  };
};

// OpenAI helper
const getChatGPTResponse = async (messages) => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages,
      temperature: 0.3,
      max_tokens: 400,
    });
    return response.choices?.[0]?.message?.content || "No response generated.";
  } catch (error) {
    console.error("❌ OpenAI API call failed:", error);
    throw error;
  }
};

// DTMF handling
const pressDigitAndReconnect = async (callSid, digit) => {
  try {
    // const deployedHost = "d862-154-80-9-163.ngrok-free.app";
    const deployedHost = process.env.BASE_URL.replace("https://", "");
      
    console.log(`📟 Pressing digit ${digit} via TwiML redirect...`);

    await twilioClient.calls(callSid).update({
      twiml: `
        <Response>
          <Play digits="${digit}" />
          <Redirect>https://${deployedHost}/api/outgoing-call</Redirect>
        </Response>
      `,
    });

    console.log(`✅ Digit ${digit} sent via <Play>, reconnecting stream...`);
  } catch (err) {
    console.error(`❌ Failed to press digit ${digit} for ${callSid}:`, err);
  }
};

// Post-call processing
const handlePostCallTasks = async (callSid, reason = "completed") => {
  if (!callSid) {
    console.warn(`⚠️ callSid is missing, cannot perform post-call tasks.`);
    return;
  }

  try {
    const conversation = await getTranscript(callSid);
    console.log(
      `📜 Full conversation transcript for ${callSid} (${reason}):`,
      conversation
    );
    console.log("📊 Call status is:", reason);

    const { companyEmail } = await getCallContext(callSid);
    console.log("📦 Loaded call Email from Redis:", { companyEmail });

    const formatted = conversation
      .map(
        (entry) =>
          `${entry.role === "agent" ? "Agent" : "Insurance Rep"}: ${entry.text}`
      )
      .join("\n");

    let summary = null;
    if (reason === "completed") {
      console.log("🤖 Generating GPT summary of the call...");
      const systemPrompt = `You are an insurance verification assistant. Summarize this transcript from a call that attempted to verify a customer's insurance details. Focus on:
- Was the verification successful or not?
- What insurance information was confirmed (e.g. policy status, transferability)? Tell clearly whether office was closed it were not working hours or etc.
- Any issues or important points?
Keep it clear and concise. if the call is suddenly disconnected it can be due to the call being disconnected by the other party or the call being ended by the system due to inactivity.`;

      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: formatted },
      ];

      try {
        const gptResponse = await getChatGPTResponse(messages);
        summary = gptResponse;
        console.log("✅ GPT Summary:", summary);
      } catch (err) {
        console.warn("⚠️ GPT Summary generation failed:", err);
        summary = "GPT summary unavailable due to an error.";
      }
    }

    const resultObj = {
      callCompleted: reason === "completed",
      success: reason,
      callSummary: summary,
      transcription: conversation,
    };

    await storeCallResult(callSid, resultObj);
    console.log(`✅ Call result stored in Redis for ${callSid}`);
    const msg = {
      to: ["founder@fasttrk.ai", "Ike@turboexotics.com", companyEmail],
      from: "noreply@em1191.fasttrk.ai",
      subject: `Insurance Verification Call Transcript - ${callSid} (${reason})`,
      text: `Call ended reason: ${reason}
        Summary:
        ${summary || "No summary"}
        Transcript:
        ${formatted}`,
    };

    try {
      await sgMail.send(msg);
      console.log(`📧 Email sent successfully for call ${callSid}`);
    } catch (emailError) {
      console.error(`❌ Failed to send email for call ${callSid}:`, emailError);
    }

    await deleteCallContext(callSid);
    await deleteTranscript(callSid);
    console.log(`🧹 Deleted Redis context + transcript for ${callSid}`);

    const result = await getCallResult(callSid);
    console.log(`📦 Retrieved call result from Redis for ${callSid}:`, result);
  } catch (e) {
    console.error("❌ Failed to handle post-call tasks:", e);
    const resultObj = {
      callCompleted: false,
      success: false,
      callSummary: null,
      transcription: null,
    };
    await storeCallResult(callSid, resultObj);
    console.log(`⚠️ Stored failed call result in Redis for ${callSid}`);
  }
};

// ✅ MAIN ROUTE EXPORT FUNCTION
export default async function indexRoutes(fastify) {
  fastify.get("/get-response", async (req, reply) => {
    try {
      const { callId } = req.query;
      const redisKey = `call_context:${callId}`;

      const result = await getCallResult(callId);

      if (result) {
        // Delete the key after fetching the result
        await redis.del(redisKey);
        const transcriptionString = result.transcription
          ? result.transcription
            .filter((entry) => entry.text?.trim())
            .map((entry) => `${entry.role}: ${entry.text}`)
            .join("\n")
          : null;

        return reply.send({
          callCompleted: result.callCompleted ?? true,
          success: result.success,
          callSummary: result.callSummary ?? null,
          transcription: transcriptionString,
        });
      } else {
        return reply.send({
          callCompleted: false,
          success: result?.success,
          callSummary: null,
          transcription: null,
        });
      }
    } catch (err) {
      console.error("❌ Error in /get-response:", err);
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  // fastify.get("/get-response", async (req, reply) => {
  //   try {
  //     const { callId } = req.query;
  //     const result = await getCallResult(callId);
  //     // console.log(`📦 Fetching call result for ${callId}:`, result);
  //     if (result) {
  //       const transcriptionString = result.transcription
  //         ? result.transcription
  //           .filter(entry => entry.text?.trim()) // skip empty text
  //           .map(entry => `${entry.role}: ${entry.text}`)
  //           .join('\n')
  //         : null;

  //       return reply.send({
  //         callCompleted: result.callCompleted ?? true,
  //         success: result.success,
  //         callSummary: result.callSummary ?? null,
  //         transcription: transcriptionString,
  //       });
  //     }

  //     return reply.send({
  //       callCompleted: false,
  //       success: result?.success,
  //       callSummary: null,
  //       transcription: null,
  //     });
  //   } catch (err) {
  //     console.error("❌ Error fetching call result:", err);
  //     return reply.code(500).send({ error: "Failed to fetch call result" });
  //   }
  // });

  fastify.post("/call-status", async (req, reply) => {
    const { CallSid, CallStatus, CallDuration } = req.body;
    console.log(req.body);
    console.log(
      `📞 Call status update - SID: ${CallSid}, Status: ${CallStatus}, Duration: ${CallDuration}s`
    );

    if (
      ["completed", "busy", "failed", "no-answer", "canceled"].includes(
        CallStatus
      )
    ) {
      console.log(`🔚 Call ${CallSid} ended with status: ${CallStatus}`);
      setTimeout(async () => {
        await handlePostCallTasks(CallSid, CallStatus);
      }, 2000);
    }

    reply.send({ status: "received" });
  });

  // Start call endpoint
  fastify.post("/start-call", async (req, reply) => {
    const {
      to,
      customerName,
      vehicleName,
      rentalStartDate,
      rentalDays,
      state,
      driverLicense,
      insuranceProvider,
      policyNumber,
      companyName,
      companyEmail,
      policyRegistrationPhone,
    } = req.body;

    if (!to) {
      return reply.code(400).send({ error: 'Missing "to" phone number' });
    }

    try {
      const deployedHost = process.env.BASE_URL.replace("https://", "");
      // const deployedHost = "d862-154-80-9-163.ngrok-free.app";
      const call = await twilioClient.calls.create({
        url: `https://${deployedHost}/api/outgoing-call`,
        statusCallback: `https://${deployedHost}/api/call-status`,
        statusCallbackEvent: [
          "completed",
          "busy",
          "failed",
          "no-answer",
          "canceled",
        ],
        statusCallbackMethod: "POST",
        record: true,
        to,
        from: TWILIO_PHONE_NUMBER,
      });

      const context = {
        customerName,
        vehicleName,
        rentalStartDate,
        rentalDays,
        state,
        driverLicense,
        insuranceProvider,
        policyNumber,
        companyName,
        companyEmail: companyEmail || "aliahmad@gmail.com",
        policyRegistrationPhone,
      };

      await storeCallContext(call.sid, context);
      console.log(`📞 Call SID: ${call.sid}`);
      console.log("🗂️ Stored call context to Redis:", context);

      reply.send({
        callId: `${call.sid}_callresult`,
        success: true,
        message: "Call initiated successfully",
      });
    } catch (err) {
      console.error("❌ Failed to start call:", err);
      reply.code(500).send({ error: "Failed to initiate call" });
    }
  });

  // Outgoing call TwiML
  fastify.all("/outgoing-call", async (req, reply) => {
    // const deployedHost = "d862-154-80-9-163.ngrok-free.app";
    const deployedHost = process.env.BASE_URL.replace("https://", "");  
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Connect>
        <Stream url="wss://${deployedHost}/api/media-stream">
          
        </Stream>
      </Connect>
    </Response>`;
    reply.type("text/xml").send(twiml);
  });

  // ✅ WebSocket route - properly structured
  fastify.register(async (fastify) => {
    fastify.get("/media-stream", { websocket: true }, (conn, req) => {
      let streamSid = null;
      let latestMediaTimestamp = 0;
      let lastAssistantItem = null;
      let markQueue = [];
      let responseStartTimestampTwilio = null;
      let callSid = null;
      let silenceTimeout = null;
      const SILENCE_LIMIT_MS = 40000;
      const openAiWs = new WebSocket(
        "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01",
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "OpenAI-Beta": "realtime=v1",
          },
        }
      );
      const resetSilenceTimer = () => {
        if (silenceTimeout) clearTimeout(silenceTimeout);
        silenceTimeout = setTimeout(async () => {
          if (callSid) {
            console.warn(`🕓 No speech from other party for 40s. Ending call ${callSid}...`);
            try {
              await twilioClient.calls(callSid).update({ status: "completed" });
              console.log(`✅ Call ${callSid} ended due to silence.`);
            } catch (err) {
              console.error(`❌ Failed to end call ${callSid}:`, err);
            }
          }
        }, SILENCE_LIMIT_MS);
      };

      const initializeSession = (context) => {
        let contextString = "";
        if (context) {
          const {
            customerName,
            vehicleName,
            rentalStartDate,
            rentalDays,
            state,
            driverLicense,
            insuranceProvider,
            policyNumber,
            companyName,
            policyRegistrationPhone,
          } = context;

          console.log("📦 Context received:", context);
          const { vehicleName: vehicleType, vehiclePrice } = parseVehicleInfo(
            context.vehicleName
          );
          const startDateNatural = formatDateNatural(context.rentalStartDate);
          const daysNatural =
            context.rentalDays === "1"
              ? "one day"
              : `${context.rentalDays} days`;
          const vehicleDesc = vehiclePrice
            ? `${vehicleType} valued at ${vehiclePrice}`
            : vehicleType;

          contextString = `
You are an AI assistant calling ${insuranceProvider} to verify insurance coverage for a rental customer. your name is Susan

Customer:
- Name: ${customerName}
- Vehicle: ${vehicleDesc}
- Rental: Starts ${startDateNatural}, for ${daysNatural}
- State: ${state}
- Driver License: ${driverLicense}
- Policy Number: ${policyNumber}
- Renter Company Name: ${companyName}
- User Policy Registration Phone: ${policyRegistrationPhone}
`;
        }

        const SYSTEM_MESSAGE = `
${contextString}

🎯 You are calling from ${context?.companyName
          }. Your goal is to confirm insurance coverage with ${context?.insuranceProvider || "the insurance provider"
          } for a rental vehicle.

🌐 Language:
- Speak **only English**
- If asked to switch languages, **do not press anything**. Stay in English.

🧠 Behavior Rules (Follow Exactly):

1. 🔇 **Stay silent unless clearly prompted**
   - Ignore system messages like "this call may be recorded"
   - Don't respond until IVR or human asks a question or gives menu/options

2. 🧏 **Do not speak first**
   - If unclear, wait silently for repetition or next step

3. 🎛 **IVR Handling**
   - Let menus finish before responding
   - Say **"press [digit]"** to simulate DTMF, only when sure
   - Don't press options that switch languages

4. 🗣 **Speak briefly and clearly**
   - Keep replies minimal, factual, and on-topic
   - No small talk or repetition
   - Never restate the full context unless asked

5. 👤 **Human Escalation**
   - If system can't verify policy, say:
      *"I need to speak to a human representative to complete the insurance verification."*
      If he not takes you to the human try to coordinate to get the details verified.

6. If it says no human agent is available or its not the working hours then simply say 'Have a good day' and end the call

❓ What You Must Confirm:

1. Can I provide you with their policy number and driver's license number to verify their policy?
  - Only proceed if the agent confirms that they can verify using the policy number and driver's license.
  - If the answer is unclear or denied, **end the verification attempt politely and do not continue.**

2. Does this policy have full coverage or liability only?

3. Can you verify that the customer's policy will carry over to our rental vehicle and your company will cover comprehensive, collision, and/or physical damage to our vehicle while being rented — including theft or vandalism while in the renter's care and custody?

4. Are you able to verify the renter's liability limit amounts and confirm that it will carry over as well?

5. Can you confirm that they have an active policy that's been effective for more than 30 days? (If not, ask if it would still provide coverage.)

Once all answers are collected, say:
"Thank you for confirming and being of assistance today. Have a nice day, goodbye"

📌 What You Know:
- Customer: ${context?.customerName}
- Vehicle: ${context?.vehicleName}
- Rental: ${formatDateNatural(context?.rentalStartDate)} for ${context?.rentalDays
          } days
- State: ${context?.state}
- License: ${context?.driverLicense}
- Policy #: ${context?.policyNumber}
- Renter Company Name: ${context?.companyName}
- User Policy Registration Phone: ${context?.policyRegistrationPhone}

📝 If asked what this is about in few words, say:
  "I'm calling from ${context?.companyName
          } Car Rentals to verify insurance coverage for ${context?.customerName}.
  
  when proper verfications starts you can say
  So our customer ${context?.customerName} is renting a ${context?.vehicleName
          } starting ${formatDateNatural(context?.rentalStartDate)} for ${context?.rentalDays
          } days in ${context?.state
          }. I need to confirm if their policy covers our rental vehicle."

  if denied about providing the policy details, you tell them that this call is being made by the approval of the customer.

  Be professional. Be silent unless required. Focus only on insurance verification.
`;

        const sessionUpdate = {
          type: "session.update",
          session: {
            turn_detection: { type: "server_vad" },
            input_audio_format: "g711_ulaw",
            output_audio_format: "g711_ulaw",
            voice: VOICE,
            instructions: SYSTEM_MESSAGE,
            modalities: ["text", "audio"],
            temperature: 0.7,
            input_audio_transcription: { model: "whisper-1" },
          },
        };

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

      // OpenAI message handling
      openAiWs.on("message", async (data) => {
        try {
          const res = JSON.parse(data);

          if (
            res.type === "conversation.item.input_audio_transcription.completed"
          ) {
            const userSpeech = res.transcript;
            console.log("[User Speech]", userSpeech);
            if (callSid) {
              await storeTranscriptEntry(callSid, {
                role: "user",
                text: userSpeech,
              });
            }
          }

          if (res.type === "response.audio_transcript.done") {
            console.log("[Bot Transcript]", res.transcript);
            const lowerTranscript = res.transcript.toLowerCase();

            if (callSid) {
              await storeTranscriptEntry(callSid, {
                role: "agent",
                text: res.transcript,
              });

              // DTMF detection
              const cleanTranscript = res.transcript.trim().toLowerCase();
              const simplified = cleanTranscript.replace(/[^a-z0-9 ]/gi, "");

              let spokenDigit = null;
              for (const [word, digit] of Object.entries(numberWords)) {
                if (
                  simplified.includes(`press ${word}`) ||
                  simplified.includes(`number ${word}`)
                ) {
                  spokenDigit = digit;
                  break;
                }
              }

              const dtmfMatch = simplified.match(
                /\b(?:press|dial|number)\s+(\d)\b/
              );
              const digit = dtmfMatch?.[1] || spokenDigit;

              if (digit && callSid) {
                console.log(`📟 DTMF requested: ${digit}`);
                await pressDigitAndReconnect(callSid, digit);

                const isJustPressing =
                  simplified.includes(`i will press ${digit}`) ||
                  simplified.includes(`press ${digit}`) ||
                  simplified.includes(`number ${digit}`) ||
                  simplified.includes(`dial ${digit}`);

                if (isJustPressing) {
                  console.log(`🔇 Skipping TTS: matched DTMF-only sentence`);
                  return;
                }
                console.log(
                  `📟 Pressed ${digit}, but will also speak: "${res.transcript}"`
                );
              }
            }

            // Call ending detection
            const endingPhrases = [
              "goodbye",
              "have a great day",
              "have a nice day",
              "unable to help",
              "unable to help",
              "can not verify",
              "thanks for calling",
            ];

            const shouldEnd =
              endingPhrases.some((phrase) =>
                lowerTranscript.includes(phrase)
              ) ||
              (lowerTranscript.includes("thank you") &&
                lowerTranscript.includes("bye"));

            if (shouldEnd && callSid) {
              setTimeout(async () => {
                try {
                  await twilioClient
                    .calls(callSid)
                    .update({ status: "completed" });
                  console.log(`✅ Call ${callSid} ended by AI after delay.`);
                } catch (err) {
                  console.error(`❌ Failed to end call ${callSid}:`, err);
                }
              }, 6000);
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
            resetSilenceTimer();
          }
        } catch (e) {
          console.error("Error handling OpenAI message", e);
        }
      });

      // Twilio WebSocket message handling
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
              resetSilenceTimer();
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

      // Connection cleanup
      conn.on("close", () => {
        if (silenceTimeout) clearTimeout(silenceTimeout);

        console.log(`🔌 WebSocket connection closed for callSid ${callSid}`);
      });

      openAiWs.on("close", () => {
        if (silenceTimeout) clearTimeout(silenceTimeout);

        console.log("OpenAI WebSocket connection closed for callSid", callSid);
      });

      openAiWs.on("error", (err) => console.error("OpenAI WS error:", err));
    });
  });
}
