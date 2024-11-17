const { sendPusherData } = require("../common/pusher");
const { _getSQLAppClient, _getMongoLogClient } = require("../common/utility");

exports.changeChatUserStatus = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { user_id, enabled } = obj;
  const sqlAppClient = _getSQLAppClient();

  try {
    const query = `UPDATE chat_user SET enabled=${enabled} WHERE user_id=${user_id};`;
    await sqlAppClient.query(query);

    return true;
  } catch (e) {
    console.log("[change err]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};

/**
{
  user_id,
  messages: [
    {
      text: '',
      to_admin: true,
      created: timestamp
      updated: timestamp
    }
  ]
}
*/

exports.addMessage = async (_, obj, ctx) => {
  const { userId, permission, is_ghost } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0 || is_ghost) return false;
  const toAdmin = permission == "USER" ? true : false;

  // Event id "dev_123"
  const { text, urls, event_id } = obj;
  const currTime = new Date();

  const mongoClient = await _getMongoLogClient();
  const sqlAppClient = _getSQLAppClient();

  let res = "",
    query = "";

  try {
    const splits = event_id ? event_id.split("_") : [];
    const roomId = splits.length > 1 ? Number(splits[splits.length - 1]) : null;

    ////////////////////// Permission check ///////////////////////////////
    if (!roomId) throw Error("There is no room to modify");
    if (permission == "USER" && roomId != userId) throw Error("Student can not modify another chat room data");

    ////////////////////// chat_users /////////////////////////////////////
    query = `
      INSERT INTO chat_user (user_id, enabled) 
      VALUES (${roomId}, 1) 
      ON DUPLICATE KEY UPDATE count=count+1;
    `;
    await sqlAppClient.query(query);

    ////////////////////// Handle DB ///////////////////////////////
    // Determine whether there is document inside MongoDB
    res = await mongoClient
      .db(process.env.MONGO_DB_INSPECT_NAME)
      .collection("chat.hist")
      .aggregate([{ $match: { user_id: roomId } }, { $project: { _id: "$_id" } }])
      .toArray();

    if (!res || res.length == 0) {
      // If there is no document for this user-course pair, then insert new one
      await mongoClient
        .db(process.env.MONGO_DB_INSPECT_NAME)
        .collection("chat.hist")
        .insertOne({
          user_id: roomId, // same as room id
          messages: [
            {
              text: text,
              urls: urls,
              to_admin: toAdmin,
              created: currTime,
              updated: currTime,
            },
          ],
        });
    } else {
      // If there is item
      const objectId = res[0]["_id"];

      await mongoClient
        .db(process.env.MONGO_DB_INSPECT_NAME)
        .collection("chat.hist")
        .updateOne(
          { _id: objectId },
          {
            $push: {
              messages: {
                $each: [
                  {
                    text: text,
                    urls: urls,
                    to_admin: toAdmin,
                    created: currTime,
                    updated: currTime,
                  },
                ],
                $position: 0,
              },
            },
          }
        );
    }

    ////////////////////// Send via pusher /////////////////////////
    const data = {
      text: text,
      urls: urls,
      to_admin: toAdmin,
      created: currTime,
      updated: currTime,
    };

    await sendPusherData("message", `${process.env.REACT_APP_SITE_NAME}_${roomId}`, data);

    return true;
  } catch (e) {
    console.log("[error]", e);
    return false;
  } finally {
    mongoClient.close();
    sqlAppClient.quit();
  }
};

exports.editMessage = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return false;

  // const { text, event_id, urls, created } = obj;

  return true;
};

exports.deleteOneMessage = async (_, obj, ctx) => {
  const { userId, permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return false;

  const { user_id, created } = obj;

  const delUserId = permission == "USER" ? userId : user_id;

  const mongoClient = await _getMongoLogClient();

  try {
    await mongoClient
      .db(process.env.MONGO_DB_INSPECT_NAME)
      .collection("chat.hist")
      .deleteOne({
        user_id: delUserId,
        "messages.created": new Date(created),
      });
    return true;
  } catch (e) {
    console.log("[delete err]", e);
    return false;
  } finally {
    mongoClient.close();
  }
};

exports.deleteAllMessage = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { user_id } = obj;

  const mongoClient = await _getMongoLogClient();

  try {
    await mongoClient.db(process.env.MONGO_DB_INSPECT_NAME).collection("chat.hist").deleteOne({ user_id: user_id });
    return true;
  } catch (e) {
    console.log("[delete err]", e);
    return false;
  } finally {
    mongoClient.close();
  }
};

exports.editChatFlag = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const sqlAppClient = _getSQLAppClient();

  const { enabled } = obj;

  try {
    const query = `UPDATE site_key SET value=${enabled ? 1 : 0} WHERE \`key\` = 'chat_enabled'`;
    await sqlAppClient.query(query);

    return true;
  } catch (e) {
    console.log("[Edit chat Err]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};
