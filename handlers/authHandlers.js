const getField = (field) =>
  typeof field?.value === "string" ? field.value : field?.value || "";

export async function signupHandler(request, reply) {
  try {
    const body = request.body || {};
    const name = getField(body.name);
    const email = getField(body.email);
    const password = getField(body.password);
    const companyName = getField(body.companyName);

    let logoBuffer = null;
    if (body.logo && typeof body.logo.toBuffer === "function") {
      logoBuffer = await body.logo.toBuffer();
    }

    if (!name || !email || !password || !companyName) {
      return reply.code(400).send({ message: "Missing required fields" });
    }

    const existing = await request.server.prisma.user.findUnique({
      where: { email },
    });
    if (existing) {
      return reply.code(400).send({ message: "Email already in use" });
    }

    const hashedPassword = await request.server.hashPassword(password);

    const user = await request.server.prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        companyName,
        logo: logoBuffer,
      },
    });

    const token = request.server.jwt.sign({
      userId: user.id,
      email: user.email,
    });
 reply.setCookie("token", token, {
      httpOnly: true,
      secure: true, 
      domain: '.fasttrk.ai',
      path: "/",
      sameSite: "none",
      maxAge: 60 * 60 * 24 * 7,
    });
    return reply.code(201).send({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        companyName: user.companyName,
        logo: user.logo ? user.logo.toString("base64") : null,
      },
    });
  } catch (error) {
    request.server.log.error(error);
    return reply.code(500).send({ message: "Registration failed" });
  }
}

export async function loginHandler(request, reply) {
  try {
    let email, password;

    if (request.isMultipart()) {
      const body = request.body || {};
      email = getField(body.email);
      password = getField(body.password);
    } else {
      ({ email, password } = request.body || {});
    }

    if (!email || !password) {
      return reply.code(400).send({ message: "Missing credentials" });
    }

    const user = await request.server.prisma.user.findUnique({
      where: { email },
    });
    if (
      !user ||
      !(await request.server.comparePassword(password, user.password))
    ) {
      return reply.code(401).send({ message: "Invalid credentials" });
    }

    const token = request.server.jwt.sign({
      userId: user.id,
      email: user.email,
    });

  reply.setCookie("token", token, {
      httpOnly: true,
      secure: true, 
      domain: '.fasttrk.ai',
      path: "/",
      sameSite: "none",
      maxAge: 60 * 60 * 24 * 7,
    });

    return reply.send({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        companyName: user.companyName,
        logo: user.logo ? user.logo.toString("base64") : null,
      },
    });
  } catch (error) {
    request.server.log.error(error);
    return reply.code(500).send({ message: "Login failed" });
  }
}

export async function logoutHandler(_, reply) {
  reply.clearCookie("token", { path: "/" });
  return reply.send({ message: "Logged out successfully" });
}

export async function getCurrentUserHandler(request, reply) {
  try {
    const user = await request.server.prisma.user.findUnique({
      where: { id: request.user.userId },
      select: {
        id: true,
        name: true,
        email: true,
        companyName: true,
        logo: true,
      },
    });

    if (!user) {
      return reply.code(404).send({ message: "User not found" });
    }

    return reply.send({
      ...user,
      logo: user.logo ? user.logo.toString("base64") : null,
    });
  } catch (error) {
    request.server.log.error(error);
    return reply.code(500).send({ message: "Server error" });
  }
}
