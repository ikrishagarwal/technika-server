![Cover Image](https://tiqr.events/_next/image/?url=https%3A%2F%2Ftiqr-events.sgp1.cdn.digitaloceanspaces.com%2Ftiqr-events%2Fmedia%2Fimages%2F6346d159dd464de0ac14b03a1460c92c-technika_16_x_9_in.png&w=1920&q=75)

<center>

![GitHub commit activity](https://img.shields.io/github/commit-activity/t/ikrishagarwal/technika-server)
![Git Last Commit](https://img.shields.io/github/last-commit/ikrishagarwal/technika-server)
![Uptime Robot status](https://img.shields.io/uptimerobot/status/m801916595-5ce31760bdd16adce6d296e8)

</center>

# Server for Technika 25

This repository contains the server-side code for Technika 25. The server is built using Fastify and TypeScript.

# Endpoints

### Accommodation

- `POST /accommodation/book`: Book new accommodation slots.
- `GET /accommodation/status`: Get your accommodation booking status.

### Alumni

- `POST /alumni/register`: Make a new registration as an alumni.
- `GET /alumni/status`: Get your alumni registration status.

### Delegate

- `POST /delegate/create`: Create a new room for group delegate registration.
- `POST /delegate/join`: Join a group delegate room with the room code.
- `DELETE /delegate/leave`: Leave the delegate room you are a part of.
- `DELETE /delegate/delete`: Delete the delegate room you created.

- `GET /delegate/status/user`: Get your delegate registration status (per user).
- `GET /delegate/status/room/:roomId`: Get the status of a delegate room by it's room ID.

  > Note: You must be a part of the room to access this endpoint.

- `POST /delegate/register/self`: Register a delegate booking for yourself (individual).
- `POST /delegate/register/group`: Register tickets for all members in your delegate room (group owner exclusive).

#### Legacy Delegate Endpoints

> Note: These are the old endpoints for how we managed delegate bookings previously which is now heavily changed, thus all these endpoints are deprecated but still kept as a part of codebase for legacy support.

- `POST /delegate/book-self`: Book delegate tickets for yourself.
- `POST /delegate/book-group`: Book delegate tickets for a bunch of people.

- `GET /delegate/status-self`: Get your delegate booking registration status.
- `GET /delegate/status-group`: Get your delegate group booking registration status.

- `DELETE /delegate/group-reset`: Reset your group delegate members list.

### Events

- `POST /event/book`: Book tickets for any event.
- `GET /event/status/:eventId`: Get your booking status for a specific event.
- `GET /events/registered`: Get a list of all the event you initiated a registration for. May it be pending or confirmed.

### Webhook

- `POST /webhook`: Webhook endpoint for our payment provider to notify us about the payment status changes.

## Non Production Endpoints

> Note: These endpoints are exclusively for testing purposes and shouldn't be used in production under any circumstances as they are not well written will security in mind.

### Book Any Ticket

- `POST /book/:uid`: Book any ticket if you have a ticket ID.
- `GET /book/:uid/status`: Get the booking status for the ticket ID you booked for.

### Proxy Endpoints

> Note: These endpoints require you to have a secret header while making a request.

- `POST /booking`: Proxy endpoint to create booking directly via the payment provider.
- `GET /booking/:uid`: If you have the booking UID, this endpoint can be used to fetch it's details.

## Plugins (Deprecated)

URL: `/ws`

It's a websocket endpoint which was previously planned to update the client real time for any changes made to the booking status. However, it never made it to production and now it's out of the scope of this project, thus deprecated.

# Technologies Used

- Fastify: A fast and low-overhead web framework for Node.js.
- TypeScript: A strongly typed programming language that builds on JavaScript.

# Setup Instructions

1. Install `Node.js`, `pnpm` and `Nodemon` if you haven't already.
2. Run `pnpm install`
3. Make a copy of `.env.example` and rename it to `.env`. Fill in the required environment variables.
4. Create a Firebase service account and download the JSON key file. Save it as `serviceAccountKey.json` in the root directory.
5. Open two terminal tabs.
6. In first tab, run `pnpm run watch:ts` to watch for TypeScript changes.
7. In second tab, run `pnpm run watch:start` to start the server in development mode.

# Important Information

- Base URL: `http://localhost:3000`
- WebSocket URL: `ws://localhost:3000/ws`

# Lore

The main goal of this project apart from providing backend services for Technika 25 is to learn API development in depth with fastify, get my hands dirty with firebase. Along with this, I also reviewed more of Typescript and better type safety with Zod and error management with Sentry. Summing up with a better understanding of how to structure a backend project.

# Authors

- [Krish](https://github.com/ikrishagarwal)
