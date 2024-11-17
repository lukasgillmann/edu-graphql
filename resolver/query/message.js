const { _getMongoLogClient, _getSQLAppClient } = require("../common/utility");

const CHAT_LIST_SIZE = 20;

exports._listChatUser = async (sqlAppClient, mongoHistClient, enabled, page, pageSize) => {
  const query = `
    SELECT A.*, 
      B.email, B.username, TRIM(CONCAT(B.first_name, ' ', B.last_name)) AS fullname, 
      C.avatar, C.phone_number, C.role, C.location,
      IF(B.is_superuser = 1, 'SUPERADMIN', IF(B.is_staff = 1, 'STAFF', IF(D.state = 'granted', 'ADMIN', 'USER'))) AS permission
    FROM (
      SELECT id, user_id, count, DATE_FORMAT(created, '%Y-%m-%dT%TZ') AS created, DATE_FORMAT(updated, '%Y-%m-%dT%TZ') AS updated, enabled
      FROM chat_user
      WHERE enabled=${enabled}
      ORDER BY updated DESC
      LIMIT ${page * pageSize}, ${pageSize}
    ) AS A
      LEFT JOIN auth_user AS B ON A.user_id = B.id
      LEFT JOIN auth_userprofile AS C ON A.user_id = C.user_id
      LEFT JOIN course_creators_coursecreator D ON A.user_id = D.user_id;
    SELECT COUNT(*) AS total FROM chat_user WHERE enabled=${enabled};
  `;
  let users = await sqlAppClient.query(query);
  const total = users[1][0].total;
  users = users[0];

  // Now map pageSize chat history per each user
  if (users.length) {
    const hists = await mongoHistClient
      .db(process.env.MONGO_DB_INSPECT_NAME)
      .collection("chat.hist")
      .aggregate([
        {
          $project: {
            user_id: 1,
            messages: { $slice: ["$messages", CHAT_LIST_SIZE] },
          },
        },
      ])
      .toArray();

    for (let i = 0; i < users.length; i++) {
      const chatItem = hists.find((v) => v.user_id == users[i].user_id) || { messages: [] };
      users[i].messages = chatItem.messages;
      users[i].message_more = chatItem.messages.length == CHAT_LIST_SIZE;
      users[i].page = 0;
    }
  }

  return { total, page, page_size: pageSize, data: users };
};

exports.listChatUser = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return null;

  const { page, page_size, enabled } = obj;

  const sqlAppClient = await _getSQLAppClient();
  const mongoHistClient = await _getMongoLogClient();
  try {
    return await this._listChatUser(sqlAppClient, mongoHistClient, enabled, page, page_size);
  } catch (e) {
    console.log("[error]", e);
    return null;
  } finally {
    sqlAppClient.quit();
    mongoHistClient.close();
  }
};

exports._listChatHist = async (mongoHistClient, userId, page = 0, pageSize = CHAT_LIST_SIZE) => {
  let hists = await mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("chat.hist")
    .aggregate([
      { $match: { user_id: userId } },
      { $unwind: "$messages" },
      {
        $project: {
          text: "$messages.text",
          urls: "$messages.urls",
          to_admin: "$messages.to_admin",
          created: "$messages.created",
          updated: "$messages.updated",
        },
      },
    ])
    .toArray();

  hists = {
    message_more: hists.length == pageSize,
    page: page,
    messages: hists,
  };

  return hists;
};

exports.listChatHist = async (_, obj, ctx) => {
  const { userId, permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return null;

  const { page, page_size, user_id } = obj;

  const _userId = permission == "USER" ? userId : user_id;

  const mongoClient = await _getMongoLogClient();
  try {
    return await this._listChatHist(mongoClient, _userId, page, page_size);
  } catch (e) {
    console.log("[chat list error]", e);
    return null;
  } finally {
    mongoClient.close();
  }
};

exports._getChatEnableFlag = async (sqlAppClient) => {
  const query = `SELECT value FROM site_key WHERE \`key\`='chat_enabled'`;
  const res = await sqlAppClient.query(query);

  if (res.length) return res[0].value;
  return false;
};

exports.getChatEnableFlag = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return false;

  const sqlAppClient = _getSQLAppClient();

  try {
    return await this._getChatEnableFlag(sqlAppClient);
  } catch (e) {
    console.log("[get chat Err]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};
