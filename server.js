// No top-level await: Passenger (used by Hostinger) loads this file with require().
import { exitOnStartupError, startServer } from './server/app.js';

startServer().catch(exitOnStartupError);
