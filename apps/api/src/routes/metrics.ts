import { Elysia } from "elysia";
import { getPrometheusMetrics } from "../services/prometheus";

export const metricsRoutes = new Elysia().get("/metrics/prometheus", async ({ set }) => {
  set.headers["content-type"] = "text/plain; version=0.0.4; charset=utf-8";
  return getPrometheusMetrics();
});
