export const BASE_URL = "https://api.tiqr.events/";

export const ApiEndpoints = {
  fetchBooking: (uid: string) => BASE_URL + `participant/booking/${uid}/`,
  createBooking: () => BASE_URL + `participant/booking/`,
};
