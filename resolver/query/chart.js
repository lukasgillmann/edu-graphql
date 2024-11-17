const { _getZeroTime } = require("../common/time");
const { _getMongoLogClient } = require("../common/utility");

exports._listTrackChart = async (mongoHistClient, startDate, endDate) => {
  const data = [];

  let hists = [];

  const starting = _getZeroTime(startDate);
  const step = 1000 * 60 * 60 * 24;

  // ************************************ MODULE ************************************
  hists = await mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.module")
    .aggregate([
      { $unwind: "$data" },
      { $match: { "data.date": { $gte: startDate, $lt: endDate } } },
      {
        $project: {
          _id: 0,
          user_id: 1,
          date: "$data.date",
          total_spent: { $sum: "$data.details.total_spent" },
          correct_count: { $sum: "$data.details.correct_count" },
          total_count: { $sum: "$data.details.total_count" },
        },
      },
    ])
    .toArray();

  for (let dt = starting; dt < endDate; dt += step) {
    const items = hists.filter((v) => v.date == dt);
    const learningTime = items.reduce((a, b) => a + b.total_spent, 0);
    const uniqueUserIds = [...new Set(items.map((v) => v.user_id))];

    data.push([dt, uniqueUserIds.length, learningTime]);
  }

  return { start: startDate, end: endDate, data: data || [] };
};

exports.listTrackChart = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { start, end } = obj;

  const mongoClient = await _getMongoLogClient();

  try {
    return await this._listTrackChart(mongoClient, Number(start), Number(end));
  } catch (e) {
    console.log("[mongoerror]", e);

    return null;
  } finally {
    mongoClient.close();
  }
};

exports._listDashboardChart = async (mongoHistClient, courseId, startDate, endDate) => {
  const data = [];

  let hists = [];

  const starting = _getZeroTime(startDate);
  const step = 1000 * 60 * 60 * 24;

  // ************************************ MODULE ************************************
  hists = await mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.module")
    .aggregate([
      { $match: { ...(courseId ? { course_id: courseId } : {}) } },
      { $unwind: "$data" },
      { $match: { "data.date": { $gte: starting, $lt: endDate } } },
      {
        $project: {
          _id: 0,
          user_id: 1,
          date: "$data.date",
          total_spent: { $sum: "$data.details.total_spent" },
          correct_count: { $sum: "$data.details.correct_count" },
          total_count: { $sum: "$data.details.total_count" },
        },
      },
    ])
    .toArray();

  const activeUserCount = [...new Set(hists.map((v) => v.user_id))].length || 0;

  for (let dt = starting; dt < endDate; dt += step) {
    const items = hists.filter((v) => v.date == dt);
    const uniqueUserIds = [...new Set(items.map((v) => v.user_id))];
    const correct = items.reduce((a, b) => a + b.correct_count, 0);
    const total = items.reduce((a, b) => a + b.total_count, 0);

    data.push([dt, uniqueUserIds.length, total ? (correct * 100) / total : 0]);
  }

  return { start: startDate, end: endDate, data: data || [], actives: activeUserCount };
};

exports.listDashboardChart = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { course_id, start, end } = obj;

  const mongoClient = await _getMongoLogClient();

  try {
    return await this._listDashboardChart(mongoClient, course_id, Number(start), Number(end));
  } catch (e) {
    console.log("[mongoerror]", e);

    return null;
  } finally {
    mongoClient.close();
  }
};

