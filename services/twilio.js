import twilio from "twilio";
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  BASE_URL,
} from "../config/env.js";

// Initialize Twilio client
export const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

export const createCall = async (toNumber, req) => {
  try {
    const deployedHost = "ba1c-103-151-43-230.ngrok-free.app"; 
    
    const call = await twilioClient.calls.create({
      url: `https://${deployedHost}/outgoing-call`,
      to: toNumber,
      from: TWILIO_PHONE_NUMBER,
    });

    console.log(`📞 Call created with SID: ${call.sid}`);
    return call;
  } catch (error) {
    console.error("❌ Failed to create call:", error);
    throw error;
  }
};

export const endCall = async (callSid) => {
  try {
    await twilioClient.calls(callSid).update({ status: "completed" });
    console.log(`✅ Call ${callSid} ended successfully`);
  } catch (error) {
    console.error(`❌ Failed to end call ${callSid}:`, error);
    throw error;
  }
};

export const generateOutgoingCallTwiML = () => {
  //const deployedHost = BASE_URL.replace("https://", "");
  const deployedHost =
    "ba1c-103-151-43-230.ngrok-free.app";

  return `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say voice="Polly.Joanna">You are now connected with FAST TRACK AI assistant.</Say>
      <Pause length="1"/>
      <Say voice="Polly.Joanna">Transfering your call to Fast Track Agent, Speak when you are ready.</Say>
      <Connect>
        <Stream url="wss://${deployedHost}/media-stream" />
      </Connect>
    </Response>`;
};
