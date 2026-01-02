export const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
export const FRONT_END_BASE_URL =
  process.env.FRONT_END_BASE_URL || "https://technika.co";
export const ApiToken = process.env.API_TOKEN || "";
export const WebhookSecret = process.env.WEBHOOK_TOKEN || "";
export const BIT_EMAILS = process.env.BIT_EMAILS
  ? JSON.parse(process.env.BIT_EMAILS)
  : [];

export const PaymentBaseUrl = "https://payments.juspay.in/payment-page/order/";

export enum PaymentStatus {
  Confirmed = "confirmed",
  Failed = "failed",
  PendingPayment = "pending_payment",
}

export enum Tickets {
  Alumni = 2387,
  Delegate = 2399,
  DelegateComplimentary = 2416,
  Accommodation = 2440,
  MerchTee = 2475,
  MerchJacket = 2474,
  MerchCombo = 2476,
}

export const EventMappings: Record<number, string> = {
  [Tickets.Alumni]: "alumni_registrations",
  [Tickets.Delegate]: "delegates",
  [Tickets.DelegateComplimentary]: "delegates",
  [Tickets.Accommodation]: "accommodation",
  [Tickets.MerchTee]: "merchandise",
  [Tickets.MerchJacket]: "merchandise",
  [Tickets.MerchCombo]: "merchandise",
};

export const AllowedTicketIds = process.env["TICKETS"]
  ? process.env["TICKETS"]
      .split(",")
      .map((t) => Number(t))
      .filter((t) => !isNaN(t))
  : [];

export const TicketPriceToIdMap = {
  99: 2466,
  199: 2454,
  149: 2455,
  299: 2456,
  399: 2463,
  599: 2460,
  499: 2457,
  249: 2458,
  699: 2459,
};

export const EventTickets = Object.values(TicketPriceToIdMap);

export const EventIdToPriceMap = {
  // Technical
  1: 499, // hackathon
  2: 199, // cp
  3: 199, // ampere_assemble
  4: 499, // robo_war
  5: 499, // robo_soccer
  6: 499, // robo_race
  7: 199, // tall_tower
  8: 199, // bridge_the_gap
  9: 199, // multisim_mavericks
  10: 149, // startup_sphere
  11: 199, // cad_modelling
  12: 199, // brain_brawl
  13: 199, // utility_bot

  // Cultural
  101: 149, // solo_saga
  102: 699, // exuberance
  103: 249, // synced_showdown
  104: 149, // raag_unreleased
  105: 299, // fusion_fiesta
  106: 199, // musical_marvel
  107: 149, // ekanki
  108: 599, // matargasthi
  109: 699, // hulchul
  111: 149, // kavi_sammelan
  112: 149, // debate
  113: 399, // fashion_insta

  // Cultural (new)
  115: 149, // street_dance
  116: 149, // pencil_perfection
  117: 149, // wall_painting

  // Frame & Focus
  118: 99, // motion_e_magic (price not confirmed)
  119: 99, // capture_the_unseen (price not confirmed)

  120: 149, // poetry_english
  121: 149, // poetry_hindi

  // Fun
  // 201: undefined, // escape_room (on-spot / not fixed)

  // ESports
  301: 0, // bgmi - free
  302: 249, // valorant
  303: undefined, // fifa (on-spot)
  304: undefined, // tekken (on-spot)
  305: 0, // cricket
};

export const SoloEvents = [
  2, 9, 10, 11, 101, 104, 107, 111, 112, 116, 119, 120, 121, 303, 304,
];

// LEGACY
// export enum EventIds {
//   Delegate = 1683,
// }
