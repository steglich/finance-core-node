import { AppServer } from "./app.server.js";
import dotenv from 'dotenv';

dotenv.config();

const PORT = +`${process.env.PORT ?? '3000'}`;

const app = new AppServer();
app.start(PORT);
