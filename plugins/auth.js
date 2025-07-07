import fp from 'fastify-plugin';
import bcrypt from 'bcryptjs';

async function auth(fastify, options) {
  // Utility: comparePassword
  fastify.decorate('comparePassword', async (plain, hashed) => {
    return bcrypt.compare(plain, hashed);
  });

  // Utility: hashPassword
  fastify.decorate('hashPassword', async (plain) => {
    return bcrypt.hash(plain, 12);
  });

}

export default fp(auth);
