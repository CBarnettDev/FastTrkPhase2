import {
  createVehicleHandler,
  getVehiclesHandler,
  getVehicleByIdHandler,
  updateVehicleHandler,
  deleteVehicleHandler,
} from "../handlers/vehicleHandlers.js";

async function vehicleRoutes(fastify) {
  fastify.post("/", { preValidation: [fastify.authenticate] }, createVehicleHandler);
  fastify.get("/", { preValidation: [fastify.authenticate] }, getVehiclesHandler);
  fastify.get("/:id", { preValidation: [fastify.authenticate] }, getVehicleByIdHandler);
  fastify.put("/:id", { preValidation: [fastify.authenticate] }, updateVehicleHandler);
  fastify.delete("/:id", { preValidation: [fastify.authenticate] }, deleteVehicleHandler);
}

export default vehicleRoutes;
