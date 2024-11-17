const { _getMongoLogClient, _getSQLAppClient, DEFAULT_OUTPUT } = require("../common/utility");

exports._getCommentsNumber = async (mongoHistClient, userId) => {
  // Get number of comments user posted
  return await mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("comment")
    .count({ author_id: Number(userId) });
};

exports.getCommentsNumber = async (_, obj, ctx) => {
  const { userId, permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return 0;

  const mongoClient = await _getMongoLogClient();

  try {
    // Get number of comments user posted
    this._getCommentsNumber(mongoClient, userId);
  } catch (e) {
    console.log("[err]", e);
    return 0;
  } finally {
    mongoClient.close();
  }
};

exports._listUserComment = async (mongoHistClient, userId, page = 0, pageSize = DEFAULT_OUTPUT.page_size) => {
  const filterBody = [{ $match: { author_id: userId } }];

  const proData = mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("comment")
    .aggregate([...filterBody, { $skip: pageSize * page }, { $limit: pageSize }])
    .toArray();

  const proTotal = mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("comment")
    .aggregate([...filterBody, { $group: { _id: null, count: { $sum: 1 } } }])
    .toArray();

  let [dbData, totalCount] = await Promise.all([proData, proTotal]);
  totalCount = totalCount.length ? totalCount[0].count : 0;

  let comments = {
    total: totalCount,
    page: page,
    page_size: pageSize,
    data: dbData,
  };

  return comments;
};

exports.listUserComment = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return null;

  const { user_id, page, page_size } = obj;

  const mongoClient = await _getMongoLogClient();

  try {
    return await this._listUserComment(mongoClient, user_id, page, page_size);
  } catch (e) {
    console.log("[list comment error]", e);
    return null;
  } finally {
    mongoClient.close();
  }
};

exports._listComment = async (sqlAppClient, mongoHistClient, courseId, discussionId = "", page = 0, pageSize = DEFAULT_OUTPUT.page_size) => {
  // Get comments for a course
  // let comments = await mongoHistClient.db('edx_hist').collection('comment').aggregate([
  //   { $match: { 'course_id': courseId, ...(discussionId ? { discussion_id: discussionId } : {}) } },
  //   {
  //     $facet: {
  //       metadata: [{ $count: "total" }],
  //       data: [{ $skip: pageSize * page }, { $limit: pageSize }],
  //     }
  //   }, {
  //     $project: {
  //       total: { $arrayElemAt: ["$metadata.total", 0] },
  //       data: 1
  //     }
  //   }
  // ]).toArray();
  // comments = {
  //   total: 0,
  //   page: page,
  //   page_size: pageSize,
  //   data: [],
  //   ...(comments.length ? comments[0] : {}),
  // };

  const filterBody = [{ $match: { course_id: courseId, ...(discussionId ? { discussion_id: discussionId } : {}) } }];

  const proData = mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("comment")
    .aggregate([...filterBody, { $skip: pageSize * page }, { $limit: pageSize }])
    .toArray();

  const proTotal = mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("comment")
    .aggregate([...filterBody, { $group: { _id: null, count: { $sum: 1 } } }])
    .toArray();

  let [dbData, totalCount] = await Promise.all([proData, proTotal]);
  totalCount = totalCount.length ? totalCount[0].count : 0;

  let comments = {
    total: totalCount,
    page: page,
    page_size: pageSize,
    data: dbData,
  };

  const userIds = [];
  for (let comment of comments.data) {
    userIds.push(comment.author_id);

    for (let reply of comment.reply) {
      userIds.push(reply.author_id);
    }
  }

  if (userIds.length) {
    const query = `SELECT user_id, avatar, cover FROM auth_userprofile WHERE user_id IN (${userIds});`;
    const res = await sqlAppClient.query(query);

    for (let i = 0; i < comments.data.length; i++) {
      const item = res.find((v) => v.user_id == comments.data[i].author_id) || {};
      comments.data[i] = { ...comments.data[i], avatar: item.avatar, cover: item.cover };

      for (let j = 0; j < comments.data[i].reply.length; j++) {
        const item1 = res.find((v) => v.user_id == comments.data[i].reply[j].author_id) || {};
        comments.data[i].reply[j] = { ...comments.data[i].reply[j], avatar: item1.avatar, cover: item1.cover };
      }
    }
  }

  return comments;
};

exports.listComment = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return null;

  const { course_id, discussion_id, page, page_size } = obj;

  const sqlAppClient = _getSQLAppClient();
  const mongoClient = await _getMongoLogClient();

  try {
    return await this._listComment(sqlAppClient, mongoClient, course_id, discussion_id, page, page_size);
  } catch (e) {
    console.log("[list comment error]", e);
    return null;
  } finally {
    sqlAppClient.quit();
    mongoClient.close();
  }
};

exports._listRecentComment = async (mongoHistClient) => {
  // Get comments for a course
  let comments = await mongoHistClient.db(process.env.MONGO_DB_INSPECT_NAME).collection("comment").find().sort({ updated_at: -1 }).limit(2).toArray();
  return comments;
};

exports.listRecentComment = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return null;

  const mongoClient = await _getMongoLogClient();

  try {
    return await this._listRecentComment(mongoClient);
  } catch (e) {
    console.log("[mongoerror]", e);
    return null;
  } finally {
    mongoClient.close();
  }
};

exports._listWholeComment = async (sqlAppClient, mongoHistClient, page = 0, pageSize = DEFAULT_OUTPUT.page_size) => {
  const proData = mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("comment")
    .aggregate([{ $sort: { updated_at: -1 } }, { $skip: pageSize * page }, { $limit: pageSize }])
    .toArray();

  const proTotal = mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("comment")
    .aggregate([{ $group: { _id: null, count: { $sum: 1 } } }])
    .toArray();

  let [dbData, totalCount] = await Promise.all([proData, proTotal]);
  totalCount = totalCount.length ? totalCount[0].count : 0;

  let comments = {
    total: totalCount,
    page: page,
    page_size: pageSize,
    data: dbData,
  };

  const userIds = [];
  for (let comment of comments.data) {
    userIds.push(comment.author_id);

    for (let reply of comment.reply) {
      userIds.push(reply.author_id);
    }
  }

  if (userIds.length) {
    const query = `SELECT user_id, avatar, cover FROM auth_userprofile WHERE user_id IN (${userIds});`;
    const res = await sqlAppClient.query(query);

    for (let i = 0; i < comments.data.length; i++) {
      const item = res.find((v) => v.user_id == comments.data[i].author_id) || {};
      comments.data[i] = { ...comments.data[i], avatar: item.avatar, cover: item.cover };

      for (let j = 0; j < comments.data[i].reply.length; j++) {
        const item1 = res.find((v) => v.user_id == comments.data[i].reply[j].author_id) || {};
        comments.data[i].reply[j] = { ...comments.data[i].reply[j], avatar: item1.avatar, cover: item1.cover };
      }
    }
  }

  return comments;
};

exports.listWholeComment = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const mongoClient = await _getMongoLogClient();
  const sqlAppClient = _getSQLAppClient();

  const { page, page_size } = obj;

  try {
    return await this._listWholeComment(sqlAppClient, mongoClient, page, page_size);
  } catch (e) {
    return null;
  } finally {
    mongoClient.close();
    sqlAppClient.quit();
  }
};
