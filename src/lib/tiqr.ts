import { ApiToken } from "../constants";

export class TiQR {
  static BASE_URL = "https://api.tiqr.events";

  static async createBooking(bookingData: BookingPayload) {
    try {
      return fetch(`${TiQR.BASE_URL}/participant/booking/`, {
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

  static async createBulkBooking(bookingData: BulkBookingPayload) {
    try {
      return fetch(`${TiQR.BASE_URL}/participant/booking/bulk/`, {
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
      return fetch(`${TiQR.BASE_URL}/participant/booking/${uid}/`, {
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

  // LEGACY
  // static async bookComplimentary(eventId: number, payload: BookingPayload) {
  //   try {
  //     return await fetch(
  //       `${TiQR.BASE_URL}/organiser/event/${eventId}/booking/`,
  //       {
  //         method: "POST",
  //         headers: {
  //           "Content-Type": "application/json",
  //           Authorization: `Bearer ${ApiToken}`,
  //         },
  //         body: JSON.stringify({
  //           booking_type: "complimentary",
  //           ...payload,
  //         }),
  //       }
  //     );
  //   } catch (error) {
  //     console.error("Error fetching booking:", error);
  //     throw error;
  //   }
  // }
}

export interface BookingResponse {
  uid: string;
  booking: {
    id: number;
    participant_identification_id: string;
    uid: string;
    status: string;
  };
  ticket: {
    id: number;
  };
  payment: {
    url_to_redirect: string;
  };
  meta_data: Record<string, any>;
}

export interface BulkBookingResponse {
  booking: {
    uid: string;
    status: string;
    child_bookings: Array<{
      uid: string;
      status: string;
      meta_data: {
        uid: string;
      };
    }>;
  };
  payment: {
    url_to_redirect: string;
  };
}

export interface FetchBookingResponse {
  status: string;
  payment: {
    payment_id: string;
  };
}

export interface BookingPayload {
  first_name: string;
  last_name: string;
  phone_number: string;
  email: string;
  ticket: number;
  meta_data?: {
    [key: string]: any;
  };
  callback_url?: string | null;
  quantity?: number;
}

export interface BulkBookingPayload {
  bookings: BookingPayload[];
}

export default TiQR;
