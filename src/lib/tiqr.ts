import { ApiToken } from "../constants";

export class TiQR {
  static BASE_URL = "https://api.tiqr.events/";

  static async createBooking(bookingData: object) {
    try {
      const response = await fetch(`${TiQR.BASE_URL}participant/booking/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ApiToken}`,
        },
        body: JSON.stringify(bookingData),
      });
      return response.json() as Promise<BookingResponse>;
    } catch (error) {
      console.error("Error creating booking:", error);
      throw error;
    }
  }
}

interface BookingResponse {
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
