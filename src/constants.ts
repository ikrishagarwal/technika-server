export const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
export const FRONT_END_BASE_URL =
  process.env.FRONT_END_BASE_URL || "https://technika.co";
export const ApiToken = process.env.API_TOKEN || "";
export const WebhookSecret = process.env.WEBHOOK_TOKEN || "";

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
  GroupEvent = 2412,
  SoloEvent = 2411,
  Accommodation = 2440,
}

export const EventMappings: Record<string, string> = {
  "2387": "alumni_registrations",
  "2399": "delegate",
  "2440": "accommodation",
};

export const AllowedTicketIds = process.env["TICKETS"]
  ? process.env["TICKETS"]
      .split(",")
      .map((t) => Number(t))
      .filter((t) => !isNaN(t))
  : [];

// LEGACY
// export enum EventIds {
//   Delegate = 1683,
// }
