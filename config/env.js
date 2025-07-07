import dotenv from "dotenv";

dotenv.config({ path: ".env.development" });

export const {
  OPENAI_API_KEY,
  PORT = 3000,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  REDIS_URL,
  BASE_URL,
  SENDGRID_API_KEY
} = process.env;

const requiredEnvVars = [
  'OPENAI_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
  'REDIS_URL',
  'BASE_URL',
  'SENDGRID_API_KEY'
];

export const validateEnv = () => {
  const missing = requiredEnvVars.filter(key => !process.env[key]);
  
  if (missing.length > 0) {

    process.exit(1);
  }

};