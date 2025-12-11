import { FastifyPluginAsync } from "fastify";
import type { DecodedIdToken } from "firebase-admin/auth";
import { validateAuthToken } from "../lib/auth";
import { HttpError, uuid } from "../lib/utils";
import { db } from "../lib/firebase";
import z from "zod";
import { FieldValue } from "firebase-admin/firestore";
import TiQR, { BookingData, BookingResponse } from "../lib/tiqr";
import { PaymentStatus, Tickets } from "../constants";

const Delegate: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.decorateRequest("user", null);
  fastify.addHook("onRequest", async (request, reply) => {
    const user = await validateAuthToken(request);

    if (!user) {
      reply //
        .code(401)
        .send({ error: true, message: "Unauthorized" });
      return;
    }

    request.setDecorator<DecodedIdToken>("user", user);
  });

  fastify.post("/delegate/create", async function (request, reply) {
    try {
      const user = request.getDecorator<DecodedIdToken>("user");

      const result = await db.runTransaction(async (tx): Promise<object> => {
        const userRef = db.collection("delegates").doc(user.uid);
        const snapshot = await tx.get(userRef);

        if (snapshot.exists) {
          const data = snapshot.data()!;
          if (data.member) {
            throw new HttpError(400, {
              error: true,
              message: "User is already a member of another delegate room",
            });
          }

          if (data.owner && data.roomId) {
            return {
              success: true,
              roomId: snapshot.data()!.roomId,
            };
          }
        }

        const roomId = uuid();

        const updatePayload = {
          owner: true,
          email: user.email,
          roomId,
          updatedAt: FieldValue.serverTimestamp(),
        } as DelegateUserData;

        if (!snapshot.exists || snapshot.data()!.createdAt === undefined) {
          updatePayload.createdAt = FieldValue.serverTimestamp();
        }

        tx.set(userRef, updatePayload, { merge: true });

        return {
          success: true,
          roomId,
        };
      });

      return result;
    } catch (err: any) {
      reply.code(err.statusCode ?? 500);
      fastify.log.error("Error in /delegate/create:");
      fastify.log.error(err.error || err);
      return {
        error: true,
        details: err.error || err.message || String(err),
      };
    }
  });

  fastify.post("/delegate/join", async function (request, reply) {
    try {
      const user = request.getDecorator<DecodedIdToken>("user");
      const body = DelegateJoinBody.safeParse(request.body);

      if (!body.success) {
        reply.code(400);
        return {
          error: true,
          message: "Invalid request body",
        };
      }

      const { roomId } = body.data;

      const result = await db.runTransaction(async (tx): Promise<object> => {
        const userRef = db.collection("delegates").doc(user.uid);
        const userSnap = await tx.get(userRef);

        if (userSnap.exists) {
          const userData = userSnap.data() as DelegateUserData;

          if (userData.member) {
            if (userData.member === roomId) {
              return {
                success: true,
                message: "Already a part of the delegate room",
              };
            }

            throw new HttpError(400, {
              error: true,
              message: "User is already a member of another delegate room",
            });
          }

          if (userData.owner) {
            throw new HttpError(400, {
              error: true,
              message: "User is already a room owner",
            });
          }
        }

        const roomQuery = db
          .collection("delegates")
          .where("roomId", "==", roomId);
        const roomSnap = await tx.get(roomQuery);

        if (roomSnap.empty) {
          throw new HttpError(404, {
            error: true,
            message: "Delegate room not found",
          });
        }

        const roomData = roomSnap.docs[0].data();
        const existingUsers = roomData.users as Record<string, string> | null;

        if (existingUsers && existingUsers[user.uid]) {
          return {
            success: true,
            message: "Already a part of the delegate room",
          };
        }

        tx.update(roomSnap.docs[0].ref, {
          [`users.${user.uid}`]: user.email,
          updatedAt: FieldValue.serverTimestamp(),
        });

        const updatePayload = {
          email: user.email,
          member: roomId,
          updatedAt: FieldValue.serverTimestamp(),
        } as DelegateUserData;

        if (!userSnap.exists || userSnap.data()!.createdAt === undefined) {
          updatePayload.createdAt = FieldValue.serverTimestamp();
        }

        tx.set(userRef, updatePayload, { merge: true });

        return {
          success: true,
          message: "Joined the delegate room successfully",
        };
      });

      return result;
    } catch (err: any) {
      reply.code(err.statusCode ?? 500);
      fastify.log.error("Error in /delegate/join:");
      fastify.log.error(err.error || err);
      return {
        error: true,
        details: err.error || err.message || String(err),
      };
    }
  });

  fastify.post("/delegate/leave", async function (request, reply) {
    try {
      const user = request.getDecorator<DecodedIdToken>("user");

      return await db.runTransaction(async (tx) => {
        const userRef = db.collection("delegates").doc(user.uid);
        const snapshot = await tx.get(userRef);

        if (!snapshot.exists) {
          return {
            success: true,
            message: "User is not part of any delegate room",
          };
        }

        if (snapshot.data()!.owner) {
          throw new HttpError(400, {
            error: true,
            message: "User is a room owner",
          });
        }

        if (!snapshot.data()!.member) {
          return {
            success: true,
            message: "User is not part of any delegate room",
          };
        }

        const roomId = snapshot.data()!.member;

        const roomQuery = db
          .collection("delegates")
          .where("roomId", "==", roomId);
        const roomSnap = await tx.get(roomQuery);

        tx.update(userRef, {
          member: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        if (roomSnap.empty) {
          return {
            success: true,
            message: "Delegate room not found",
          };
        }

        tx.update(roomSnap.docs[0].ref, {
          [`users.${user.uid}`]: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        return {
          success: true,
          message: "Left the delegate room successfully",
        };
      });
    } catch (err: any) {
      reply.code(err.statusCode ?? 500);
      fastify.log.error("Error in /delegate/leave:");
      fastify.log.error(err.error || err);
      return {
        error: true,
        details: err.error || err.message || String(err),
      };
    }
  });

  fastify.delete("/delegate/delete", async function (request, reply) {
    try {
      const user = request.getDecorator<DecodedIdToken>("user");

      return await db.runTransaction(async (tx) => {
        const userRef = db.collection("delegates").doc(user.uid);
        const userSnap = await tx.get(userRef);

        if (!userSnap.exists || !userSnap.data()!.owner) {
          return {
            success: true,
            message: "User isn't a room owner already",
          };
        }

        const roomId = userSnap.data()!.roomId;
        const roomUsersQuery = db
          .collection("delegates")
          .where("member", "==", roomId);
        const roomUsers = await tx.get(roomUsersQuery);

        tx.update(userRef, {
          owner: false,
          users: FieldValue.delete(),
          roomId: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        roomUsers.docs.forEach((doc) => {
          tx.update(doc.ref, {
            member: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        });

        return {
          success: true,
          message: "Delegate room deleted successfully",
        };
      });
    } catch (err: any) {
      reply.code(err.statusCode ?? 500);
      fastify.log.error("Error in /delegate/delete:");
      fastify.log.error(err.error || err);
      return {
        error: true,
        details: err.error || err.message || String(err),
      };
    }
  });

  fastify.post("/delegate/book-self", async function (request, reply) {
    try {
      const user = request.getDecorator<DecodedIdToken>("user");
      const body = DelegateBookSelfBody.safeParse(request.body);

      if (!body.success) {
        reply.code(400);
        return {
          error: true,
          details: "Invalid request body",
        };
      }

      const userSnap = await db.collection("delegates").doc(user.uid).get();

      if (!userSnap.exists) {
        await userSnap.ref.set(
          {
            email: user.email,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      const userData = userSnap.data() as DelegateUserData;

      if (userData.member || userData.owner) {
        reply.code(400);
        return {
          error: true,
          details: "You are already part of a delegate room, cannot book self",
        };
      }

      if (userData.selfBooking) {
        switch (userData.paymentStatus) {
          case PaymentStatus.PendingPayment:
            return {
              success: true,
              paymentUrl: userData.paymentUrl,
            };

          case PaymentStatus.Confirmed:
            reply.code(400);
            return {
              error: true,
              details: "You have already booked yourself as a delegate",
            };
        }
      }

      const tiqrResponse = await TiQR.createBooking({
        email: user.email ?? "",
        ticket: Tickets.Delegate,
        first_name: body.data.name.split(" ").at(0)!,
        last_name: body.data.name.split(" ").slice(1).join(" ") || "",
        phone_number: body.data.phone,
        meta_data: {
          address: body.data.address || "",
          college: body.data.college || "",
        },
      });

      const tiqrData = (await tiqrResponse.json()) as BookingResponse;

      await userSnap.ref.update({
        selfBooking: true,
        address: body.data.address,
        college: body.data.college,
        tiqrBookingUid: tiqrData.booking.uid,
        paymentUrl: tiqrData.payment.url_to_redirect,
        paymentStatus: PaymentStatus.PendingPayment,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        paymentUrl: tiqrData.payment.url_to_redirect,
      };
    } catch (err: any) {
      reply.code(err.statusCode ?? 500);
      fastify.log.error("Error in /delegate/book-self:");
      fastify.log.error(err.error || err);
      return {
        error: true,
        details: err.error || err.message || String(err),
      };
    }
  });

  fastify.get("/delegate/status-self", async function (request, reply) {
    try {
      const user = request.getDecorator<DecodedIdToken>("user");
      const userSnap = await db.collection("delegates").doc(user.uid).get();

      if (!userSnap.exists) {
        reply.code(404);
        return {
          error: true,
          details: "No delegate data found for user",
        };
      }

      const userData = userSnap.data() as DelegateUserData;

      if (!userData.selfBooking || !userData.tiqrBookingUid) {
        reply.code(404);
        return {
          error: true,
          details: "No self-booking found for user",
        };
      }

      if (userData.paymentStatus === PaymentStatus.Confirmed) {
        return {
          success: true,
          status: PaymentStatus.Confirmed,
        };
      }

      const tiqrResponse = await TiQR.fetchBooking(userData.tiqrBookingUid);
      const tiqrData = (await tiqrResponse.json()) as BookingData;

      if (tiqrData.status && tiqrData.status !== userData.paymentStatus) {
        await userSnap.ref.update({
          paymentStatus: tiqrData.status,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      return {
        success: true,
        status: tiqrData.status,
      };
    } catch (err: any) {
      reply.code(err.statusCode ?? 500);
      fastify.log.error("Error in /delegate/status-self:");
      fastify.log.error(err.error || err);
      return {
        error: true,
        details: err.error || err.message || String(err),
      };
    }
  });
};

const DelegateJoinBody = z.object({
  roomId: z.string().trim().length(15),
});

const DelegateBookSelfBody = z.object({
  phone: z.string().trim().min(10),
  name: z.string().trim().min(1),
  address: z.string().trim().optional(),
  college: z.string().trim().optional(),
});

interface DelegateUserData extends Record<string, any> {
  owner?: boolean;
  member?: string;
  roomId?: string;
  createdAt?: FirebaseFirestore.FieldValue;
  updatedAt?: FirebaseFirestore.FieldValue;
  users?: Record<string, string>;
  selfBooking?: boolean;
  tiqrBookingUid?: string;
  paymentUrl?: string;
  paymentStatus?: PaymentStatus;
}

export default Delegate;
