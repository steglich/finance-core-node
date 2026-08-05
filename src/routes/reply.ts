import type { FastifyReply } from "fastify";
import type { ControllerResult } from "../shared/api/controller-result.js";

/**
 * Sends a controller result as the HTTP response.
 * Routes are the only place allowed to write to the reply.
 */
export function sendResult(
  reply: FastifyReply,
  result: ControllerResult,
): FastifyReply {
  return reply.code(result.statusCode).send(result.body);
}
