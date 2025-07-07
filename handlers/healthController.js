export const handleHealthCheck = async (req, reply) => {
  reply.send({ status: "Twilio Voice AI server running" });
};