exports._listUserTimeChart = async (mongoHistClient, userId, startDate, endDate) => {
  const data = {
    total_module_spent: 0,
    total_quiz_spent: 0,
    total_virtual_spent: 0,
    total_replay_spent: 0,
    start: startDate,
    end: endDate,
    data: [], // [ date, module_spent, quiz_spent, replay_spent, virtual_spent]
  };

  let hists = [];

  const starting = _getZeroTime(startDate);
  const step = 1000 * 60 * 60 * 24;

  // ************************************ MODULE ************************************
  hists = await mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.module")
    .aggregate([{ $match: { user_id: userId } }, { $project: { course_id: 1, total_spent: 1, quiz_spent: 1 } }])
    .toArray();
  data.total_module_spent = Math.round(hists.reduce((a, b) => (b.total_spent ? a + b.total_spent : a), 0) || 0);
  data.total_quiz_spent = Math.round(hists.reduce((a, b) => (b.quiz_spent ? a + b.quiz_spent : a), 0) || 0);

  hists = await mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.module")
    .aggregate([
      { $match: { user_id: userId } },
      { $unwind: "$data" },
      { $match: { "data.date": { $gte: startDate, $lt: endDate } } },
      {
        $project: {
          _id: 0,
          course_id: 1,
          date: "$data.date",
          course_spent: { $sum: "$data.details.total_spent" },
          quiz_spent: { $sum: "$data.details.quiz_spent" },
        },
      },
    ])
    .toArray();

  for (let dt = starting; dt < endDate; dt += step) {
    const items = hists.filter((v) => v.date == dt);
    const totalSpent = items.reduce((a, b) => a + b.course_spent, 0);
    const quizSpent = items.reduce((a, b) => a + b.quiz_spent, 0);
    data.data.push([dt, totalSpent, quizSpent, 0, 0]);
  }

  // ************************************ REPLAY ************************************
  hists = await mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.replay")
    .aggregate([{ $match: { user_id: userId } }, { $project: { course_id: 1, total_spent: 1 } }])
    .toArray();
  data.total_replay_spent = Math.round(hists.reduce((a, b) => (b.total_spent ? a + b.total_spent : a), 0) || 0);

  hists = await mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.replay")
    .aggregate([
      { $match: { user_id: userId } },
      { $unwind: "$data" },
      { $match: { "data.date": { $gte: startDate, $lt: endDate } } },
      {
        $project: {
          _id: 0,
          course_id: 1,
          date: "$data.date",
          spent: { $sum: "$data.details.spent" },
        },
      },
    ])
    .toArray();

  let idx = 0;
  for (let dt = starting; dt < endDate; dt += step) {
    const items = hists.filter((v) => v.date == dt);
    const spent = items.reduce((a, b) => a + b.spent, 0);
    data.data[idx][3] = spent;
    idx += 1;
  }

  // ************************************ Meeting ************************************
  hists = await mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.meeting")
    .aggregate([{ $match: { user_id: userId } }, { $project: { course_id: 1, total_spent: 1 } }])
    .toArray();
  data.total_virtual_spent = Math.round(hists.reduce((a, b) => (b.total_spent ? a + b.total_spent : a), 0) || 0);

  hists = await mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.meeting")
    .aggregate([
      { $match: { user_id: userId } },
      { $unwind: "$data" },
      { $match: { "data.date": { $gte: startDate, $lt: endDate } } },
      {
        $project: {
          _id: 0,
          course_id: 1,
          total_spent: "$total_spent",
          date: "$data.date",
          spent: { $sum: "$data.details.spent" },
        },
      },
    ])
    .toArray();

  idx = 0;
  for (let dt = starting; dt < endDate; dt += step) {
    const items = hists.filter((v) => v.date == dt);
    const spent = items.reduce((a, b) => a + b.spent, 0);
    data.data[idx][4] = spent;
    idx += 1;
  }

  return data;
};

exports.listUserTimeChart = async (_, obj, ctx) => {
  const { userId, permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return null;

  const { user_id, start, end } = obj;

  const selUserId = permission == "USER" ? userId : user_id;

  const mongoClient = await _getMongoLogClient();

  try {
    return await this._listUserTimeChart(mongoClient, selUserId, Number(start), Number(end));
  } catch (e) {
    console.log("[mongoerror]", e);

    return null;
  } finally {
    mongoClient.close();
  }
};
