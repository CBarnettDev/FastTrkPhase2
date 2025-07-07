export async function createVehicleHandler(req, reply) {
  const { model, name, price } = req.body;

  if (!model || !name || !price) {
    return reply.code(400).send({ message: "Missing required fields" });
  }

  const vehicle = await req.server.prisma.vehicle.create({
    data: {
      model,
      name,
      price: parseFloat(price),
      userId: req.user.userId,
    },
  });

  return reply.code(201).send(vehicle);
}

export async function getVehiclesHandler(req, reply) {
  const vehicles = await req.server.prisma.vehicle.findMany({
    where: { userId: req.user.userId },
    orderBy: { createdAt: "desc" },
  });

  return reply.send(vehicles);
}

export async function getVehicleByIdHandler(req, reply) {
  const vehicle = await req.server.prisma.vehicle.findFirst({
    where: { id: parseInt(req.params.id), userId: req.user.userId },
  });

  if (!vehicle) {
    return reply.code(404).send({ message: "Vehicle not found" });
  }

  return reply.send(vehicle);
}

export async function updateVehicleHandler(req, reply) {
  const { model, name, price } = req.body;

  const updated = await req.server.prisma.vehicle.updateMany({
    where: { id: parseInt(req.params.id), userId: req.user.userId },
    data: { model, name, price: parseFloat(price) },
  });

  if (updated.count === 0) {
    return reply.code(404).send({ message: "Vehicle not found" });
  }

  return reply.send({ message: "Vehicle updated successfully" });
}

export async function deleteVehicleHandler(req, reply) {
  const deleted = await req.server.prisma.vehicle.deleteMany({
    where: { id: parseInt(req.params.id), userId: req.user.userId },
  });

  if (deleted.count === 0) {
    return reply.code(404).send({ message: "Vehicle not found" });
  }

  return reply.send({ message: "Vehicle deleted successfully" });
}
