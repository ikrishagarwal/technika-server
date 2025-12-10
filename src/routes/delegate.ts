import { FastifyPluginAsync } from "fastify";
import type { DecodedIdToken } from "firebase-admin/auth";
import { validateAuthToken } from "../lib/auth";
import { uuid } from "../lib/utils";
import { db } from "../lib/firebase";
import z from "zod";
import { FieldValue } from "firebase-admin/firestore";

const Delegate: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.decorateRequest("user");
  fastify.addHook("onRequest", async (request, reply) => {
    const user = await validateAuthToken(request);

    if (!user) {
      reply //
        .status(401)
        .send({ error: true, message: "Unauthorized" });
      return;
    }

    request.setDecorator<DecodedIdToken>("user", user);
  });

  fastify.post("/delegate/create", async function (request, reply) {
    try {
      const user = request.getDecorator<DecodedIdToken>("user");
      const roomId = uuid();

      const existingSnapshot = await db
        .collection("delegates")
        .where("firebaseUid", "==", user.uid)
        .get();

      if (!existingSnapshot.empty) {
        return {
          success: true,
          roomId: existingSnapshot.docs[0].data().roomId,
        };
      }

      const delegateRef = db.collection("delegates").doc();
      await delegateRef.set({
        firebaseUid: user.uid,
        roomId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      return {
        success: true,
        roomId,
      };
    } catch (err: any) {
      reply.status(500);
      fastify.log.error("Error in /delegate/create:");
      fastify.log.error(err);
      return {
        error: true,
        message: "Internal Server Error",
        details: err.message || String(err),
      };
    }
  });

  fastify.post("/delegate/join", async function (request, reply) {
    try {
      const user = request.getDecorator<DecodedIdToken>("user");
      const body = DelegateJoinBody.safeParse(request.body);

      if (!body.success) {
        reply.status(400);
        return {
          error: true,
          message: "Invalid request body",
        };
      }

      const { roomId } = body.data;

      let dbUser = await db
        .collection("delegates")
        .where("firebaseUid", "==", user.uid)
        .get();

      if (dbUser.empty) {
        await db.collection("delegates").add({
          firebaseUid: user.uid,
          roomId: uuid(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        dbUser = await db
          .collection("delegates")
          .where("firebaseUid", "==", user.uid)
          .get();
      }

      const dbUserData = dbUser.docs[0].data();

      if (dbUserData.member) {
        reply.status(400);
        return {
          error: true,
          message: "User is already a member of another delegate room",
        };
      }

      if (Object.keys(dbUserData.users || {}).length > 0) {
        reply.status(400);
        return {
          error: true,
          message: "User is already part of a delegate room",
        };
      }

      const snapshot = await db
        .collection("delegates")
        .where("roomId", "==", roomId)
        .get();

      if (snapshot.empty) {
        reply.status(404);
        return {
          error: true,
          message: "Delegate room not found",
        };
      }

      const doc = snapshot.docs[0];
      const existingUsers = doc.data().users as Record<string, string> | null;

      if (existingUsers && existingUsers[user.uid]) {
        return {
          success: true,
          message: "Already joined the delegate room",
        };
      }

      await doc.ref.update({
        [`users.${user.uid}`]: user.email,
        updatedAt: new Date().toISOString(),
      });

      dbUser.docs[0].ref.update({
        member: roomId,
        updatedAt: new Date().toISOString(),
      });

      return {
        success: true,
        message: "Joined the delegate room successfully",
      };
    } catch (err: any) {
      reply.status(500);
      fastify.log.error("Error in /delegate/join:");
      fastify.log.error(err);
      return {
        error: true,
        message: "Internal Server Error",
        details: err.message || String(err),
      };
    }
  });

  fastify.post("/delegate/leave", async function (request, reply) {
    try {
      const user = request.getDecorator<DecodedIdToken>("user");

      const dbUser = await db
        .collection("delegates")
        .where("firebaseUid", "==", user.uid)
        .get();

      if (dbUser.empty) {
        return {
          success: true,
          message: "User is not part of any delegate room",
        };
      }

      if (Object.keys(dbUser.docs[0].data().users || {}).length > 0) {
        reply.status(400);
        return {
          error: true,
          message: "User is a room owner",
        };
      }

      if (!dbUser.docs[0].data().member) {
        return {
          success: true,
          message: "User is not part of any delegate room",
        };
      }

      dbUser.docs[0].ref.update({
        member: null,
        updatedAt: new Date().toISOString(),
      });

      const roomId = dbUser.docs[0].data().member;
      const roomSnapshot = await db
        .collection("delegates")
        .where("roomId", "==", roomId)
        .get();

      if (roomSnapshot.empty) {
        return {
          success: true,
          message: "Delegate room not found",
        };
      }

      await roomSnapshot.docs[0].ref.update({
        [`users.${user.uid}`]: FieldValue.delete(),
      });

      return {
        success: true,
        message: "Left the delegate room successfully",
      };
    } catch (err: any) {
      reply.status(500);
      fastify.log.error("Error in /delegate/leave:");
      fastify.log.error(err);
      return {
        error: true,
        message: "Internal Server Error",
        details: err.message || String(err),
      };
    }
  });
};

const DelegateJoinBody = z.object({
  roomId: z.string().length(10),
});

export default Delegate;
