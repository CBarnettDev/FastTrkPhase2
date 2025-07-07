import fastifyMultipart from "@fastify/multipart";
import {
  signupHandler,
  loginHandler,
  logoutHandler,
  getCurrentUserHandler,
} from "../handlers/authHandlers.js";

async function authRoutes(fastify) {
  await fastify.register(fastifyMultipart, {
    attachFieldsToBody: true,
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1,
    },
  });

  fastify.post("/signup", signupHandler);
  fastify.post("/login", loginHandler);
  fastify.post("/logout", logoutHandler);
  fastify.get("/me", { preValidation: [fastify.authenticate] }, getCurrentUserHandler);
}

export default authRoutes;
