import Fastify from "fastify";
const fastify = Fastify({ logger: false });

fastify.get("/", async (request, reply) => {
    reply.send({ hello: "world" })
}
)


// server start (npm start)
try {
    fastify.listen({ port: 3001 })
    console.log("server started successfully at 3001")
} catch (err) {
    fastify.log.error(err)
    process.exit(1)
}