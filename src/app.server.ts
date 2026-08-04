import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

export class AppServer {
  private readonly server;

  constructor() {
    this.server = createServer(this.handleRequest.bind(this));
  }

  start(port: number): void {
    this.server.listen(port, () => {
      console.log(`Server listening on http://localhost:${port}`);
    });
  }

  private handleRequest(_req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Finance Core API is running!" }));
  }
}
