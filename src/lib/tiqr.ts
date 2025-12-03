import { ApiToken } from "../constants";

export class TiQR {
  static BASE_URL = "https://api.tiqr.events/";

  static async createBooking(bookingData: object) {
    try {
      return fetch(`${TiQR.BASE_URL}participant/booking/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ApiToken}`,
        },
        body: JSON.stringify(bookingData),
      });
    } catch (error) {
      console.error("Error creating booking:", error);
      throw error;
    }
  }

  static async fetchBooking(uid: string) {
    try {
      return fetch(`${TiQR.BASE_URL}participant/booking/${uid}/`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ApiToken}`,
        },
      });
    } catch (error) {
      console.error("Error fetching booking:", error);
      throw error;
    }
  }
}

export interface BookingResponse {
  booking: {
    id: number;
    participant_identification_id: string;
    uid: string;
    status: string;
  };
  payment: {
    url_to_redirect: string;
  };
}

export default TiQR;
