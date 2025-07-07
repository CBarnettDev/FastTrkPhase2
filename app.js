import Fastify from "fastify";
import fastifyFormbody from "@fastify/formbody";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import fastifyJwt from "@fastify/jwt";
import fastifyWs from "@fastify/websocket"; // ✅ ADD THIS IMPORT
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { PrismaClient } from "./generated/prisma/index.js";
import auth from "./plugins/auth.js";
import authRoutes from "./routes/auth.js";
import vehicleRoutes from "./routes/vehicles.js";
import indexRoutes from './routes/index.js';

// Load env vars
dotenv.config();

// __dirname fix for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// App setup
const PORT = process.env.PORT || 8080;
const fastify = Fastify({ logger: true, pluginTimeout: 30000 }); // ✅ ADD pluginTimeout
const prisma = new PrismaClient();

// Register plugins in correct order
await fastify.register(fastifyCors, {
  origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
});

await fastify.register(fastifyFormbody);
await fastify.register(fastifyCookie);

// ✅ REGISTER WEBSOCKET PLUGIN BEFORE ROUTES
await fastify.register(fastifyWs);

await fastify.register(fastifyJwt, {
  secret: process.env.JWT_SECRET,
  sign: { expiresIn: "7d" },
  cookie: {
    cookieName: "token",
    signed: false,
  },
});

// JWT Auth decorator
fastify.decorate("authenticate", async (request, reply) => {
  try {
    const token = request.cookies.token;
    if (!token)
      return reply.code(401).send({ message: "Unauthorized - No token" });
    const decoded = fastify.jwt.verify(token);
    request.user = decoded;
  } catch (err) {
    reply.clearCookie("token", { path: "/" });
    return reply.code(401).send({ message: "Unauthorized - Invalid token" });
  }
});

// Prisma instance on Fastify
fastify.decorate("prisma", prisma);

// Static assets
await fastify.register(fastifyStatic, {
  root: path.join(__dirname, "public"),
  prefix: "/public/",
  decorateReply: false,
});

// Register internal plugins and routes
await fastify.register(auth);
await fastify.register(authRoutes, { prefix: "/api/auth" });
await fastify.register(vehicleRoutes, { prefix: "/api/vehicles" });
await fastify.register(indexRoutes, { prefix: "/api" }); // ✅ WebSocket routes will work now

// Start the server
const start = async () => {
  try {
    await prisma.$connect();
    console.log("✅ PostgreSQL (Prisma) connected");

    await fastify.listen({ port: PORT || 3000, host: "0.0.0.0" });
    console.log("🚀 Server running");

  } catch (err) {
    console.error("❌ Server error:", err);
    process.exit(1);
  }
};


// Graceful shutdown
process.on("SIGINT", async () => {
  await prisma.$disconnect();
  console.log("🛑 Prisma disconnected on SIGINT");
  process.exit(0);
});

start();