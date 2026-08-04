import { AppServer } from "./app.server.js";

const PORT = 3000;

const app = new AppServer();
app.start(PORT);
