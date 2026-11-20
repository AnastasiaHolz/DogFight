function installRoutes(server) {
  server.middlewares.use((request, response, next) => {
    if (request.method !== "GET" || !request.url) return next();
    const url = new URL(request.url, "http://localhost");

    if (url.pathname === "/api/rooms") {
      request.url = `/api/rooms.json${url.search}`;
      return next();
    }
    if (url.pathname === "/__lab03/missing-sprite") {
      response.statusCode = 404;
      response.end("Sprite not found");
      return;
    }
    if (url.pathname === "/__lab03/bad-json") {
      response.setHeader("Content-Type", "application/json");
      response.end('{"width":');
      return;
    }

    const delays = { bench: 120, timeout: 1300, abort: 3500 };
    const delay = delays[url.searchParams.get("labDelay")];
    if (url.pathname.startsWith("/assets/") && Number.isInteger(delay)) {
      const timer = setTimeout(next, delay);
      response.once("close", () => clearTimeout(timer));
      return;
    }
    next();
  });
}

export default {
  plugins: [
    {
      name: "dogfight-lab03-routes",
      configureServer: installRoutes,
      configurePreviewServer: installRoutes,
    },
  ],
};
