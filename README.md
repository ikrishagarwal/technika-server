# Server for Technika 25

This repository contains the server-side code for Technika 25. The server is built using Fastify and TypeScript.

# Technologies Used

- Fastify: A fast and low-overhead web framework for Node.js.
- TypeScript: A strongly typed programming language that builds on JavaScript.

# Setup Instructions

1. Install `Node.js`, `pnpm` and `Nodemon` if you haven't already.
2. Run `pnpm install`
3. Make a copy of `.env.example` and rename it to `.env`. Fill in the required environment variables.
4. Open two terminal tabs.
5. In first tab, run `pnpm run watch:ts` to watch for TypeScript changes.
6. In second tab, run `pnpm run watch:start` to start the server in development mode.

# Important Information

- Base URL: `http://localhost:3000`
- WebSocket URL: `ws://localhost:3000/ws`

# Authors

- [Krish](https://github.com/ikrishagarwal)
