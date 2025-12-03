export const TiQR_API_URI = "https://api.tiqr.events/";

export const ApiEndpoints = {
  fetchBooking: (uid: string) => TiQR_API_URI + `participant/booking/${uid}/`,
  createBooking: () => TiQR_API_URI + `participant/booking/`,
};

export const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
export const ApiToken = process.env.API_TOKEN || "";
export const WebhookSecret = process.env.WEBHOOK_TOKEN || "";
