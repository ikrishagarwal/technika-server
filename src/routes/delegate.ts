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
    const user = request.getDecorator<DecodedIdToken>("user");
    const body = CreateRoomBody.safeParse(request.body);

    if (!body.success) {
      reply.code(400);
      return {
        error: true,
        message: "Invalid request body",
        details: z.prettifyError(body.error),
      };
    }

    const result = await db.runTransaction(async (tx): Promise<object> => {
      const userRef = db.collection("delegates").doc(user.uid);
      const snapshot = await tx.get(userRef);

      if (snapshot.exists) {
        const data = snapshot.data()!;
        if (data.member) {
          throw new HttpError(
            400,
            "User is already a member of another delegate room"
          );
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
        name: body.data.name,
        phone: body.data.phone,
        college: body.data.college,
        roomId,
        updatedAt: FieldValue.serverTimestamp(),
      } as ExtendedDelegateSchema;

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
  });

  fastify.post("/delegate/join", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const body = JoinRoomBody.safeParse(request.body);

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
        const userData = userSnap.data() as ExtendedDelegateSchema;

        if (userData.member) {
          if (userData.member === roomId) {
            return {
              success: true,
              message: "Already a part of the delegate room",
            };
          }

          throw new HttpError(
            400,
            "User is already a member of another delegate room"
          );
        }

        if (userData.owner) {
          throw new HttpError(400, "User is already a room owner");
        }
      }

      const roomQuery = db
        .collection("delegates")
        .where("roomId", "==", roomId);
      const roomSnap = await tx.get(roomQuery);

      if (roomSnap.empty) {
        throw new HttpError(404, "Delegate room not found");
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
        [`users.${user.uid}`]: {
          email: user.email,
          name: body.data.name,
          phone: body.data.phone,
          college: body.data.college,
        },
        updatedAt: FieldValue.serverTimestamp(),
      });

      const updatePayload = {
        email: user.email,
        name: body.data.name,
        phone: body.data.phone,
        college: body.data.college,
        member: roomId,
        updatedAt: FieldValue.serverTimestamp(),
      } as ExtendedDelegateSchema;

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
  });

  fastify.delete("/delegate/leave", async function (request, reply) {
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
        throw new HttpError(400, "User is a room owner");
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
  });

  fastify.delete("/delegate/delete", async function (request, reply) {
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
  });

  fastify.get("/delegate/status/user", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const userSnap = await db.collection("delegate").doc(user.uid).get();

    if (!userSnap.exists) {
      reply.code(404);
      return {
        error: true,
        isOwner: false,
        isMember: false,
      };
    }

    const userData = userSnap.data() as ExtendedDelegateSchema;

    return {
      success: true,
      isOwner: Boolean(userData.owner),
      isMember: Boolean(userData.member),
      roomId: userData.roomId,
      selfBooking: Boolean(userData.selfBooking),
      paymentStatus: userData.paymentStatus,
      paymentUrl: userData.paymentUrl,
      users: userData.users ? Object.values(userData.users) : null,
    };
  });

  fastify.get("/delegate/status/room/:roomId", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const { roomId } = request.params as { roomId: string };
    const roomSnap = await db
      .collection("delegates")
      .where("roomId", "==", roomId)
      .get();

    if (roomSnap.empty) {
      reply.code(404);
      return {
        error: true,
        message: "Delegate room not found",
      };
    }

    const roomOwnerData = roomSnap.docs[0].data() as ExtendedDelegateSchema;

    const authorizedUserIds = [
      roomSnap.docs[0].id,
      ...Object.keys(roomOwnerData.users || {}),
    ];

    if (!authorizedUserIds.includes(user.uid)) {
      reply.code(403);
      return {
        error: true,
        message: "Forbidden: You are not associated with this delegate room",
      };
    }

    return {
      success: true,
      owner: {
        name: roomOwnerData.name,
        email: roomOwnerData.email,
        phone: roomOwnerData.phone,
        college: roomOwnerData.college,
      },
      users: roomOwnerData.users ? Object.values(roomOwnerData.users) : null,
      paymentStatus: roomOwnerData.paymentStatus,
      paymentUrl: roomOwnerData.paymentUrl,
    };
  });

  fastify.post("/delegate/register/self", async function (request, reply) {
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

    if (userSnap.exists) {
      const userData = userSnap.data() as ExtendedDelegateSchema;

      if (userData.owner) {
        reply.code(400);
        return {
          error: true,
          message: "Delete your existing room to register as self",
        };
      }

      if (userData.member) {
        reply.code(400);
        return {
          error: true,
          message: "Leave your existing room to register as self",
        };
      }

      if (
        userData.selfBooking &&
        userData.paymentStatus === PaymentStatus.Confirmed
      ) {
        reply.code(400);
        return {
          error: true,
          message: "You have already registered successfully as a delegate",
        };
      }

      if (
        userData.selfBooking &&
        userData.paymentStatus === PaymentStatus.PendingPayment
      ) {
        const payload = {} as any;

        if (body.data.address !== userData.address)
          payload.address = body.data.address;
        if (body.data.college !== userData.college)
          payload.college = body.data.college;
        if (body.data.name !== userData.name) payload.name = body.data.name;
        if (body.data.phone !== userData.phone) payload.phone = body.data.phone;

        if (Object.keys(payload).length > 0) {
          payload.updatedAt = FieldValue.serverTimestamp();
        }

        if (Object.keys(payload).length > 0) {
          await userSnap.ref.update(payload);
        }

        return {
          success: true,
          paymentUrl: userData.paymentUrl,
        };
      }
    }

    const tiqrResponse = await TiQR.createBooking({
      email: user.email ?? "",
      first_name: body.data.name.split(" ").at(0)!,
      last_name: body.data.name.split(" ").slice(1).join(" ") || "",
      phone_number: body.data.phone,
      ticket: Tickets.Delegate,
      meta_data: {
        address: body.data.address || "",
        selfBooking: true,
        college: body.data.college || "",
      },
    });

    const tiqrData = (await tiqrResponse.json()) as BookingResponse;

    const payload = {
      selfBooking: true,
      tiqrBookingUid: tiqrData.booking.uid,
      paymentUrl: tiqrData.payment.url_to_redirect || "",
      paymentStatus: tiqrData.booking.status,
      updatedAt: FieldValue.serverTimestamp(),
    } as ExtendedDelegateSchema;

    if (!userSnap.exists) payload.createdAt = FieldValue.serverTimestamp();

    await userSnap.ref.set(payload, { merge: true });

    return {
      success: true,
      paymentUrl: tiqrData.payment.url_to_redirect,
    };
  });

  // LEGACY ENDPOINTS
  // Keeping them untouched for backward compatibility
  fastify.post("/delegate/book-self", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const body = DelegateBookSelfBody.safeParse(request.body);

    if (!body.success) {
      reply.code(400);
      return {
        error: true,
        details: "Invalid request body",
      };
    }

    let userSnap = await db
      .collection("delegate_registrations")
      .doc(user.uid)
      .get();

    if (!userSnap.exists) {
      await userSnap.ref.set({
        email: user.email,
        name: body.data.name,
        phone: body.data.phone,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      userSnap = await userSnap.ref.get();
    }

    const userData = userSnap.data() as DelegateSchema;

    if (
      userData.self?.paymentStatus === PaymentStatus.Confirmed ||
      userData.group?.paymentStatus === PaymentStatus.Confirmed
    ) {
      reply.code(400);
      return {
        error: true,
        details: "You have already booked yourself as a delegate",
      };
    }

    if (userData.self?.paymentStatus) {
      switch (userData.self.paymentStatus) {
        case PaymentStatus.PendingPayment:
          const payload = {} as any;

          if (body.data.address !== userData.address)
            payload["address"] = body.data.address;
          if (body.data.college !== userData.college)
            payload["college"] = body.data.college;
          if (body.data.name !== userData.name)
            payload["name"] = body.data.name;
          if (body.data.phone !== userData.phone)
            payload["phone"] = body.data.phone;

          if (Object.keys(payload).length > 0) {
            payload["updatedAt"] = FieldValue.serverTimestamp();
            await userSnap.ref.update(payload);
          }

          return {
            success: true,
            paymentUrl: userData.self.paymentUrl,
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
      callback_url: body.data.callbackUrl || "",
    });

    const tiqrData = (await tiqrResponse.json()) as BookingResponse;

    await userSnap.ref.update({
      address: body.data.address,
      college: body.data.college,
      self: {
        tiqrBookingUid: tiqrData.booking.uid,
        paymentUrl: tiqrData.payment.url_to_redirect,
        paymentStatus: PaymentStatus.PendingPayment,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      paymentUrl: tiqrData.payment.url_to_redirect,
    };
  });

  fastify.get("/delegate/status-self", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const userSnap = await db
      .collection("delegate_registrations")
      .doc(user.uid)
      .get();

    if (!userSnap.exists) {
      reply.code(404);
      return {
        error: true,
        details: "No delegate data found for user",
      };
    }

    const userData = userSnap.data() as DelegateSchema;

    if (!userData.self?.tiqrBookingUid) {
      reply.code(404);
      return {
        error: true,
        details: "No self-booking found for user",
      };
    }

    if (userData.self.paymentStatus === PaymentStatus.Confirmed) {
      return {
        success: true,
        status: PaymentStatus.Confirmed,
      };
    }

    const tiqrResponse = await TiQR.fetchBooking(userData.self.tiqrBookingUid);
    const tiqrData = (await tiqrResponse.json()) as BookingData;

    if (tiqrData.status && tiqrData.status !== userData.self.paymentStatus) {
      await userSnap.ref.update({
        "self.paymentStatus": tiqrData.status,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return {
      success: true,
      status: tiqrData.status,
    };
  });

  fastify.post("/delegate/book-group", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const body = DelegateBookGroupBody.safeParse(request.body);

    if (!body.success) {
      reply.code(400);
      return {
        error: true,
        message: "Invalid request body",
      };
    }

    let userSnap = await db
      .collection("delegate_registrations")
      .doc(user.uid)
      .get();

    if (!userSnap.exists) {
      await userSnap.ref.set({
        email: user.email,
        name: body.data.leader.name,
        phone: body.data.leader.phone,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      userSnap = await userSnap.ref.get();
    }

    const userData = userSnap.data() as DelegateSchema;

    if (
      userData.group?.paymentStatus === PaymentStatus.Confirmed ||
      userData.self?.paymentStatus === PaymentStatus.Confirmed
    ) {
      reply.code(400);
      return {
        error: true,
        details: "You have already booked as a delegate",
      };
    }

    if (userData.group?.paymentStatus) {
      switch (userData.group.paymentStatus) {
        case PaymentStatus.PendingPayment:
          return {
            success: true,
            paymentUrl: userData.group.paymentUrl,
          };
      }
    }

    if (!body.data.members) body.data.members = [];

    const tiqrResponse = await TiQR.createBooking({
      first_name: body.data.leader.name.split(" ").at(0)!,
      last_name: body.data.leader.name.split(" ").slice(1).join(" ") || "",
      phone_number: body.data.leader.phone,
      email: user.email ?? "",
      quantity:
        body.data.members.length -
        Math.floor((body.data.members.length + 1) / 6) +
        1,
      ticket: Tickets.Delegate,
      meta_data: {
        members: body.data.members,
      },
    });

    const tiqrData = (await tiqrResponse.json()) as BookingResponse;

    await userSnap.ref.update({
      address: body.data.leader.address || "",
      college: body.data.leader.college || "",
      group: {
        tiqrBookingUid: tiqrData.booking.uid,
        paymentUrl: tiqrData.payment.url_to_redirect || "",
        paymentStatus: tiqrData.booking.status,
        members: body.data.members,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      paymentUrl: tiqrData.payment.url_to_redirect,
    };
  });

  fastify.delete("/delegate/group-reset", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const userSnap = await db
      .collection("delegate_registrations")
      .doc(user.uid)
      .get();

    if (!userSnap.exists) {
      reply.code(404);
      return {
        error: true,
        message: "User not registered as delegate",
      };
    }

    if (userSnap.data()?.group)
      await userSnap.ref.update({
        group: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });

    return {
      success: true,
      message: "Delegate group booking data reset successfully",
    };
  });

  fastify.get("/delegate/status-group", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");

    const userSnap = await db
      .collection("delegate_registrations")
      .doc(user.uid)
      .get();

    if (!userSnap.exists) {
      reply.code(404);
      return {
        error: true,
        status: "unregistered",
        message: "User not registered as delegate",
      };
    }

    const userData = userSnap.data() as DelegateSchema;
    if (!userData.group?.tiqrBookingUid) {
      reply.code(404);
      return {
        error: true,
        status: "unregistered",
        message: "No group booking found for user",
      };
    }

    if (userData.group.paymentStatus === PaymentStatus.Confirmed) {
      return {
        success: true,
        status: PaymentStatus.Confirmed,
      };
    }

    const tiqrResponse = await TiQR.fetchBooking(userData.group.tiqrBookingUid);
    const tiqrData = (await tiqrResponse.json()) as BookingData;

    if (tiqrData.status && tiqrData.status !== userData.group.paymentStatus) {
      await userSnap.ref.update({
        "group.paymentStatus": tiqrData.status,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return {
      success: true,
      status: tiqrData.status,
    };
  });

  fastify.get("/delegate/status", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");

    const userSnap = await db
      .collection("delegate_registrations")
      .doc(user.uid)
      .get();

    if (!userSnap.exists) {
      reply.code(404);
      return {
        error: true,
        status: "unregistered",
        message: "User not registered as delegate",
      };
    }

    const userData = userSnap.data() as DelegateSchema;
    const response = {
      success: false,
    } as any;

    if (userData.self?.paymentStatus) {
      response.success = true;
      response.isSelf = true;
      response.statusSelf = userData.self.paymentStatus;
    }

    if (userData.group?.paymentStatus) {
      response.success = true;
      response.isGroup = true;
      response.statusGroup = userData.group.paymentStatus;
    }

    if (response.success) return response;

    reply.code(404);
    return {
      error: true,
      status: "unregistered",
      message: "No booking found for user",
    };
  });
};

const CreateRoomBody = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().min(10),
  college: z.string().trim().min(1),
});

const JoinRoomBody = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().min(10),
  college: z.string().trim().min(1),
  roomId: z.string().trim().length(15),
});

const DelegateBookSelfBody = z.object({
  phone: z.string().trim().min(10),
  name: z.string().trim().min(1),
  address: z.string().trim().optional(),
  college: z.string().trim().optional(),
  callbackUrl: z.string().trim().optional(),
});

const DelegateBookGroupBody = z.object({
  leader: z.object({
    name: z.string().trim().min(1),
    phone: z.string().trim().min(10),
    college: z.string().trim(),
    address: z.string().trim().optional(),
  }),
  members: z.array(
    z.object({
      name: z.string().trim().min(1),
      phone: z.string().trim().min(10),
      email: z.email().trim(),
    })
  ),
});

export interface DelegateSchema extends Record<string, any> {
  email: string;
  name: string;
  phone: string;
  address?: string;
  college?: string;
  self?: {
    tiqrBookingUid?: string;
    paymentUrl?: string;
    paymentStatus?: PaymentStatus;
  };
  group?: {
    tiqrBookingUid?: string;
    paymentUrl?: string;
    paymentStatus?: PaymentStatus;
    members: Array<{
      name: string;
      phone: string;
      email: string;
    }>;
  };
  createdAt?: FirebaseFirestore.FieldValue;
  updatedAt?: FirebaseFirestore.FieldValue;
}
interface ExtendedDelegateSchema extends Record<string, any> {
  owner?: boolean;
  member?: string;
  roomId?: string;
  createdAt?: FirebaseFirestore.FieldValue;
  updatedAt?: FirebaseFirestore.FieldValue;
  users?: Record<
    string,
    {
      name: string;
      email: string;
      phone: string;
      college: string;
    }
  >;
  selfBooking?: boolean;
  tiqrBookingUid?: string;
  paymentUrl?: string;
  paymentStatus?: PaymentStatus;
}

export default Delegate;
