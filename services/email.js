import sgMail from "@sendgrid/mail";
import { SENDGRID_API_KEY } from "../config/env.js";

// Initialize SendGrid
sgMail.setApiKey(SENDGRID_API_KEY);

export const sendTranscriptEmail = async (callSid, conversation) => {
  try {
    const formatted = conversation
      .map(entry => 
        `${entry.role === "agent" ? "Agent" : "User"}: ${entry.text}`
      )
      .join("\n");

    const msg = {
      to: ["founder@fasttrk.ai", "Ike@turboexotics.com"],
      from: "noreply@em1191.fasttrk.ai",
      subject: `Call Transcript for ${callSid}`,
      text: formatted,
    };

    await sgMail.send(msg);
    console.log(`✅ Transcript email sent successfully for call ${callSid}`);
  } catch (error) {
    console.error(`❌ Error sending transcript email for ${callSid}:`, error);
    throw error;
  }
};