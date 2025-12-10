import { FastifyPluginAsync } from "fastify";
import type { DecodedIdToken } from "firebase-admin/auth";
import { validateAuthToken } from "../lib/auth";
import { httpError, uuid } from "../lib/utils";
import { db } from "../lib/firebase";
import z from "zod";
import { FieldValue } from "firebase-admin/firestore";

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
            throw httpError(400, {
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
          roomId,
          updatedAt: FieldValue.serverTimestamp(),
        } as DelegateUserData;

        if (snapshot.exists && snapshot.data()!.createdAt === undefined) {
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

            throw httpError(400, {
              error: true,
              message: "User is already a member of another delegate room",
            });
          }

          if (userData.owner) {
            throw httpError(400, {
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
          throw httpError(404, {
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
          member: roomId,
          updatedAt: FieldValue.serverTimestamp(),
        } as DelegateUserData;

        if (userSnap.exists && userSnap.data()!.createdAt === undefined) {
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
          throw httpError(400, {
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
};

const DelegateJoinBody = z.object({
  roomId: z.string().trim().length(15),
});

interface DelegateUserData extends Record<string, any> {
  owner?: boolean;
  member?: string;
  roomId?: string;
  createdAt?: FirebaseFirestore.FieldValue;
  updatedAt?: FirebaseFirestore.FieldValue;
  users?: Record<string, string>;
}

export default Delegate;
